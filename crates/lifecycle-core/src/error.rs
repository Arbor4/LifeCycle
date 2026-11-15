use std::fmt;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("config error: {0}")]
    Config(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("busy: {0}")]
    Busy(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("not ready: {0}")]
    NotReady(String),
    #[error("build failed: {0}")]
    BuildFailed(String),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::Config(_) => "CONFIG",
            Error::Io(_) => "IO",
            Error::NotFound(_) => "NOT_FOUND",
            Error::Busy(_) => "BUSY",
            Error::Timeout(_) => "TIMEOUT",
            Error::NotReady(_) => "NOT_READY",
            Error::BuildFailed(_) => "BUILD_FAILED",
            Error::Other(_) => "INTERNAL",
        }
    }
}

impl From<toml::de::Error> for Error {
    fn from(e: toml::de::Error) -> Self {
        Error::Config(e.to_string())
    }
}

impl From<regex::Error> for Error {
    fn from(e: regex::Error) -> Self {
        Error::Config(format!("invalid regex: {e}"))
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Other(format!("json error: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub struct DurationMs(pub u64);

impl fmt::Display for DurationMs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let secs = self.0 / 1000;
        if secs < 60 {
            write!(f, "{}s", secs)
        } else if secs < 3600 {
            write!(f, "{}m{}s", secs / 60, secs % 60)
        } else {
            write!(f, "{}h{}m", secs / 3600, (secs % 3600) / 60)
        }
    }
}