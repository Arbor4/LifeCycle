use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

use crate::engine::Engine;
use crate::error::{Error, Result};

/// Multi-project holder shared by MCP, HTTP and the desktop app.
/// Projects can be registered/unregistered at runtime.
pub struct Workspace {
    engines: Mutex<HashMap<String, Arc<AsyncMutex<Engine>>>>,
    expose: Mutex<HashMap<String, Vec<String>>>,
}

impl Workspace {
    pub fn load(config_paths: &[PathBuf]) -> Result<Self> {
        let ws = Self {
            engines: Mutex::new(HashMap::new()),
            expose: Mutex::new(HashMap::new()),
        };
        for path in config_paths {
            ws.add(path)?;
        }
        if ws.engines.lock().unwrap().is_empty() {
            return Err(Error::Config("no projects loaded".into()));
        }
        Ok(ws)
    }

    /// Register a project from its lifecycle.toml at runtime.
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
        engines.insert(name.clone(), Arc::new(AsyncMutex::new(engine)));
        Ok(name)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let mut engines = self.engines.lock().unwrap();
        engines
            .remove(name)
            .ok_or_else(|| Error::NotFound(format!("project '{name}'")))?;
        self.expose.lock().unwrap().remove(name);
        Ok(())
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