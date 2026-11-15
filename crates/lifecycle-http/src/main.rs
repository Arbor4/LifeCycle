use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use lifecycle_core::workspace::{scan_projects, Workspace};

#[derive(Parser)]
#[command(name = "lifecycle-http", about = "LifeCycle 本地 HTTP API + SSE（headless）")]
struct Cli {
    /// lifecycle.toml 路径，可多次指定
    #[arg(long = "config", short)]
    configs: Vec<PathBuf>,
    /// 扫描目录自动发现项目
    #[arg(long)]
    scan: Option<PathBuf>,
    #[arg(long, default_value_t = 39517)]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let mut configs = cli.configs;
    if let Some(dir) = cli.scan {
        configs.extend(scan_projects(&dir));
    }
    if configs.is_empty() && PathBuf::from("lifecycle.toml").is_file() {
        configs.push(PathBuf::from("lifecycle.toml"));
    }
    let ws = Arc::new(Workspace::load_console(&configs)?);
    lifecycle_http::serve(ws, cli.port).await
}