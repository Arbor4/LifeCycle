// 配置原文编辑 HTTP 闭环：整份保存+热加载 / 非法 TOML 拒写 / workdir 越界拒写
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = process.env.LC_BASE || "http://127.0.0.1:39517";
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
const dir = mkdtempSync(join(tmpdir(), "lc-rawcfg-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lc-rawcfg", private: true, scripts: { dev: "node server.js" } }, null, 2));
writeFileSync(join(dir, "server.js"), 'console.log("READY rawcfg"); setInterval(()=>{},1000);');
let project = null;
const cfgPath = () => `/api/projects/${encodeURIComponent(project)}/config`;
try {
  const reg = await api("/api/projects/register", { method: "POST", body: JSON.stringify({ path: dir }) });
  assert(reg.ok, "temp project registered");
  project = reg.body.project;
  const orig = (await api(cfgPath())).body.content;

  const added = orig + '\n[profiles.extra]\nworkdir = "."\n\n[profiles.extra.start]\ncommand = "node server.js"\nready_pattern = "READY"\n';
  const save = await api(cfgPath(), { method: "PUT", body: JSON.stringify({ content: added }) });
  assert(save.ok, "raw save accepted");
  assert((await api(cfgPath())).body.content === added, "file content replaced verbatim");
  const list = await api("/api/projects");
  assert(list.body.find((p) => p.project === project)?.profiles.some((s) => s.profile === "extra"), "hot reload lists new profile");

  const bad = await api(cfgPath(), { method: "PUT", body: JSON.stringify({ content: "[project\nname = broken" }) });
  assert(!bad.ok, "invalid TOML rejected");
  assert((await api(cfgPath())).body.content === added, "file unchanged after invalid save");

  const escape = added.replace('workdir = "."\n\n[profiles.extra.start]', 'workdir = "../evil"\n\n[profiles.extra.start]');
  const esc = await api(cfgPath(), { method: "PUT", body: JSON.stringify({ content: escape }) });
  assert(!esc.ok, "workdir escaping root rejected");
  assert((await api(cfgPath())).body.content === added, "file unchanged after escape attempt");

  const removed = await api(cfgPath(), { method: "PUT", body: JSON.stringify({ content: orig }) });
  assert(removed.ok, "raw save can remove profiles");
  const list2 = await api("/api/projects");
  assert(!list2.body.find((p) => p.project === project)?.profiles.some((s) => s.profile === "extra"), "removed profile gone after reload");
  console.log("RAW-CONFIG HTTP E2E ALL PASS");
} finally {
  if (project) await api(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" }).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}