use lifecycle_mcp::{effective_tools, tool_matches, ALL_TOOLS};

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn empty_whitelist_hides_reload_config() {
    assert!(tool_matches(&[], "start_project"));
    assert!(tool_matches(&[], "get_logs"));
    assert!(!tool_matches(&[], "reload_config"));
    assert_eq!(effective_tools(&[]).len(), ALL_TOOLS.len() - 1);
}

#[test]
fn explicit_whitelist_is_exact() {
    let expose = v(&["get_logs", "get_status"]);
    assert!(tool_matches(&expose, "get_logs"));
    assert!(!tool_matches(&expose, "start_project"));
    assert!(!tool_matches(&expose, "reload_config"));
    assert_eq!(effective_tools(&expose), v(&["get_status", "get_logs"]));
}

#[test]
fn prefix_patterns_and_explicit_reload() {
    let expose = v(&["compile_*", "reload_config"]);
    assert!(tool_matches(&expose, "compile_quick"));
    assert!(tool_matches(&expose, "compile_partial"));
    assert!(tool_matches(&expose, "compile_package"));
    assert!(tool_matches(&expose, "reload_config"));
    assert!(!tool_matches(&expose, "start_project"));
    assert_eq!(effective_tools(&expose).len(), 5);
}

#[test]
fn catalog_covers_every_tool_once() {
    let catalog = lifecycle_mcp::tool_catalog();
    assert_eq!(catalog.len(), ALL_TOOLS.len());
    for name in ALL_TOOLS {
        assert_eq!(catalog.iter().filter(|t| t.name == *name).count(), 1, "{name}");
    }
    assert!(catalog.iter().all(|t| !t.summary.is_empty()));
    assert_eq!(catalog.iter().filter(|t| t.default_exposed).count(), ALL_TOOLS.len() - 1);
}