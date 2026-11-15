#!/usr/bin/env node
// M2 验收：MCP stdio 闭环（改→编→重启→看日志 的 AI 视角）
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert";

const BIN = process.env.BIN || "target/debug/lifecycle";
const CFG = process.env.CFG || "fixtures/simple/lifecycle.toml";

const child = spawn(BIN, ["--mcp", "--config", CFG], { stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
const traces = [];
let nextId = 1;

createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
createInterface({ input: child.stderr }).on("line", (line) => {
  if (line.includes('"tool"')) traces.push(JSON.parse(line));
});

function send(method, params) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
async function call(name, args = {}) {
  const res = await send("tools/call", { name, arguments: args });
  if (res.error) {
    const err = new Error(`tool ${name} rpc error: ${JSON.stringify(res.error)}`);
    err.toolResult = res.error;
    throw err;
  }
  const result = res.result;
  if (result.isError) {
    const err = new Error(`tool ${name} failed: ${JSON.stringify(result.content)}`);
    err.toolResult = result;
    throw err;
  }
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "e2e", version: "1.0" },
});
assert(init.result.serverInfo.name.length > 0);
notify("notifications/initialized");

const tools = await send("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
console.log("tools:", names.join(", "));
assert(names.includes("compile_quick") && names.includes("watch_logs"));
assert(!names.includes("reload_config"), "reload_config 默认不暴露给 AI");

const projects = await call("list_projects");
assert.equal(projects[0].project, "fixture-simple");

const quick = await call("compile_quick", { profile: "default" });
assert.equal(quick.success, true);
console.log("compile_quick ✓", quick.duration_ms + "ms");

const full = await call("compile_full", { profile: "default" });
assert.equal(full.success, false);
assert.equal(full.errors[0].file, "/src/Bad.java");
assert.equal(full.errors[0].line, 12);
console.log("compile_full 结构化错误 ✓", JSON.stringify(full.errors[0]));

const partial = await call("compile_partial", { profile: "default", targets: ["mod-a", "mod-b"] });
assert.equal(partial.success, true);

const started = await call("start_project", { profile: "default", waitForReady: true });
assert.equal(started.ready, true);
assert(started.pid > 0);
console.log("start_project ✓ pid=" + started.pid);

const status = await call("get_status", { profile: "default" });
assert.equal(status.state, "running");

const http = await fetch("http://127.0.0.1:18099/");
assert.equal(http.status, 200);

const watch = await call("watch_logs", { profile: "default", source: "run" });
assert(watch.cursor > 0);
await fetch("http://127.0.0.1:18099/"); // 产生新日志
await new Promise((r) => setTimeout(r, 500));
const inc = await call("get_logs", { profile: "default", source: "run" });
assert(inc.lines.length >= 1, "watch 后 get_logs 应返回增量");
assert(inc.lines.every((l) => l.cursor > watch.cursor));
const inc2 = await call("get_logs", { profile: "default", source: "run" });
assert.equal(inc2.lines.length, 0, "无新日志时增量应为空");
console.log("watch_logs + 增量 get_logs ✓");

const filtered = await call("get_logs", { profile: "default", source: "run", lines: 100, filter: "GET", since: 0 });
assert(filtered.lines.length >= 1);

const restarted = await call("restart_project", { profile: "default", recompile: true });
assert.equal(restarted.ready, true);
assert.notEqual(restarted.pid, started.pid);
console.log("restart_project(recompile) ✓ pid=" + restarted.pid);

const stopped = await call("stop_project", { profile: "default" });
assert.equal(stopped.state, "idle");

// BUSY 语义：重复启动后再启动
await call("start_project", { profile: "default", waitForReady: true });
try {
  await call("start_project", { profile: "default" });
  assert.fail("should be BUSY");
} catch (e) {
  assert(JSON.stringify(e.toolResult).includes("BUSY"));
}
await call("stop_project", { profile: "default" });
console.log("BUSY 互斥 ✓");

assert(traces.length >= 10, "stderr 应有结构化 Trace");
for (const t of traces) {
  assert(t.tool && t.input_hash && typeof t.duration_ms === "number" && "exit_code" in t && t.ts);
}
console.log(`stderr Trace ✓ (${traces.length} 条)`);

child.stdin.end();
await new Promise((r) => child.on("exit", r));
console.log("M2 MCP e2e 全部通过");