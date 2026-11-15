use std::path::Path;

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Detected {
    pub kind: String,
    pub start_command: String,
    pub ready_pattern: Option<String>,
    pub ready_port: Option<u16>,
    pub compile_quick: Option<String>,
    pub parser: Option<String>,
}

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

fn vite_port(root: &Path) -> Option<u16> {
    for dir in [root.to_path_buf(), root.join("src/web")] {
        for name in ["vite.config.ts", "vite.config.js", "vite.config.mjs"] {
            if let Ok(text) = std::fs::read_to_string(dir.join(name)) {
                let re = regex::Regex::new(r"port:\s*(\d+)").unwrap();
                if let Some(c) = re.captures(&text) {
                    return c[1].parse().ok();
                }
            }
        }
    }
    None
}

/// Inspect a directory and propose a lifecycle profile for it.
pub fn detect(root: &Path) -> Detected {
    if let Some(pkg) = read_json(&root.join("package.json")) {
        let scripts = pkg.get("scripts").cloned().unwrap_or(Value::Null);
        let has = |k: &str| scripts.get(k).and_then(|v| v.as_str()).is_some();
        let start = if has("web:dev") {
            "npm run web:dev"
        } else if has("dev") {
            "npm run dev"
        } else if has("start") {
            "npm run start"
        } else {
            ""
        };
        let port = vite_port(root).or(Some(5173));
        let compile = if has("typecheck") {
            Some("npm run typecheck".to_string())
        } else if has("build") {
            Some("npm run build".to_string())
        } else {
            None
        };
        return Detected {
            kind: "node".into(),
            start_command: start.into(),
            ready_pattern: Some("Local:|ready in|localhost:".into()),
            ready_port: port,
            compile_quick: compile,
            parser: Some("typescript".into()),
        };
    }
    if root.join("Cargo.toml").is_file() {
        return Detected {
            kind: "rust".into(),
            start_command: "cargo run".into(),
            ready_pattern: None,
            ready_port: None,
            compile_quick: Some("cargo build".into()),
            parser: Some("cargo".into()),
        };
    }
    if root.join("pom.xml").is_file() {
        let spring = std::fs::read_to_string(root.join("pom.xml"))
            .map(|t| t.contains("spring-boot"))
            .unwrap_or(false);
        return Detected {
            kind: "java".into(),
            start_command: if spring {
                "mvn spring-boot:run".into()
            } else {
                "mvn -q compile exec:java".into()
            },
            ready_pattern: Some("Started .* in|READY".into()),
            ready_port: Some(8080),
            compile_quick: Some("mvn compile".into()),
            parser: Some("maven".into()),
        };
    }
    Detected {
        kind: "generic".into(),
        start_command: String::new(),
        ready_pattern: None,
        ready_port: None,
        compile_quick: None,
        parser: None,
    }
}

/// Render a lifecycle.toml for a detected project, applying user overrides.
pub fn render_toml(
    name: &str,
    d: &Detected,
    port_override: Option<u16>,
    command_override: Option<&str>,
) -> String {
    let command = command_override
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| d.start_command.clone());
    let port = port_override.or(d.ready_port);
    let mut out = format!("[project]\nname = {name:?}\n\n[profiles.default]\nworkdir = \".\"\n\n[profiles.default.start]\ncommand = {command:?}\n");
    if let Some(p) = &d.ready_pattern {
        out.push_str(&format!("ready_pattern = {p:?}\n"));
    }
    if let Some(p) = port {
        out.push_str(&format!("ready_port = {p}\n"));
    }
    out.push_str("ready_timeout_ms = 60000\n");
    if let Some(c) = &d.compile_quick {
        out.push_str(&format!(
            "\n[profiles.default.compile.quick]\ncommand = {c:?}\nparser = {:?}\ntimeout_ms = 300000\n",
            d.parser.as_deref().unwrap_or("generic")
        ));
    }
    out
}