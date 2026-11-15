use std::collections::VecDeque;
use std::convert::Infallible;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use futures::Stream;
use lifecycle_core::compile::CompileKind;
use lifecycle_core::groups::{new_id, validate, Group, GroupMember, GroupStore};
use lifecycle_core::workspace::Workspace;
use lifecycle_core::Error;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub editor_command: String,
    pub notifications: bool,
    pub log_lines: usize,
    pub ready_timeout_ms: u64,
    pub compile_timeout_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            editor_command: "code -g {file}:{line}".into(),
            notifications: true,
            log_lines: 5000,
            ready_timeout_ms: 120_000,
            compile_timeout_ms: 300_000,
        }
    }
}

pub struct AppState {
    pub ws: Arc<Workspace>,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub diagnostics: Mutex<VecDeque<Value>>,
    pub groups: GroupStore,
}

impl AppState {
    pub fn new(ws: Arc<Workspace>) -> Self {
        let settings_path = home_dir().join(".lifecycle").join("settings.json");
        let settings = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let groups = GroupStore::new(home_dir().join(".lifecycle").join("groups.json"));
        if !groups.path().exists() {
            // 首启种子：把已加载项目的首个 profile 组成示例分组，便于体验一键启动。
            let members: Vec<GroupMember> = ws
                .names()
                .into_iter()
                .take(3)
                .filter_map(|name| {
                    let engine = ws.engine(&name).ok()?;
                    let guard = engine.try_lock().ok()?;
                    let profile = guard.list().ok()?.first()?.profile.clone();
                    Some(GroupMember {
                        project: name,
                        profile,
                    })
                })
                .collect();
            if !members.is_empty() {
                let seed = vec![Group {
                    id: new_id(),
                    name: "示例分组".into(),
                    members,
                    created_at_ms: lifecycle_core::process::now_ms(),
                }];
                let _ = groups.save(&seed);
            }
        }
        Self {
            ws,
            settings: Mutex::new(settings),
            settings_path,
            diagnostics: Mutex::new(VecDeque::new()),
            groups,
        }
    }

    async fn record(&self, tool: &str, started: Instant, ok: bool) {
        let entry = json!({
            "tool": tool,
            "duration_ms": started.elapsed().as_millis() as u64,
            "exit_code": if ok { 0 } else { 1 },
            "ts": lifecycle_core::process::now_ms(),
        });
        let mut diags = self.diagnostics.lock().await;
        if diags.len() >= 200 {
            diags.pop_front();
        }
        diags.push_back(entry);
    }
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub struct ApiError(Error);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let e = self.0;
        let status = match e.code() {
            "NOT_FOUND" => StatusCode::NOT_FOUND,
            "BUSY" => StatusCode::CONFLICT,
            "TIMEOUT" => StatusCode::GATEWAY_TIMEOUT,
            "CONFIG" => StatusCode::BAD_REQUEST,
            "BUILD_FAILED" => StatusCode::UNPROCESSABLE_ENTITY,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(json!({"error": {"code": e.code(), "message": e.to_string()}})),
        )
            .into_response()
    }
}

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        ApiError(e)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        ApiError(e.into())
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError(Error::Other(e.to_string()))
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

async fn traced<T, Fut>(state: &AppState, tool: &str, fut: Fut) -> ApiResult
where
    T: Serialize,
    Fut: Future<Output = lifecycle_core::Result<T>>,
{
    let started = Instant::now();
    let result = fut.await;
    state.record(tool, started, result.is_ok()).await;
    match result {
        Ok(v) => Ok(Json(serde_json::to_value(v).map_err(|e| {
            Error::Other(e.to_string())
        })?)),
        Err(e) => Err(ApiError(e)),
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let mcp_service = lifecycle_mcp::streamable_http_service(state.ws.clone());
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/register", post(register_project))
        .route("/api/projects/{project}", delete(unregister_project))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/diagnostics", get(get_diagnostics))
        .route("/api/open-editor", post(open_editor))
        .route("/api/reveal-log", post(reveal_log))
        .route("/api/events", get(events_stream))
        .route("/api/groups", get(list_groups).post(create_group))
        .route(
            "/api/groups/{id}",
            put(upsert_group).delete(delete_group),
        )
        .route("/api/groups/{id}/start", post(start_group))
        .route("/api/groups/{id}/stop", post(stop_group))
        .route("/api/groups/{id}/restart", post(restart_group))
        .route("/api/projects/{project}/reload", post(reload_config))
        .route("/api/projects/{project}/config", get(get_config))
        .route("/api/projects/{project}/modules", get(list_modules))
        .route(
            "/api/projects/{project}/profiles/{profile}/status",
            get(profile_status),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/start",
            post(start_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/stop",
            post(stop_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/restart",
            post(restart_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/compile",
            post(compile_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/compile/cancel",
            post(cancel_compile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/logs",
            get(get_logs),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/logs/stream",
            get(logs_stream),
        )
        .nest_service("/mcp", mcp_service)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn list_projects(State(state): State<Arc<AppState>>) -> ApiResult {
    traced(&state, "list_projects", async {
        let mut out = Vec::new();
        for name in state.ws.names() {
            let engine = state.ws.engine(&name)?;
            let statuses = engine.lock().await.list()?;
            out.push(json!({"project": name, "profiles": statuses}));
        }
        Ok(out)
    })
    .await
}

#[derive(Debug, Deserialize)]
struct RegisterBody {
    path: String,
    name: Option<String>,
    port: Option<u16>,
    command: Option<String>,
}

async fn register_project(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> ApiResult {
    traced(&state, "register_project", async {
        let root = std::fs::canonicalize(&body.path)
            .map_err(|_| Error::Config(format!("directory not found: {}", body.path)))?;
        if !root.is_dir() {
            return Err(Error::Config(format!("not a directory: {}", root.display())));
        }
        let toml_path = root.join("lifecycle.toml");
        let generated = !toml_path.exists();
        if generated {
            let detected = lifecycle_core::detect::detect(&root);
            let name = body.name.clone().unwrap_or_else(|| {
                root.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "project".into())
            });
            let has_command = body
                .command
                .as_deref()
                .is_some_and(|c| !c.trim().is_empty())
                || !detected.start_command.is_empty();
            if !has_command {
                return Err(Error::Config(
                    "cannot detect a start command for this directory; fill in the start command".into(),
                ));
            }
            let content = lifecycle_core::detect::render_toml(
                &name,
                &detected,
                body.port,
                body.command.as_deref(),
            );
            std::fs::write(&toml_path, content)?;
        }
        let project = state.ws.add(&toml_path)?;
        Ok(json!({"project": project, "path": toml_path, "generated": generated}))
    })
    .await
}

async fn unregister_project(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    traced(&state, "unregister_project", async {
        let engine = state.ws.engine(&project)?;
        {
            let mut guard = engine.lock().await;
            let statuses = guard.list()?;
            for s in statuses {
                if matches!(
                    s.state,
                    lifecycle_core::process::State::Running
                        | lifecycle_core::process::State::Starting
                ) {
                    let _ = guard.stop(&s.profile).await;
                }
            }
        }
        state.ws.remove(&project)?;
        Ok(json!({"ok": true}))
    })
    .await
}

async fn profile_status(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
) -> ApiResult {
    traced(&state, "get_status", async {
        let engine = state.ws.engine(&project)?;
        let status = engine.lock().await.status(&profile)?;
        Ok(status)
    })
    .await
}

#[derive(Debug, Deserialize)]
struct StartBody {
    #[serde(default = "default_true")]
    wait: bool,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

fn default_true() -> bool {
    true
}

async fn start_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    body: Option<Json<StartBody>>,
) -> ApiResult {
    let body = body.map(|b| b.0).unwrap_or(StartBody {
        wait: true,
        timeout_ms: None,
    });
    traced(&state, "start_project", async {
        let engine = state.ws.engine(&project)?;
        let mut guard = engine.lock().await;
        let outcome = guard
            .start_with_timeout(&profile, body.wait, body.timeout_ms)
            .await?;
        Ok(outcome)
    })
    .await
}

#[derive(Debug, Deserialize)]
struct StopBody {
    signal: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

async fn stop_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    body: Option<Json<StopBody>>,
) -> ApiResult {
    let timeout = body.and_then(|b| {
        if b.0.signal.as_deref() == Some("kill") {
            Some(0)
        } else {
            b.0.timeout_ms
        }
    });
    traced(&state, "stop_project", async {
        let engine = state.ws.engine(&project)?;
        let mut guard = engine.lock().await;
        let outcome = guard.stop_with_timeout(&profile, timeout).await?;
        Ok(outcome)
    })
    .await
}

#[derive(Debug, Deserialize)]
struct RestartBody {
    #[serde(default)]
    recompile: bool,
    #[serde(default = "default_true")]
    wait: bool,
}

async fn restart_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    body: Option<Json<RestartBody>>,
) -> ApiResult {
    let body = body.map(|b| b.0).unwrap_or(RestartBody {
        recompile: false,
        wait: true,
    });
    traced(&state, "restart_project", async {
        let engine = state.ws.engine(&project)?;
        let mut guard = engine.lock().await;
        if body.recompile {
            let result = guard.compile(&profile, CompileKind::Quick, &[]).await?;
            if !result.success {
                return Err(Error::BuildFailed(format!(
                    "{} compile errors",
                    result.errors.len()
                )));
            }
        }
        guard.stop(&profile).await?;
        let outcome = guard.start(&profile, body.wait).await?;
        Ok(outcome)
    })
    .await
}

#[derive(Debug, Deserialize)]
struct CompileBody {
    kind: String,
    #[serde(default)]
    targets: Vec<String>,
}

async fn compile_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Json(body): Json<CompileBody>,
) -> ApiResult {
    traced(&state, "compile", async {
        let kind = CompileKind::parse(&body.kind)?;
        let engine = state.ws.engine(&project)?;
        let mut guard = engine.lock().await;
        let result = guard.compile(&profile, kind, &body.targets).await?;
        Ok(result)
    })
    .await
}

async fn cancel_compile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
) -> ApiResult {
    traced(&state, "cancel_compile", async {
        let engine = state.ws.engine(&project)?;
        let cancelled = engine.lock().await.cancel_compile(&profile)?;
        Ok(json!({"cancelled": cancelled}))
    })
    .await
}

#[derive(Debug, Deserialize)]
struct LogsQuery {
    #[serde(default = "default_source")]
    source: String,
    #[serde(default = "default_lines")]
    lines: usize,
    filter: Option<String>,
    since: Option<u64>,
}

fn default_source() -> String {
    "run".into()
}

fn default_lines() -> usize {
    500
}

async fn get_logs(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Query(q): Query<LogsQuery>,
) -> ApiResult {
    traced(&state, "get_logs", async {
        let engine = state.ws.engine(&project)?;
        let page = engine.lock().await.logs(
            &profile,
            &q.source,
            q.lines,
            q.filter.as_deref(),
            q.since,
        )?;
        Ok(json!({"lines": page.lines, "nextCursor": page.next_cursor}))
    })
    .await
}

async fn logs_stream(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Query(q): Query<LogsQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let engine = state.ws.engine(&project)?;
    let cursor = q.since.unwrap_or(0);
    let stream = async_stream::stream! {
        let mut cursor = cursor;
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let page = {
                let guard = engine.lock().await;
                guard.logs(&profile, &q.source, 0, None, Some(cursor))
            };
            match page {
                Ok(page) => {
                    cursor = page.next_cursor;
                    if !page.lines.is_empty() {
                        let data = json!({"lines": page.lines, "nextCursor": cursor});
                        yield Ok(Event::default().data(data.to_string()));
                    }
                }
                Err(e) => {
                    yield Ok(Event::default().event("error").data(e.to_string()));
                    break;
                }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn events_stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let ws = state.ws.clone();
    let stream = async_stream::stream! {
        let mut last = String::new();
        loop {
            let mut snapshot = Vec::new();
            for name in ws.names() {
                if let Ok(engine) = ws.engine(&name) {
                    if let Ok(statuses) = engine.lock().await.list() {
                        snapshot.push(json!({"project": name, "profiles": statuses}));
                    }
                }
            }
            let serialized = serde_json::to_string(&snapshot).unwrap_or_default();
            if serialized != last {
                last = serialized.clone();
                yield Ok(Event::default().event("status").data(serialized));
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn list_modules(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    traced(&state, "list_modules", async {
        let engine = state.ws.engine(&project)?;
        let guard = engine.lock().await;
        let mut all = Vec::new();
        for status in guard.list()? {
            let modules = guard.modules(&status.profile)?;
            all.push(json!({"profile": status.profile, "modules": modules}));
        }
        Ok(all)
    })
    .await
}

async fn get_config(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    let engine = state.ws.engine(&project)?;
    let path = engine.lock().await.config_path().to_path_buf();
    let content = std::fs::read_to_string(&path)?;
    Ok(Json(json!({"path": path, "content": content})))
}

async fn reload_config(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    traced(&state, "reload_config", async {
        let engine = state.ws.engine(&project)?;
        engine.lock().await.reload_config()?;
        Ok(json!({"ok": true}))
    })
    .await
}

async fn get_settings(State(state): State<Arc<AppState>>) -> Json<Settings> {
    Json(state.settings.lock().await.clone())
}

async fn put_settings(
    State(state): State<Arc<AppState>>,
    Json(settings): Json<Settings>,
) -> ApiResult {
    let mut guard = state.settings.lock().await;
    *guard = settings.clone();
    if let Some(parent) = state.settings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(
        &state.settings_path,
        serde_json::to_vec_pretty(&settings).map_err(|e| Error::Other(e.to_string()))?,
    )?;
    Ok(Json(json!({"ok": true})))
}

async fn get_diagnostics(State(state): State<Arc<AppState>>) -> Json<Value> {
    let diags = state.diagnostics.lock().await;
    Json(Value::Array(diags.iter().cloned().collect()))
}

#[derive(Debug, Deserialize)]
struct EditorRequest {
    file: String,
    #[serde(default)]
    line: u32,
    #[serde(default)]
    col: u32,
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

async fn open_editor(
    State(state): State<Arc<AppState>>,
    Json(req): Json<EditorRequest>,
) -> ApiResult {
    let template = state.settings.lock().await.editor_command.clone();
    let command = template
        .replace("{file}", &shell_quote(&req.file))
        .replace("{line}", &req.line.to_string())
        .replace("{col}", &req.col.to_string());
    #[cfg(unix)]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    #[cfg(not(unix))]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    };
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| Error::Other(format!("failed to launch editor '{command}': {e}")))?;
    Ok(Json(json!({"ok": true})))
}

#[derive(Debug, Deserialize)]
struct RevealRequest {
    project: String,
    profile: String,
    #[serde(default = "default_source")]
    source: String,
}

async fn reveal_log(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RevealRequest>,
) -> ApiResult {
    let engine = state.ws.engine(&req.project)?;
    let path = engine.lock().await.log_file(&req.profile, &req.source);
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", path.display()));
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path.parent().unwrap_or(&path));
        c
    };
    cmd.spawn()
        .map_err(|e| Error::Other(format!("failed to reveal log: {e}")))?;
    Ok(Json(json!({"ok": true})))
}

#[derive(Debug, Deserialize)]
struct GroupBody {
    name: String,
    members: Vec<GroupMember>,
}

async fn list_groups(State(state): State<Arc<AppState>>) -> ApiResult {
    Ok(Json(serde_json::to_value(state.groups.load()?)?))
}

async fn create_group(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GroupBody>,
) -> ApiResult {
    validate(&body.name, &body.members)?;
    let mut groups = state.groups.load()?;
    let group = Group {
        id: new_id(),
        name: body.name,
        members: body.members,
        created_at_ms: lifecycle_core::process::now_ms(),
    };
    groups.push(group.clone());
    state.groups.save(&groups)?;
    Ok(Json(serde_json::to_value(group)?))
}

async fn upsert_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<GroupBody>,
) -> ApiResult {
    validate(&body.name, &body.members)?;
    let mut groups = state.groups.load()?;
    let group = Group {
        id: id.clone(),
        name: body.name,
        members: body.members,
        created_at_ms: lifecycle_core::process::now_ms(),
    };
    match groups.iter_mut().find(|g| g.id == id) {
        Some(g) => *g = group.clone(),
        None => groups.push(group.clone()),
    }
    state.groups.save(&groups)?;
    Ok(Json(serde_json::to_value(group)?))
}

async fn delete_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult {
    let mut groups = state.groups.load()?;
    let pos = groups
        .iter()
        .position(|g| g.id == id)
        .ok_or_else(|| Error::NotFound(format!("group '{id}'")))?;
    let removed = groups.remove(pos);
    state.groups.save(&groups)?;
    Ok(Json(serde_json::to_value(removed)?))
}

fn find_group(state: &AppState, id: &str) -> lifecycle_core::Result<Group> {
    state
        .groups
        .load()?
        .into_iter()
        .find(|g| g.id == id)
        .ok_or_else(|| Error::NotFound(format!("group '{id}'")))
}

#[derive(Debug, Serialize)]
struct MemberResult {
    project: String,
    profile: String,
    ok: bool,
    state: String,
    pid: Option<u32>,
    error: Option<String>,
}

async fn run_group(
    state: &AppState,
    id: &str,
    op: &'static str,
    wait: bool,
) -> lifecycle_core::Result<Vec<MemberResult>> {
    let group = find_group(state, id)?;
    let futs = group.members.iter().map(|m| {
        let engine = state.ws.engine(&m.project);
        let (project, profile) = (m.project.clone(), m.profile.clone());
        async move {
            let engine = match engine {
                Ok(e) => e,
                Err(e) => {
                    return MemberResult {
                        project,
                        profile,
                        ok: false,
                        state: "error".into(),
                        pid: None,
                        error: Some(e.to_string()),
                    }
                }
            };
            let mut guard = engine.lock().await;
            let result = match op {
                "start" => guard.start(&profile, wait).await.map(|o| (o.state, Some(o.pid))),
                "stop" => guard.stop(&profile).await.map(|o| (o.state, None)),
                _ => {
                    let stopped = guard.stop(&profile).await;
                    match stopped {
                        Ok(_) => guard.start(&profile, wait).await.map(|o| (o.state, Some(o.pid))),
                        Err(e) => Err(e),
                    }
                }
            };
            match result {
                Ok((state, pid)) => MemberResult {
                    project,
                    profile,
                    ok: true,
                    state: format!("{state:?}").to_lowercase(),
                    pid,
                    error: None,
                },
                Err(e) => MemberResult {
                    project,
                    profile,
                    ok: false,
                    state: "error".into(),
                    pid: None,
                    error: Some(e.to_string()),
                },
            }
        }
    });
    Ok(futures::future::join_all(futs).await)
}

#[derive(Debug, Deserialize)]
struct GroupOpBody {
    #[serde(default = "default_true")]
    wait: bool,
}

async fn start_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<GroupOpBody>>,
) -> ApiResult {
    let wait = body.map(|b| b.0.wait).unwrap_or(true);
    traced(&state, "group_start", async {
        let results = run_group(&state, &id, "start", wait).await?;
        Ok(json!({"results": results}))
    })
    .await
}

async fn stop_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult {
    traced(&state, "group_stop", async {
        let results = run_group(&state, &id, "stop", false).await?;
        Ok(json!({"results": results}))
    })
    .await
}

async fn restart_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<GroupOpBody>>,
) -> ApiResult {
    let wait = body.map(|b| b.0.wait).unwrap_or(true);
    traced(&state, "group_restart", async {
        let results = run_group(&state, &id, "restart", wait).await?;
        Ok(json!({"results": results}))
    })
    .await
}

pub async fn serve(ws: Arc<Workspace>, port: u16) -> anyhow::Result<()> {
    let state = Arc::new(AppState::new(ws));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("lifecycle-http listening on 127.0.0.1:{port}");
    axum::serve(listener, router(state)).await?;
    Ok(())
}