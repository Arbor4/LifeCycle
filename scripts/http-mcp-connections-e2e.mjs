#!/usr/bin/env node
// MCP 真实连接数 e2e：stdio 进程 +1 / HTTP 会话握手 +1 / DELETE 与 kill 后回落。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

const HTTP_BIN = process.env.HTTP_BIN || "target/release/lifecycle-http";
const CLI_BIN = process.env.CLI_BIN || "target/release/lifecycle";
const PORT = 39519;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc-conn-home-"));
const backend = spawn(HTTP_BIN, ["-c", "fixtures/simple/lifecycle.toml", "--port", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HOME: home },
});
backend.stderr.on("data", () => {});
const cleanup = () => {
  backend.kill("SIGKILL");
  fs.rmSync(home, { recursive: true, force: true });
};
process.on("exit", cleanup);

const getConn = async () => (await fetch(BASE + "/api/mcp/connections")).json();
const waitConn = async (pred, what, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const c = await getConn();
    if (pred(c)) return c;
    await sleep(300);
  }
  throw new Error("timeout waiting: " + what + " last=" + JSON.stringify(await getConn()));
};

for (let i = 0; i < 50; i++) {
  try {
    await fetch(BASE + "/healthz");
    break;
  } catch {
    await sleep(200);
  }
}
const base = await getConn();
assert(Number.isInteger(base.http) && Number.isInteger(base.stdio) && base.total === base.http + base.stdio, "baseline shape");
console.log("baseline:", JSON.stringify(base));

// stdio：拉起一个 lifecycle --mcp，计数 +1
const stdio = spawn(CLI_BIN, ["--mcp", "-c", "fixtures/simple/lifecycle.toml"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HOME: home },
});
stdio.stderr.on("data", () => {});
const withStdio = await waitConn((c) => c.stdio === base.stdio + 1, "stdio +1");
console.log("stdio +1 ✓", JSON.stringify(withStdio));

// HTTP：initialize 握手 → 会话 +1
const initRes = await fetch(BASE + "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "conn-e2e", version: "0" } },
  }),
});
assert(initRes.ok, "initialize ok");
const sid = initRes.headers.get("mcp-session-id");
assert(sid, "session id header");
await initRes.text();
await fetch(BASE + "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": sid },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});
const withHttp = await waitConn((c) => c.http === base.http + 1 && c.stdio === base.stdio + 1, "http +1");
assert(withHttp.total === base.total + 2, "total = baseline + 2");
console.log("http session +1 ✓", JSON.stringify(withHttp));

// DELETE 终止会话 → http 回落
const del = await fetch(BASE + "/mcp", { method: "DELETE", headers: { "mcp-session-id": sid } });
assert(del.ok || del.status === 202, "DELETE session ok");
await waitConn((c) => c.http === base.http, "http back to baseline");
console.log("http session closed ✓");

// kill stdio → 回落（扫描缓存 2s）
stdio.kill("SIGKILL");
await waitConn((c) => c.stdio === base.stdio, "stdio back to baseline");
console.log("stdio closed ✓");

console.log("MCP CONNECTIONS E2E ALL PASS");
cleanup();
process.exit(0);