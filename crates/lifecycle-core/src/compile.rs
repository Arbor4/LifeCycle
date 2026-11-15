use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Child;
use tokio::sync::Notify;

use crate::error::{Error, Result};
use crate::process;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompileKind {
    Quick,
    Partial,
    Full,
}

impl CompileKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CompileKind::Quick => "quick",
            CompileKind::Partial => "partial",
            CompileKind::Full => "full",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "quick" => Ok(CompileKind::Quick),
            "partial" => Ok(CompileKind::Partial),
            "full" => Ok(CompileKind::Full),
            _ => Err(Error::NotFound(format!("compile kind '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub message: String,
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildResult {
    pub success: bool,
    pub errors: Vec<Diagnostic>,
    pub warnings: Vec<Diagnostic>,
    pub duration_ms: u64,
    pub artifacts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildSummary {
    pub kind: CompileKind,
    pub success: bool,
    pub duration_ms: u64,
    pub error_count: usize,
    pub warning_count: usize,
    pub finished_at_ms: u64,
}

pub struct CompileControl {
    pub pid: u32,
    pub cancel: Arc<Notify>,
}

pub struct CompileOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

/// Cross-process compile mutex via lock file; stale locks (dead owner pid) are cleaned.
pub fn acquire_lock(lock_dir: &Path, profile: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(lock_dir)?;
    let path = lock_dir.join(format!("compile-{profile}.lock"));
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            if process::is_alive(pid) {
                return Err(Error::Busy(format!(
                    "profile '{profile}' is already compiling (owner pid {pid})"
                )));
            }
        }
        // Dirty lock left by a crashed run.
        let _ = std::fs::remove_file(&path);
    }
    std::fs::write(&path, std::process::id().to_string())?;
    Ok(path)
}

pub fn release_lock(path: &Path) {
    let _ = std::fs::remove_file(path);
}

pub fn spawn_compile(
    command: &str,
    workdir: &Path,
    env: &BTreeMap<String, String>,
) -> Result<(Child, u32)> {
    #[cfg(unix)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    #[cfg(not(unix))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(command);
        c
    };
    cmd.current_dir(workdir)
        .envs(env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false);
    // 与 process::spawn 一致：GUI 启动时 PATH 极简，编译命令同样需要工具链补全
    #[cfg(unix)]
    cmd.env("PATH", crate::process::toolchain_path());
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd
        .spawn()
        .map_err(|e| Error::Other(format!("failed to spawn compile '{command}': {e}")))?;
    let pid = child
        .id()
        .ok_or_else(|| Error::Other("compile child exited before pid was read".into()))?;
    Ok((child, pid))
}

/// Wait for the compile with timeout and cancellation; on either, SIGTERM→SIGKILL the group.
pub async fn wait_compile(
    mut child: Child,
    pid: u32,
    timeout_ms: u64,
    cancel: Arc<Notify>,
    stop_timeout_ms: u64,
) -> Result<CompileOutput> {
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let reader = tokio::spawn(async move {
        let mut out = String::new();
        let mut err = String::new();
        if let Some(p) = stdout_pipe.as_mut() {
            let _ = p.read_to_string(&mut out).await;
        }
        if let Some(p) = stderr_pipe.as_mut() {
            let _ = p.read_to_string(&mut err).await;
        }
        (out, err)
    });

    let mut timed_out = false;
    let mut cancelled = false;
    let status = tokio::select! {
        r = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()) => {
            match r {
                Ok(s) => s?,
                Err(_) => {
                    timed_out = true;
                    process::kill_group(pid);
                    child.wait().await?
                }
            }
        }
        _ = cancel.notified() => {
            cancelled = true;
            terminate_then_kill(pid, stop_timeout_ms, &mut child).await?
        }
    };
    let (stdout, stderr) = reader.await.unwrap_or_default();
    Ok(CompileOutput {
        exit_code: status.code(),
        stdout,
        stderr,
        timed_out,
        cancelled,
    })
}

async fn terminate_then_kill(
    pid: u32,
    stop_timeout_ms: u64,
    child: &mut Child,
) -> Result<std::process::ExitStatus> {
    // SIGTERM first via a short grace, then SIGKILL; child.wait reaps.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as libc::pid_t), libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .output();
    }
    match tokio::time::timeout(Duration::from_millis(stop_timeout_ms.min(3000)), child.wait()).await {
        Ok(s) => Ok(s?),
        Err(_) => {
            process::kill_group(pid);
            Ok(child.wait().await?)
        }
    }
}

pub fn build_result(
    output: &CompileOutput,
    parser: Option<&str>,
    duration_ms: u64,
) -> BuildResult {
    let combined = format!("{}{}", output.stdout, output.stderr);
    let success = !output.timed_out && !output.cancelled && output.exit_code == Some(0);
    let (errors, warnings) = parse_output(parser, &combined);
    let artifacts = extract_artifacts(&combined);
    let raw = if !success && errors.is_empty() {
        Some(tail_lines(&combined, 200))
    } else {
        None
    };
    BuildResult {
        success,
        errors,
        warnings,
        duration_ms,
        artifacts,
        raw,
        cancelled: output.cancelled,
    }
}

fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

fn extract_artifacts(output: &str) -> Vec<String> {
    let re = Regex::new(r"Building (?:jar|war): (\S+)").unwrap();
    re.captures_iter(output)
        .map(|c| c[1].to_string())
        .collect()
}

pub fn parse_output(parser: Option<&str>, output: &str) -> (Vec<Diagnostic>, Vec<Diagnostic>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    match parser.unwrap_or("generic") {
        "maven" | "javac" => parse_maven(output, &mut errors, &mut warnings),
        "gradle" | "kotlin" => parse_gradle(output, &mut errors, &mut warnings),
        "typescript" | "tsc" => parse_typescript(output, &mut errors, &mut warnings),
        "cargo" | "rust" => parse_cargo(output, &mut errors, &mut warnings),
        "go" => parse_generic(output, &mut errors, &mut warnings),
        _ => parse_generic(output, &mut errors, &mut warnings),
    }
    if errors.is_empty() && warnings.is_empty() && parser.is_some() {
        // Parser missed everything: fall back rather than lose information.
        parse_generic(output, &mut errors, &mut warnings);
    }
    (errors, warnings)
}

fn push(diags: &mut Vec<Diagnostic>, file: &str, line: &str, col: &str, msg: &str, level: &str) {
    diags.push(Diagnostic {
        file: file.to_string(),
        line: line.parse().unwrap_or(0),
        col: col.parse().unwrap_or(0),
        message: msg.trim().to_string(),
        level: level.to_string(),
    });
}

fn parse_maven(output: &str, errors: &mut Vec<Diagnostic>, warnings: &mut Vec<Diagnostic>) {
    let re = Regex::new(
        r"^\[(ERROR|WARNING)\]\s+(?P<file>[^\s:]+):\[(?P<line>\d+),(?P<col>\d+)\]\s*(?P<msg>.*)$",
    )
    .unwrap();
    for line in output.lines() {
        if let Some(c) = re.captures(line) {
            let level = if &c[1] == "ERROR" { "error" } else { "warning" };
            let target = if level == "error" { &mut *errors } else { &mut *warnings };
            push(target, &c["file"], &c["line"], &c["col"], &c["msg"], level);
        }
    }
}

fn parse_gradle(output: &str, errors: &mut Vec<Diagnostic>, warnings: &mut Vec<Diagnostic>) {
    let re = Regex::new(
        r"^(?P<level>e|w):\s+(?:file://)?(?P<file>[^\s:]+):(?P<line>\d+):(?P<col>\d+)\s*(?P<msg>.*)$",
    )
    .unwrap();
    for line in output.lines() {
        if let Some(c) = re.captures(line) {
            let level = if &c["level"] == "e" { "error" } else { "warning" };
            let target = if level == "error" { &mut *errors } else { &mut *warnings };
            push(target, &c["file"], &c["line"], &c["col"], &c["msg"], level);
        }
    }
}

fn parse_typescript(output: &str, errors: &mut Vec<Diagnostic>, warnings: &mut Vec<Diagnostic>) {
    let re = Regex::new(
        r"^(?P<file>[^\s(]+)\((?P<line>\d+),(?P<col>\d+)\):\s*(?P<level>error|warning)\s+TS\d+:\s*(?P<msg>.*)$",
    )
    .unwrap();
    for line in output.lines() {
        if let Some(c) = re.captures(line) {
            let level = &c["level"];
            let target = if level == "error" { &mut *errors } else { &mut *warnings };
            push(target, &c["file"], &c["line"], &c["col"], &c["msg"], level);
        }
    }
}

fn parse_cargo(output: &str, errors: &mut Vec<Diagnostic>, warnings: &mut Vec<Diagnostic>) {
    let header = Regex::new(r"^(?P<level>error|warning)(?:\[[A-Z0-9]+\])?:\s*(?P<msg>.*)$").unwrap();
    let loc = Regex::new(r"^\s*-->\s+(?P<file>[^\s:]+):(?P<line>\d+):(?P<col>\d+)").unwrap();
    let mut pending: Option<(String, String)> = None;
    for line in output.lines() {
        if let Some(c) = header.captures(line) {
            pending = Some((c["level"].to_string(), c["msg"].to_string()));
        } else if let Some(c) = loc.captures(line) {
            if let Some((level, msg)) = pending.take() {
                let target = if level == "error" { &mut *errors } else { &mut *warnings };
                push(target, &c["file"], &c["line"], &c["col"], &msg, &level);
            }
        }
    }
}

fn parse_generic(output: &str, errors: &mut Vec<Diagnostic>, warnings: &mut Vec<Diagnostic>) {
    let re = Regex::new(
        r"(?P<file>[^\s:]+):(?P<line>\d+):(?P<col>\d+):\s*(?P<msg>.+)$",
    )
    .unwrap();
    for line in output.lines() {
        if let Some(c) = re.captures(line) {
            let lower = line.to_lowercase();
            let level = if lower.contains("warning") { "warning" } else { "error" };
            let target = if level == "error" { &mut *errors } else { &mut *warnings };
            push(target, &c["file"], &c["line"], &c["col"], &c["msg"], level);
        }
    }
}

pub fn summary_of(kind: CompileKind, result: &BuildResult) -> BuildSummary {
    BuildSummary {
        kind,
        success: result.success,
        duration_ms: result.duration_ms,
        error_count: result.errors.len(),
        warning_count: result.warnings.len(),
        finished_at_ms: process::now_ms(),
    }
}

pub fn load_builds(path: &Path) -> Result<BTreeMap<String, BuildSummary>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn save_builds(path: &Path, builds: &BTreeMap<String, BuildSummary>) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(builds)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_maven() {
        let out = "[ERROR] /src/X.java:[12,34] cannot find symbol\n[WARNING] /src/Y.java:[1,1] deprecation\n[INFO] build stuff";
        let (e, w) = parse_output(Some("maven"), out);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].file, "/src/X.java");
        assert_eq!(e[0].line, 12);
        assert_eq!(e[0].col, 34);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].level, "warning");
    }

    #[test]
    fn parses_gradle_kotlin() {
        let out = "e: file:///src/X.kt:12:34 unresolved reference\nw: /src/Y.kt:1:1 unused";
        let (e, w) = parse_output(Some("gradle"), out);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].file, "/src/X.kt");
        assert_eq!(w.len(), 1);
    }

    #[test]
    fn parses_typescript() {
        let out = "src/x.ts(12,34): error TS1234: Type mismatch\nsrc/y.ts(1,1): warning TS9999: hint";
        let (e, w) = parse_output(Some("typescript"), out);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].message, "Type mismatch");
        assert_eq!(w.len(), 1);
    }

    #[test]
    fn parses_cargo_multiline() {
        let out = "error[E0308]: mismatched types\n  --> src/main.rs:12:34\n   |\n12 | ...\nwarning: unused variable\n --> src/lib.rs:3:5";
        let (e, w) = parse_output(Some("cargo"), out);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].file, "src/main.rs");
        assert_eq!(e[0].message, "mismatched types");
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].file, "src/lib.rs");
    }

    #[test]
    fn parses_go_and_generic() {
        let out = "./x.go:12:34: undefined: foo";
        let (e, _) = parse_output(Some("go"), out);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].file, "./x.go");
        let (e2, _) = parse_output(None, out);
        assert_eq!(e2.len(), 1);
    }

    #[test]
    fn failed_build_keeps_raw_when_unparseable() {
        let output = CompileOutput {
            exit_code: Some(1),
            stdout: "some opaque failure\nno location info".into(),
            stderr: String::new(),
            timed_out: false,
            cancelled: false,
        };
        let result = build_result(&output, Some("maven"), 10);
        assert!(!result.success);
        assert!(result.errors.is_empty());
        assert!(result.raw.unwrap().contains("opaque failure"));
    }

    #[test]
    fn success_has_no_raw_and_extracts_artifacts() {
        let output = CompileOutput {
            exit_code: Some(0),
            stdout: "[INFO] Building jar: /target/app.jar".into(),
            stderr: String::new(),
            timed_out: false,
            cancelled: false,
        };
        let result = build_result(&output, Some("maven"), 10);
        assert!(result.success);
        assert!(result.raw.is_none());
        assert_eq!(result.artifacts, vec!["/target/app.jar"]);
    }

    #[test]
    fn lock_detects_busy_and_cleans_stale() {
        let dir = tempfile::tempdir().unwrap();
        let lock = acquire_lock(dir.path(), "default").unwrap();
        let err = acquire_lock(dir.path(), "default").unwrap_err();
        assert_eq!(err.code(), "BUSY");
        release_lock(&lock);
        // Stale lock with a dead pid is cleaned automatically.
        std::fs::write(dir.path().join("compile-default.lock"), "999999999").unwrap();
        let lock2 = acquire_lock(dir.path(), "default").unwrap();
        release_lock(&lock2);
    }
}