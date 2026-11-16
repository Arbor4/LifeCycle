use std::path::PathBuf;

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
fn legacy_mcp_section_still_parses_but_is_inert() {
    let tmp = tempfile::tempdir().unwrap();
    let path = write(tmp.path());
    let text = std::fs::read_to_string(&path).unwrap();
    std::fs::write(
        &path,
        format!("{text}\n[mcp]\ntransport = \"http\"\nexpose = [\"get_logs\", \"compile_*\"]\n"),
    )
    .unwrap();

    // 旧配置的 [mcp] 段仍可加载（白名单已全局化，不再按项目生效）。
    let cfg = Config::load(&path).unwrap();
    cfg.validate().unwrap();
    assert_eq!(cfg.project.name, "demo");
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

#[test]
fn profile_patch_empty_string_clears_optional_keys() {
    use lifecycle_core::config::{update_profile, ProfilePatch};
    let tmp = tempfile::tempdir().unwrap();
    let path = write(tmp.path());
    let set = ProfilePatch {
        workdir: Some("sub".into()),
        fast_start_command: Some("echo fast".into()),
        stop_command: Some("echo stop".into()),
        restart_command: Some("echo restart".into()),
        ready_pattern: Some("READY".into()),
        ready_timeout_ms: Some(5000),
        compile_partial: Some(("echo partial".into(), None)),
        ..Default::default()
    };
    update_profile(&path, "default", &set).unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    for needle in [
        "workdir = \"sub\"",
        "fast_command = \"echo fast\"",
        "[profiles.default.stop]",
        "[profiles.default.restart]",
        "ready_pattern = \"READY\"",
        "ready_timeout_ms = 5000",
        "[profiles.default.compile.partial]",
    ] {
        assert!(text.contains(needle), "missing {needle}");
    }

    let clear = ProfilePatch {
        workdir: Some("".into()),
        fast_start_command: Some("".into()),
        stop_command: Some("".into()),
        restart_command: Some("".into()),
        ready_pattern: Some("".into()),
        ready_port: Some(0),
        ready_timeout_ms: Some(0),
        compile_quick: Some(("".into(), None)),
        compile_partial: Some(("".into(), None)),
        ..Default::default()
    };
    update_profile(&path, "default", &clear).unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    for needle in [
        "workdir",
        "fast_command",
        "[profiles.default.stop]",
        "[profiles.default.restart]",
        "ready_pattern",
        "ready_port",
        "ready_timeout_ms",
        "[profiles.default.compile",
    ] {
        assert!(!text.contains(needle), "should be cleared: {needle}");
    }
    assert!(text.contains("command = \"echo hi\""), "start command preserved");
    assert!(text.contains("# 启动命令"), "comments preserved");
    Config::load(&path).unwrap();
}