use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

use crate::diagnostics::CallLog;
use crate::engine::Engine;
use crate::error::{Error, Result};
use crate::groups::{new_id, Group, GroupMember, GroupStore};
use crate::logs::LogHub;
use crate::registry::Registry;

/// Multi-project holder shared by MCP, HTTP and the desktop app.
/// Projects can be registered/unregistered at runtime; registrations persist
/// in ~/.lifecycle/projects.json so they survive a restart.
pub struct Workspace {
    engines: Mutex<HashMap<String, Arc<AsyncMutex<Engine>>>>,
    expose: Mutex<HashMap<String, Vec<String>>>,
    paths: Mutex<HashMap<String, PathBuf>>,
    hubs: Mutex<HashMap<String, LogHub>>,
    registry: Registry,
    groups: GroupStore,
    call_log: Arc<CallLog>,
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
        let ws = Self {
            engines: Mutex::new(HashMap::new()),
            expose: Mutex::new(HashMap::new()),
            paths: Mutex::new(HashMap::new()),
            hubs: Mutex::new(HashMap::new()),
            registry,
            groups,
            call_log: Arc::new(CallLog::new()),
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
                    Ok(_) => {
                        loaded.insert(canonical(&path));
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
        self.expose
            .lock()
            .unwrap()
            .insert(name.clone(), engine.mcp_expose().to_vec());
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
        Ok(name)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let mut engines = self.engines.lock().unwrap();
        engines
            .remove(name)
            .ok_or_else(|| Error::NotFound(format!("project '{name}'")))?;
        self.expose.lock().unwrap().remove(name);
        self.hubs.lock().unwrap().remove(name);
        if let Some(path) = self.paths.lock().unwrap().remove(name) {
            let _ = self.registry.remove(&path);
        }
        Ok(())
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

    /// Update the cached expose whitelist after a config reload.
    pub fn set_expose(&self, project: &str, expose: Vec<String>) {
        self.expose.lock().unwrap().insert(project.to_string(), expose);
    }

    pub fn expose(&self, project: &str) -> Vec<String> {
        self.expose
            .lock()
            .unwrap()
            .get(project)
            .cloned()
            .unwrap_or_default()
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