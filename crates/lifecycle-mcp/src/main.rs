use std::path::PathBuf;

use clap::Parser;

#[derive(Parser)]
#[command(name = "lifecycle-mcp", about = "LifeCycle MCP Server（stdio，headless）")]
struct Cli {
    /// lifecycle.toml 路径，可多次指定以加载多项目
    #[arg(long = "config", short)]
    configs: Vec<PathBuf>,
    /// 扫描目录（两层深度）自动发现 lifecycle.toml
    #[arg(long)]
    scan: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let mut configs = cli.configs;
    if let Some(dir) = cli.scan {
        configs.extend(lifecycle_mcp::scan_projects(&dir));
    }
    if configs.is_empty() {
        configs.push(PathBuf::from("lifecycle.toml"));
    }
    lifecycle_mcp::serve_stdio(configs).await
}