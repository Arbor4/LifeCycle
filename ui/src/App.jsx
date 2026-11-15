import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BASE, notify, profilePath } from "./lib/api.js";
import { pushToast } from "./lib/toast.js";
import { adoptTheme } from "./lib/theme.js";
import Sidebar from "./lib/Sidebar.jsx";
import StatusCard from "./lib/StatusCard.jsx";
import LogPanel from "./lib/LogPanel.jsx";
import ErrorsPanel from "./lib/ErrorsPanel.jsx";
import PartialModal from "./lib/PartialModal.jsx";
import SettingsPanel from "./lib/SettingsPanel.jsx";
import ConfigPanel from "./lib/ConfigPanel.jsx";
import DiagnosticsPanel from "./lib/DiagnosticsPanel.jsx";
import ServicesView from "./lib/ServicesView.jsx";
import GroupsView from "./lib/GroupsView.jsx";
import McpView from "./lib/McpView.jsx";
import ToastHost from "./lib/ToastHost.jsx";
import Icon from "./lib/Icon.jsx";

const TABS = [
  ["logs", "日志", "logs"],
  ["errors", "错误", "warn"],
  ["config", "配置", "config"],
];

export default function App() {
  const [projects, setProjects] = useState([]);
  const [sel, setSel] = useState({ project: null, profile: null });
  const [view, setView] = useState("services");
  const [tab, setTab] = useState("logs");
  const [errorsByProfile, setErrorsByProfile] = useState({});
  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState(null);
  const [showPartial, setShowPartial] = useState(false);
  const [settings, setSettings] = useState({ notifications: true, log_lines: 5000 });
  const [online, setOnline] = useState(false);

  const prevStates = useRef({});
  const selRef = useRef(sel);
  selRef.current = sel;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const key = `${sel.project}/${sel.profile}`;
  const current = useMemo(
    () =>
      projects.find((p) => p.project === sel.project)?.profiles.find((p) => p.profile === sel.profile) ?? null,
    [projects, sel]
  );
  const currentErrors = errorsByProfile[key] ?? null;
  const isBusy = !!busy[key];
  const running = current?.state === "running" || current?.state === "starting";
  const compiling = busy[key] === "compile";

  const openDetail = useCallback((project, profile) => {
    setSel({ project, profile });
    setView("detail");
    setTab("logs");
  }, []);

  const refresh = useCallback(async () => {
    const data = await api("/api/projects");
    setProjects(data);
    setOnline(true);
    if (!selRef.current.project && data.length) {
      setSel({ project: data[0].project, profile: data[0].profiles[0]?.profile ?? "default" });
    }
    return data;
  }, []);

  const detectChanges = useCallback((next) => {
    for (const p of next) {
      for (const s of p.profiles) {
        const k = `${p.project}/${s.profile}`;
        const prev = prevStates.current[k];
        if (prev && settingsRef.current.notifications) {
          if (s.state === "crashed" && prev.state !== "crashed") {
            notify("LifeCycle：进程崩溃", `${k} 意外退出`);
            pushToast(`${k} 崩溃`, { kind: "error" });
          }
          const ts = s.last_build?.finished_at_ms;
          if (ts && ts !== prev.buildTs && s.last_build && !s.last_build.success) {
            notify("LifeCycle：编译失败", `${k} 有 ${s.last_build.error_count} 个错误`);
          }
        }
        prevStates.current[k] = { state: s.state, buildTs: s.last_build?.finished_at_ms };
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 20 && alive; i++) {
        try {
          await refresh();
          if (!alive) return;
          setMessage(null);
          break;
        } catch (e) {
          if (!alive) return;
          setMessage(e.message);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      api("/api/settings")
        .then((s) => {
          if (!alive) return;
          setSettings(s);
          if (s.theme) adoptTheme(s.theme);
        })
        .catch(() => {});
    })();

    const es = new EventSource(`${BASE}/api/events`);
    es.addEventListener("status", (e) => {
      const next = JSON.parse(e.data);
      detectChanges(next);
      setProjects(next);
      setOnline(true);
      setMessage(null);
      if (!selRef.current.project && next.length) {
        setSel({ project: next[0].project, profile: next[0].profiles[0]?.profile ?? "default" });
      }
    });
    es.onerror = () => setOnline(false);
    return () => {
      alive = false;
      es.close();
    };
  }, [refresh, detectChanges]);

  const act = useCallback(
    async (name, fn) => {
      const k = `${selRef.current.project}/${selRef.current.profile}`;
      setBusy((b) => ({ ...b, [k]: name }));
      setMessage(null);
      try {
        const r = await fn();
        if (r && Array.isArray(r.errors)) {
          setErrorsByProfile((prev) => ({ ...prev, [k]: r }));
          if (!r.success && r.errors.length) setTab("errors");
          pushToast(
            r.cancelled
              ? "编译已取消"
              : r.success
                ? `编译成功 · ${r.duration_ms}ms`
                : `编译失败 · ${r.errors.length} 错误`,
            { kind: r.success ? "success" : "error" }
          );
        } else if (name === "start") {
          pushToast(`${k} 已启动${r?.ready ? "（就绪）" : ""}`, { kind: "success" });
        } else if (name === "stop") {
          pushToast(`${k} 已停止`, { kind: "success" });
        } else if (name === "restart") {
          pushToast(`${k} 已重启`, { kind: "success" });
        }
        await refresh();
      } catch (e) {
        setMessage(e.message);
        await refresh().catch(() => {});
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[k];
          return next;
        });
      }
    },
    [refresh]
  );

  const post = (suffix, body) =>
    api(profilePath(sel.project, sel.profile, suffix), { method: "POST", body: JSON.stringify(body ?? {}) });

  const start = () => act("start", () => post("/start", { wait: true }));
  const startFast = () => act("start", () => post("/start", { wait: false }));
  const stop = () => act("stop", () => post("/stop"));
  const restart = () => act("restart", () => post("/restart", { wait: true }));
  const compileQuick = () => act("compile", () => post("/compile", { kind: "quick" }));
  const compileFull = () => act("compile", () => post("/compile", { kind: "full" }));
  const compilePartial = (targets) => {
    setShowPartial(false);
    act("compile", () => post("/compile", { kind: "partial", targets }));
  };
  const cancelCompile = () => post("/compile/cancel").catch((e) => setMessage(e.message));

  async function reload() {
    try {
      await api(`/api/projects/${encodeURIComponent(sel.project)}/reload`, { method: "POST" });
      setMessage(null);
      pushToast("配置已重载", { kind: "success" });
      await refresh();
    } catch (e) {
      setMessage(e.message);
    }
  }

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        sel={sel}
        view={view}
        online={online}
        onSelect={openDetail}
        onNavigate={(v) => setView(v)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {view === "services" ? (
          <ServicesView projects={projects} onOpen={openDetail} />
        ) : view === "groups" ? (
          <GroupsView projects={projects} onOpen={openDetail} />
        ) : view === "mcp" ? (
          <McpView />
        ) : view === "settings" ? (
          <SettingsPanel />
        ) : view === "diagnostics" ? (
          <DiagnosticsPanel />
        ) : current ? (
          <>
            <div className="border-b border-[var(--line)] bg-[var(--bg1)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <StatusCard status={current} project={sel.project} />
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn btn-success" disabled={running || isBusy} onClick={start}>
                    <Icon name="play" size={13} />
                    启动
                  </button>
                  <button
                    className="btn btn-success"
                    disabled={running || isBusy}
                    onClick={startFast}
                    title="跳过等待就绪，直接拉起"
                  >
                    <Icon name="zap" size={13} />
                    快速启动
                  </button>
                  <button className="btn btn-danger" disabled={!running || isBusy} onClick={stop}>
                    <Icon name="stop" size={13} />
                    停止
                  </button>
                  <button className="btn btn-warn" disabled={isBusy} onClick={restart}>
                    <Icon name="restart" size={13} />
                    重启
                  </button>
                  <span className="mx-1 border-l border-[var(--line2)]" />
                  {compiling ? (
                    <button className="btn" onClick={cancelCompile}>
                      <span className="spinner" />
                      取消编译…
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-primary" disabled={isBusy} onClick={compileQuick}>
                        <Icon name="compile" size={13} />
                        快速编译
                      </button>
                      <button className="btn btn-primary" disabled={isBusy} onClick={() => setShowPartial(true)}>
                        <Icon name="grid" size={13} />
                        部分编译
                      </button>
                      <button className="btn btn-primary" disabled={isBusy} onClick={compileFull}>
                        <Icon name="boxes" size={13} />
                        完整编译
                      </button>
                    </>
                  )}
                </div>
              </div>
              {message && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--red)] bg-[var(--red-soft)] px-3 py-2 text-sm text-[var(--red)]">
                  <Icon name="warn" size={14} className="mt-0.5 flex-none" />
                  <span className="min-w-0 break-all">{message}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--bg1)] px-4">
              {TABS.map(([t, label, icon]) => (
                <button
                  key={t}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                    tab === t
                      ? "border-b-2 border-[var(--blu)] font-medium text-[var(--blu)]"
                      : "text-[var(--mut)] hover:text-[var(--txt)]"
                  }`}
                  onClick={() => setTab(t)}
                >
                  <Icon name={icon} size={13} />
                  {label}
                  {t === "errors" && currentErrors ? ` (${currentErrors.errors.length})` : ""}
                </button>
              ))}
              <span className="flex-1" />
              <button className="btn btn-ghost btn-sm" title="重新读取 lifecycle.toml，无需重启" onClick={reload}>
                <Icon name="refresh" size={12} />
                重载配置
              </button>
            </div>

            <div className="min-h-0 flex-1" key={key}>
              {tab === "logs" ? (
                <LogPanel project={sel.project} profile={sel.profile} maxLines={settings.log_lines ?? 5000} />
              ) : tab === "errors" ? (
                <ErrorsPanel result={currentErrors} />
              ) : (
                <ConfigPanel project={sel.project} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--dim)]">
            {message ? (
              <>
                <Icon name="warn" size={28} className="text-[var(--red)]" />
                <div className="text-sm">无法连接后端：{message}</div>
                <p className="max-w-md text-center text-xs leading-5">
                  请确认 LifeCycle 后端已启动（默认端口 39517），或运行{" "}
                  <span className="mono">cargo run -p lifecycle-http</span>。
                </p>
              </>
            ) : (
              <>
                <span className="spinner !h-5 !w-5 text-[var(--blu)]" />
                <div className="text-sm">加载中…</div>
              </>
            )}
          </div>
        )}
      </main>

      {showPartial && (
        <PartialModal
          project={sel.project}
          profile={sel.profile}
          onClose={() => setShowPartial(false)}
          onSubmit={compilePartial}
        />
      )}
      <ToastHost />
    </div>
  );
}