// 添加服务（项目内新增 profile）HTTP 闭环：注册临时项目 → 添加/校验/拒绝 → 启动就绪 → 清理
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.LC_BASE || "http://127.0.0.1:39517";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok -", msg);
}

const dir = mkdtempSync(join(tmpdir(), "lc-addsvc-"));
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name: "lc-addsvc", private: true, scripts: { dev: "node server.js" } }, null, 2)
);
writeFileSync(
  join(dir, "server.js"),
  'require("http").createServer((q, s) => s.end("ok")).listen(18097, "127.0.0.1", () => console.log("ready on 18097"));'
);

const addBody = (over = {}) =>
  JSON.stringify({ profile: "api", start_command: "node server.js", ready_port: 18097, workdir: ".", ...over });
const addPath = (p) => `/api/projects/${encodeURIComponent(p)}/profiles`;

let project = null;
try {
  const reg = await api("/api/projects/register", { method: "POST", body: JSON.stringify({ path: dir }) });
  assert(reg.ok && reg.body.generated, "register temp project (toml generated)");
  project = reg.body.project;

  const list = await api("/api/projects");
  const entry = list.body.find((p) => p.project === project);
  assert(entry && typeof entry.path === "string" && entry.path.endsWith("lifecycle.toml"), "list_projects exposes config path");

  const add = await api(addPath(project), { method: "POST", body: addBody() });
  assert(add.ok && add.body.profile === "api", "add service profile");

  const toml = readFileSync(join(dir, "lifecycle.toml"), "utf8");
  assert(
    toml.includes("[profiles.api]") && toml.includes("node server.js") && toml.includes("18097"),
    "lifecycle.toml contains [profiles.api] with command and port"
  );

  const dup = await api(addPath(project), { method: "POST", body: addBody() });
  assert(!dup.ok, "duplicate profile rejected");
  const parent = await api(addPath(project), { method: "POST", body: addBody({ profile: "evil", workdir: "../evil" }) });
  assert(!parent.ok, "workdir escaping project root rejected");
  const abs = await api(addPath(project), { method: "POST", body: addBody({ profile: "evil2", workdir: "/tmp" }) });
  assert(!abs.ok, "absolute workdir rejected");
  const nocmd = await api(addPath(project), { method: "POST", body: addBody({ profile: "evil3", start_command: "   " }) });
  assert(!nocmd.ok, "blank start command rejected");

  const list2 = await api("/api/projects");
  assert(
    list2.body.find((p) => p.project === project)?.profiles.some((s) => s.profile === "api"),
    "hot reload lists the new profile"
  );

  const start = await api(`/api/projects/${encodeURIComponent(project)}/profiles/api/start`, { method: "POST", body: "{}" });
  assert(start.ok, "start added service (wait ready)");
  const probe = await fetch("http://127.0.0.1:18097/");
  assert(probe.ok, "added service responds on ready port");
  const stop = await api(`/api/projects/${encodeURIComponent(project)}/profiles/api/stop`, { method: "POST", body: "{}" });
  assert(stop.ok, "stop added service");

  console.log("HTTP ADD-SERVICE E2E ALL PASS");
} finally {
  if (project) {
    await api(`/api/projects/${encodeURIComponent(project)}/profiles/api/stop`, { method: "POST", body: "{}" }).catch(() => {});
    await api(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" }).catch(() => {});
  }
  rmSync(dir, { recursive: true, force: true });
}