use std::collections::HashMap;
use std::future::Future;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use lifecycle_core::compile::CompileKind;
use lifecycle_core::logs::LogPage;
use lifecycle_core::Error;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::model::{ErrorCode, ServerCapabilities, ServerConfig};
use rmcp::{tool, tool_handler, tool_router, ErrorData, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

pub const ALL_TOOLS: &[&str] = &[
    "list_projects",
    "get_status",
    "start_project",
    "stop_project",
    "restart_project",
    "compile_quick",
    "compile_partial",
    "compile_full",
    "cancel_compile",
    "get_logs",
    "watch_logs",
    "reload_config",
    "register_project",
    "configure_service",
    "list_groups",
    "create_group",
    "update_group",
    "delete_group",
    "start_group",
    "stop_group",
    "restart_group",
];

/// Whether a tool is allowed by an expose whitelist. An empty whitelist means
/// "everything except reload_config"; `prefix*` patterns are supported.
pub fn tool_matches(expose: &[String], tool: &str) -> bool {
    if expose.is_empty() {
        return tool != "reload_config";
    }
    expose.iter().any(|pattern| match pattern.strip_suffix('*') {
        Some(prefix) => tool.starts_with(prefix),
        None => pattern == tool,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub name: &'static str,
    /// Chinese summary shown in the console.
    pub summary: &'static str,
    pub group: &'static str,
    /// "read" | "control" | "build" | "danger"
    pub risk: &'static str,
    pub default_exposed: bool,
}

pub fn tool_catalog() -> Vec<ToolInfo> {
    let t = |name, summary, group, risk| ToolInfo {
        name,
        summary,
        group,
        risk,
        default_exposed: name != "reload_config",
    };
    vec![
        t("list_projects", "列出全部项目与 profile 状态", "查询", "read"),
        t("get_status", "读取状态、PID、运行时长、最近编译", "查询", "read"),
        t("get_logs", "按正则/游标增量读取运行或编译日志", "查询", "read"),
        t("watch_logs", "标记日志游标，后续只返回增量", "查询", "read"),
        t("start_project", "启动服务并等待就绪", "进程", "control"),
        t("stop_project", "停止服务（进程组 SIGTERM→SIGKILL）", "进程", "control"),
        t("restart_project", "重启服务，可选先快速编译", "进程", "control"),
        t("compile_quick", "增量编译，返回结构化错误", "编译", "build"),
        t("compile_partial", "只编译指定模块/目录", "编译", "build"),
        t("compile_full", "清理后完整编译", "编译", "build"),
        t("cancel_compile", "取消进行中的编译", "编译", "build"),
        t("reload_config", "重载 lifecycle.toml（默认不暴露给 AI）", "配置", "danger"),
        t("register_project", "注册/导入项目：探测工程并生成 lifecycle.toml", "配置", "danger"),
        t("configure_service", "改写服务的启动命令/就绪端口/正则/三档编译", "配置", "danger"),
        t("list_groups", "列出服务分组与成员", "分组", "read"),
        t("create_group", "新建服务分组", "分组", "control"),
        t("update_group", "更新分组名称或成员", "分组", "control"),
        t("delete_group", "删除服务分组", "分组", "control"),
        t("start_group", "一键启动分组内全部服务", "分组", "control"),
        t("stop_group", "一键停止分组内全部服务", "分组", "control"),
        t("restart_group", "一键重启分组内全部服务", "分组", "control"),
    ]
}

/// Tool names an AI client actually sees for a given whitelist.
pub fn effective_tools(expose: &[String]) -> Vec<String> {
    ALL_TOOLS
        .iter()
        .filter(|name| tool_matches(expose, name))
        .map(|s| s.to_string())
        .collect()
}

pub struct Workspace {
    core: Arc<lifecycle_core::workspace::Workspace>,
    watches: Mutex<HashMap<String, u64>>,
}

impl Workspace {
    pub fn load(config_paths: &[PathBuf]) -> lifecycle_core::Result<Self> {
        Ok(Self {
            core: Arc::new(lifecycle_core::workspace::Workspace::load(config_paths)?),
            watches: Mutex::new(HashMap::new()),
        })
    }

    pub fn from_core(core: Arc<lifecycle_core::workspace::Workspace>) -> Self {
        Self {
            core,
            watches: Mutex::new(HashMap::new()),
        }
    }

    fn tool_allowed(&self, expose: &[String], tool: &str) -> bool {
        tool_matches(expose, tool)
    }

    fn any_allows(&self, tool: &str) -> bool {
        self.core
            .names()
            .iter()
            .any(|name| self.tool_allowed(&self.core.expose(name), tool))
    }
}

#[derive(Clone)]
pub struct LifeCycleServer {
    tool_router: ToolRouter<Self>,
    ws: Arc<Workspace>,
}

fn default_profile() -> String {
    "default".into()
}

fn default_source() -> String {
    "run".into()
}

fn default_lines() -> usize {
    200
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ProjectProfileReq {
    /// Project name; optional when only one project is loaded.
    pub project: Option<String>,
    /// Profile name, defaults to "default".
    #[serde(default = "default_profile")]
    pub profile: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct StartReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    /// Skip compile and start directly in dev mode (start never compiles).
    #[serde(default)]
    pub fast: bool,
    /// Wait until ready_pattern/ready_port is satisfied.
    #[serde(default = "default_true", rename = "waitForReady")]
    pub wait_for_ready: bool,
    /// Override ready timeout in milliseconds.
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct StopReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    /// "term" (default, graceful) or "kill" (immediate).
    pub signal: Option<String>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RestartReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    /// Run compile_quick before restarting.
    #[serde(default)]
    pub recompile: bool,
    #[serde(default = "default_true", rename = "waitForReady")]
    pub wait_for_ready: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CompilePartialReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    /// Modules/files/directories to compile.
    pub targets: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct LogsReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    /// "run" or "build".
    #[serde(default = "default_source")]
    pub source: String,
    /// Max lines when no cursor is given.
    #[serde(default = "default_lines")]
    pub lines: usize,
    /// Regex filter.
    pub filter: Option<String>,
    /// Byte cursor from a previous nextCursor / watch_logs.
    pub since: Option<u64>,
}

impl LifeCycleServer {
    pub fn new(ws: Arc<Workspace>) -> Self {
        let mut tool_router = Self::tool_router();
        for tool in ALL_TOOLS {
            if !ws.any_allows(tool) {
                tool_router.remove_route(tool);
            }
        }
        Self { tool_router, ws }
    }

    fn check_expose(&self, project: &str, tool: &str) -> lifecycle_core::Result<()> {
        let expose = self.ws.core.expose(project);
        if self.ws.tool_allowed(&expose, tool) {
            Ok(())
        } else {
            Err(Error::NotFound(format!(
                "tool '{tool}' is not exposed for project '{project}'"
            )))
        }
    }

    async fn traced<T, Fut>(
        &self,
        tool: &str,
        input: Value,
        fut: Fut,
    ) -> Result<Json<T>, ErrorData>
    where
        T: Serialize,
        Fut: Future<Output = lifecycle_core::Result<T>>,
    {
        let started = Instant::now();
        let mut hasher = DefaultHasher::new();
        input.to_string().hash(&mut hasher);
        let input_hash = format!("{:016x}", hasher.finish());
        let result = fut.await;
        let exit_code = if result.is_ok() { 0 } else { 1 };
        let trace = json!({
            "tool": tool,
            "input_hash": input_hash,
            "duration_ms": started.elapsed().as_millis() as u64,
            "exit_code": exit_code,
            "ts": lifecycle_core::process::now_ms(),
        });
        eprintln!("{trace}");
        let (exit, output) = match &result {
            Ok(v) => (0, serde_json::to_value(v).unwrap_or(Value::Null)),
            Err(e) => (
                1,
                json!({"error": {"code": e.code(), "message": e.to_string()}}),
            ),
        };
        self.ws.core.call_log().push(
            "mcp",
            tool,
            started.elapsed().as_millis() as u64,
            exit,
            input,
            output,
        );
        match result {
            Ok(v) => Ok(Json(v)),
            Err(e) => Err(to_error_data(e)),
        }
    }
}

fn to_error_data(e: Error) -> ErrorData {
    let code = e.code();
    let hint = match code {
        "BUSY" => Some("another operation is in progress; wait for it or cancel_compile"),
        "NOT_FOUND" => Some("check list_projects for valid project/profile names"),
        "TIMEOUT" => Some("increase timeoutMs or inspect logs for startup progress"),
        "NOT_READY" => Some("process exited or never became ready; inspect the returned logs"),
        "BUILD_FAILED" => Some("fix the reported compile errors, then retry"),
        _ => None,
    };
    ErrorData::new(
        ErrorCode::INTERNAL_ERROR,
        e.to_string(),
        Some(json!({"error": {"code": code, "message": e.to_string(), "hint": hint}})),
    )
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RegisterProjectReq {
    /// Absolute path of the project directory.
    pub path: String,
    /// Optional project name; defaults to the directory name.
    pub name: Option<String>,
    /// Optional readiness port override.
    pub port: Option<u16>,
    /// Optional start command override.
    pub command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CompileSpec {
    pub command: String,
    /// maven|gradle|typescript|cargo|go|generic
    pub parser: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ConfigureServiceReq {
    pub project: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    pub workdir: Option<String>,
    pub env: Option<std::collections::BTreeMap<String, String>>,
    pub start_command: Option<String>,
    pub ready_pattern: Option<String>,
    pub ready_port: Option<u16>,
    pub ready_timeout_ms: Option<u64>,
    pub compile_quick: Option<CompileSpec>,
    pub compile_partial: Option<CompileSpec>,
    pub compile_full: Option<CompileSpec>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GroupMemberReq {
    pub project: String,
    #[serde(default = "default_profile")]
    pub profile: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CreateGroupReq {
    pub name: String,
    pub members: Vec<GroupMemberReq>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct UpdateGroupReq {
    pub id: String,
    pub name: Option<String>,
    pub members: Option<Vec<GroupMemberReq>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GroupIdReq {
    pub id: String,
    #[serde(default = "default_true", rename = "waitForReady")]
    pub wait_for_ready: bool,
}

#[tool_router(router = tool_router)]
impl LifeCycleServer {
    #[tool(description = "List all registered projects with their profiles and states.")]
    async fn list_projects(&self) -> Result<Json<Value>, ErrorData> {
        self.traced("list_projects", json!({}), async {
            let mut out = Vec::new();
            for (name, engine) in self.ws.core.snapshot() {
                let statuses = engine.lock().await.list()?;
                out.push(json!({"project": name, "profiles": statuses}));
            }
            Ok(Value::Array(out))
        })
        .await
    }

    #[tool(description = "Get state, pid, uptime and last build summary of a profile.")]
    async fn get_status(
        &self,
        Parameters(req): Parameters<ProjectProfileReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("get_status", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "get_status")?;
            let engine = self.ws.core.engine(&project)?;
            let guard = engine.lock().await;
            Ok(serde_json::to_value(guard.status(&req.profile)?)?)
        })
        .await
    }

    #[tool(description = "Start a profile; by default waits until ready_pattern or ready_port is satisfied. Returns state, pid, ready and logsTail on failure.")]
    async fn start_project(
        &self,
        Parameters(req): Parameters<StartReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("start_project", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "start_project")?;
            let engine = self.ws.core.engine(&project)?;
            let mut guard = engine.lock().await;
            let outcome = guard
                .start_with_timeout(&req.profile, req.wait_for_ready, req.timeout_ms)
                .await?;
            Ok(serde_json::to_value(outcome)?)
        })
        .await
    }

    #[tool(description = "Stop a profile: SIGTERM to the whole process group, grace period, then SIGKILL.")]
    async fn stop_project(
        &self,
        Parameters(req): Parameters<StopReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("stop_project", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "stop_project")?;
            let engine = self.ws.core.engine(&project)?;
            let timeout = if req.signal.as_deref() == Some("kill") {
                Some(0)
            } else {
                req.timeout_ms
            };
            let mut guard = engine.lock().await;
            let outcome = guard.stop_with_timeout(&req.profile, timeout).await?;
            Ok(serde_json::to_value(outcome)?)
        })
        .await
    }

    #[tool(description = "Restart a profile (stop then start); optionally recompile with compile_quick first.")]
    async fn restart_project(
        &self,
        Parameters(req): Parameters<RestartReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("restart_project", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "restart_project")?;
            let engine = self.ws.core.engine(&project)?;
            let mut guard = engine.lock().await;
            if req.recompile {
                let result = guard.compile(&req.profile, CompileKind::Quick, &[]).await?;
                if !result.success {
                    return Err(Error::BuildFailed(format!(
                        "{} errors; first: {}",
                        result.errors.len(),
                        result
                            .errors
                            .first()
                            .map(|d| format!("{}:{}: {}", d.file, d.line, d.message))
                            .unwrap_or_else(|| result.raw.unwrap_or_default())
                    )));
                }
            }
            guard.stop(&req.profile).await?;
            let outcome = guard.start(&req.profile, req.wait_for_ready).await?;
            Ok(serde_json::to_value(outcome)?)
        })
        .await
    }

    #[tool(description = "Incremental compile (build cache reused). Returns structured BuildResult with errors/warnings.")]
    async fn compile_quick(
        &self,
        Parameters(req): Parameters<ProjectProfileReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("compile_quick", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "compile_quick")?;
            let engine = self.ws.core.engine(&project)?;
            let result = engine
                .lock()
                .await
                .compile(&req.profile, CompileKind::Quick, &[])
                .await?;
            Ok(serde_json::to_value(result)?)
        })
        .await
    }

    #[tool(description = "Compile only the given modules/files/directories. Returns structured BuildResult.")]
    async fn compile_partial(
        &self,
        Parameters(req): Parameters<CompilePartialReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("compile_partial", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "compile_partial")?;
            let engine = self.ws.core.engine(&project)?;
            let result = engine
                .lock()
                .await
                .compile(&req.profile, CompileKind::Partial, &req.targets)
                .await?;
            Ok(serde_json::to_value(result)?)
        })
        .await
    }

    #[tool(description = "Clean full build. Returns structured BuildResult.")]
    async fn compile_full(
        &self,
        Parameters(req): Parameters<ProjectProfileReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("compile_full", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "compile_full")?;
            let engine = self.ws.core.engine(&project)?;
            let result = engine
                .lock()
                .await
                .compile(&req.profile, CompileKind::Full, &[])
                .await?;
            Ok(serde_json::to_value(result)?)
        })
        .await
    }

    #[tool(description = "Cancel an in-progress compile of a profile.")]
    async fn cancel_compile(
        &self,
        Parameters(req): Parameters<ProjectProfileReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("cancel_compile", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "cancel_compile")?;
            let engine = self.ws.core.engine(&project)?;
            let cancelled = engine.lock().await.cancel_compile(&req.profile)?;
            Ok(json!({"cancelled": cancelled}))
        })
        .await
    }

    #[tool(description = "Read logs with regex filter and cursor-based increments. After watch_logs, omitting 'since' returns only new lines.")]
    async fn get_logs(
        &self,
        Parameters(req): Parameters<LogsReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("get_logs", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "get_logs")?;
            let engine = self.ws.core.engine(&project)?;
            let watch_key = format!("{}/{}/{}", project, req.profile, req.source);
            let since = match req.since {
                Some(c) => Some(c),
                None => self.ws.watches.lock().await.get(&watch_key).copied(),
            };
            let page: LogPage = engine.lock().await.logs(
                &req.profile,
                &req.source,
                req.lines,
                req.filter.as_deref(),
                since,
            )?;
            self.ws
                .watches
                .lock()
                .await
                .insert(watch_key, page.next_cursor);
            Ok(json!({"lines": page.lines, "nextCursor": page.next_cursor}))
        })
        .await
    }

    #[tool(description = "Mark the current end of a log stream; subsequent get_logs calls return only increments.")]
    async fn watch_logs(
        &self,
        Parameters(req): Parameters<LogsReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("watch_logs", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "watch_logs")?;
            let engine = self.ws.core.engine(&project)?;
            let cursor = engine.lock().await.log_len(&req.profile, &req.source)?;
            let watch_key = format!("{}/{}/{}", project, req.profile, req.source);
            self.ws.watches.lock().await.insert(watch_key, cursor);
            Ok(json!({"cursor": cursor}))
        })
        .await
    }

    #[tool(description = "Reload lifecycle.toml without restarting. Not exposed to AI by default.")]
    async fn reload_config(
        &self,
        Parameters(req): Parameters<ProjectProfileReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("reload_config", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "reload_config")?;
            let engine = self.ws.core.engine(&project)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            self.ws.core.set_expose(&project, expose);
            Ok(json!({"ok": true}))
        })
        .await
    }

    #[tool(description = "Register/import a project: detect the stack (Node/Rust/Maven), generate lifecycle.toml if missing, then hot-load it. Returns project name and config path.")]
    async fn register_project(
        &self,
        Parameters(req): Parameters<RegisterProjectReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("register_project", input, async {
            if !self.ws.any_allows("register_project") {
                return Err(Error::NotFound("tool 'register_project' is not exposed".into()));
            }
            let root = std::fs::canonicalize(&req.path)
                .map_err(|_| Error::Config(format!("directory not found: {}", req.path)))?;
            if !root.is_dir() {
                return Err(Error::Config(format!("not a directory: {}", root.display())));
            }
            let toml_path = root.join("lifecycle.toml");
            let generated = !toml_path.exists();
            if generated {
                let detected = lifecycle_core::detect::detect(&root);
                let name = req.name.clone().unwrap_or_else(|| {
                    root.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "project".into())
                });
                let has_command = req
                    .command
                    .as_deref()
                    .is_some_and(|c| !c.trim().is_empty())
                    || !detected.start_command.is_empty();
                if !has_command {
                    return Err(Error::Config(
                        "cannot detect a start command for this directory; provide 'command'".into(),
                    ));
                }
                let content =
                    lifecycle_core::detect::render_toml(&name, &detected, req.port, req.command.as_deref());
                std::fs::write(&toml_path, content)?;
            }
            let project = self.ws.core.register(&toml_path)?;
            Ok(json!({"project": project, "path": toml_path, "generated": generated}))
        })
        .await
    }

    #[tool(description = "Configure a service profile in lifecycle.toml: start command, readiness port/pattern/timeout, workdir, env and quick/partial/full compile commands. Other content and comments are preserved; config is reloaded hot.")]
    async fn configure_service(
        &self,
        Parameters(req): Parameters<ConfigureServiceReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("configure_service", input, async {
            let project = self.ws.core.resolve_project(&req.project)?;
            self.check_expose(&project, "configure_service")?;
            let engine = self.ws.core.engine(&project)?;
            let path = engine.lock().await.config_path().to_path_buf();
            let patch = lifecycle_core::config::ProfilePatch {
                workdir: req.workdir.clone(),
                env: req.env.clone(),
                start_command: req.start_command.clone(),
                ready_pattern: req.ready_pattern.clone(),
                ready_port: req.ready_port,
                ready_timeout_ms: req.ready_timeout_ms,
                compile_quick: req.compile_quick.as_ref().map(|s| (s.command.clone(), s.parser.clone())),
                compile_partial: req.compile_partial.as_ref().map(|s| (s.command.clone(), s.parser.clone())),
                compile_full: req.compile_full.as_ref().map(|s| (s.command.clone(), s.parser.clone())),
            };
            lifecycle_core::config::update_profile(&path, &req.profile, &patch)?;
            let expose = {
                let mut guard = engine.lock().await;
                guard.reload_config()?;
                guard.mcp_expose().to_vec()
            };
            self.ws.core.set_expose(&project, expose);
            Ok(json!({"ok": true, "project": project, "profile": req.profile, "config_path": path}))
        })
        .await
    }

    #[tool(description = "List service groups with their members.")]
    async fn list_groups(&self) -> Result<Json<Value>, ErrorData> {
        self.traced("list_groups", json!({}), async {
            if !self.ws.any_allows("list_groups") {
                return Err(Error::NotFound("tool 'list_groups' is not exposed".into()));
            }
            Ok(serde_json::to_value(self.ws.core.groups().load()?)?)
        })
        .await
    }

    #[tool(description = "Create a service group from project/profile members.")]
    async fn create_group(
        &self,
        Parameters(req): Parameters<CreateGroupReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("create_group", input, async {
            if !self.ws.any_allows("create_group") {
                return Err(Error::NotFound("tool 'create_group' is not exposed".into()));
            }
            let members: Vec<lifecycle_core::groups::GroupMember> = req
                .members
                .iter()
                .map(|m| lifecycle_core::groups::GroupMember { project: m.project.clone(), profile: m.profile.clone() })
                .collect();
            lifecycle_core::groups::validate(&req.name, &members)?;
            let group = lifecycle_core::groups::Group {
                id: lifecycle_core::groups::new_id(),
                name: req.name.clone(),
                members,
                created_at_ms: lifecycle_core::process::now_ms(),
            };
            let mut groups = self.ws.core.groups().load()?;
            groups.push(group.clone());
            self.ws.core.groups().save(&groups)?;
            Ok(serde_json::to_value(group)?)
        })
        .await
    }

    #[tool(description = "Update a group's name and/or members.")]
    async fn update_group(
        &self,
        Parameters(req): Parameters<UpdateGroupReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("update_group", input, async {
            if !self.ws.any_allows("update_group") {
                return Err(Error::NotFound("tool 'update_group' is not exposed".into()));
            }
            let mut groups = self.ws.core.groups().load()?;
            let group = groups
                .iter_mut()
                .find(|g| g.id == req.id)
                .ok_or_else(|| Error::NotFound(format!("group '{}'", req.id)))?;
            if let Some(name) = &req.name {
                group.name = name.clone();
            }
            if let Some(members) = &req.members {
                group.members = members
                    .iter()
                    .map(|m| lifecycle_core::groups::GroupMember { project: m.project.clone(), profile: m.profile.clone() })
                    .collect();
            }
            lifecycle_core::groups::validate(&group.name, &group.members)?;
            let updated = group.clone();
            self.ws.core.groups().save(&groups)?;
            Ok(serde_json::to_value(updated)?)
        })
        .await
    }

    #[tool(description = "Delete a service group (does not stop its services).")]
    async fn delete_group(
        &self,
        Parameters(req): Parameters<GroupIdReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("delete_group", input, async {
            if !self.ws.any_allows("delete_group") {
                return Err(Error::NotFound("tool 'delete_group' is not exposed".into()));
            }
            let mut groups = self.ws.core.groups().load()?;
            let pos = groups
                .iter()
                .position(|g| g.id == req.id)
                .ok_or_else(|| Error::NotFound(format!("group '{}'", req.id)))?;
            let removed = groups.remove(pos);
            self.ws.core.groups().save(&groups)?;
            Ok(serde_json::to_value(removed)?)
        })
        .await
    }

    #[tool(description = "Start every service in a group; returns per-member results.")]
    async fn start_group(
        &self,
        Parameters(req): Parameters<GroupIdReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("start_group", input, async {
            self.run_group(&req.id, "start", req.wait_for_ready).await
        })
        .await
    }

    #[tool(description = "Stop every service in a group; returns per-member results.")]
    async fn stop_group(
        &self,
        Parameters(req): Parameters<GroupIdReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("stop_group", input, async {
            self.run_group(&req.id, "stop", false).await
        })
        .await
    }

    #[tool(description = "Restart every service in a group; returns per-member results.")]
    async fn restart_group(
        &self,
        Parameters(req): Parameters<GroupIdReq>,
    ) -> Result<Json<Value>, ErrorData> {
        let input = serde_json::to_value(&req).unwrap_or_default();
        self.traced("restart_group", input, async {
            self.run_group(&req.id, "restart", req.wait_for_ready).await
        })
        .await
    }
}

impl LifeCycleServer {
    async fn run_group(&self, id: &str, op: &str, wait: bool) -> lifecycle_core::Result<Value> {
        if !self.ws.any_allows(&format!("{op}_group")) {
            return Err(Error::NotFound(format!("tool '{op}_group' is not exposed")));
        }
        let groups = self.ws.core.groups().load()?;
        let group = groups
            .iter()
            .find(|g| g.id == id)
            .ok_or_else(|| Error::NotFound(format!("group '{id}'")))?;
        let mut results = Vec::new();
        for m in &group.members {
            let outcome: lifecycle_core::Result<String> = async {
                let engine = self.ws.core.engine(&m.project)?;
                let mut guard = engine.lock().await;
                match op {
                    "start" => Ok(format!(
                        "{:?}",
                        guard.start_with_timeout(&m.profile, wait, None).await?.state
                    )),
                    "stop" => Ok(format!(
                        "{:?}",
                        guard.stop_with_timeout(&m.profile, None).await?.state
                    )),
                    _ => {
                        guard.stop(&m.profile).await?;
                        Ok(format!("{:?}", guard.start(&m.profile, wait).await?.state))
                    }
                }
            }
            .await;
            match outcome {
                Ok(state) => results.push(json!({"project": m.project, "profile": m.profile, "ok": true, "state": state})),
                Err(e) => results.push(json!({"project": m.project, "profile": m.profile, "ok": false, "error": e.to_string()})),
            }
        }
        Ok(json!({"group": group.name, "results": results}))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LifeCycleServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.server_info = rmcp::model::Implementation::new("lifecycle", env!("CARGO_PKG_VERSION"))
            .with_title("LifeCycle")
            .with_description("本地项目生命周期管理：启停 / 三档编译 / 日志");
        info.instructions = Some(
            "命令只来自 lifecycle.toml；工作目录限制在项目根内；reload_config 默认不暴露。".into(),
        );
        info
    }
}

pub use lifecycle_core::workspace::scan_projects;

/// Streamable HTTP + SSE transport, mountable into any tower/axum router.
pub fn streamable_http_service(
    core: Arc<lifecycle_core::workspace::Workspace>,
) -> rmcp::transport::streamable_http_server::StreamableHttpService<
    LifeCycleServer,
    rmcp::transport::streamable_http_server::session::local::LocalSessionManager,
> {
    rmcp::transport::streamable_http_server::StreamableHttpService::new(
        move || Ok(LifeCycleServer::new(Arc::new(Workspace::from_core(core.clone())))),
        Arc::new(
            rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default(),
        ),
        rmcp::transport::streamable_http_server::StreamableHttpServerConfig::default(),
    )
}

pub async fn serve_stdio(config_paths: Vec<PathBuf>) -> anyhow::Result<()> {
    let ws = Arc::new(Workspace::load(&config_paths)?);
    let server = LifeCycleServer::new(ws);
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}