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
    pub service: String,
    pub env_name: String,
    pub state: State,
    pub pid: Option<u32>,
    pub uptime_ms: Option<u64>,
    pub command: Option<String>,
    pub fast_start_command: Option<String>,
    pub stop_command: Option<String>,
    pub restart_command: Option<String>,
    pub workdir: Option<String>,
    pub port: Option<u16>,
    pub compile_quick: Option<String>,
    pub compile_partial: Option<String>,
    pub compile_full: Option<String>,
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

    pub fn list(&mut self) -> Result<Vec<ProfileStatus>> {
        self.reap_exited()?;
        let records = self.store.load()?;
        let builds = compile::load_builds(&self.builds_path)?;
        Ok(self
            .config
            .profiles
            .iter()
            .map(|(name, cfg)| {
                status_from(name, cfg, records.get(name), builds.get(name))
            })
            .collect())
    }

    pub fn status(&mut self, profile: &str) -> Result<ProfileStatus> {
        self.reap_exited()?;
        let cfg = self.config.profile(profile)?;
        let records = self.store.load()?;
        let builds = compile::load_builds(&self.builds_path)?;
        Ok(status_from(
            profile,
            cfg,
            records.get(profile),
            builds.get(profile),
        ))
    }

    pub fn is_compiling(&self, profile: &str) -> bool {
        self.compiling.contains_key(profile)
    }

    /// 就绪后退出进程无人回收会变成僵尸（kill(pid,0) 仍为真），状态将永远停在
    /// Running；每次状态轮询时 try_wait 回收并落盘 Crashed。
    fn reap_exited(&mut self) -> Result<()> {
        let mut records = self.store.load()?;
        let mut changed = false;
        let names: Vec<String> = self.children.keys().cloned().collect();
        for name in names {
            let exited = self
                .children
                .get_mut(&name)
                .and_then(|child| child.try_wait().ok().flatten())
                .is_some();
            if !exited {
                continue;
            }
            self.children.remove(&name);
            if let Some(r) = records.get_mut(&name) {
                if matches!(r.state, State::Running | State::Starting) {
                    r.state = State::Crashed;
                    changed = true;
                }
            }
        }
        if changed {
            self.store.save(&records)?;
        }
        Ok(())
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

        let mut spawn_cfg = profile_cfg.clone();
        if !wait {
            if let Some(fast_cmd) = &profile_cfg.start.fast_command {
                if !fast_cmd.trim().is_empty() {
                    spawn_cfg.start.command = fast_cmd.clone();
                }
            }
        }

        let (mut record, mut child) =
            process::spawn(profile, &spawn_cfg, &self.paths, self.config.logs.color)?;
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
        let profile_cfg = self.config.profile(profile)?.clone();
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

        if let Some(stop_cfg) = &profile_cfg.stop {
            if let Some(stop_cmd) = &stop_cfg.command {
                if !stop_cmd.trim().is_empty() {
                    let mut cmd = process::shell_command(stop_cmd);
                    cmd.current_dir(self.paths.workdir(&profile_cfg));
                    let _ = cmd.status().await;
                }
            }
        }

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
        let profile_cfg = self.config.profile(profile)?.clone();
        self.stop(profile).await?;
        if let Some(restart_cfg) = &profile_cfg.restart {
            if let Some(restart_cmd) = &restart_cfg.command {
                if !restart_cmd.trim().is_empty() {
                    let mut cmd = process::shell_command(restart_cmd);
                    cmd.current_dir(self.paths.workdir(&profile_cfg));
                    let _ = cmd.status().await;
                }
            }
        }
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

pub fn parse_service_and_env(
    key: &str,
    cfg_service: Option<&str>,
    cfg_env: Option<&str>,
) -> (String, String) {
    if let (Some(s), Some(e)) = (cfg_service, cfg_env) {
        return (s.to_string(), e.to_string());
    }
    if let Some(s) = cfg_service {
        return (s.to_string(), cfg_env.unwrap_or("dev").to_string());
    }
    if let Some((s, e)) = key.split_once(':').or_else(|| key.split_once('/')) {
        return (s.to_string(), e.to_string());
    }
    if matches!(key, "dev" | "test" | "prod" | "staging" | "default") {
        let env = if key == "default" { "dev" } else { key };
        return ("main".to_string(), env.to_string());
    }
    (key.to_string(), cfg_env.unwrap_or("dev").to_string())
}

fn status_from(
    name: &str,
    cfg: &crate::config::Profile,
    record: Option<&RunRecord>,
    build: Option<&BuildSummary>,
) -> ProfileStatus {
    let (service, env_name) =
        parse_service_and_env(name, cfg.service.as_deref(), cfg.env_name.as_deref());
    let last_build = build.cloned();
    let compile_quick = cfg.compile.quick.as_ref().map(|c| c.command.clone());
    let compile_partial = cfg.compile.partial.as_ref().map(|c| c.command.clone());
    let compile_full = cfg.compile.full.as_ref().map(|c| c.command.clone());
    let fast_start_command = cfg.start.fast_command.clone();
    let stop_command = cfg.stop.as_ref().and_then(|s| s.command.clone());
    let restart_command = cfg.restart.as_ref().and_then(|r| r.command.clone());
    let workdir = Some(cfg.workdir.clone());
    let port = cfg.start.ready_port;
    let base_command = Some(cfg.start.command.clone());

    match record {
        None => ProfileStatus {
            profile: name.into(),
            service,
            env_name,
            state: State::Idle,
            pid: None,
            uptime_ms: None,
            command: base_command,
            fast_start_command,
            stop_command,
            restart_command,
            workdir,
            port,
            compile_quick,
            compile_partial,
            compile_full,
            last_build,
        },
        Some(r) => {
            let alive = process::is_alive(r.pid);
            let state = if alive { r.state } else { State::Crashed };
            ProfileStatus {
                profile: name.into(),
                service,
                env_name,
                state,
                pid: Some(r.pid),
                uptime_ms: alive.then(|| now_ms().saturating_sub(r.started_at_ms)),
                command: Some(r.command.clone()),
                fast_start_command,
                stop_command,
                restart_command,
                workdir,
                port,
                compile_quick,
                compile_partial,
                compile_full,
                last_build,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exited_after_ready_is_reaped_as_crashed() {
        let dir = std::env::temp_dir().join(format!("lc-reap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg_path = dir.join("lifecycle.toml");
        std::fs::write(
            &cfg_path,
            "[project]\nname = \"reap\"\n[profiles.default]\n[profiles.default.start]\ncommand = \"sleep 30\"\n",
        )
        .unwrap();
        let mut engine = Engine::new(&cfg_path).unwrap();
        let out = engine.start("default", true).await.unwrap();
        assert!(out.ready);
        std::process::Command::new("kill")
            .arg("-9")
            .arg(out.pid.to_string())
            .status()
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let statuses = engine.list().unwrap();
        assert_eq!(statuses[0].state, State::Crashed);
        assert!(!engine.children.contains_key("default"));
        let _ = engine.stop("default").await;
        std::fs::remove_dir_all(&dir).ok();
    }
}