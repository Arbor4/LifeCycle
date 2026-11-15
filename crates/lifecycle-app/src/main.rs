#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use lifecycle_core::workspace::{scan_projects, Workspace};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

#[derive(Parser)]
#[command(name = "lifecycle", about = "LifeCycle 桌面 App")]
struct Cli {
    /// lifecycle.toml 路径，可多次指定
    #[arg(long = "config", short)]
    configs: Vec<PathBuf>,
    /// 扫描目录自动发现项目
    #[arg(long)]
    scan: Option<PathBuf>,
    /// 本地 API 端口
    #[arg(long, default_value_t = 39517)]
    port: u16,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let scan_dir = cli.scan.clone();
    let mut configs = cli.configs;
    if let Some(dir) = cli.scan {
        configs.extend(scan_projects(&dir));
    }
    if configs.is_empty() {
        configs.push(PathBuf::from("lifecycle.toml"));
    }
    let ws = match Workspace::load(&configs) {
        Ok(ws) => Arc::new(ws),
        Err(e) => {
            eprintln!("加载项目失败: {e}");
            std::process::exit(1);
        }
    };
    let port = cli.port;

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let ws_http = ws.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = lifecycle_http::serve(ws_http, port).await {
                    eprintln!("HTTP 服务失败: {e}");
                }
            });

            let show = MenuItem::with_id(app, "show", "显示 LifeCycle", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // 自动发现：扫描目录中的项目已加载，提示用户确认导入。
            if let Some(dir) = scan_dir.clone() {
                let found = scan_projects(&dir);
                if !found.is_empty() {
                    let names: Vec<String> = found
                        .iter()
                        .filter_map(|p| {
                            lifecycle_core::Config::load(p)
                                .ok()
                                .map(|c| c.project.name)
                        })
                        .collect();
                    let _ = handle
                        .notification()
                        .builder()
                        .title("LifeCycle：发现项目")
                        .body(format!("已导入 {} 个项目：{}", names.len(), names.join(", ")))
                        .show();
                }
            }

            // 孤儿清理：上次残留的死进程记录清掉，活着的孤儿提示用户。
            let ws_orphan = ws.clone();
            let handle_orphan = handle.clone();
            tauri::async_runtime::spawn(async move {
                for name in ws_orphan.names() {
                    let Ok(engine) = ws_orphan.engine(&name) else { continue };
                    let mut guard = engine.lock().await;
                    let Ok(statuses) = guard.list() else { continue };
                    for s in statuses {
                        match s.state {
                            lifecycle_core::process::State::Crashed => {
                                let _ = guard.stop(&s.profile).await;
                            }
                            lifecycle_core::process::State::Running
                            | lifecycle_core::process::State::Starting => {
                                let _ = handle_orphan
                                    .notification()
                                    .builder()
                                    .title("LifeCycle：发现残留进程")
                                    .body(format!(
                                        "{}/{} 仍在运行 (pid {:?})，已重新纳入管理",
                                        name, s.profile, s.pid
                                    ))
                                    .show();
                            }
                            _ => {}
                        }
                    }
                }
            });

            // 崩溃/编译失败通知 + 托盘运行计数。
            let ws_monitor = ws.clone();
            tauri::async_runtime::spawn(async move {
                let mut prev: HashMap<String, (String, Option<u64>, bool)> = HashMap::new();
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let notifications_on = std::fs::read_to_string(
                        dirs_settings_path(),
                    )
                    .ok()
                    .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                    .and_then(|v| v.get("notifications").and_then(|n| n.as_bool()))
                    .unwrap_or(true);

                    let mut running = 0usize;
                    for name in ws_monitor.names() {
                        let Ok(engine) = ws_monitor.engine(&name) else { continue };
                        let Ok(statuses) = engine.lock().await.list() else { continue };
                        for s in statuses {
                            let key = format!("{}/{}", name, s.profile);
                            let state = format!("{:?}", s.state);
                            if state == "Running" || state == "Starting" {
                                running += 1;
                            }
                            let build_ts = s.last_build.as_ref().map(|b| b.finished_at_ms);
                            let build_ok = s.last_build.as_ref().map(|b| b.success).unwrap_or(true);
                            if let Some((prev_state, prev_ts, _)) = prev.get(&key) {
                                if notifications_on {
                                    if state == "Crashed" && prev_state != "Crashed" {
                                        let _ = handle
                                            .notification()
                                            .builder()
                                            .title("LifeCycle：进程崩溃")
                                            .body(format!("{key} 意外退出"))
                                            .show();
                                    }
                                    if build_ts != *prev_ts && !build_ok {
                                        let _ = handle
                                            .notification()
                                            .builder()
                                            .title("LifeCycle：编译失败")
                                            .body(format!(
                                                "{key} 有 {} 个错误",
                                                s.last_build.map(|b| b.error_count).unwrap_or(0)
                                            ))
                                            .show();
                                    }
                                }
                            }
                            prev.insert(key, (state, build_ts, build_ok));
                        }
                    }
                    let _ = tray.set_title(Some(format!("▶{running}")));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 = 最小化到托盘，进程与编译不受影响。
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 LifeCycle 失败");
}

fn dirs_settings_path() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".lifecycle")
        .join("settings.json")
}