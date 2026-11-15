use std::path::PathBuf;

use lifecycle_core::config::update_mcp_section;
use lifecycle_core::registry::Registry;
use lifecycle_core::Config;

const BASE: &str = r#"# 项目配置
[project]
name = "demo"

[profiles.default.start]
command = "echo hi"   # 启动命令
ready_port = 18099

[profiles.default.compile.quick]
command = "echo build"
"#;

fn write(dir: &std::path::Path) -> PathBuf {
    let path = dir.join("lifecycle.toml");
    std::fs::write(&path, BASE).unwrap();
    path
}

#[test]
fn mcp_section_rewrite_keeps_other_sections_and_comments() {
    let tmp = tempfile::tempdir().unwrap();
    let path = write(tmp.path());

    update_mcp_section(&path, "http", &["get_logs".into(), "compile_*".into()]).unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("# 项目配置"), "顶层注释应保留");
    assert!(text.contains("# 启动命令"), "行内注释应保留");
    assert!(text.contains("ready_port = 18099"));
    assert!(text.contains("command = \"echo build\""));
    assert!(text.contains("transport = \"http\""));
    assert!(text.contains("\"compile_*\""));

    let cfg = Config::load(&path).unwrap();
    assert_eq!(cfg.mcp.transport, "http");
    assert_eq!(cfg.mcp.expose, vec!["get_logs", "compile_*"]);
    assert_eq!(cfg.project.name, "demo");

    // 二次改写只更新 [mcp]，不重复追加表。
    update_mcp_section(&path, "stdio", &["get_status".into()]).unwrap();
    let text2 = std::fs::read_to_string(&path).unwrap();
    assert_eq!(text2.matches("[mcp]").count(), 1);
    assert!(!text2.contains("compile_*"));
    assert_eq!(Config::load(&path).unwrap().mcp.expose, vec!["get_status"]);
}

#[test]
fn mcp_section_rejects_unknown_transport() {
    let tmp = tempfile::tempdir().unwrap();
    let path = write(tmp.path());
    let err = update_mcp_section(&path, "carrier-pigeon", &[]).unwrap_err();
    assert_eq!(err.code(), "CONFIG");
    assert!(std::fs::read_to_string(&path).unwrap().contains("echo hi"));
}

#[test]
fn registry_add_dedup_remove_and_prune() {
    let tmp = tempfile::tempdir().unwrap();
    let path = write(tmp.path());
    let registry = Registry::new(tmp.path().join("projects.json"));

    assert!(registry.paths().is_empty());
    registry.add(&path).unwrap();
    registry.add(&path).unwrap();
    assert_eq!(registry.paths().len(), 1, "重复注册应去重");

    // 重启后仍能读回。
    let reopened = Registry::new(tmp.path().join("projects.json"));
    assert_eq!(reopened.paths(), vec![std::fs::canonicalize(&path).unwrap()]);

    registry.remove(&path).unwrap();
    assert!(registry.paths().is_empty());

    registry.add(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert!(registry.paths().is_empty(), "文件消失后不应再返回");
    registry.prune().unwrap();
    assert!(Registry::new(tmp.path().join("projects.json")).paths().is_empty());
}