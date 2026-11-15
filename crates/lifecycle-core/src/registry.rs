use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    path: PathBuf,
    added_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Doc {
    #[serde(default)]
    projects: Vec<Entry>,
}

/// Persisted list of registered lifecycle.toml paths (~/.lifecycle/projects.json),
/// so services created in the UI survive an app restart.
pub struct Registry {
    path: PathBuf,
}

fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

impl Registry {
    pub fn default_path() -> PathBuf {
        home().join(".lifecycle").join("projects.json")
    }

    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read(&self) -> Doc {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn write(&self, doc: &Doc) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(doc)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Registered config paths that still exist on disk.
    pub fn paths(&self) -> Vec<PathBuf> {
        self.read()
            .projects
            .into_iter()
            .map(|e| e.path)
            .filter(|p| p.is_file())
            .collect()
    }

    pub fn add(&self, config_path: &Path) -> Result<()> {
        let canonical = std::fs::canonicalize(config_path).unwrap_or_else(|_| config_path.to_path_buf());
        let mut doc = self.read();
        if doc.projects.iter().any(|e| e.path == canonical) {
            return Ok(());
        }
        doc.projects.push(Entry {
            path: canonical,
            added_at_ms: crate::process::now_ms(),
        });
        self.write(&doc)
    }

    pub fn remove(&self, config_path: &Path) -> Result<()> {
        let canonical = std::fs::canonicalize(config_path).unwrap_or_else(|_| config_path.to_path_buf());
        let mut doc = self.read();
        let before = doc.projects.len();
        doc.projects.retain(|e| e.path != canonical && e.path != config_path);
        if doc.projects.len() != before {
            self.write(&doc)?;
        }
        Ok(())
    }

    /// Drop entries whose config file disappeared.
    pub fn prune(&self) -> Result<()> {
        let mut doc = self.read();
        let before = doc.projects.len();
        doc.projects.retain(|e| e.path.is_file());
        if doc.projects.len() != before {
            self.write(&doc)?;
        }
        Ok(())
    }
}