import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, profilePath } from "./api.js";
import { pushToast } from "./toast.js";
import { copyText } from "./clipboard.js";
import { STATE_LABEL, uptime } from "./format.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";
import Modal from "./Modal.jsx";
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

export default function ServicesView({
  projects,
  selectedProject,
  onSelectProject,
  onOpenAdd,
  onManageProject,
  onOpen,
}) {
  const { t } = useI18n();
  const saved = useRef(loadView()).current;
  const [q, setQ] = useState(saved.q ?? "");
  const [statusFilter, setStatusFilter] = useState(saved.statusFilter ?? "all");
  const [sort, setSort] = useState(saved.sort ?? { key: "name", dir: "asc" });
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [statsCollapsed, setStatsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("lifecycle-stats-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [showRegister, setShowRegister] = useState(false);
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef(null);

  const openAddModal = onOpenAdd || (() => setShowRegister(true));

  useEffect(() => {
    const tm = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tm);
  }, []);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ q, statusFilter, sort }));
  }, [q, statusFilter, sort]);

  useEffect(() => {
    try {
      localStorage.setItem("lifecycle-stats-collapsed", statsCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [statsCollapsed]);

  useEffect(() => {
    if (!confirming) return;
    const tm = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(tm);
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
        openAddModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAddModal]);

  const targetProjects = useMemo(() => {
    if (selectedProject) {
      const found = projects.filter((p) => p.project === selectedProject);
      return found.length ? found : projects;
    }
    return projects;
  }, [projects, selectedProject]);

  const currentProj = useMemo(
    () => (selectedProject ? projects.find((p) => p.project === selectedProject) ?? null : null),
    [projects, selectedProject]
  );
  const currentProjDir = currentProj?.path ? String(currentProj.path).replace(/\/lifecycle\.toml$/, "") : "";

  async function copyProjPath(path) {
    if (!path) return;
    if (await copyText(path)) {
      pushToast(t("已复制项目路径"), { kind: "success" });
    }
  }

  async function revealProjPath(path) {
    if (!path) return;
    try {
      await api("/api/reveal-path", { method: "POST", body: JSON.stringify({ path }) });
      pushToast(t("已在文件管理器中定位"), { kind: "success" });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    }
  }

  const rows = useMemo(
    () =>
      targetProjects.flatMap((p) =>
        p.profiles.map((s) => ({ ...s, project: p.project, key: `${p.project}/${s.profile}` }))
      ),
    [targetProjects]
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

  const start = (r) => act(r.key, () => post(r, "/start", { wait: true }), t("{key} 已启动", { key: r.key }));
  const stop = (r) => act(r.key, () => post(r, "/stop"), t("{key} 已停止", { key: r.key }));
  const restart = (r) => act(r.key, () => post(r, "/restart", { wait: true }), t("{key} 已重启", { key: r.key }));
  const compile = (r) =>
    act(r.key, async () => {
      const res = await post(r, "/compile", { kind: "quick" });
      pushToast(
        res.success
          ? t("{key} 编译成功 · {ms}ms", { key: r.key, ms: res.duration_ms })
          : t("{key} 编译失败 · {n} 错误", { key: r.key, n: res.errors.length }),
        { kind: res.success ? "success" : "error" }
      );
    });
  const compileFull = (r) =>
    act(r.key, async () => {
      const res = await post(r, "/compile", { kind: "full" });
      pushToast(
        res.success
          ? t("{key} 全量编译成功 · {ms}ms", { key: r.key, ms: res.duration_ms })
          : t("{key} 全量编译失败 · {n} 错误", { key: r.key, n: res.errors.length }),
        { kind: res.success ? "success" : "error" }
      );
    });

  const [renamingService, setRenamingService] = useState(null);

  async function handleRenameService() {
    if (!renamingService) return;
    const { project, service, newName } = renamingService;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === service) return;
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/services/${encodeURIComponent(service)}/rename`, {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      pushToast(t("服务已重命名为「{name}」", { name: trimmed }), { kind: "success" });
      setRenamingService(null);
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    }
  }

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
      pushToast(t("已卸载服务「{name}」", { name: r.project }), {
        kind: "success",
        duration: 15000,
        action: configPath
          ? {
              label: t("撤销"),
              fn: async () => {
                try {
                  await api("/api/projects/register", {
                    method: "POST",
                    body: JSON.stringify({ path: configPath.replace(/\/lifecycle\.toml$/, "") }),
                  });
                  pushToast(t("已恢复「{name}」", { name: r.project }), { kind: "success" });
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
    pushToast(
      op === "start"
        ? t("批量启动完成 {ok}/{total}", { ok, total: targets.length })
        : t("批量停止完成 {ok}/{total}", { ok, total: targets.length }),
      { kind: ok === targets.length ? "success" : "error" }
    );
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
    { label: t("运行中"), value: stats.running, icon: "play", tone: "grn", filter: "running" },
    { label: t("启停中"), value: stats.starting, icon: "clock", tone: "amb", filter: "starting" },
    { label: t("崩溃"), value: stats.crashed, icon: "warn", tone: "red", filter: "crashed" },
    { label: t("未启动"), value: stats.idle, icon: "stop", tone: "dim", filter: "idle" },
    { label: t("编译失败"), value: stats.buildFail, icon: "compile", tone: "vio", filter: null },
  ];

  return (
    <div className="view relative flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--line)] bg-[var(--bg1)]">
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">
            {t("状态概览")}
          </span>
          <span className="mono text-[11px] text-[var(--dim)]">
            {t("{running}/{total} 运行中", { running: stats.running, total: rows.length })}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--dim)] transition-colors hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
            onClick={() => setStatsCollapsed((v) => !v)}
            aria-expanded={!statsCollapsed}
            title={statsCollapsed ? t("展开概览") : t("折叠概览")}
          >
            <Icon
              name="down"
              size={13}
              className={`transition-transform duration-200 ${statsCollapsed ? "-rotate-90" : ""}`}
            />
          </button>
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            statsCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const inner = (
            <>
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
                style={{
                  background: `color-mix(in oklab, var(--${tile.tone === "dim" ? "mut" : tile.tone}) 14%, transparent)`,
                  color: `var(--${tile.tone === "dim" ? "mut" : tile.tone})`,
                }}
              >
                <Icon name={tile.icon} size={15} />
              </span>
              <span className="min-w-0">
                <span className="mono block text-lg font-semibold leading-tight">{tile.value}</span>
                <span className="block truncate text-[11px] text-[var(--dim)]">{tile.label}</span>
              </span>
            </>
          );
          const isFilterActive = statusFilter === tile.filter;
          const cls = `panel flex items-center gap-3 px-3 py-2 text-left transition-all ${
            isFilterActive
              ? "!border-[var(--blu)] shadow-sm bg-[var(--bg2)] ring-1 ring-[var(--blu)]"
              : "hover:border-[var(--line3)]"
          }`;
          return tile.filter ? (
            <button
              key={tile.label}
              className={cls}
              onClick={() => setStatusFilter(statusFilter === tile.filter ? "all" : tile.filter)}
              title={t("按「{label}」筛选", { label: tile.label })}
            >
              {inner}
            </button>
          ) : (
            <div key={tile.label} className={cls} title={t("最近一次编译失败的服务数")}>
              {inner}
            </div>
          );
        })}
            </div>
          </div>
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            statsCollapsed ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 pt-1">
              {tiles.map((tile) => {
                const tone = tile.tone === "dim" ? "mut" : tile.tone;
                const active = statusFilter === tile.filter;
                const chip = (
                  <>
                    <span
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{ background: `var(--${tone})` }}
                    />
                    <span className="mono font-semibold" style={{ color: `var(--${tone})` }}>
                      {tile.value}
                    </span>
                    <span className="text-[var(--dim)]">{tile.label}</span>
                  </>
                );
                const cls = `flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-all ${
                  active
                    ? "border-[var(--blu)] bg-[var(--blu-soft)] ring-1 ring-[var(--blu)]"
                    : "border-[var(--line)] hover:border-[var(--line3)] hover:bg-[var(--bg2)]"
                }`;
                return tile.filter ? (
                  <button
                    key={tile.label}
                    type="button"
                    className={cls}
                    onClick={() => setStatusFilter(statusFilter === tile.filter ? "all" : tile.filter)}
                    title={t("按「{label}」筛选", { label: tile.label })}
                  >
                    {chip}
                  </button>
                ) : (
                  <span key={tile.label} className={cls} title={t("最近一次编译失败的服务数")}>
                    {chip}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="list" size={16} className="text-[var(--blu)]" />
          {selectedProject ? (
            <span className="flex items-center gap-1.5">
              <span>{t("服务列表")}</span>
              <span className="text-[var(--dim)]">/</span>
              <span className="text-[var(--blu)] font-bold">{selectedProject}</span>
            </span>
          ) : (
            t("全部服务列表")
          )}
        </h1>
        <span className="mono text-xs text-[var(--mut)]">
          {t("{running}/{total} 运行中", { running: stats.running, total: rows.length })}
        </span>
        <span className="flex-1" />
        <div className="relative">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            ref={searchRef}
            className="input w-52 pl-8! pr-7!"
            placeholder={t("搜索服务…  /")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--dim)] hover:text-[var(--txt)] p-0.5 rounded"
              onClick={() => setQ("")}
              title={t("清空")}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t("全部状态")}</option>
          <option value="running">{t("运行中")}</option>
          <option value="starting">{t("启动中")}</option>
          <option value="crashed">{t("崩溃")}</option>
          <option value="idle">{t("未启动")}</option>
        </select>
        <button className="btn btn-success" onClick={openAddModal} title={t("快捷键 n，在当前项目下配置新服务")}>
          <Icon name="plus" />
          {t("添加服务")}
        </button>
      </div>

      {projects.length > 1 && (
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-[var(--bg2)]/60 px-4 py-1.5 overflow-x-auto text-xs">
          <span className="text-[11px] font-semibold text-[var(--dim)] mr-1 flex-none">{t("项目切换:")}</span>
          <button
            type="button"
            className={`rounded-full px-2.5 py-0.5 transition-colors flex-none ${
              !selectedProject
                ? "bg-[var(--blu)] text-white font-medium"
                : "bg-[var(--bg1)] text-[var(--mut)] hover:bg-[var(--bg3)] hover:text-[var(--txt)] border border-[var(--line)]"
            }`}
            onClick={() => onSelectProject && onSelectProject(null)}
          >
            {t("全部 ({n})", { n: projects.reduce((sum, p) => sum + p.profiles.length, 0) })}
          </button>
          {projects.map((p) => {
            const isSel = selectedProject === p.project;
            return (
              <button
                key={p.project}
                type="button"
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors flex-none ${
                  isSel
                    ? "bg-[var(--blu)] text-white font-medium"
                    : "bg-[var(--bg1)] text-[var(--mut)] hover:bg-[var(--bg3)] hover:text-[var(--txt)] border border-[var(--line)]"
                }`}
                onClick={() => onSelectProject && onSelectProject(p.project)}
              >
                <Icon name="folder" size={11} className={isSel ? "text-white" : "text-[var(--dim)]"} />
                <span>{p.project}</span>
                <span className={`text-[10px] ${isSel ? "text-white/80" : "text-[var(--dim)]"}`}>
                  ({p.profiles.length})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {currentProj && (
        <div className="flex flex-wrap items-center justify-between border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[var(--dim)] flex-none">{t("项目路径:")}</span>
            <span className="mono text-[var(--txt)] truncate select-all">{currentProjDir}</span>
            <button
              type="button"
              className="text-[var(--dim)] hover:text-[var(--txt)] p-1 rounded hover:bg-[var(--bg2)] flex-none"
              title={t("复制项目路径")}
              onClick={() => copyProjPath(currentProjDir)}
            >
              <Icon name="copy" size={12} />
            </button>
            <button
              type="button"
              className="text-[var(--dim)] hover:text-[var(--txt)] p-1 rounded hover:bg-[var(--bg2)] flex-none"
              title={t("在文件管理器中定位")}
              onClick={() => revealProjPath(currentProjDir)}
            >
              <Icon name="open" size={12} />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-none ml-2">
            <button
              type="button"
              className="btn btn-primary btn-sm !py-1 !px-2 flex items-center gap-1"
              onClick={() => openAddModal()}
              title={t("在此项目下添加新环境/服务（如 Web 端或桌面端）")}
            >
              <Icon name="plus" size={12} />
              {t("添加服务/环境")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm !py-1 !px-2 flex items-center gap-1"
              onClick={() => onManageProject && onManageProject(selectedProject)}
              title={t("管理项目信息、重命名或移除项目")}
            >
              <Icon name="settings" size={12} />
              {t("项目管理")}
            </button>
          </div>
        </div>
      )}


      <div className="min-h-0 flex-1 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 hidden sm:table-cell">
                <Checkbox
                  size="sm"
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  onChange={toggleAll}
                  title={t("全选当前筛选结果")}
                />
              </th>
              {thSort("name", t("服务名称"))}
              <th className="hidden lg:table-cell">{t("环境 / Profile")}</th>
              {thSort("state", t("状态"))}
              <th className="hidden lg:table-cell">PID</th>
              {thSort("uptime", t("运行时长"), "hidden md:table-cell")}
              {thSort("port", t("端口"), "hidden sm:table-cell")}
              {thSort("build", t("最近编译"), "hidden xl:table-cell")}
              <th className="text-right sticky right-0 z-20 bg-[var(--bg1)] shadow-[-6px_0_12px_rgba(0,0,0,0.12)]">
                {t("操作")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const running = r.state === "running" || r.state === "starting";
              return (
                <tr
                  key={r.key}
                  className="group cursor-pointer hover:bg-[var(--bg2)]/60 transition-colors"
                  data-selected={selected.has(r.key) || undefined}
                  onClick={(e) => rowClick(e, r)}
                >
                  <td className="hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                    <Checkbox size="sm" checked={selected.has(r.key)} onChange={() => toggle(r.key)} title={t("选择 {key}", { key: r.key })} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-[var(--txt)]">
                        {r.service || r.profile}
                      </span>
                      <button
                        type="button"
                        className="text-[var(--dim)] hover:text-[var(--blu)] p-0.5 rounded transition-colors"
                        title={t("修改服务名称")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingService({
                            project: r.project,
                            service: r.service || r.profile,
                            newName: r.service || r.profile,
                          });
                        }}
                      >
                        <Icon name="edit" size={11} />
                      </button>
                      <span className="text-[11px] mono text-[var(--dim)]">({r.project})</span>
                    </div>
                  </td>
                  <td className="hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <select
                        className="input !py-0.5 !px-2 text-xs mono font-medium bg-[var(--bg2)] border-[var(--line)]"
                        value={r.profile}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__ADD__") {
                            openAddModal();
                          } else {
                            onOpen(r.project, val, "run");
                          }
                        }}
                        title={t("切换或添加该服务的运行环境")}
                      >
                        <option value={r.profile}>
                          {r.env_name || r.profile} ({r.env_name === "prod" ? t("生产") : r.env_name === "test" ? t("测试") : t("开发")})
                        </option>
                        {targetProjects
                          .find((p) => p.project === r.project)
                          ?.profiles?.filter((s) => s.profile !== r.profile && (s.service === r.service || (!s.service && !r.service)))
                          .map((s) => (
                            <option key={s.profile} value={s.profile}>
                              {s.env_name || s.profile}
                            </option>
                          ))}
                        <option value="__ADD__">{t("+ 新增环境…")}</option>
                      </select>
                    </div>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className={`dot dot-${r.state}`} />
                      <span
                        className={
                          r.state === "crashed" ? "text-[var(--red)]" : r.state === "running" ? "text-[var(--grn)]" : "text-[var(--mut)]"
                        }
                      >
                        {t(STATE_LABEL[r.state] ?? r.state)}
                      </span>
                    </span>
                  </td>
                  <td className="mono hidden lg:table-cell text-[var(--mut)]">{r.pid ?? "—"}</td>
                  <td className="mono hidden md:table-cell text-[var(--mut)]">{uptime(r.uptime_ms)}</td>
                  <td className="mono hidden sm:table-cell text-[var(--mut)]">{r.port ?? "—"}</td>
                  <td className="hidden xl:table-cell">
                    {r.last_build ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--bg2)] transition-colors"
                        title={t("点击直接查看该服务的编译日志")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.project, r.profile, "build");
                        }}
                      >
                        <span
                          className={`mono inline-flex items-center gap-1 text-xs font-medium ${
                            r.last_build.success ? "text-[var(--grn)]" : "text-[var(--red)]"
                          }`}
                        >
                          <Icon name={r.last_build.success ? "check" : "x"} size={11} />
                          {r.last_build.kind}
                        </span>
                        <span className="text-xs text-[var(--dim)]">{r.last_build.duration_ms}ms</span>
                      </button>
                    ) : (
                      <span className="text-[var(--dim)]">—</span>
                    )}
                  </td>
                  <td
                    className="sticky right-0 z-10 bg-[var(--bg1)] group-hover:bg-[var(--bg2)] transition-colors shadow-[-6px_0_12px_rgba(0,0,0,0.12)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-end items-center gap-1.5 py-0.5 pr-1">
                      {busy[r.key] && <span className="spinner self-center text-[var(--blu)]" />}

                      <div className="flex items-center gap-0.5 rounded border border-[var(--line)] bg-[var(--bg2)]/60 p-0.5">
                        <button
                          className="btn btn-sm btn-success !py-1 !px-2"
                          title={t("启动服务")}
                          disabled={running || busy[r.key]}
                          onClick={() => start(r)}
                        >
                          <Icon name="play" size={11} />
                          {t("启动")}
                        </button>
                        <button
                          className="btn btn-sm btn-danger !py-1 !px-2"
                          title={t("停止服务")}
                          disabled={!running}
                          onClick={() => stop(r)}
                        >
                          <Icon name="stop" size={11} />
                          {t("停止")}
                        </button>
                        <button
                          className="btn btn-sm btn-warn !py-1 !px-1.5 hidden sm:inline-flex"
                          title={t("重启服务")}
                          disabled={!!busy[r.key]}
                          onClick={() => restart(r)}
                        >
                          <Icon name="restart" size={11} />
                        </button>
                      </div>

                      <div className="hidden lg:flex items-center gap-0.5 rounded border border-[var(--line)] bg-[var(--bg2)]/60 p-0.5">
                        <button
                          className="btn btn-sm btn-primary !py-1 !px-2"
                          title={t("快速增量编译")}
                          disabled={!!busy[r.key]}
                          onClick={() => compile(r)}
                        >
                          <Icon name="compile" size={11} />
                          {t("快速")}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost !py-1 !px-1.5"
                          title={t("全量完整编译")}
                          disabled={!!busy[r.key]}
                          onClick={() => compileFull(r)}
                        >
                          <Icon name="boxes" size={11} />
                        </button>
                      </div>

                      <button
                        className="btn btn-sm btn-ghost !py-1 !px-1.5"
                        title={t("查看服务启动日志与配置")}
                        onClick={() => onOpen(r.project, r.profile, "run")}
                      >
                        <Icon name="logs" size={12} />
                      </button>

                      <button
                        className={`btn btn-sm btn-ghost !py-1 !px-1.5 ${confirming === r.key ? "!text-[var(--red)]" : ""}`}
                        title={confirming === r.key ? t("再次点击确认卸载") : t("卸载服务（停止并移除注册）")}
                        onClick={() => unregister(r)}
                      >
                        {confirming === r.key ? <span className="text-xs">{t("确认?")}</span> : <Icon name="trash" size={12} />}
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
              {rows.length === 0 ? t("还没有注册任何服务") : t("没有匹配的服务")}
            </div>
            <p className="max-w-sm text-xs leading-5 text-[var(--dim)]">
              {rows.length === 0
                ? t("填入项目目录即可自动探测 Node / Rust / Maven 工程并生成 lifecycle.toml。")
                : t("试试清空搜索或切换状态筛选。")}
            </p>
            <button className="btn btn-success btn-sm" onClick={openAddModal}>
              <Icon name="plus" />
              {t("添加第一个服务")}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--line)] bg-[var(--bg1)] px-4 py-1.5 text-[11px] text-[var(--dim)]">
        <span>{t("显示 {a}/{b}", { a: filtered.length, b: rows.length })}</span>
        <span className="flex items-center gap-1">
          <span className="kbd">/</span> {t("搜索")}
        </span>
        <span className="flex items-center gap-1">
          <span className="kbd">n</span> {t("新建")}
        </span>
        <span className="flex-1" />
        <span>{t("点击行进入详情 · 筛选与排序已自动保存")}</span>
      </div>

      {renamingService && (
        <Modal
          title={t("修改服务名称")}
          icon="edit"
          tone="blu"
          width={440}
          onClose={() => setRenamingService(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRenamingService(null)}>
                {t("取消")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!renamingService.newName.trim() || renamingService.newName.trim() === renamingService.service}
                onClick={handleRenameService}
              >
                {t("保存服务名")}
              </button>
            </>
          }
        >
          <label className="block">
            <span className="field-label">{t("服务名称")}</span>
            <input
              className="input mono w-full"
              value={renamingService.newName}
              onChange={(e) => setRenamingService({ ...renamingService, newName: e.target.value })}
              placeholder={t("输入新的服务名")}
              autoFocus
            />
          </label>
          <p className="mt-2 text-xs text-[var(--dim)] leading-5">
            {t("重命名将同步更新 lifecycle.toml 中该服务名下的全部环境配置。")}
          </p>
        </Modal>
      )}

      {showRegister && (
        <RegisterModal
          kind="service"
          projects={projects}
          defaultProject={selectedProject}
          onClose={() => setShowRegister(false)}
          onSaved={(p, prof) => {
            setShowRegister(false);
            if (p && prof && onOpen) onOpen(p, prof);
          }}
        />
      )}

      {/* 悬浮批量操作条：overlay 不参与布局，勾选时表格行不会位移 */}
      <div
        role="toolbar"
        aria-label={t("批量操作")}
        aria-hidden={!selected.size}
        className={`absolute bottom-9 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-[var(--blu)] bg-[var(--bg1)] px-3 py-2 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all duration-200 ${
          selected.size
            ? "translate-y-0 opacity-100"
            : "pointer-events-none invisible translate-y-3 opacity-0"
        }`}
      >
        <span className="flex items-center gap-1.5 rounded-full bg-[var(--blu-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--blu)]">
          <Icon name="check" size={12} />
          {t("已选 {n} 个服务", { n: selected.size })}
        </span>
        <button className="btn btn-sm btn-success" onClick={() => bulk("start")} disabled={!selected.size}>
          <Icon name="play" size={12} />
          {t("批量启动")}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => bulk("stop")} disabled={!selected.size}>
          <Icon name="stop" size={12} />
          {t("批量停止")}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>
          {t("清除选择")}
        </button>
      </div>
    </div>
  );
}