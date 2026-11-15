import { useEffect, useMemo, useRef, useState } from "react";
import { api, profilePath } from "./api.js";
import { pushToast } from "./toast.js";
import { STATE_LABEL, uptime } from "./format.js";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";
import RegisterModal from "./RegisterModal.jsx";

const VIEW_KEY = "lifecycle-services-view";
const STATE_ORDER = { running: 0, starting: 1, stopping: 2, crashed: 3, idle: 4 };

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY)) ?? {};
  } catch {
    return {};
  }
}

export default function ServicesView({ projects, onOpen }) {
  const saved = useRef(loadView()).current;
  const [q, setQ] = useState(saved.q ?? "");
  const [statusFilter, setStatusFilter] = useState(saved.statusFilter ?? "all");
  const [sort, setSort] = useState(saved.sort ?? { key: "name", dir: "asc" });
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ q, statusFilter, sort }));
  }, [q, statusFilter, sort]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n") {
        e.preventDefault();
        setShowRegister(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(
    () =>
      projects.flatMap((p) =>
        p.profiles.map((s) => ({ ...s, project: p.project, key: `${p.project}/${s.profile}` }))
      ),
    [projects]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (statusFilter !== "all" && r.state !== statusFilter) return false;
      if (needle && !r.key.toLowerCase().includes(needle)) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return out.sort((a, b) => {
      let d = 0;
      if (sort.key === "name") d = a.key.localeCompare(b.key);
      else if (sort.key === "state") d = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
      else if (sort.key === "uptime") d = (a.uptime_ms ?? -1) - (b.uptime_ms ?? -1);
      else if (sort.key === "build") d = (a.last_build?.finished_at_ms ?? 0) - (b.last_build?.finished_at_ms ?? 0);
      else if (sort.key === "port") d = (a.port ?? 0) - (b.port ?? 0);
      return d * dir || a.key.localeCompare(b.key);
    });
  }, [rows, q, statusFilter, sort]);

  const stats = useMemo(
    () => ({
      running: rows.filter((r) => r.state === "running").length,
      starting: rows.filter((r) => r.state === "starting" || r.state === "stopping").length,
      crashed: rows.filter((r) => r.state === "crashed").length,
      idle: rows.filter((r) => r.state === "idle").length,
      buildFail: rows.filter((r) => r.last_build && !r.last_build.success).length,
    }),
    [rows]
  );

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.key));
  const someChecked = filtered.some((r) => selected.has(r.key));

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filtered.map((r) => r.key)));
  }
  function sortBy(key) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  }

  async function act(key, fn, okMsg) {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
      if (okMsg) pushToast(okMsg, { kind: "success" });
    } catch (e) {
      pushToast(`${key}: ${e.message}`, { kind: "error" });
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[key];
        return next;
      });
    }
  }

  const post = (r, suffix, body) =>
    api(profilePath(r.project, r.profile, suffix), { method: "POST", body: JSON.stringify(body ?? {}) });

  const start = (r) => act(r.key, () => post(r, "/start", { wait: true }), `${r.key} 已启动`);
  const stop = (r) => act(r.key, () => post(r, "/stop"), `${r.key} 已停止`);
  const restart = (r) => act(r.key, () => post(r, "/restart", { wait: true }), `${r.key} 已重启`);
  const compile = (r) =>
    act(r.key, async () => {
      const res = await post(r, "/compile", { kind: "quick" });
      pushToast(
        res.success ? `${r.key} 编译成功 · ${res.duration_ms}ms` : `${r.key} 编译失败 · ${res.errors.length} 错误`,
        { kind: res.success ? "success" : "error" }
      );
    });

  async function unregister(r) {
    if (confirming !== r.key) {
      setConfirming(r.key);
      return;
    }
    setConfirming(null);
    setBusy((b) => ({ ...b, [r.key]: true }));
    let configPath = null;
    try {
      configPath = (await api(`/api/projects/${encodeURIComponent(r.project)}/config`)).path;
    } catch {
      // 拿不到路径就只提示，不提供撤销
    }
    try {
      await api(`/api/projects/${encodeURIComponent(r.project)}`, { method: "DELETE" });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(r.key);
        return next;
      });
      pushToast(`已卸载服务「${r.project}」`, {
        kind: "success",
        duration: 15000,
        action: configPath
          ? {
              label: "撤销",
              fn: async () => {
                try {
                  await api("/api/projects/register", {
                    method: "POST",
                    body: JSON.stringify({ path: configPath.replace(/\/lifecycle\.toml$/, "") }),
                  });
                  pushToast(`已恢复「${r.project}」`, { kind: "success" });
                } catch (e) {
                  pushToast(e.message, { kind: "error" });
                }
              },
            }
          : undefined,
      });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[r.key];
        return next;
      });
    }
  }

  async function bulk(op) {
    const targets = filtered.filter((r) => selected.has(r.key));
    setSelected(new Set());
    let ok = 0;
    for (const r of targets) {
      try {
        await post(r, op === "start" ? "/start" : "/stop", op === "start" ? { wait: true } : {});
        ok++;
      } catch (e) {
        pushToast(`${r.key}: ${e.message}`, { kind: "error" });
      }
    }
    pushToast(`批量${op === "start" ? "启动" : "停止"}完成 ${ok}/${targets.length}`, {
      kind: ok === targets.length ? "success" : "error",
    });
  }

  function rowClick(e, r) {
    if (e.target.closest("button,input,a,select,label")) return;
    onOpen(r.project, r.profile);
  }

  const thSort = (k, children, className = "") => (
    <th className={className}>
      <button className="th-sort" data-active={sort.key === k} onClick={() => sortBy(k)}>
        {children}
        {sort.key === k && <Icon name={sort.dir === "asc" ? "up" : "down"} size={11} />}
      </button>
    </th>
  );

  const tiles = [
    { label: "运行中", value: stats.running, icon: "play", tone: "grn", filter: "running" },
    { label: "启停中", value: stats.starting, icon: "clock", tone: "amb", filter: "starting" },
    { label: "崩溃", value: stats.crashed, icon: "warn", tone: "red", filter: "crashed" },
    { label: "未启动", value: stats.idle, icon: "stop", tone: "dim", filter: "idle" },
    { label: "编译失败", value: stats.buildFail, icon: "compile", tone: "vio", filter: null },
  ];

  return (
    <div className="view flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-2 gap-2 border-b border-[var(--line)] bg-[var(--bg1)] p-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => {
          const inner = (
            <>
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
                style={{
                  background: `color-mix(in oklab, var(--${t.tone === "dim" ? "mut" : t.tone}) 14%, transparent)`,
                  color: `var(--${t.tone === "dim" ? "mut" : t.tone})`,
                }}
              >
                <Icon name={t.icon} size={15} />
              </span>
              <span className="min-w-0">
                <span className="mono block text-lg font-semibold leading-tight">{t.value}</span>
                <span className="block truncate text-[11px] text-[var(--dim)]">{t.label}</span>
              </span>
            </>
          );
          const cls = "panel flex items-center gap-3 px-3 py-2 text-left transition-colors hover:border-[var(--line3)]";
          return t.filter ? (
            <button key={t.label} className={cls} onClick={() => setStatusFilter(t.filter)} title={`按「${t.label}」筛选`}>
              {inner}
            </button>
          ) : (
            <div key={t.label} className={cls} title="最近一次编译失败的服务数">
              {inner}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="list" size={16} className="text-[var(--blu)]" />
          服务列表
        </h1>
        <span className="mono text-xs text-[var(--mut)]">
          {stats.running}/{rows.length} 运行中
        </span>
        <span className="flex-1" />
        <div className="relative">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            ref={searchRef}
            className="input w-52 pl-8"
            placeholder="搜索服务…  /"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="running">运行中</option>
          <option value="starting">启动中</option>
          <option value="crashed">崩溃</option>
          <option value="idle">未启动</option>
        </select>
        <button className="btn btn-success" onClick={() => setShowRegister(true)} title="快捷键 n">
          <Icon name="plus" />
          创建服务
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--blu-soft)] px-4 py-2 text-sm">
          <Icon name="check" size={14} className="text-[var(--blu)]" />
          <span>已选 {selected.size} 个服务</span>
          <button className="btn btn-sm btn-success" onClick={() => bulk("start")}>
            <Icon name="play" size={12} />
            批量启动
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => bulk("stop")}>
            <Icon name="stop" size={12} />
            批量停止
          </button>
          <span className="flex-1" />
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            清除选择
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10">
                <Checkbox
                  size="sm"
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  onChange={toggleAll}
                  title="全选当前筛选结果"
                />
              </th>
              {thSort("name", "服务名称")}
              {thSort("state", "状态")}
              <th>PID</th>
              {thSort("uptime", "运行时长")}
              {thSort("port", "端口")}
              {thSort("build", "最近编译")}
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const running = r.state === "running" || r.state === "starting";
              return (
                <tr
                  key={r.key}
                  className="cursor-pointer"
                  data-selected={selected.has(r.key) || undefined}
                  onClick={(e) => rowClick(e, r)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Checkbox size="sm" checked={selected.has(r.key)} onChange={() => toggle(r.key)} title={`选择 ${r.key}`} />
                  </td>
                  <td>
                    <span className="mono text-[var(--blu)]">
                      {r.project}
                      <span className="text-[var(--dim)]">/</span>
                      {r.profile}
                    </span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span className={`dot dot-${r.state}`} />
                      <span
                        className={
                          r.state === "crashed" ? "text-[var(--red)]" : r.state === "running" ? "text-[var(--grn)]" : "text-[var(--mut)]"
                        }
                      >
                        {STATE_LABEL[r.state] ?? r.state}
                      </span>
                    </span>
                  </td>
                  <td className="mono text-[var(--mut)]">{r.pid ?? "—"}</td>
                  <td className="mono text-[var(--mut)]">{uptime(r.uptime_ms)}</td>
                  <td className="mono text-[var(--mut)]">{r.port ?? "—"}</td>
                  <td>
                    {r.last_build ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`mono inline-flex items-center gap-1 text-xs ${
                            r.last_build.success ? "text-[var(--grn)]" : "text-[var(--red)]"
                          }`}
                        >
                          <Icon name={r.last_build.success ? "check" : "x"} size={11} />
                          {r.last_build.kind}
                        </span>
                        <span className="text-xs text-[var(--dim)]">{r.last_build.duration_ms}ms</span>
                      </span>
                    ) : (
                      <span className="text-[var(--dim)]">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {busy[r.key] && <span className="spinner self-center text-[var(--blu)]" />}
                      <button
                        className="btn btn-sm btn-success"
                        title="启动"
                        disabled={running || busy[r.key]}
                        onClick={() => start(r)}
                      >
                        <Icon name="play" size={12} />
                        启动
                      </button>
                      <button className="btn btn-sm btn-danger" title="停止" disabled={!running} onClick={() => stop(r)}>
                        <Icon name="stop" size={12} />
                        停止
                      </button>
                      <button className="btn btn-sm btn-warn" title="重启" disabled={!!busy[r.key]} onClick={() => restart(r)}>
                        <Icon name="restart" size={12} />
                      </button>
                      <button className="btn btn-sm" title="快速编译" disabled={!!busy[r.key]} onClick={() => compile(r)}>
                        <Icon name="compile" size={12} />
                      </button>
                      <button className="btn btn-sm btn-ghost" title="查看日志" onClick={() => onOpen(r.project, r.profile)}>
                        <Icon name="logs" size={12} />
                      </button>
                      <button
                        className={`btn btn-sm btn-ghost ${confirming === r.key ? "!text-[var(--red)]" : ""}`}
                        title={confirming === r.key ? "再次点击确认卸载" : "卸载服务（停止并移除注册）"}
                        onClick={() => unregister(r)}
                      >
                        {confirming === r.key ? <span className="text-xs">确认?</span> : <Icon name="trash" size={12} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg2)] text-[var(--dim)]">
              <Icon name="server" size={26} />
            </span>
            <div className="text-sm text-[var(--mut)]">
              {rows.length === 0 ? "还没有注册任何服务" : "没有匹配的服务"}
            </div>
            <p className="max-w-sm text-xs leading-5 text-[var(--dim)]">
              {rows.length === 0
                ? "填入项目目录即可自动探测 Node / Rust / Maven 工程并生成 lifecycle.toml。"
                : "试试清空搜索或切换状态筛选。"}
            </p>
            <button className="btn btn-success btn-sm" onClick={() => setShowRegister(true)}>
              <Icon name="plus" />
              创建第一个服务
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--line)] bg-[var(--bg1)] px-4 py-1.5 text-[11px] text-[var(--dim)]">
        <span>
          显示 {filtered.length}/{rows.length}
        </span>
        <span className="flex items-center gap-1">
          <span className="kbd">/</span> 搜索
        </span>
        <span className="flex items-center gap-1">
          <span className="kbd">n</span> 新建
        </span>
        <span className="flex-1" />
        <span>点击行进入详情 · 筛选与排序已自动保存</span>
      </div>

      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onSaved={() => setShowRegister(false)} />}
    </div>
  );
}