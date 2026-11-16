use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};

use crate::config::{Profile, ProjectPaths, StartConfig};
use crate::error::{Error, Result};
use crate::logs::{ensure_log_file, LogHub, RingBuffer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Idle,
    Starting,
    Running,
    Stopping,
    Crashed,
}

/// Persisted per profile so a later CLI invocation (or app restart) can find the process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub pid: u32,
    pub started_at_ms: u64,
    pub command: String,
    pub state: State,
    /// Log file size at spawn time; readiness matching ignores older runs.
    pub log_start: u64,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone)]
pub struct StateStore {
    path: PathBuf,
}

impl StateStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> Result<BTreeMap<String, RunRecord>> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, records: &BTreeMap<String, RunRecord>) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(records)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

/// Spawn detached in its own process group; stdout/stderr go straight to the run log
/// so the process keeps running after this CLI invocation exits.
pub fn spawn(
    profile_name: &str,
    profile: &Profile,
    paths: &ProjectPaths,
    force_color: bool,
) -> Result<(RunRecord, Child)> {
    let log_path = paths.log_file(profile_name, "run");
    let log_start = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
    let out = ensure_log_file(&log_path)?;
    let err = out.try_clone()?;

    let mut cmd = shell_command(&profile.start.command);
    cmd.current_dir(paths.workdir(profile));
    // GUI（Finder/launchd）启动时 PATH 极简，补上常见工具链，否则 npm/cargo 找不到。
    #[cfg(unix)]
    cmd.env("PATH", toolchain_path());
    if force_color {
        // 管道不是 TTY，多数工具会关掉颜色；显式要求保留 ANSI。
        for (k, v) in [
            ("FORCE_COLOR", "1"),
            ("CLICOLOR_FORCE", "1"),
            ("CARGO_TERM_COLOR", "always"),
            ("SPRING_OUTPUT_ANSI_ENABLED", "always"),
        ] {
            cmd.env(k, v);
        }
        if std::env::var("TERM").is_err() {
            cmd.env("TERM", "xterm-256color");
        }
    }
    cmd.envs(&profile.env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(out))
        .stderr(std::process::Stdio::from(err))
        .kill_on_drop(false);
    #[cfg(unix)]
    cmd.process_group(0);

    let child = cmd.spawn().map_err(|e| {
        Error::Other(format!("failed to spawn '{}': {e}", profile.start.command))
    })?;
    let pid = child.id().ok_or_else(|| Error::Other("child exited before pid was read".into()))?;
    #[cfg(windows)]
    winjob::assign(pid);

    let record = RunRecord {
        pid,
        started_at_ms: now_ms(),
        command: profile.start.command.clone(),
        state: State::Starting,
        log_start,
    };
    Ok((record, child))
}

#[cfg(unix)]
pub fn shell_command(command: &str) -> Command {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(command);
    cmd
}

/// Prepend well-known user toolchain dirs to PATH so services started from a
/// GUI-launched manager still find node / npm / cargo / mvn.
#[cfg(unix)]
pub fn toolchain_path() -> String {
    use std::path::PathBuf;
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".local/bin"));
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort_by_key(|p| {
                p.file_name()
                    .map(|n| {
                        n.to_string_lossy()
                            .trim_start_matches('v')
                            .split('.')
                            .next()
                            .and_then(|s| s.parse::<u32>().ok())
                            .unwrap_or(0)
                    })
                    .unwrap_or(0)
            });
            if let Some(v) = versions.last() {
                dirs.push(v.join("bin"));
            }
        }
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    let mut parts: Vec<String> = dirs
        .iter()
        .filter(|d| d.is_dir())
        .map(|d| d.to_string_lossy().into_owned())
        .collect();
    parts.push(std::env::var("PATH").unwrap_or_default());
    parts.join(":")
}

#[cfg(not(unix))]
pub fn shell_command(command: &str) -> Command {
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(command);
    cmd
}

#[cfg(unix)]
pub fn is_alive(pid: u32) -> bool {
    // SAFETY: kill with signal 0 only probes existence.
    let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if ret == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
pub fn is_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(unix)]
fn signal_group(pid: u32, sig: libc::c_int) {
    // SAFETY: negative pid targets the process group led by pid.
    unsafe {
        libc::kill(-(pid as libc::pid_t), sig);
    }
}

#[cfg(unix)]
fn terminate_group(pid: u32) {
    signal_group(pid, libc::SIGTERM);
}

#[cfg(unix)]
pub fn kill_group(pid: u32) {
    signal_group(pid, libc::SIGKILL);
}

#[cfg(not(unix))]
fn terminate_group(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .output();
}

#[cfg(not(unix))]
pub fn kill_group(pid: u32) {
    if winjob::terminate(pid) {
        return;
    }
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

/// 命令行是否属于 LifeCycle 的 stdio MCP server 入口之一。
/// `exe` 为可执行文件基名（可带 .exe），`args` 为完整命令行。
pub fn is_stdio_mcp(exe: &str, args: &str) -> bool {
    let exe = exe.strip_suffix(".exe").unwrap_or(exe);
    let has = |flag: &str| args.split_whitespace().any(|a| a == flag);
    match exe {
        "lifecycle-mcp" => true,
        "lifecycle-app" => has("--mcp-stdio"),
        "lifecycle" => has("--mcp"),
        _ => false,
    }
}

fn is_stdio_candidate(base: &str) -> bool {
    matches!(base, "lifecycle-mcp" | "lifecycle-app" | "lifecycle")
}

/// 本机正在运行的 stdio MCP server 进程数（每个进程＝一个 AI 客户端连接）。
/// 结果缓存 2s，避免 UI 轮询频繁 spawn 扫描命令。
pub fn stdio_mcp_count() -> usize {
    static CACHE: std::sync::Mutex<Option<(Instant, usize)>> = std::sync::Mutex::new(None);
    let mut guard = CACHE.lock().unwrap();
    if let Some((at, n)) = *guard {
        if at.elapsed() < Duration::from_secs(2) {
            return n;
        }
    }
    let n = scan_stdio_mcp();
    *guard = Some((Instant::now(), n));
    n
}

#[cfg(unix)]
fn scan_stdio_mcp() -> usize {
    let out = match std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,comm="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return scan_proc_stdio(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut candidates: Vec<(u32, String)> = Vec::new();
    for line in text.lines() {
        let line = line.trim_start();
        let Some((pid, comm)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else { continue };
        let base = comm.trim().rsplit('/').next().unwrap_or("");
        if is_stdio_candidate(base) {
            candidates.push((pid, base.to_string()));
        }
    }
    if candidates.is_empty() {
        return 0;
    }
    let pids = candidates
        .iter()
        .map(|(p, _)| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let Ok(args_out) = std::process::Command::new("ps")
        .args(["-p", &pids, "-o", "pid=,args="])
        .output()
    else {
        return 0;
    };
    let args_text = String::from_utf8_lossy(&args_out.stdout);
    let mut args_by_pid: BTreeMap<u32, String> = BTreeMap::new();
    for line in args_text.lines() {
        let line = line.trim_start();
        if let Some((pid, args)) = line.split_once(char::is_whitespace) {
            if let Ok(pid) = pid.parse::<u32>() {
                args_by_pid.insert(pid, args.to_string());
            }
        }
    }
    candidates
        .iter()
        .filter(|(pid, base)| {
            let args = args_by_pid.get(pid).map(String::as_str).unwrap_or("");
            is_stdio_mcp(base, args)
        })
        .count()
}

/// Linux 无 ps 时的兜底：直接读 /proc。
#[cfg(unix)]
fn scan_proc_stdio() -> usize {
    let Ok(rd) = std::fs::read_dir("/proc") else {
        return 0;
    };
    let mut n = 0;
    for entry in rd.flatten() {
        let name = entry.file_name();
        let is_pid = name
            .to_str()
            .map(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false);
        if !is_pid {
            continue;
        }
        let Ok(comm) = std::fs::read_to_string(entry.path().join("comm")) else {
            continue;
        };
        let base = comm.trim();
        if !is_stdio_candidate(base) {
            continue;
        }
        let Ok(cmdline) = std::fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let args = cmdline
            .split(|b| *b == 0)
            .map(|s| String::from_utf8_lossy(s))
            .collect::<Vec<_>>()
            .join(" ");
        if is_stdio_mcp(base, &args) {
            n += 1;
        }
    }
    n
}

#[cfg(not(unix))]
fn scan_stdio_mcp() -> usize {
    let Ok(out) = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress",
        ])
        .output()
    else {
        return 0;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return 0;
    };
    let items = match value {
        serde_json::Value::Array(a) => a,
        obj @ serde_json::Value::Object(_) => vec![obj],
        _ => return 0,
    };
    items
        .iter()
        .filter(|p| {
            let name = p.get("Name").and_then(|v| v.as_str()).unwrap_or("");
            let args = p.get("CommandLine").and_then(|v| v.as_str()).unwrap_or("");
            is_stdio_mcp(name, args)
        })
        .count()
}

/// Windows: group children in a Job Object so the whole tree can be terminated
/// even when the shell wrapper spawns grandchildren. The job handle lives in a
/// process-local registry; cross-session stops fall back to taskkill /T.
#[cfg(windows)]
mod winjob {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    static JOBS: Mutex<Option<HashMap<u32, JobHandle>>> = Mutex::new(None);

    #[derive(Clone, Copy)]
    struct JobHandle(HANDLE);
    // Win32 HANDLEs are process-global and safe to move between threads.
    unsafe impl Send for JobHandle {}

    pub fn assign(pid: u32) {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return;
            }
            let info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if proc.is_null() {
                CloseHandle(job);
                return;
            }
            if AssignProcessToJobObject(job, proc) == 0 {
                CloseHandle(job);
            } else {
                let mut guard = JOBS.lock().unwrap();
                guard
                    .get_or_insert_with(HashMap::new)
                    .insert(pid, JobHandle(job));
            }
            CloseHandle(proc);
        }
    }

    pub fn terminate(pid: u32) -> bool {
        let job = JOBS.lock().unwrap().as_mut().and_then(|m| m.remove(&pid));
        match job {
            Some(JobHandle(job)) => unsafe {
                let ok = TerminateJobObject(job, 1) != 0;
                CloseHandle(job);
                ok
            },
            None => false,
        }
    }
}

/// SIGTERM the whole group, wait out the grace period, then SIGKILL.
pub async fn stop_group(pid: u32, timeout_ms: u64) -> Result<()> {
    if !is_alive(pid) {
        return Ok(());
    }
    terminate_group(pid);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while is_alive(pid) {
        if Instant::now() >= deadline {
            kill_group(pid);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    for _ in 0..20 {
        if !is_alive(pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}

/// Stop a process we spawned ourselves: reap via the child handle so no zombie
/// lingers and the exit code is captured.
pub async fn stop_child(child: &mut Child, pid: u32, timeout_ms: u64) -> Result<Option<i32>> {
    terminate_group(pid);
    let grace = Duration::from_millis(timeout_ms);
    let status = match tokio::time::timeout(grace, child.wait()).await {
        Ok(status) => status.ok(),
        Err(_) => {
            kill_group(pid);
            child.wait().await.ok()
        }
    };
    Ok(status.and_then(|s| s.code()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadyKind {
    Ready,
    TimedOut,
    Exited,
}

#[derive(Debug)]
pub struct ReadyOutcome {
    pub kind: ReadyKind,
    pub exit_code: Option<i32>,
    pub tail: Vec<String>,
}

/// Ready when the log pattern matches OR the TCP port accepts a connection.
pub async fn wait_ready(
    child: &mut Child,
    record: &RunRecord,
    start: &StartConfig,
    hub: &LogHub,
    profile_name: &str,
    buffer_lines: usize,
) -> Result<ReadyOutcome> {
    let re = start
        .ready_pattern
        .as_ref()
        .map(|p| Regex::new(p))
        .transpose()?;
    let deadline = Instant::now() + Duration::from_millis(start.ready_timeout_ms);
    let mut cursor = record.log_start;
    let mut ring = RingBuffer::new(buffer_lines);

    loop {
        let page = hub.read_since(profile_name, "run", cursor, None)?;
        cursor = page.next_cursor;
        let mut matched = false;
        for line in &page.lines {
            ring.push(line.text.clone());
            if re.as_ref().is_some_and(|r| r.is_match(&line.text)) {
                matched = true;
            }
        }

        // Drain logs before checking exit so a fast-crashing process still reports its output.
        if let Some(status) = child.try_wait()? {
            return Ok(ReadyOutcome {
                kind: ReadyKind::Exited,
                exit_code: status.code(),
                tail: ring.tail(50),
            });
        }
        if matched {
            return Ok(outcome(ReadyKind::Ready, None, &ring));
        }

        if let Some(port) = start.ready_port {
            // 双栈探测：dev server 可能只监听 IPv6 loopback。
            let addrs = [
                std::net::SocketAddr::from(([127, 0, 0, 1], port)),
                std::net::SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
            ];
            let mut open = false;
            for addr in addrs {
                if tokio::time::timeout(
                    Duration::from_millis(200),
                    tokio::net::TcpStream::connect(addr),
                )
                .await
                .is_ok_and(|r| r.is_ok())
                {
                    open = true;
                    break;
                }
            }
            if open {
                return Ok(outcome(ReadyKind::Ready, None, &ring));
            }
        }

        if re.is_none() && start.ready_port.is_none() {
            return Ok(outcome(ReadyKind::Ready, None, &ring));
        }
        if Instant::now() >= deadline {
            return Ok(outcome(ReadyKind::TimedOut, None, &ring));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn outcome(kind: ReadyKind, exit_code: Option<i32>, ring: &RingBuffer) -> ReadyOutcome {
    ReadyOutcome {
        kind,
        exit_code,
        tail: ring.tail(50),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn fixture(command: &str, ready_pattern: Option<&str>) -> (tempfile::TempDir, Config, ProjectPaths) {
        let dir = tempfile::tempdir().unwrap();
        let toml = format!(
            r#"
[project]
name = "fixture"
[profiles.default.start]
command = {command:?}
ready_timeout_ms = 5000
"#
        );
        let mut config: Config = toml::from_str(&toml).unwrap();
        if let Some(p) = ready_pattern {
            config.profiles.get_mut("default").unwrap().start.ready_pattern = Some(p.into());
        }
        let paths = ProjectPaths {
            root: dir.path().to_path_buf(),
            log_dir: dir.path().join("logs"),
            state_file: dir.path().join("state.json"),
        };
        (dir, config, paths)
    }

    #[tokio::test]
    async fn spawn_wait_ready_stop() {
        let (_dir, config, paths) =
            fixture("printf 'booting\\nREADY\\n'; sleep 30", Some("READY"));
        let profile = config.profile("default").unwrap();
        let (record, mut child) = spawn("default", profile, &paths, false).unwrap();
        assert!(is_alive(record.pid));

        let hub = LogHub::new(&paths.log_dir);
        let outcome = wait_ready(
            &mut child,
            &record,
            &profile.start,
            &hub,
            "default",
            100,
        )
        .await
        .unwrap();
        assert_eq!(outcome.kind, ReadyKind::Ready);

        stop_child(&mut child, record.pid, 2000).await.unwrap();
        assert!(!is_alive(record.pid));
    }

    #[tokio::test]
    async fn detects_early_exit() {
        let (_dir, config, paths) = fixture("echo boom; exit 3", Some("READY"));
        let profile = config.profile("default").unwrap();
        let (record, mut child) = spawn("default", profile, &paths, false).unwrap();
        let hub = LogHub::new(&paths.log_dir);
        let outcome = wait_ready(&mut child, &record, &profile.start, &hub, "default", 100)
            .await
            .unwrap();
        assert_eq!(outcome.kind, ReadyKind::Exited);
        assert_eq!(outcome.exit_code, Some(3));
        assert!(outcome.tail.iter().any(|l| l.contains("boom")));
    }

    #[tokio::test]
    async fn stop_escalates_to_sigkill() {
        let (_dir, config, paths) = fixture("trap '' TERM; sleep 30", None);
        let profile = config.profile("default").unwrap();
        let (record, mut child) = spawn("default", profile, &paths, false).unwrap();
        // Let the shell install the trap.
        tokio::time::sleep(Duration::from_millis(300)).await;
        let code = stop_child(&mut child, record.pid, 500).await.unwrap();
        assert!(!is_alive(record.pid));
        assert_eq!(code, None); // killed by SIGKILL
    }

    #[tokio::test]
    async fn ready_timeout_reports_tail() {
        let (_dir, config, paths) = fixture("echo still-booting; sleep 30", Some("READY"));
        let profile = config.profile("default").unwrap();
        let mut start = profile.start.clone();
        start.ready_timeout_ms = 600;
        let (record, mut child) = spawn("default", profile, &paths, false).unwrap();
        let hub = LogHub::new(&paths.log_dir);
        let outcome = wait_ready(&mut child, &record, &start, &hub, "default", 100)
            .await
            .unwrap();
        assert_eq!(outcome.kind, ReadyKind::TimedOut);
        assert!(outcome.tail.iter().any(|l| l.contains("still-booting")));
        stop_child(&mut child, record.pid, 1000).await.unwrap();
    }

    #[test]
    fn state_store_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = StateStore::new(dir.path().join("state.json"));
        assert!(store.load().unwrap().is_empty());
        let mut records = BTreeMap::new();
        records.insert(
            "default".to_string(),
            RunRecord {
                pid: 42,
                started_at_ms: 1,
                command: "sleep 1".into(),
                state: State::Running,
                log_start: 0,
            },
        );
        store.save(&records).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded["default"].pid, 42);
        assert_eq!(loaded["default"].state, State::Running);
    }

    #[test]
    fn stdio_mcp_argv_matching() {
        assert!(is_stdio_mcp("lifecycle-mcp", "target/release/lifecycle-mcp -c a.toml"));
        assert!(is_stdio_mcp(
            "lifecycle-app",
            "/x/LifeCycle.app/Contents/MacOS/lifecycle-app --mcp-stdio --config /x/a.toml"
        ));
        assert!(is_stdio_mcp("lifecycle", "target/release/lifecycle --mcp -c a.toml"));
        assert!(is_stdio_mcp("lifecycle-app.exe", "C:\\x\\lifecycle-app.exe --mcp-stdio"));
        // 桌面主进程 / HTTP 后端 / 普通 CLI 调用都不是 stdio 连接
        assert!(!is_stdio_mcp("lifecycle-app", "/x/LifeCycle.app/Contents/MacOS/lifecycle-app"));
        assert!(!is_stdio_mcp("lifecycle-http", "target/release/lifecycle-http --port 39517"));
        assert!(!is_stdio_mcp("lifecycle", "target/release/lifecycle -c a.toml list"));
        assert!(!is_stdio_mcp("node", "node lifecycle-mcp.js"));
        assert!(!is_stdio_mcp("lifecycle-app", "/x/lifecycle-app --mcp-stdio-extra"));
    }
}