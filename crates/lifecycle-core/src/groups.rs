use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::process::now_ms;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMember {
    pub project: String,
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub members: Vec<GroupMember>,
    pub created_at_ms: u64,
}

pub fn new_id() -> String {
    format!("{:x}-{:x}", now_ms(), std::process::id())
}

pub struct GroupStore {
    path: PathBuf,
}

impl GroupStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Vec<Group>> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, groups: &[Group]) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(groups)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

pub fn validate(name: &str, members: &[GroupMember]) -> Result<()> {
    if name.trim().is_empty() {
        return Err(Error::Config("group name must not be empty".into()));
    }
    if members.is_empty() {
        return Err(Error::Config("group needs at least one service".into()));
    }
    Ok(())
}