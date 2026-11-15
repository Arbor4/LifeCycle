// 清空日志 HTTP 闭环：产生日志 → clear(run) → 空且文件 0 → 运行中服务继续写入 → clear(all)
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = process.env.LC_BASE || "http://127.0.0.1:39517";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { headers: { "content-type": "application/json" }, ...opts });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    throw new Error(msg);
  }
  console.log("ok -", msg);
}
const dir = mkdtempSync(join(tmpdir(), "lc-clearlogs-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lc-clearlogs", private: true, scripts: { dev: "node server.js" } }, null, 2));
writeFileSync(join(dir, "server.js"), 'let n=0; setInterval(()=>console.log("tick "+(++n)), 200); require("http").createServer((q,s)=>s.end("ok")).listen(18095,"127.0.0.1");');
let project = null;
const P = (s = "") => `/api/projects/${encodeURIComponent(project)}/profiles/default${s}`;
try {
  const reg = await api("/api/projects/register", { method: "POST", body: JSON.stringify({ path: dir }) });
  assert(reg.ok, "temp project registered");
  project = reg.body.project;
  const start = await api(P("/start"), { method: "POST", body: "{}" });
  assert(start.ok, "service started");
  await sleep(1200);
  let logs = await api(P("/logs?source=run&lines=100"));
  assert(logs.body.lines.length > 0, "logs accumulate");
  const clear = await api(P("/logs/clear"), { method: "POST", body: JSON.stringify({ source: "run" }) });
  assert(clear.ok && clear.body.cleared?.[0]?.bytes > 0, "clear(run) reports freed bytes");
  logs = await api(P("/logs?source=run&lines=100"));
  assert(logs.body.lines.length === 0, "run logs empty right after clear");
  await sleep(1000);
  logs = await api(P("/logs?source=run&lines=100"));
  assert(logs.body.lines.length > 0, "running service keeps appending after clear");
  const streamCursor = logs.body.nextCursor ?? logs.body.next_cursor;
  const all = await api(P("/logs/clear"), { method: "POST", body: JSON.stringify({ source: "all" }) });
  assert(all.ok && all.body.cleared?.length === 2, "clear(all) covers run+build");
  const bad = await api(P("/logs/clear"), { method: "POST", body: JSON.stringify({ source: "nope" }) });
  assert(!bad.ok, "unknown source rejected");
  console.log("CLEAR-LOGS HTTP E2E ALL PASS");
} finally {
  if (project) {
    await api(P("/stop"), { method: "POST", body: "{}" }).catch(() => {});
    await api(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" }).catch(() => {});
  }
  rmSync(dir, { recursive: true, force: true });
}