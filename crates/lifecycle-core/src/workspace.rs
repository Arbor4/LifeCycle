use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;

use crate::diagnostics::CallLog;
use crate::engine::Engine;
use crate::error::{Error, Result};
use crate::groups::{new_id, Group, GroupMember, GroupStore};
use crate::logs::LogHub;
use crate::registry::Registry;

/// 全局 MCP 白名单：LifeCycle 自身的管理面配置，与被管项目无关。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPolicy {
    #[serde(default = "default_mcp_transport")]
    pub transport: String,
    #[serde(default)]
    pub expose: Vec<String>,
}

impl Default for McpPolicy {
    fn default() -> Self {
        Self {
            transport: default_mcp_transport(),
            expose: Vec::new(),
        }
    }
}

fn default_mcp_transport() -> String {
    "both".into()
}

/// Multi-project holder shared by MCP, HTTP and the desktop app.
/// Projects can be registered/unregistered at runtime; registrations persist
/// in ~/.lifecycle/projects.json so they survive a restart.
pub struct Workspace {
    engines: Mutex<HashMap<String, Arc<AsyncMutex<Engine>>>>,
    mcp: Mutex<McpPolicy>,
    mcp_path: PathBuf,
    paths: Mutex<HashMap<String, PathBuf>>,
    hubs: Mutex<HashMap<String, LogHub>>,
    registry: Registry,
    groups: GroupStore,
    call_log: Arc<CallLog>,
    console: bool,
    from_registry: Mutex<HashSet<String>>,
    registry_errors: Mutex<HashSet<PathBuf>>,
    mtimes: Mutex<HashMap<PathBuf, std::time::SystemTime>>,
}

fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

impl Workspace {
    /// Load exactly the given configs (CLI / stdio MCP semantics).
    pub fn load(config_paths: &[PathBuf]) -> Result<Self> {
        Self::build(config_paths, false)
    }

    /// Console semantics (desktop / HTTP): explicit configs plus everything
    /// registered earlier via the UI, so services survive restarts.
    pub fn load_console(config_paths: &[PathBuf]) -> Result<Self> {
        Self::build(config_paths, true)
    }

    fn build(config_paths: &[PathBuf], with_registry: bool) -> Result<Self> {
        let registry = Registry::new(Registry::default_path());
        if with_registry {
            let _ = registry.prune();
        }
        let groups = GroupStore::new(home().join(".lifecycle").join("groups.json"));
        let mcp_path = home().join(".lifecycle").join("mcp.json");
        let mcp = std::fs::read_to_string(&mcp_path)
            .ok()
            .and_then(|text| serde_json::from_str::<McpPolicy>(&text).ok())
            .unwrap_or_default();
        let ws = Self {
            engines: Mutex::new(HashMap::new()),
            mcp: Mutex::new(mcp),
            mcp_path,
            paths: Mutex::new(HashMap::new()),
            hubs: Mutex::new(HashMap::new()),
            registry,
            groups,
            call_log: Arc::new(CallLog::new()),
            console: with_registry,
            from_registry: Mutex::new(HashSet::new()),
            registry_errors: Mutex::new(HashSet::new()),
            mtimes: Mutex::new(HashMap::new()),
        };
        let mut loaded: HashSet<PathBuf> = HashSet::new();
        for path in config_paths {
            ws.add(path)?;
            loaded.insert(canonical(path));
        }
        if with_registry {
            for path in ws.registry.paths() {
                if loaded.contains(&canonical(&path)) {
                    continue;
                }
                match ws.add(&path) {
                    Ok(name) => {
                        loaded.insert(canonical(&path));
                        ws.from_registry.lock().unwrap().insert(name);
                    }
                    Err(e) => eprintln!("lifecycle: skip registered project {}: {e}", path.display()),
                }
            }
            ws.seed_groups();
        }
        Ok(ws)
    }

    /// First-run convenience: group the first profile of up to three projects.
    fn seed_groups(&self) {
        if self.groups.path().exists() {
            return;
        }
        let members: Vec<GroupMember> = self
            .names()
            .into_iter()
            .take(3)
            .filter_map(|name| {
                let engine = self.engine(&name).ok()?;
                let mut guard = engine.try_lock().ok()?;
                let profile = guard.list().ok()?.first()?.profile.clone();
                Some(GroupMember { project: name, profile })
            })
            .collect();
        if !members.is_empty() {
            let seed = vec![Group {
                id: new_id(),
                name: "示例分组".into(),
                members,
                created_at_ms: crate::process::now_ms(),
            }];
            let _ = self.groups.save(&seed);
        }
    }

    pub fn groups(&self) -> &GroupStore {
        &self.groups
    }

    pub fn call_log(&self) -> &Arc<CallLog> {
        &self.call_log
    }

    /// Register a project from its lifecycle.toml at runtime (in-memory only).
    pub fn add(&self, config_path: &Path) -> Result<String> {
        let engine = Engine::new(config_path)?;
        let name = engine.project_name().to_string();
        let mut engines = self.engines.lock().unwrap();
        if engines.contains_key(&name) {
            return Err(Error::Busy(format!("project '{name}' already registered")));
        }
        self.paths
            .lock()
            .unwrap()
            .insert(name.clone(), config_path.to_path_buf());
        self.hubs
            .lock()
            .unwrap()
            .insert(name.clone(), engine.hub());
        engines.insert(name.clone(), Arc::new(AsyncMutex::new(engine)));
        Ok(name)
    }

    /// Register and remember across restarts.
    pub fn register(&self, config_path: &Path) -> Result<String> {
        let name = self.add(config_path)?;
        self.registry.add(config_path)?;
        self.from_registry.lock().unwrap().insert(name.clone());
        Ok(name)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let mut engines = self.engines.lock().unwrap();
        engines
            .remove(name)
            .ok_or_else(|| Error::NotFound(format!("project '{name}'")))?;
        self.hubs.lock().unwrap().remove(name);
        self.from_registry.lock().unwrap().remove(name);
        if let Some(path) = self.paths.lock().unwrap().remove(name) {
            let _ = self.registry.remove(&path);
        }
        Ok(())
    }

    /// Pick up edits made by other processes (a stdio MCP server, an editor):
    /// reload configs whose mtime changed and sync registry additions/removals.
    /// Engines held by a running operation are skipped and retried next tick.
    /// Returns true when anything changed.
    pub fn sync_external(&self) -> bool {
        let mut changed = false;
        if self.console {
            let registered = self.registry.paths();
            let desired: HashSet<PathBuf> = registered.iter().map(|p| canonical(p)).collect();
            for path in &registered {
                match self.add(path) {
                    Ok(name) => {
                        self.from_registry.lock().unwrap().insert(name);
                        self.registry_errors.lock().unwrap().remove(path);
                        changed = true;
                    }
                    Err(Error::Busy(_)) => {}
                    Err(e) => {
                        if self.registry_errors.lock().unwrap().insert(path.clone()) {
                            eprintln!("lifecycle: skip registered project {}: {e}", path.display());
                        }
                    }
                }
            }
            let stale: Vec<String> = self
                .from_registry
                .lock()
                .unwrap()
                .iter()
                .filter(|name| {
                    self.paths
                        .lock()
                        .unwrap()
                        .get(*name)
                        .map(|p| !desired.contains(&canonical(p)))
                        .unwrap_or(true)
                })
                .cloned()
                .collect();
            for name in stale {
                let _ = self.remove(&name);
                changed = true;
            }
        }
        for (name, engine) in self.snapshot() {
            let Ok(mut guard) = engine.try_lock() else { continue };
            let path = guard.config_path().to_path_buf();
            let Ok(mtime) = std::fs::metadata(&path).and_then(|m| m.modified()) else {
                continue;
            };
            if self.mtimes.lock().unwrap().get(&path) == Some(&mtime) {
                continue;
            }
            if guard.reload_config().is_ok() {
                self.mtimes.lock().unwrap().insert(path, mtime);
                self.forget_hub(&name);
                changed = true;
            }
        }
        changed
    }

    /// Log hub without taking the engine mutex: log reads/streaming stay
    /// responsive while a long compile/package holds the engine lock.
    pub fn hub(&self, project: &str) -> Result<LogHub> {
        if let Some(h) = self.hubs.lock().unwrap().get(project) {
            return Ok(h.clone());
        }
        let path = self
            .paths
            .lock()
            .unwrap()
            .get(project)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("project '{project}'")))?;
        let config = crate::config::Config::load(&path)?;
        let hub = LogHub::new(crate::config::ProjectPaths::new(&path, &config).log_dir);
        self.hubs.lock().unwrap().insert(project.to_string(), hub.clone());
        Ok(hub)
    }

    /// Drop the cached hub after config edits that may change logs.dir.
    pub fn forget_hub(&self, project: &str) {
        self.hubs.lock().unwrap().remove(project);
    }

    pub fn engine(&self, project: &str) -> Result<Arc<AsyncMutex<Engine>>> {
        self.engines
            .lock()
            .unwrap()
            .get(project)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("project '{project}'")))
    }

    pub fn resolve_project(&self, project: &Option<String>) -> Result<String> {
        let engines = self.engines.lock().unwrap();
        match project {
            Some(p) if engines.contains_key(p) => Ok(p.clone()),
            Some(p) => Err(Error::NotFound(format!("project '{p}'"))),
            None if engines.is_empty() => Err(Error::NotFound("no projects registered".into())),
            None if engines.len() == 1 => Ok(engines.keys().next().unwrap().clone()),
            None => Err(Error::Config(
                "multiple projects loaded; 'project' is required".into(),
            )),
        }
    }

    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.engines.lock().unwrap().keys().cloned().collect();
        names.sort();
        names
    }

    pub fn snapshot(&self) -> Vec<(String, Arc<AsyncMutex<Engine>>)> {
        self.engines
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn mcp_policy(&self) -> McpPolicy {
        self.mcp.lock().unwrap().clone()
    }

    pub fn mcp_policy_path(&self) -> &Path {
        &self.mcp_path
    }

    /// Persist the global whitelist; new MCP sessions pick it up immediately.
    pub fn set_mcp_policy(&self, policy: McpPolicy) -> Result<()> {
        if let Some(parent) = self.mcp_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.mcp_path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(&policy).map_err(|e| Error::Other(e.to_string()))?,
        )?;
        std::fs::rename(&tmp, &self.mcp_path)?;
        *self.mcp.lock().unwrap() = policy;
        Ok(())
    }
}

/// Poll for external config/registry edits so long-lived consoles (desktop,
/// HTTP) and stdio MCP sessions hot-reload what other processes wrote.
pub async fn watch_external(ws: Arc<Workspace>) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(2));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        ws.sync_external();
    }
}

/// Discover lifecycle.toml files up to two levels under a directory.
pub fn scan_projects(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let direct = dir.join("lifecycle.toml");
    if direct.is_file() {
        found.push(direct);
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let candidate = entry.path().join("lifecycle.toml");
            if candidate.is_file() {
                found.push(candidate);
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE: &str = r#"
[project]
name = "watched"

[profiles.default]
service = "web"

[profiles.default.start]
command = "sleep 1"
"#;

    const TWO: &str = r#"
[project]
name = "watched"

[profiles.default]
service = "web"

[profiles.default.start]
command = "sleep 1"

[profiles.desktop]
service = "desktop"

[profiles.desktop.start]
command = "sleep 2"
"#;

    #[test]
    fn sync_external_reloads_edited_config() {
        let dir = std::env::temp_dir().join(format!("lc-watch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("lifecycle.toml");
        std::fs::write(&path, ONE).unwrap();
        let ws = Workspace::load(std::slice::from_ref(&path)).unwrap();
        let engine = ws.engine("watched").unwrap();
        assert!(ws.sync_external());
        assert_eq!(engine.blocking_lock().list().unwrap().len(), 1);
        std::fs::write(&path, TWO).unwrap();
        assert!(ws.sync_external());
        assert_eq!(engine.blocking_lock().list().unwrap().len(), 2);
        assert!(!ws.sync_external());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sync_external_survives_invalid_toml() {
        let dir = std::env::temp_dir().join(format!("lc-watch-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("lifecycle.toml");
        std::fs::write(&path, ONE).unwrap();
        let ws = Workspace::load(std::slice::from_ref(&path)).unwrap();
        let engine = ws.engine("watched").unwrap();
        assert!(ws.sync_external());
        std::fs::write(&path, "[project\nname = broken").unwrap();
        assert!(!ws.sync_external());
        assert_eq!(engine.blocking_lock().list().unwrap().len(), 1);
        std::fs::write(&path, TWO).unwrap();
        assert!(ws.sync_external());
        assert_eq!(engine.blocking_lock().list().unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}