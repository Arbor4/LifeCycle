#!/usr/bin/env node
// 配置热重载 e2e：外部进程改 lifecycle.toml / projects.json 后，
// 长驻 HTTP 控制台与 stdio MCP 会话自动同步，且 SSE 推送新快照。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

const HTTP_BIN = process.env.HTTP_BIN || "target/release/lifecycle-http";
const CLI_BIN = process.env.CLI_BIN || "target/release/lifecycle";
const PORT = 39521;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc-watch-home-"));
const projA = path.join(home, "projA");
const projB = path.join(home, "projB");
fs.mkdirSync(projA, { recursive: true });
fs.mkdirSync(projB, { recursive: true });
const tomlA = path.join(projA, "lifecycle.toml");
const tomlB = path.join(projB, "lifecycle.toml");
const toml = (name, profiles) =>
  `[project]\nname = "${name}"\n` +
  profiles
    .map(
      (p) =>
        `\n[profiles.${p}]\nservice = "${p}"\n\n[profiles.${p}.start]\ncommand = "sleep 30"\n`
    )
    .join("");
fs.writeFileSync(tomlA, toml("alpha", ["default"]));
fs.writeFileSync(tomlB, toml("beta", ["default"]));

const backend = spawn(HTTP_BIN, ["-c", tomlA, "--port", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HOME: home },
});
backend.stderr.on("data", () => {});
let stdio = null;
const cleanup = () => {
  backend.kill("SIGKILL");
  if (stdio) stdio.kill("SIGKILL");
  fs.rmSync(home, { recursive: true, force: true });
};
process.on("exit", cleanup);

const getProjects = async () => (await fetch(BASE + "/api/projects")).json();
const waitFor = async (pred, what, timeout = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await pred()) return;
    await sleep(300);
  }
  throw new Error("timeout waiting: " + what);
};
const profilesOf = (list, name) => list.find((p) => p.project === name)?.profiles || [];

for (let i = 0; i < 50; i++) {
  try {
    await fetch(BASE + "/healthz");
    break;
  } catch {
    await sleep(200);
  }
}
assert.strictEqual(profilesOf(await getProjects(), "alpha").length, 1, "baseline one profile");
console.log("baseline: alpha 1 profile ✓");

// SSE 订阅：外部编辑后必须收到含新 profile 的 status 快照
const sseSnaps = [];
const sseRes = await fetch(BASE + "/api/events");
(async () => {
  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (data) {
        try {
          sseSnaps.push(JSON.parse(data));
        } catch {}
      }
    }
  }
})().catch(() => {});

// 场景 1：外部进程（模拟 stdio MCP）给 toml 增加 desktop profile
fs.writeFileSync(tomlA, toml("alpha", ["default", "desktop"]));
await waitFor(async () => profilesOf(await getProjects(), "alpha").length === 2, "http hot-reload +desktop");
console.log("http hot-reload: alpha 2 profiles ✓");
await waitFor(
  () => sseSnaps.some((s) => Array.isArray(s) && profilesOf(s, "alpha").length === 2),
  "SSE push with 2 profiles"
);
console.log("SSE status push ✓");

// 场景 2：外部注册（projects.json 增加条目）→ 控制台自动出现 beta
const regPath = path.join(home, ".lifecycle", "projects.json");
const readReg = () => {
  try {
    return JSON.parse(fs.readFileSync(regPath, "utf8"));
  } catch {
    return { projects: [] };
  }
};
const reg = readReg();
reg.projects.push({ path: tomlB, added_at_ms: Date.now() });
fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
await waitFor(async () => profilesOf(await getProjects(), "beta").length === 1, "registry add beta");
console.log("registry external add: beta ✓");

// 场景 3：外部注销 → beta 自动消失
const reg2 = readReg();
reg2.projects = reg2.projects.filter((e) => e.path !== tomlB);
fs.writeFileSync(regPath, JSON.stringify(reg2, null, 2));
await waitFor(async () => !(await getProjects()).some((p) => p.project === "beta"), "registry remove beta");
console.log("registry external remove: beta gone ✓");

// 场景 4：toml 写坏（半截写入）不崩溃、保留旧配置；恢复后继续可用
fs.writeFileSync(tomlA, "[project\nname = broken");
await sleep(2500);
assert.strictEqual(profilesOf(await getProjects(), "alpha").length, 2, "invalid toml keeps old config");
fs.writeFileSync(tomlA, toml("alpha", ["default", "desktop"]));
await sleep(2500);
assert.strictEqual(profilesOf(await getProjects(), "alpha").length, 2, "recovered toml");
console.log("invalid toml tolerated ✓");

// 场景 5：长驻 stdio MCP 会话同样热重载（AI 连接器视角）
stdio = spawn(CLI_BIN, ["--mcp", "-c", tomlA], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HOME: home },
});
stdio.stderr.on("data", () => {});
let buf = "";
const pending = new Map();
stdio.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id != null && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});
let rpcId = 0;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, resolve);
    const t = setTimeout(() => reject(new Error("rpc timeout " + method)), 8000);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    stdio.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const listViaStdio = async () => {
  const m = await rpc("tools/call", { name: "list_projects", arguments: {} });
  return JSON.parse(m.result.content[0].text);
};
await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "watch-e2e", version: "0" },
});
stdio.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
assert.strictEqual(profilesOf(await listViaStdio(), "alpha").length, 2, "stdio sees 2 profiles");
fs.writeFileSync(tomlA, toml("alpha", ["default", "desktop", "cli"]));
await waitFor(async () => profilesOf(await listViaStdio(), "alpha").length === 3, "stdio hot-reload +cli");
console.log("stdio session hot-reload: alpha 3 profiles ✓");
await waitFor(async () => profilesOf(await getProjects(), "alpha").length === 3, "http follows to 3");
console.log("http follows stdio-era edit ✓");

console.log("ALL PASS");
process.exit(0);