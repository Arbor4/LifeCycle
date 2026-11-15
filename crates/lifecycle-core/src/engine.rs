use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use regex::Regex;
use serde::Serialize;
use tokio::process::Child;
use tokio::sync::Notify;

use crate::compile::{
    self, BuildResult, BuildSummary, CompileControl, CompileKind,
};
use crate::config::{Config, ProjectPaths};
use crate::error::{Error, Result};
use crate::logs::{LogHub, LogPage};
use crate::process::{
    self, now_ms, ReadyKind, RunRecord, State, StateStore,
};

#[derive(Debug, Clone, Serialize)]
pub struct ProfileStatus {
    pub profile: String,
    pub state: State,
    pub pid: Option<u32>,
    pub uptime_ms: Option<u64>,
    pub command: Option<String>,
    pub port: Option<u16>,
    pub last_build: Option<BuildSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartOutcome {
    pub state: State,
    pub pid: u32,
    pub ready: bool,
    pub logs_tail: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StopOutcome {
    pub state: State,
    pub exit_code: Option<i32>,
}

pub struct Engine {
    config_path: PathBuf,
    config: Config,
    paths: ProjectPaths,
    store: StateStore,
    hub: LogHub,
    children: HashMap<String, Child>,
    compiling: HashMap<String, CompileControl>,
    builds_path: PathBuf,
}

impl Engine {
    pub fn new(config_path: &Path) -> Result<Self> {
        let config = Config::load(config_path)?;
        let paths = ProjectPaths::new(config_path, &config);
        let store = StateStore::new(&paths.state_file);
        let hub = LogHub::new(&paths.log_dir);
        let builds_path = paths.root.join(".lifecycle").join("builds.json");
        Ok(Self {
            config_path: config_path.to_path_buf(),
            config,
            paths,
            store,
            hub,
            children: HashMap::new(),
            compiling: HashMap::new(),
            builds_path,
        })
    }

    pub fn reload_config(&mut self) -> Result<()> {
        self.config = Config::load(&self.config_path)?;
        self.paths = ProjectPaths::new(&self.config_path, &self.config);
        self.hub = LogHub::new(&self.paths.log_dir);
        Ok(())
    }

    pub fn project_name(&self) -> &str {
        &self.config.project.name
    }

    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    pub fn mcp_expose(&self) -> &[String] {
        &self.config.mcp.expose
    }

    pub fn mcp_transport(&self) -> &str {
        &self.config.mcp.transport
    }

    pub fn log_len(&self, profile: &str, source: &str) -> Result<u64> {
        self.config.profile(profile)?;
        Ok(std::fs::metadata(self.hub.path(profile, source))
            .map(|m| m.len())
            .unwrap_or(0))
    }

    pub fn list(&self) -> Result<Vec<ProfileStatus>> {
        let records = self.store.load()?;
        let builds = compile::load_builds(&self.builds_path)?;
        Ok(self
            .config
            .profiles
            .iter()
            .map(|(name, cfg)| {
                status_from(name, records.get(name), builds.get(name), cfg.start.ready_port)
            })
            .collect())
    }

    pub fn status(&self, profile: &str) -> Result<ProfileStatus> {
        let cfg = self.config.profile(profile)?;
        let records = self.store.load()?;
        let builds = compile::load_builds(&self.builds_path)?;
        Ok(status_from(
            profile,
            records.get(profile),
            builds.get(profile),
            cfg.start.ready_port,
        ))
    }

    pub fn is_compiling(&self, profile: &str) -> bool {
        self.compiling.contains_key(profile)
    }

    pub async fn compile(
        &mut self,
        profile: &str,
        kind: CompileKind,
        targets: &[String],
    ) -> Result<BuildResult> {
        self.compile_with_cancel(profile, kind, targets, Arc::new(Notify::new()))
            .await
    }

    pub async fn compile_with_cancel(
        &mut self,
        profile: &str,
        kind: CompileKind,
        targets: &[String],
        cancel: Arc<Notify>,
    ) -> Result<BuildResult> {
        let profile_cfg = self.config.profile(profile)?.clone();
        let cmd_cfg = match kind {
            CompileKind::Quick => profile_cfg.compile.quick.as_ref(),
            CompileKind::Partial => profile_cfg.compile.partial.as_ref(),
            CompileKind::Full => profile_cfg.compile.full.as_ref(),
        }
        .ok_or_else(|| {
            Error::NotFound(format!(
                "compile.{} not configured for profile '{profile}'",
                kind.as_str()
            ))
        })?
        .clone();

        let command = if kind == CompileKind::Partial {
            if targets.is_empty() && cmd_cfg.command.contains("{targets}") {
                return Err(Error::Config(
                    "partial compile requires at least one target".into(),
                ));
            }
            cmd_cfg.command.replace("{targets}", &targets.join(","))
        } else {
            cmd_cfg.command.clone()
        };

        if self.compiling.contains_key(profile) {
            return Err(Error::Busy(format!("profile '{profile}' is already compiling")));
        }
        let lock = compile::acquire_lock(&self.paths.root.join(".lifecycle"), profile)?;

        let spawned = compile::spawn_compile(
            &command,
            &self.paths.workdir(&profile_cfg),
            &profile_cfg.env,
        );
        let (child, pid) = match spawned {
            Ok(v) => v,
            Err(e) => {
                compile::release_lock(&lock);
                return Err(e);
            }
        };
        self.compiling.insert(
            profile.into(),
            CompileControl {
                pid,
                cancel: cancel.clone(),
            },
        );

        let started = Instant::now();
        let waited = compile::wait_compile(
            child,
            pid,
            cmd_cfg.timeout_ms,
            cancel,
            self.config.process.stop_timeout_ms,
        )
        .await;
        self.compiling.remove(profile);
        compile::release_lock(&lock);
        let output = waited?;
        let duration_ms = started.elapsed().as_millis() as u64;
        let result = compile::build_result(&output, cmd_cfg.parser.as_deref(), duration_ms);

        // 编译输出落盘，供 UI / get_logs(source="build") / tail -f 查看。
        let build_log = self.paths.log_file(profile, "build");
        if let Ok(mut f) = crate::logs::ensure_log_file(&build_log) {
            use std::io::Write;
            let _ = writeln!(f, "$ {command}");
            let _ = f.write_all(output.stdout.as_bytes());
            let _ = f.write_all(output.stderr.as_bytes());
        }

        let mut builds = compile::load_builds(&self.builds_path)?;
        builds.insert(profile.into(), compile::summary_of(kind, &result));
        compile::save_builds(&self.builds_path, &builds)?;

        if output.timed_out {
            return Err(Error::Timeout(format!(
                "compile {kind:?} timed out after {}ms",
                cmd_cfg.timeout_ms
            )));
        }
        Ok(result)
    }

    pub fn cancel_compile(&mut self, profile: &str) -> Result<bool> {
        self.config.profile(profile)?;
        match self.compiling.get(profile) {
            Some(ctrl) => {
                ctrl.cancel.notify_waiters();
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub async fn start(&mut self, profile: &str, wait: bool) -> Result<StartOutcome> {
        self.start_with_timeout(profile, wait, None).await
    }

    pub async fn start_with_timeout(
        &mut self,
        profile: &str,
        wait: bool,
        timeout_ms: Option<u64>,
    ) -> Result<StartOutcome> {
        let profile_cfg = self.config.profile(profile)?.clone();
        let mut start_cfg = profile_cfg.start.clone();
        if let Some(t) = timeout_ms {
            start_cfg.ready_timeout_ms = t;
        }
        let mut records = self.store.load()?;
        if let Some(prev) = records.get(profile) {
            if process::is_alive(prev.pid) {
                return Err(Error::Busy(format!(
                    "profile '{profile}' already running (pid {})",
                    prev.pid
                )));
            }
        }

        let (mut record, mut child) =
            process::spawn(profile, &profile_cfg, &self.paths, self.config.logs.color)?;
        let pid = record.pid;
        records.insert(profile.into(), record.clone());
        self.store.save(&records)?;

        if !wait {
            record.state = State::Running;
            records.insert(profile.into(), record.clone());
            self.store.save(&records)?;
            self.children.insert(profile.into(), child);
            return Ok(StartOutcome {
                state: State::Running,
                pid,
                ready: false,
                logs_tail: Vec::new(),
            });
        }

        let outcome = process::wait_ready(
            &mut child,
            &record,
            &start_cfg,
            &self.hub,
            profile,
            self.config.logs.buffer_lines,
        )
        .await?;

        match outcome.kind {
            ReadyKind::Ready => {
                record.state = State::Running;
                records.insert(profile.into(), record);
                self.store.save(&records)?;
                self.children.insert(profile.into(), child);
                Ok(StartOutcome {
                    state: State::Running,
                    pid,
                    ready: true,
                    logs_tail: outcome.tail,
                })
            }
            ReadyKind::TimedOut => {
                record.state = State::Running;
                records.insert(profile.into(), record);
                self.store.save(&records)?;
                self.children.insert(profile.into(), child);
                Err(Error::Timeout(format!(
                    "profile '{profile}' not ready within {}ms; last logs:\n{}",
                    start_cfg.ready_timeout_ms,
                    outcome.tail.join("\n")
                )))
            }
            ReadyKind::Exited => {
                record.state = State::Crashed;
                records.insert(profile.into(), record);
                self.store.save(&records)?;
                Err(Error::NotReady(format!(
                    "profile '{profile}' exited during startup (code {:?}); last logs:\n{}",
                    outcome.exit_code,
                    outcome.tail.join("\n")
                )))
            }
        }
    }

    pub async fn stop(&mut self, profile: &str) -> Result<StopOutcome> {
        self.stop_with_timeout(profile, None).await
    }

    pub async fn stop_with_timeout(
        &mut self,
        profile: &str,
        timeout_ms: Option<u64>,
    ) -> Result<StopOutcome> {
        self.config.profile(profile)?;
        let mut records = self.store.load()?;
        let Some(mut record) = records.remove(profile) else {
            return Ok(StopOutcome {
                state: State::Idle,
                exit_code: None,
            });
        };
        record.state = State::Stopping;
        let mut with_stopping = records.clone();
        with_stopping.insert(profile.into(), record.clone());
        self.store.save(&with_stopping)?;

        let timeout_ms = timeout_ms.unwrap_or(self.config.process.stop_timeout_ms);
        let exit_code = match self.children.remove(profile) {
            Some(mut child) => process::stop_child(&mut child, record.pid, timeout_ms).await?,
            None => {
                process::stop_group(record.pid, timeout_ms).await?;
                None
            }
        };
        self.store.save(&records)?;
        Ok(StopOutcome {
            state: State::Idle,
            exit_code,
        })
    }

    pub async fn restart(&mut self, profile: &str, wait: bool) -> Result<StartOutcome> {
        self.stop(profile).await?;
        self.start(profile, wait).await
    }

    pub fn logs(
        &self,
        profile: &str,
        source: &str,
        lines: usize,
        filter: Option<&str>,
        since: Option<u64>,
    ) -> Result<LogPage> {
        self.config.profile(profile)?;
        if source != "run" && source != "build" {
            return Err(Error::NotFound(format!("log source '{source}'")));
        }
        let re = filter.map(Regex::new).transpose()?;
        match since {
            Some(cursor) => self.hub.read_since(profile, source, cursor, re.as_ref()),
            None => self.hub.tail(profile, source, lines, re.as_ref()),
        }
    }

    pub fn log_file(&self, profile: &str, source: &str) -> PathBuf {
        self.hub.path(profile, source)
    }

    /// Candidate targets for partial compile: top-level dirs + Maven <module> entries.
    pub fn modules(&self, profile: &str) -> Result<Vec<String>> {
        let profile_cfg = self.config.profile(profile)?;
        let workdir = self.paths.workdir(profile_cfg);
        let mut modules = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&workdir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
                modules.push(name);
            }
        }
        if let Ok(pom) = std::fs::read_to_string(workdir.join("pom.xml")) {
            let re = Regex::new(r"<module>([^<]+)</module>").unwrap();
            for cap in re.captures_iter(&pom) {
                let m = cap[1].trim().to_string();
                if !modules.contains(&m) {
                    modules.push(m);
                }
            }
        }
        modules.sort();
        Ok(modules)
    }
}

fn status_from(
    name: &str,
    record: Option<&RunRecord>,
    build: Option<&BuildSummary>,
    port: Option<u16>,
) -> ProfileStatus {
    let last_build = build.cloned();
    match record {
        None => ProfileStatus {
            profile: name.into(),
            state: State::Idle,
            pid: None,
            uptime_ms: None,
            command: None,
            port,
            last_build,
        },
        Some(r) => {
            let alive = process::is_alive(r.pid);
            let state = if alive { r.state } else { State::Crashed };
            ProfileStatus {
                profile: name.into(),
                state,
                pid: Some(r.pid),
                uptime_ms: alive.then(|| now_ms().saturating_sub(r.started_at_ms)),
                command: Some(r.command.clone()),
                port,
                last_build,
            }
        }
    }
}