use std::collections::BTreeMap;
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
use lifecycle_core::groups::{new_id, validate, Group, GroupMember};
use lifecycle_core::workspace::Workspace;
use lifecycle_core::Error;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

mod mcp_admin;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub editor_command: String,
    pub notifications: bool,
    pub log_lines: usize,
    pub ready_timeout_ms: u64,
    pub compile_timeout_ms: u64,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "zh" | "en"
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            editor_command: "code -g {file}:{line}".into(),
            notifications: true,
            log_lines: 5000,
            ready_timeout_ms: 120_000,
            compile_timeout_ms: 300_000,
            theme: "system".into(),
            language: "zh".into(),
        }
    }
}

pub struct AppState {
    pub ws: Arc<Workspace>,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub port: u16,
}

impl AppState {
    pub fn new(ws: Arc<Workspace>) -> Self {
        let settings_path = home_dir().join(".lifecycle").join("settings.json");
        let settings = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Self {
            ws,
            settings: Mutex::new(settings),
            settings_path,
            port: 39517,
        }
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

async fn traced<T, Fut>(state: &AppState, tool: &str, input: Value, fut: Fut) -> ApiResult
where
    T: Serialize,
    Fut: Future<Output = lifecycle_core::Result<T>>,
{
    let started = Instant::now();
    let result = fut.await;
    let (exit, output) = match &result {
        Ok(v) => (0, serde_json::to_value(v).unwrap_or(Value::Null)),
        Err(e) => (1, json!({"error": {"code": e.code(), "message": e.to_string()}})),
    };
    state.ws.call_log().push(
        "ui",
        tool,
        started.elapsed().as_millis() as u64,
        exit,
        input,
        output,
    );
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
        .route("/api/projects/choose-directory", post(choose_directory))
        .route("/api/projects/detect", post(detect_project))
        .route("/api/projects/{project}", delete(unregister_project))
        .route("/api/projects/{project}/rename", post(rename_project_handler))
        .route("/api/projects/{project}/services/{service}/rename", post(rename_service_handler))
        .route("/api/projects/{project}/profiles", post(add_service))
        .route(
            "/api/projects/{project}/profiles/{profile}",
            put(update_service_profile).delete(delete_service_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{profile}/rename",
            post(rename_profile_handler),
        )
        .route("/api/reveal-path", post(reveal_path))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/mcp", get(mcp_admin::info))
        .route("/api/mcp/projects/{project}", put(mcp_admin::put_project))
        .route("/api/mcp/client-config", post(mcp_admin::client_config))
        .route("/api/diagnostics", get(get_diagnostics))
        .route("/api/open-editor", post(open_editor))
        .route("/api/open-url", post(open_url))
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
        .route("/api/projects/{project}/config", get(get_config).put(save_config))
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
        .route(
            "/api/projects/{project}/profiles/{profile}/logs/clear",
            post(clear_logs),
        )
        .nest_service("/mcp", mcp_service)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn list_projects(State(state): State<Arc<AppState>>) -> ApiResult {
    traced(&state, "list_projects", json!({}), async {
        let mut out = Vec::new();
        for name in state.ws.names() {
            let engine = state.ws.engine(&name)?;
            let mut guard = engine.lock().await;
            let statuses = guard.list()?;
            let path = guard.config_path().to_path_buf();
            out.push(json!({"project": name, "path": path, "profiles": statuses}));
        }
        Ok(out)
    })
    .await
}

#[derive(Debug, Serialize, Deserialize)]
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
    traced(&state, "register_project", json!(body), async {
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
        let project = state.ws.register(&toml_path)?;
        Ok(json!({"project": project, "path": toml_path, "generated": generated}))
    })
    .await
}

#[derive(Debug, Serialize, Deserialize)]
struct AddServiceBody {
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    env_name: Option<String>,
    #[serde(default)]
    profile: Option<String>,
    start_command: String,
    #[serde(default)]
    fast_start_command: Option<String>,
    #[serde(default)]
    stop_command: Option<String>,
    #[serde(default)]
    restart_command: Option<String>,
    #[serde(default)]
    compile_quick: Option<String>,
    #[serde(default)]
    compile_partial: Option<String>,
    #[serde(default)]
    compile_full: Option<String>,
    #[serde(default)]
    workdir: Option<String>,
    #[serde(default)]
    ready_port: Option<u16>,
    #[serde(default)]
    ready_pattern: Option<String>,
    #[serde(default)]
    ready_timeout_ms: Option<u64>,
    #[serde(default)]
    env: Option<BTreeMap<String, String>>,
}

async fn add_service(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Json(body): Json<AddServiceBody>,
) -> ApiResult {
    traced(
        &state,
        "add_service",
        json!({"project": project, "body": body}),
        async {
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            let config = lifecycle_core::config::Config::load(&path)?;

            // Determine unique profile key
            let name = if let Some(p) = body.profile.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                p.to_string()
            } else if let Some(svc) = body.service.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                let env = body.env_name.as_deref().unwrap_or("dev").trim();
                if (env == "dev" || env == "default") && !config.profiles.contains_key(svc) {
                    svc.to_string()
                } else {
                    format!("{svc}:{env}")
                }
            } else {
                return Err(Error::Config("service name or profile must not be empty".into()));
            };

            if body.start_command.trim().is_empty() {
                return Err(Error::Config("start command must not be empty".into()));
            }
            if let Some(w) = &body.workdir {
                let p = std::path::Path::new(w);
                if p.is_absolute()
                    || p.components().any(|c| matches!(c, std::path::Component::ParentDir))
                {
                    return Err(Error::Config(
                        "workdir must be a relative path inside the project root".into(),
                    ));
                }
            }
            if config.profiles.contains_key(&name) {
                return Err(Error::Config(format!(
                    "service '{name}' already exists in project '{project}'"
                )));
            }
            let patch = lifecycle_core::config::ProfilePatch {
                service: body.service.clone(),
                env_name: body.env_name.clone(),
                workdir: body.workdir.clone(),
                env: body.env.clone(),
                start_command: Some(body.start_command.trim().to_string()),
                fast_start_command: body.fast_start_command.filter(|s| !s.trim().is_empty()),
                stop_command: body.stop_command.filter(|s| !s.trim().is_empty()),
                restart_command: body.restart_command.filter(|s| !s.trim().is_empty()),
                ready_pattern: body.ready_pattern.clone(),
                ready_port: body.ready_port,
                ready_timeout_ms: body.ready_timeout_ms,
                compile_quick: body.compile_quick.filter(|s| !s.trim().is_empty()).map(|c| (c, None)),
                compile_partial: body.compile_partial.filter(|s| !s.trim().is_empty()).map(|c| (c, None)),
                compile_full: body.compile_full.filter(|s| !s.trim().is_empty()).map(|c| (c, None)),
            };
            lifecycle_core::config::update_profile(&path, &name, &patch)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "project": project, "profile": name}))
        },
    )
    .await
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateServiceBody {
    #[serde(default)]
    service: Option<String>,
    #[serde(default)]
    env_name: Option<String>,
    #[serde(default)]
    start_command: Option<String>,
    #[serde(default)]
    fast_start_command: Option<String>,
    #[serde(default)]
    stop_command: Option<String>,
    #[serde(default)]
    restart_command: Option<String>,
    #[serde(default)]
    compile_quick: Option<String>,
    #[serde(default)]
    compile_partial: Option<String>,
    #[serde(default)]
    compile_full: Option<String>,
    #[serde(default)]
    workdir: Option<String>,
    #[serde(default)]
    ready_port: Option<u16>,
    #[serde(default)]
    ready_pattern: Option<String>,
    #[serde(default)]
    ready_timeout_ms: Option<u64>,
    #[serde(default)]
    env: Option<BTreeMap<String, String>>,
}

async fn update_service_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Json(body): Json<UpdateServiceBody>,
) -> ApiResult {
    traced(
        &state,
        "update_service_profile",
        json!({"project": project, "profile": profile, "body": body}),
        async {
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            let config = lifecycle_core::config::Config::load(&path)?;
            if !config.profiles.contains_key(&profile) {
                return Err(Error::NotFound(format!(
                    "service profile '{profile}' not found in project '{project}'"
                )));
            }
            if let Some(w) = &body.workdir {
                let p = std::path::Path::new(w);
                if p.is_absolute()
                    || p.components().any(|c| matches!(c, std::path::Component::ParentDir))
                {
                    return Err(Error::Config(
                        "workdir must be a relative path inside the project root".into(),
                    ));
                }
            }
            let patch = lifecycle_core::config::ProfilePatch {
                service: body.service,
                env_name: body.env_name,
                workdir: body.workdir,
                env: body.env,
                start_command: body.start_command.map(|c| c.trim().to_string()),
                fast_start_command: body.fast_start_command.map(|c| c.trim().to_string()),
                stop_command: body.stop_command.map(|c| c.trim().to_string()),
                restart_command: body.restart_command.map(|c| c.trim().to_string()),
                ready_pattern: body.ready_pattern,
                ready_port: body.ready_port,
                ready_timeout_ms: body.ready_timeout_ms,
                compile_quick: body.compile_quick.map(|c| (c, None)),
                compile_partial: body.compile_partial.map(|c| (c, None)),
                compile_full: body.compile_full.map(|c| (c, None)),
            };
            lifecycle_core::config::update_profile(&path, &profile, &patch)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "project": project, "profile": profile}))
        },
    )
    .await
}

async fn rename_service_handler(
    State(state): State<Arc<AppState>>,
    Path((project, service)): Path<(String, String)>,
    Json(body): Json<RenameProjectBody>,
) -> ApiResult {
    traced(
        &state,
        "rename_service",
        json!({"project": project, "service": service, "new_name": body.name}),
        async {
            let new_name = body.name.trim().to_string();
            if new_name.is_empty() {
                return Err(Error::Config("service name must not be empty".into()));
            }
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            lifecycle_core::config::rename_service(&path, &service, &new_name)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "old_service": service, "new_service": new_name}))
        },
    )
    .await
}

async fn rename_profile_handler(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Json(body): Json<RenameProjectBody>,
) -> ApiResult {
    traced(
        &state,
        "rename_profile",
        json!({"project": project, "profile": profile, "new_name": body.name}),
        async {
            let new_name = body.name.trim().to_string();
            if new_name.is_empty() {
                return Err(Error::Config("profile name must not be empty".into()));
            }
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            lifecycle_core::config::rename_profile(&path, &profile, &new_name)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "old_profile": profile, "new_profile": new_name}))
        },
    )
    .await
}

async fn delete_service_profile(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
) -> ApiResult {
    traced(
        &state,
        "delete_service_profile",
        json!({"project": project, "profile": profile}),
        async {
            let engine = state.ws.engine(&project)?;
            {
                let mut guard = engine.lock().await;
                if let Ok(status) = guard.status(&profile) {
                    if matches!(
                        status.state,
                        lifecycle_core::process::State::Running
                            | lifecycle_core::process::State::Starting
                    ) {
                        let _ = guard.stop(&profile).await;
                    }
                }
            }
            let path = engine.lock().await.config_path().to_path_buf();
            lifecycle_core::config::delete_profile(&path, &profile)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "project": project, "profile": profile}))
        },
    )
    .await
}

#[derive(Debug, Deserialize)]
struct RenameProjectBody {
    name: String,
}

async fn rename_project_handler(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Json(body): Json<RenameProjectBody>,
) -> ApiResult {
    let new_name = body.name.trim().to_string();
    if new_name.is_empty() {
        return Err(ApiError(Error::Config("project name must not be empty".into())));
    }
    traced(
        &state,
        "rename_project",
        json!({"project": project, "new_name": new_name}),
        async {
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            lifecycle_core::config::rename_project(&path, &new_name)?;
            state.ws.remove(&project)?;
            let reg_name = state.ws.register(&path)?;
            Ok(json!({"ok": true, "old_name": project, "new_name": reg_name, "path": path}))
        },
    )
    .await
}

#[derive(Debug, Deserialize)]
struct RevealPathBody {
    path: String,
}

async fn reveal_path(Json(body): Json<RevealPathBody>) -> ApiResult {
    let path = std::path::Path::new(&body.path);
    if !path.exists() {
        return Err(ApiError(Error::NotFound(format!("path not found: {}", body.path))));
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if path.is_file() {
            cmd.arg("-R").arg(&body.path);
        } else {
            cmd.arg(&body.path);
        }
        let _ = cmd.spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        if path.is_file() {
            cmd.arg(format!("/select,{}", body.path));
        } else {
            cmd.arg(&body.path);
        }
        let _ = cmd.spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    }
    Ok(Json(json!({"ok": true})))
}

#[derive(Debug, Deserialize)]
struct DetectBody {
    path: String,
}

async fn detect_project(Json(body): Json<DetectBody>) -> ApiResult {
    let Ok(root) = std::fs::canonicalize(&body.path) else {
        return Ok(Json(json!({ "exists": false })));
    };
    if !root.is_dir() {
        return Ok(Json(json!({ "exists": false, "is_dir": false })));
    }
    let toml_path = root.join("lifecycle.toml");
    let has_toml = toml_path.exists();
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());
    let detected = lifecycle_core::detect::detect(&root);
    Ok(Json(json!({
        "exists": true,
        "name": name,
        "has_lifecycle_toml": has_toml,
        "kind": detected.kind,
        "start_command": detected.start_command,
        "port": detected.ready_port,
    })))
}

async fn choose_directory() -> ApiResult {
    let chosen = tokio::task::spawn_blocking(|| -> Result<Option<String>, String> {
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("osascript")
                .arg("-e")
                .arg("POSIX path of (choose folder with prompt \"选择项目目录\")")
                .output()
                .map_err(|e| e.to_string())?;
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let clean = s.trim_end_matches('/').to_string();
                if !clean.is_empty() {
                    return Ok(Some(clean));
                }
            }
            Ok(None)
        }
        #[cfg(target_os = "windows")]
        {
            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择项目目录"
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
"#;
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .output()
                .map_err(|e| e.to_string())?;
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let clean = s.trim_end_matches('\\').to_string();
                if !clean.is_empty() {
                    return Ok(Some(clean));
                }
            }
            Ok(None)
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            if let Ok(output) = std::process::Command::new("zenity")
                .args(["--file-selection", "--directory", "--title=选择项目目录"])
                .output()
            {
                if output.status.success() {
                    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let clean = s.trim_end_matches('/').to_string();
                    if !clean.is_empty() {
                        return Ok(Some(clean));
                    }
                }
            }
            if let Ok(output) = std::process::Command::new("kdialog")
                .args(["--getexistingdirectory"])
                .output()
            {
                if output.status.success() {
                    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let clean = s.trim_end_matches('/').to_string();
                    if !clean.is_empty() {
                        return Ok(Some(clean));
                    }
                }
            }
            Ok(None)
        }
    })
    .await
    .map_err(|e| ApiError(Error::Other(e.to_string())))?
    .map_err(|e| ApiError(Error::Other(e)))?;

    Ok(Json(json!({ "path": chosen })))
}

async fn unregister_project(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    traced(&state, "unregister_project", json!({"project": project}), async {
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
    traced(&state, "get_status", json!({"project": project, "profile": profile}), async {
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
    traced(&state, "start_project", json!({"project": project, "profile": profile, "wait": body.wait, "timeout_ms": body.timeout_ms}), async {
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
    traced(&state, "stop_project", json!({"project": project, "profile": profile, "timeout_ms": timeout}), async {
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
    traced(&state, "restart_project", json!({"project": project, "profile": profile, "recompile": body.recompile, "wait": body.wait}), async {
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
    traced(&state, "compile", json!({"project": project, "profile": profile, "kind": body.kind, "targets": body.targets}), async {
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
    traced(&state, "cancel_compile", json!({"project": project, "profile": profile}), async {
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

#[derive(Debug, Serialize, Deserialize)]
struct ClearLogsBody {
    #[serde(default = "default_log_scope")]
    source: String,
}

fn default_log_scope() -> String {
    "all".into()
}

async fn clear_logs(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    body: Option<Json<ClearLogsBody>>,
) -> ApiResult {
    let source = body.map(|b| b.0.source).unwrap_or_else(default_log_scope);
    traced(
        &state,
        "clear_logs",
        json!({"project": project, "profile": profile, "source": source}),
        async {
            let engine = state.ws.engine(&project)?;
            let guard = engine.lock().await;
            let cleared = guard.clear_logs(&profile, &source)?;
            Ok(json!({
                "ok": true,
                "cleared": cleared
                    .iter()
                    .map(|(s, b)| json!({"source": s, "bytes": b}))
                    .collect::<Vec<_>>()
            }))
        },
    )
    .await
}

async fn get_logs(
    State(state): State<Arc<AppState>>,
    Path((project, profile)): Path<(String, String)>,
    Query(q): Query<LogsQuery>,
) -> ApiResult {
    traced(&state, "get_logs", json!({"project": project, "profile": profile, "source": q.source, "lines": q.lines, "filter": q.filter, "since": q.since}), async {
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
                    let mut guard = engine.lock().await;
                    if let Ok(statuses) = guard.list() {
                        snapshot.push(json!({
                            "project": name,
                            "path": guard.config_path(),
                            "profiles": statuses
                        }));
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
    traced(&state, "list_modules", json!({"project": project}), async {
        let engine = state.ws.engine(&project)?;
        let mut guard = engine.lock().await;
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

#[derive(Debug, Serialize, Deserialize)]
struct SaveConfigBody {
    content: String,
}

async fn save_config(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Json(body): Json<SaveConfigBody>,
) -> ApiResult {
    traced(
        &state,
        "save_config",
        json!({"project": project, "bytes": body.content.len()}),
        async {
            // 先整份解析+校验（含 workdir confinement），失败则不落盘
            lifecycle_core::config::parse_config(&body.content)?;
            let engine = state.ws.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = path.with_extension("toml.tmp");
            std::fs::write(&tmp, &body.content)?;
            std::fs::rename(&tmp, &path)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            state.ws.set_expose(&project, expose);
            Ok(json!({"ok": true, "path": path}))
        },
    )
    .await
}

async fn reload_config(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> ApiResult {
    traced(&state, "reload_config", json!({"project": project}), async {
        let engine = state.ws.engine(&project)?;
        let expose = {
            let mut guard = engine.lock().await;
            guard.reload_config()?;
            guard.mcp_expose().to_vec()
        };
        state.ws.set_expose(&project, expose);
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
    Json(json!(state.ws.call_log().list()))
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
struct OpenUrlRequest {
    url: String,
}

/// Open an http(s) link from a log line in the default browser.
/// The URL is passed as a single argv entry (never through a shell) and is
/// restricted to http/https without whitespace or quote characters.
async fn open_url(Json(req): Json<OpenUrlRequest>) -> ApiResult {
    let url = req.url.trim();
    let ok_scheme = url.starts_with("http://") || url.starts_with("https://");
    let clean = url.len() <= 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control() || "\"'`<>\\".contains(c));
    let host = url
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""))
        .unwrap_or("");
    if !ok_scheme || !clean || host.is_empty() {
        return Err(ApiError(Error::Config(format!("refusing to open URL: {url}"))));
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| Error::Other(format!("failed to open URL: {e}")))?;
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
    Ok(Json(serde_json::to_value(state.ws.groups().load()?)?))
}

async fn create_group(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GroupBody>,
) -> ApiResult {
    validate(&body.name, &body.members)?;
    let mut groups = state.ws.groups().load()?;
    let group = Group {
        id: new_id(),
        name: body.name,
        members: body.members,
        created_at_ms: lifecycle_core::process::now_ms(),
    };
    groups.push(group.clone());
    state.ws.groups().save(&groups)?;
    Ok(Json(serde_json::to_value(group)?))
}

async fn upsert_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<GroupBody>,
) -> ApiResult {
    validate(&body.name, &body.members)?;
    let mut groups = state.ws.groups().load()?;
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
    state.ws.groups().save(&groups)?;
    Ok(Json(serde_json::to_value(group)?))
}

async fn delete_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult {
    let mut groups = state.ws.groups().load()?;
    let pos = groups
        .iter()
        .position(|g| g.id == id)
        .ok_or_else(|| Error::NotFound(format!("group '{id}'")))?;
    let removed = groups.remove(pos);
    state.ws.groups().save(&groups)?;
    Ok(Json(serde_json::to_value(removed)?))
}

fn find_group(state: &AppState, id: &str) -> lifecycle_core::Result<Group> {
    state
        .ws
        .groups()
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
    traced(&state, "group_start", json!({"id": id, "wait": wait}), async {
        let results = run_group(&state, &id, "start", wait).await?;
        Ok(json!({"results": results}))
    })
    .await
}

async fn stop_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult {
    traced(&state, "group_stop", json!({"id": id}), async {
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
    traced(&state, "group_restart", json!({"id": id, "wait": wait}), async {
        let results = run_group(&state, &id, "restart", wait).await?;
        Ok(json!({"results": results}))
    })
    .await
}

pub async fn serve(ws: Arc<Workspace>, port: u16) -> anyhow::Result<()> {
    let mut state = AppState::new(ws);
    state.port = port;
    let state = Arc::new(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("lifecycle-http listening on 127.0.0.1:{port}");
    axum::serve(listener, router(state)).await?;
    Ok(())
}