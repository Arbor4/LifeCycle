use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub project: Project,
    pub profiles: BTreeMap<String, Profile>,
    #[serde(default)]
    pub logs: LogsConfig,
    #[serde(default)]
    pub process: ProcessConfig,
    #[serde(default)]
    pub mcp: McpConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    #[serde(default = "default_workdir")]
    pub workdir: String,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub start: StartConfig,
    #[serde(default)]
    pub compile: CompileConfig,
}

fn default_workdir() -> String {
    ".".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartConfig {
    pub command: String,
    pub ready_pattern: Option<String>,
    pub ready_port: Option<u16>,
    #[serde(default = "default_ready_timeout")]
    pub ready_timeout_ms: u64,
}

fn default_ready_timeout() -> u64 {
    120_000
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompileConfig {
    pub quick: Option<CompileCommand>,
    pub partial: Option<CompileCommand>,
    pub full: Option<CompileCommand>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompileCommand {
    pub command: String,
    pub parser: Option<String>,
    #[serde(default = "default_compile_timeout")]
    pub timeout_ms: u64,
}

fn default_compile_timeout() -> u64 {
    300_000
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogsConfig {
    #[serde(default = "default_buffer_lines")]
    pub buffer_lines: usize,
    #[serde(default = "default_log_dir")]
    pub dir: String,
}

impl Default for LogsConfig {
    fn default() -> Self {
        Self {
            buffer_lines: default_buffer_lines(),
            dir: default_log_dir(),
        }
    }
}

fn default_buffer_lines() -> usize {
    5000
}

fn default_log_dir() -> String {
    ".lifecycle/logs".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessConfig {
    #[serde(default = "default_stop_timeout")]
    pub stop_timeout_ms: u64,
}

impl Default for ProcessConfig {
    fn default() -> Self {
        Self {
            stop_timeout_ms: default_stop_timeout(),
        }
    }
}

fn default_stop_timeout() -> u64 {
    5000
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpConfig {
    #[serde(default = "default_transport")]
    pub transport: String,
    #[serde(default)]
    pub expose: Vec<String>,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            transport: default_transport(),
            expose: Vec::new(),
        }
    }
}

fn default_transport() -> String {
    "stdio".into()
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).map_err(|e| {
            Error::Config(format!("cannot read {}: {e}", path.display()))
        })?;
        let config: Config = toml::from_str(&text)?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.project.name.trim().is_empty() {
            return Err(Error::Config("project.name must not be empty".into()));
        }
        if self.profiles.is_empty() {
            return Err(Error::Config("at least one profile is required".into()));
        }
        for (name, profile) in &self.profiles {
            if profile.start.command.trim().is_empty() {
                return Err(Error::Config(format!(
                    "profiles.{name}.start.command must not be empty"
                )));
            }
            if let Some(p) = &profile.start.ready_pattern {
                regex::Regex::new(p)?;
            }
        }
        if self.logs.buffer_lines == 0 {
            return Err(Error::Config("logs.buffer_lines must be > 0".into()));
        }
        Ok(())
    }

    pub fn profile(&self, name: &str) -> Result<&Profile> {
        self.profiles
            .get(name)
            .ok_or_else(|| Error::NotFound(format!("profile '{name}'")))
    }
}

/// Paths derived from a config file location; everything resolves against the project root.
#[derive(Debug, Clone)]
pub struct ProjectPaths {
    pub root: PathBuf,
    pub log_dir: PathBuf,
    pub state_file: PathBuf,
}

impl ProjectPaths {
    pub fn new(config_path: &Path, config: &Config) -> Self {
        let root = config_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .to_path_buf();
        let log_dir = root.join(&config.logs.dir);
        let state_file = root.join(".lifecycle").join("state.json");
        Self {
            root,
            log_dir,
            state_file,
        }
    }

    pub fn workdir(&self, profile: &Profile) -> PathBuf {
        self.root.join(&profile.workdir)
    }

    pub fn log_file(&self, profile: &str, source: &str) -> PathBuf {
        self.log_dir.join(format!("{profile}-{source}.log"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: &str = r#"
[project]
name = "my-service"

[profiles.default]
workdir = "."
env = { SPRING_PROFILES_ACTIVE = "dev" }

[profiles.default.start]
command = "mvn spring-boot:run"
ready_pattern = "Started .* in .* seconds"
ready_port = 8080
ready_timeout_ms = 120000

[profiles.default.compile.quick]
command = "mvn compile -o -q"
parser = "maven"

[profiles.default.compile.partial]
command = "mvn compile -pl {targets} -am -o -q"
parser = "maven"

[profiles.default.compile.full]
command = "mvn clean package -DskipTests"
parser = "maven"
timeout_ms = 600000

[logs]
buffer_lines = 5000
dir = ".lifecycle/logs"

[process]
stop_timeout_ms = 5000

[mcp]
transport = "stdio"
expose = ["start_project", "stop_project", "compile_*"]
"#;

    #[test]
    fn parses_full_example() {
        let config: Config = toml::from_str(FULL).unwrap();
        config.validate().unwrap();
        assert_eq!(config.project.name, "my-service");
        let p = config.profile("default").unwrap();
        assert_eq!(p.start.ready_port, Some(8080));
        assert_eq!(p.env["SPRING_PROFILES_ACTIVE"], "dev");
        assert_eq!(p.compile.full.as_ref().unwrap().timeout_ms, 600_000);
        assert_eq!(config.mcp.expose.len(), 3);
    }

    #[test]
    fn minimal_config_gets_defaults() {
        let config: Config = toml::from_str(
            r#"
[project]
name = "mini"
[profiles.default.start]
command = "echo hi"
"#,
        )
        .unwrap();
        config.validate().unwrap();
        let p = config.profile("default").unwrap();
        assert_eq!(p.workdir, ".");
        assert_eq!(p.start.ready_timeout_ms, 120_000);
        assert_eq!(config.logs.buffer_lines, 5000);
        assert_eq!(config.process.stop_timeout_ms, 5000);
        assert_eq!(config.mcp.transport, "stdio");
    }

    #[test]
    fn rejects_empty_command() {
        let config: Config = toml::from_str(
            r#"
[project]
name = "x"
[profiles.default.start]
command = "  "
"#,
        )
        .unwrap();
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_bad_regex() {
        let config: Config = toml::from_str(
            r#"
[project]
name = "x"
[profiles.default.start]
command = "echo hi"
ready_pattern = "("
"#,
        )
        .unwrap();
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_unknown_profile() {
        let config: Config = toml::from_str(FULL).unwrap();
        let err = config.profile("nope").unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }
}