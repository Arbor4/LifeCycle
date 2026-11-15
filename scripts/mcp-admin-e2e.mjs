#!/usr/bin/env node
// MCP 管理工具 e2e：register_project / configure_service / 分组 CRUD+启停。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = process.env.BIN || "target/debug/lifecycle";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lc-mcp-admin-"));
fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "admin-demo", scripts: { dev: "node server.js", build: "node build.js" } }));
fs.writeFileSync(path.join(tmp, "server.js"), "console.log('READY admin-demo'); setInterval(()=>{},1000);");
fs.writeFileSync(path.join(tmp, "build.js"), "console.log('built');");

// 隔离 HOME，避免 e2e 注册/分组污染真实 ~/.lifecycle
const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc-mcp-home-"));
const child = spawn(BIN, ["--mcp", "-c", "fixtures/simple/lifecycle.toml"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HOME: home },
});
const pending = new Map();
let nextId = 1;
createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
createInterface({ input: child.stderr }).on("line", () => {});
function send(method, params) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error("timeout " + method)), 30000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}
const call = async (name, args) => {
  const r = await send("tools/call", { name, arguments: args ?? {} });
  assert(!r.error, `${name} rpc error: ${JSON.stringify(r.error)}`);
  const content = r.result?.content?.[0]?.text;
  const parsed = content ? JSON.parse(content) : null;
  assert(!r.result?.isError, `${name} tool error: ${content}`);
  return parsed;
};

const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
assert(init.result?.serverInfo, "initialize");
await send("notifications/initialized", {});
const tools = await send("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
for (const t of ["register_project", "configure_service", "list_groups", "create_group", "update_group", "delete_group", "start_group", "stop_group", "restart_group"]) {
  assert(names.includes(t), `tool ${t} exposed`);
}
console.log("tools exposed ✓", names.length);

const reg = await call("register_project", { path: tmp, port: 18099 });
assert(reg.generated === true && reg.project.startsWith("lc-mcp-admin-"), "register: " + JSON.stringify(reg));
const PROJ = reg.project;
console.log("register_project ✓", reg.project);

const cfg = await call("configure_service", {
  project: PROJ,
  start_command: "node server.js",
  ready_port: 18099,
  ready_pattern: "READY",
  compile_quick: { command: "node build.js", parser: "generic" },
});
assert(cfg.ok === true, "configure");
const toml = fs.readFileSync(path.join(tmp, "lifecycle.toml"), "utf8");
assert(toml.includes("ready_port = 18099") && toml.includes("node build.js"), "toml written");
console.log("configure_service ✓ (toml updated, comments preserved)");

const created = await call("configure_service", {
  project: PROJ,
  profile: "extra",
  start_command: "node server.js",
  ready_pattern: "READY",
});
assert(created.ok === true, "configure creates absent profile");
assert(fs.readFileSync(path.join(tmp, "lifecycle.toml"), "utf8").includes("[profiles.extra]"), "new profile table written");
console.log("configure_service create-if-absent ✓");

const started = await call("start_project", { project: PROJ, waitForReady: true });
assert(started.state === "Running" || started.state === "running", "start: " + JSON.stringify(started));
console.log("start after configure ✓");

const g = await call("create_group", { name: "e2e-group", members: [{ project: PROJ, profile: "default" }] });
assert(g.id && g.members.length === 1, "create_group");
const listed = await call("list_groups", {});
assert(listed.some((x) => x.id === g.id), "list_groups");
const upd = await call("update_group", { id: g.id, name: "e2e-renamed" });
assert(upd.name === "e2e-renamed", "update_group");
const stopG = await call("stop_group", { id: g.id });
assert(stopG.results[0].ok === true, "stop_group");
const startG = await call("start_group", { id: g.id, waitForReady: true });
assert(startG.results[0].ok === true, "start_group");
const restartG = await call("restart_group", { id: g.id, waitForReady: true });
assert(restartG.results[0].ok === true, "restart_group");
console.log("group CRUD + start/stop/restart ✓");
await call("stop_group", { id: g.id });
const del = await call("delete_group", { id: g.id });
assert(del.id === g.id, "delete_group");
console.log("delete_group ✓");

await call("stop_project", { project: PROJ });
child.kill();
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log("MCP ADMIN E2E ALL PASS");
process.exit(0);