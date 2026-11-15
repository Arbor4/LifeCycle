use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use lifecycle_core::config::update_mcp_section;
use lifecycle_core::Error;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::{ApiError, ApiResult, AppState};

fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// MCP 客户端的工作目录不确定，配置路径必须绝对化。
fn absolute(path: &std::path::Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

#[derive(Clone, Copy, PartialEq)]
enum Format {
    /// `{"mcpServers": {...}}` — Claude Desktop / Cursor / Gemini CLI
    McpServers,
    /// `{"servers": {...}}` — VS Code Copilot
    Servers,
    /// `[mcp_servers.lifecycle]` — Codex CLI
    CodexToml,
    /// Managed inside the app's own settings UI; copy/paste only.
    CopyOnly,
}

struct Client {
    id: &'static str,
    name: &'static str,
    path: Option<PathBuf>,
    format: Format,
    supports_http: bool,
    note: &'static str,
}

fn app_support() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home().join("Library").join("Application Support")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home().join("AppData").join("Roaming"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home().join(".config"))
    }
}

fn clients() -> Vec<Client> {
    let support = app_support();
    vec![
        Client {
            id: "claude",
            name: "Claude Desktop",
            path: Some(support.join("Claude").join("claude_desktop_config.json")),
            format: Format::McpServers,
            supports_http: false,
            note: "仅支持 stdio。写入后需完全退出并重开 Claude Desktop。",
        },
        Client {
            id: "cursor",
            name: "Cursor",
            path: Some(home().join(".cursor").join("mcp.json")),
            format: Format::McpServers,
            supports_http: true,
            note: "全局生效；也可放到项目内 .cursor/mcp.json。",
        },
        Client {
            id: "vscode",
            name: "VS Code · Copilot",
            path: Some(support.join("Code").join("User").join("mcp.json")),
            format: Format::Servers,
            supports_http: true,
            note: "需要 GitHub Copilot 的 MCP 支持；顶层键为 servers。",
        },
        Client {
            id: "codex",
            name: "Codex CLI",
            path: Some(home().join(".codex").join("config.toml")),
            format: Format::CodexToml,
            supports_http: false,
            note: "写入 [mcp_servers.lifecycle]，保留其余配置。",
        },
        Client {
            id: "gemini",
            name: "Gemini CLI",
            path: Some(home().join(".gemini").join("settings.json")),
            format: Format::McpServers,
            supports_http: true,
            note: "HTTP 模式使用 httpUrl 字段。",
        },
        Client {
            id: "qoder",
            name: "Qoder",
            path: None,
            format: Format::CopyOnly,
            supports_http: true,
            note: "在 Qoder 设置 → MCP 中新增服务器并粘贴以下配置。",
        },
    ]
}

/// Resolve the executable an MCP client should spawn for stdio.
fn stdio_command() -> (PathBuf, Vec<String>, &'static str) {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("lifecycle"));
    let sibling = exe
        .parent()
        .map(|dir| dir.join("lifecycle-mcp"))
        .filter(|p| p.is_file());
    match sibling {
        Some(path) => (path, Vec::new(), "standalone"),
        None => (exe, vec!["--mcp-stdio".into()], "bundled"),
    }
}

fn presets() -> Value {
    let names: Vec<&str> = lifecycle_mcp::ALL_TOOLS.to_vec();
    let without_reload: Vec<&str> = names
        .iter()
        .copied()
        .filter(|n| *n != "reload_config")
        .collect();
    let readonly = ["list_projects", "get_status", "get_logs", "watch_logs"];
    let mut build = readonly.to_vec();
    build.extend([
        "compile_quick",
        "compile_partial",
        "compile_full",
        "cancel_compile",
    ]);
    json!([
        {"id": "readonly", "name": "只读安全", "description": "只能查状态和日志，不能启停、不能编译", "expose": readonly},
        {"id": "recommended", "name": "推荐（默认）", "description": "启停 / 编译 / 日志全开，不含 reload_config", "expose": without_reload},
        {"id": "build", "name": "只读 + 编译", "description": "允许 AI 编译修错，但不允许动进程", "expose": build},
        {"id": "all", "name": "全部（含重载配置）", "description": "包含 reload_config，AI 可改变服务行为，请谨慎", "expose": names},
    ])
}

fn stdio_entry(command: &str, args: &[String]) -> Value {
    let mut entry = Map::new();
    entry.insert("command".into(), json!(command));
    entry.insert("args".into(), json!(args));
    // GUI 客户端启动时 PATH 很精简，注入当前 PATH 才能找到 node/npm/cargo。
    if let Ok(path) = std::env::var("PATH") {
        entry.insert("env".into(), json!({"PATH": path}));
    }
    Value::Object(entry)
}

fn http_entry(client: &Client, url: &str) -> Value {
    match client.id {
        "gemini" => json!({"httpUrl": url}),
        "vscode" => json!({"type": "http", "url": url}),
        _ => json!({"url": url}),
    }
}

fn snippet(client: &Client, entry: &Value) -> String {
    match client.format {
        Format::CodexToml => {
            let mut doc = toml_edit::DocumentMut::new();
            let root = doc.as_table_mut();
            let servers = root
                .entry("mcp_servers")
                .or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
            let servers = servers.as_table_mut().expect("mcp_servers table");
            servers.set_implicit(true);
            let mut table = toml_edit::Table::new();
            if let Some(obj) = entry.as_object() {
                for (k, v) in obj {
                    match v {
                        Value::String(s) => {
                            table[k] = toml_edit::value(s.as_str());
                        }
                        Value::Array(items) => {
                            let mut arr = toml_edit::Array::new();
                            for item in items {
                                if let Some(s) = item.as_str() {
                                    arr.push(s);
                                }
                            }
                            table[k] = toml_edit::value(arr);
                        }
                        Value::Object(env) => {
                            let mut env_table = toml_edit::Table::new();
                            for (ek, ev) in env {
                                if let Some(s) = ev.as_str() {
                                    env_table[ek] = toml_edit::value(s);
                                }
                            }
                            table[k] = toml_edit::Item::Table(env_table);
                        }
                        _ => {}
                    }
                }
            }
            servers["lifecycle"] = toml_edit::Item::Table(table);
            doc.to_string()
        }
        Format::Servers => serde_json::to_string_pretty(&json!({"servers": {"lifecycle": entry}}))
            .unwrap_or_default(),
        _ => serde_json::to_string_pretty(&json!({"mcpServers": {"lifecycle": entry}}))
            .unwrap_or_default(),
    }
}

fn configured(client: &Client) -> bool {
    let Some(path) = &client.path else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    match client.format {
        Format::CodexToml => text
            .parse::<toml_edit::DocumentMut>()
            .ok()
            .and_then(|d| d.get("mcp_servers")?.get("lifecycle").cloned())
            .is_some(),
        _ => {
            let key = if client.format == Format::Servers {
                "servers"
            } else {
                "mcpServers"
            };
            serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get(key)?.get("lifecycle").cloned())
                .is_some()
        }
    }
}

pub async fn info(State(state): State<Arc<AppState>>) -> ApiResult {
    let (exe, base_args, kind) = stdio_command();
    let mut config_args = base_args.clone();
    let mut projects = Vec::new();
    for (name, engine) in state.ws.snapshot() {
        let mut guard = engine.lock().await;
        let path = guard.config_path().to_path_buf();
        let transport = guard.mcp_transport().to_string();
        let expose = guard.mcp_expose().to_vec();
        let profiles: Vec<String> = guard.list()?.into_iter().map(|s| s.profile).collect();
        config_args.push("--config".into());
        config_args.push(absolute(&path));
        projects.push(json!({
            "project": name,
            "config_path": path,
            "transport": transport,
            "expose": expose,
            "effective": lifecycle_mcp::effective_tools(&expose),
            "is_default": expose.is_empty(),
            "profiles": profiles,
        }));
    }
    projects.sort_by(|a, b| a["project"].as_str().cmp(&b["project"].as_str()));

    let url = format!("http://127.0.0.1:{}/mcp", state.port);
    let command = exe.to_string_lossy().into_owned();
    let stdio = stdio_entry(&command, &config_args);

    let client_list: Vec<Value> = clients()
        .iter()
        .map(|c| {
            let (exists, installed) = match &c.path {
                Some(p) => (p.is_file(), p.parent().map(|d| d.is_dir()).unwrap_or(false)),
                None => (false, false),
            };
            let entry_http = if c.supports_http {
                Some(http_entry(c, &url))
            } else {
                None
            };
            json!({
                "id": c.id,
                "name": c.name,
                "path": c.path,
                "exists": exists,
                "installed": installed,
                "configured": configured(c),
                "can_write": c.path.is_some(),
                "supports_http": c.supports_http,
                "note": c.note,
                "entry_stdio": stdio,
                "entry_http": entry_http,
                "snippet_stdio": snippet(c, &stdio),
                "snippet_http": entry_http.as_ref().map(|e| snippet(c, e)),
            })
        })
        .collect();

    Ok(Json(json!({
        "endpoint": url,
        "port": state.port,
        "stdio": {
            "command": command,
            "args": config_args,
            "kind": kind,
            "available": exe.is_file(),
        },
        "tools": lifecycle_mcp::tool_catalog(),
        "presets": presets(),
        "projects": projects,
        "clients": client_list,
    })))
}

#[derive(Debug, Deserialize)]
pub struct ExposeBody {
    transport: String,
    expose: Vec<String>,
}

pub async fn put_project(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Json(body): Json<ExposeBody>,
) -> ApiResult {
    for pattern in &body.expose {
        let known = match pattern.strip_suffix('*') {
            Some(prefix) => lifecycle_mcp::ALL_TOOLS
                .iter()
                .any(|t| t.starts_with(prefix)),
            None => lifecycle_mcp::ALL_TOOLS.contains(&pattern.as_str()),
        };
        if !known {
            return Err(ApiError(Error::Config(format!(
                "unknown MCP tool '{pattern}'"
            ))));
        }
    }
    let engine = state.ws.engine(&project)?;
    let path = engine.lock().await.config_path().to_path_buf();
    update_mcp_section(&path, &body.transport, &body.expose)?;
    let (transport, expose) = {
        let mut guard = engine.lock().await;
        guard.reload_config()?;
        (guard.mcp_transport().to_string(), guard.mcp_expose().to_vec())
    };
    state.ws.set_expose(&project, expose.clone());
    Ok(Json(json!({
        "ok": true,
        "project": project,
        "config_path": path,
        "transport": transport,
        "expose": expose,
        "effective": lifecycle_mcp::effective_tools(&expose),
    })))
}

#[derive(Debug, Deserialize)]
pub struct ClientConfigBody {
    client: String,
    #[serde(default = "default_mode")]
    mode: String,
    /// "write" (default) or "remove" — remove is the undo of write.
    #[serde(default = "default_action")]
    action: String,
}

fn default_mode() -> String {
    "stdio".into()
}

fn default_action() -> String {
    "write".into()
}

pub async fn client_config(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ClientConfigBody>,
) -> ApiResult {
    let all = clients();
    let client = all
        .iter()
        .find(|c| c.id == body.client)
        .ok_or_else(|| ApiError(Error::NotFound(format!("client '{}'", body.client))))?;
    let path = client.path.as_ref().ok_or_else(|| {
        ApiError(Error::Config(format!(
            "{} 的配置由应用自身管理，请复制配置后在其设置界面粘贴",
            client.name
        )))
    })?;

    let url = format!("http://127.0.0.1:{}/mcp", state.port);
    let use_http = body.mode == "http" && client.supports_http;
    let entry = if use_http {
        http_entry(client, &url)
    } else {
        let (exe, mut args, _) = stdio_command();
        for (_, engine) in state.ws.snapshot() {
            let p = engine.lock().await.config_path().to_path_buf();
            args.push("--config".into());
            args.push(absolute(&p));
        }
        stdio_entry(&exe.to_string_lossy(), &args)
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let backup = path.with_extension(format!(
        "{}.lifecycle-bak",
        path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default()
    ));
    let original = std::fs::read_to_string(path).ok();
    if let Some(text) = &original {
        std::fs::write(&backup, text)?;
    }

    let remove = body.action == "remove";
    let updated = match client.format {
        Format::CodexToml => {
            let mut doc = original
                .as_deref()
                .unwrap_or("")
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| Error::Config(format!("cannot parse {}: {e}", path.display())))?;
            if remove {
                if let Some(servers) = doc.get_mut("mcp_servers").and_then(|i| i.as_table_mut()) {
                    servers.remove("lifecycle");
                }
            } else {
                let text = snippet(client, &entry);
                let patch = text
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|e| Error::Other(e.to_string()))?;
                let table = patch
                    .get("mcp_servers")
                    .and_then(|s| s.get("lifecycle"))
                    .ok_or_else(|| Error::Other("generated snippet missing table".into()))?
                    .clone();
                let servers = doc
                    .entry("mcp_servers")
                    .or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
                let servers = servers
                    .as_table_mut()
                    .ok_or_else(|| Error::Config("mcp_servers is not a table".into()))?;
                servers.set_implicit(true);
                servers["lifecycle"] = table;
            }
            doc.to_string()
        }
        _ => {
            let key = if client.format == Format::Servers {
                "servers"
            } else {
                "mcpServers"
            };
            let mut root: Value = match original.as_deref() {
                Some(text) if !text.trim().is_empty() => serde_json::from_str(text)
                    .map_err(|e| Error::Config(format!("cannot parse {}: {e}", path.display())))?,
                _ => json!({}),
            };
            let obj = root
                .as_object_mut()
                .ok_or_else(|| Error::Config(format!("{} 顶层不是对象", path.display())))?;
            let servers = obj
                .entry(key.to_string())
                .or_insert_with(|| json!({}));
            let servers = servers
                .as_object_mut()
                .ok_or_else(|| Error::Config(format!("{key} 不是对象")))?;
            if remove {
                servers.remove("lifecycle");
            } else {
                servers.insert("lifecycle".into(), entry.clone());
            }
            serde_json::to_string_pretty(&root)? + "\n"
        }
    };

    let tmp = path.with_extension("lifecycle-tmp");
    std::fs::write(&tmp, updated)?;
    std::fs::rename(&tmp, path)?;

    Ok(Json(json!({
        "ok": true,
        "client": client.id,
        "name": client.name,
        "action": if remove { "remove" } else { "write" },
        "mode": if use_http { "http" } else { "stdio" },
        "path": path,
        "backup": if original.is_some() { Some(backup) } else { None::<PathBuf> },
        "note": client.note,
    })))
}