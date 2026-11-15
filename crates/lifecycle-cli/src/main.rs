use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use lifecycle_core::error::DurationMs;
use lifecycle_core::Engine;

#[derive(Parser)]
#[command(name = "lifecycle", about = "本地项目生命周期管理（M0：进程管理 CLI）")]
struct Cli {
    /// lifecycle.toml 路径
    #[arg(long, short, global = true, default_value = "lifecycle.toml")]
    config: PathBuf,

    /// 以 MCP Server（stdio）模式无 GUI 运行
    #[arg(long)]
    mcp: bool,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// 列出所有 profile 及状态
    List,
    /// 启动 profile（默认等待就绪）
    Start {
        #[arg(default_value = "default")]
        profile: String,
        /// 不等待就绪，spawn 后立即返回
        #[arg(long)]
        no_wait: bool,
    },
    /// 停止 profile（SIGTERM → 宽限 → SIGKILL，整进程组）
    Stop {
        #[arg(default_value = "default")]
        profile: String,
    },
    /// 重启 profile
    Restart {
        #[arg(default_value = "default")]
        profile: String,
        #[arg(long)]
        no_wait: bool,
    },
    /// 查询状态
    Status {
        #[arg(default_value = "default")]
        profile: String,
    },
    /// 编译（quick / partial / full）
    Compile {
        #[arg(default_value = "default")]
        profile: String,
        /// quick | partial | full
        #[arg(long, short, default_value = "quick")]
        kind: String,
        /// partial 编译目标，逗号分隔
        #[arg(long, short)]
        targets: Option<String>,
    },
    /// 查看日志
    Logs {
        #[arg(default_value = "default")]
        profile: String,
        /// run 或 build
        #[arg(long, default_value = "run")]
        source: String,
        #[arg(long, short, default_value_t = 100)]
        lines: usize,
        /// 正则过滤
        #[arg(long)]
        filter: Option<String>,
        /// 持续跟随输出（Ctrl-C 退出）
        #[arg(long, short)]
        follow: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    if cli.mcp {
        return lifecycle_mcp::serve_stdio(vec![cli.config]).await;
    }
    let Some(command) = cli.command else {
        anyhow::bail!("需要子命令（或使用 --mcp 启动 MCP Server）");
    };
    let mut engine = Engine::new(&cli.config)
        .with_context(|| format!("加载配置失败: {}", cli.config.display()))?;

    match command {
        Command::List => {
            println!("项目: {}", engine.project_name());
            for s in engine.list()? {
                print_status(&s);
            }
        }
        Command::Start { profile, no_wait } => {
            let outcome = engine.start(&profile, !no_wait).await?;
            println!(
                "已启动 {profile}: pid={} state={:?} ready={}",
                outcome.pid, outcome.state, outcome.ready
            );
        }
        Command::Stop { profile } => {
            let outcome = engine.stop(&profile).await?;
            println!(
                "已停止 {profile}: state={:?} exit_code={:?}",
                outcome.state, outcome.exit_code
            );
        }
        Command::Restart { profile, no_wait } => {
            let outcome = engine.restart(&profile, !no_wait).await?;
            println!(
                "已重启 {profile}: pid={} state={:?} ready={}",
                outcome.pid, outcome.state, outcome.ready
            );
        }
        Command::Status { profile } => {
            print_status(&engine.status(&profile)?);
        }
        Command::Compile {
            profile,
            kind,
            targets,
        } => {
            let kind = lifecycle_core::compile::CompileKind::parse(&kind)?;
            let targets: Vec<String> = targets
                .map(|t| {
                    t.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
            let fut = engine.compile_with_cancel(&profile, kind, &targets, cancel.clone());
            tokio::pin!(fut);
            let result = tokio::select! {
                r = &mut fut => r?,
                _ = tokio::signal::ctrl_c() => {
                    eprintln!("收到 Ctrl-C，取消编译…");
                    cancel.notify_waiters();
                    fut.await?
                }
            };
            println!(
                "编译{}: 耗时 {}ms errors={} warnings={}",
                if result.cancelled {
                    "已取消".to_string()
                } else if result.success {
                    "成功".to_string()
                } else {
                    "失败".to_string()
                },
                result.duration_ms,
                result.errors.len(),
                result.warnings.len()
            );
            for d in result.errors.iter().chain(result.warnings.iter()) {
                println!("  [{}] {}:{}:{} {}", d.level, d.file, d.line, d.col, d.message);
            }
            for a in &result.artifacts {
                println!("  artifact: {a}");
            }
            if let Some(raw) = &result.raw {
                println!("--- raw ---\n{raw}");
            }
            if !result.success && !result.cancelled {
                std::process::exit(1);
            }
        }
        Command::Logs {
            profile,
            source,
            lines,
            filter,
            follow,
        } => {
            let page = engine.logs(&profile, &source, lines, filter.as_deref(), None)?;
            for line in &page.lines {
                println!("{}", line.text);
            }
            if follow {
                let mut cursor = page.next_cursor;
                loop {
                    tokio::select! {
                        _ = tokio::signal::ctrl_c() => break,
                        _ = tokio::time::sleep(Duration::from_millis(250)) => {
                            let page = engine.logs(&profile, &source, 0, filter.as_deref(), Some(cursor))?;
                            cursor = page.next_cursor;
                            for line in &page.lines {
                                println!("{}", line.text);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn print_status(s: &lifecycle_core::engine::ProfileStatus) {
    let uptime = s
        .uptime_ms
        .map(|ms| format!(" uptime={}", DurationMs(ms)))
        .unwrap_or_default();
    let pid = s.pid.map(|p| format!(" pid={p}")).unwrap_or_default();
    println!("[{}] {:?}{pid}{uptime}", s.profile, s.state);
    if let Some(cmd) = &s.command {
        println!("    command: {cmd}");
    }
    if let Some(b) = &s.last_build {
        println!(
            "    last_build: {:?} {} errors={} ({}ms)",
            b.kind,
            if b.success { "✓" } else { "✗" },
            b.error_count,
            b.duration_ms
        );
    }
}