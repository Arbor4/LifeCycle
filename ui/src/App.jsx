import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BASE, notify, profilePath } from "./lib/api.js";
import { pushToast } from "./lib/toast.js";
import { adoptTheme } from "./lib/theme.js";
import { adoptLang, useI18n, t as tr } from "./lib/i18n.js";
import Sidebar from "./lib/Sidebar.jsx";
import StatusCard from "./lib/StatusCard.jsx";
import LogPanel from "./lib/LogPanel.jsx";
import ErrorsPanel from "./lib/ErrorsPanel.jsx";
import PartialModal from "./lib/PartialModal.jsx";
import SettingsPanel from "./lib/SettingsPanel.jsx";
import ConfigPanel from "./lib/ConfigPanel.jsx";
import ServicesView from "./lib/ServicesView.jsx";
import GroupsView from "./lib/GroupsView.jsx";
import McpView from "./lib/McpView.jsx";
import ToastHost from "./lib/ToastHost.jsx";
import RegisterModal from "./lib/RegisterModal.jsx";
import Logo from "./lib/Logo.jsx";
import { useMediaQuery } from "./lib/useMediaQuery.js";
import ProjectManageModal from "./lib/ProjectManageModal.jsx";
import Icon from "./lib/Icon.jsx";

const TABS = [
  ["logs", "日志", "logs"],
  ["errors", "错误", "warn"],
  ["config", "配置", "config"],
];

export default function App() {
  const { t } = useI18n();
  const [projects, setProjects] = useState([]);
  const [sel, setSel] = useState({ project: null, profile: null });
  const [selectedProject, setSelectedProject] = useState(null);
  const [view, setView] = useState("services");
  const [tab, setTab] = useState("logs");
  const [logSource, setLogSource] = useState("run");
  const [errorsByProfile, setErrorsByProfile] = useState({});
  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState(null);
  const [showPartial, setShowPartial] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(max-width: 1023px)");
  const [registerKind, setRegisterKind] = useState("project");
  const [manageProject, setManageProject] = useState(null);
  const [settings, setSettings] = useState({ notifications: true, log_lines: 5000 });
  const [online, setOnline] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("lifecycle-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!isMobile) setMobileNav(false);
  }, [isMobile]);

  // 进入平板宽度默认收为图标栏，把宽度让给内容；用户仍可手动展开
  useEffect(() => {
    if (isTablet) setCollapsed(true);
  }, [isTablet]);

  useEffect(() => {
    try {
      localStorage.setItem("lifecycle-sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

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
  const packaging = busy[key] === "package";

  const openDetail = useCallback((project, profile, source = "run") => {
    setSel({ project, profile });
    setView("detail");
    setTab("logs");
    if (source) setLogSource(source);
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
            notify(tr("LifeCycle：进程崩溃"), tr("{k} 意外退出", { k }));
            pushToast(tr("{k} 崩溃", { k }), { kind: "error" });
          }
          const ts = s.last_build?.finished_at_ms;
          if (ts && ts !== prev.buildTs && s.last_build && !s.last_build.success) {
            notify(tr("LifeCycle：编译失败"), tr("{k} 有 {n} 个错误", { k, n: s.last_build.error_count }));
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
          if (s.language) adoptLang(s.language);
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
      if (name === "compile" || name === "package") setLogSource("build");
      try {
        const r = await fn();
        if (r && Array.isArray(r.errors)) {
          setErrorsByProfile((prev) => ({ ...prev, [k]: r }));
          if (!r.success && r.errors.length) setTab("errors");
          const pkg = name === "package";
          pushToast(
            r.cancelled
              ? pkg
                ? tr("打包已取消")
                : tr("编译已取消")
              : r.success
                ? pkg
                  ? tr("打包成功 · {ms}ms", { ms: r.duration_ms })
                  : tr("编译成功 · {ms}ms", { ms: r.duration_ms })
                : pkg
                  ? tr("打包失败 · {n} 错误", { n: r.errors.length })
                  : tr("编译失败 · {n} 错误", { n: r.errors.length }),
            { kind: r.success ? "success" : "error" }
          );
        } else if (name === "start") {
          pushToast(r?.ready ? tr("{k} 已启动（就绪）", { k }) : tr("{k} 已启动", { k }), { kind: "success" });
        } else if (name === "stop") {
          pushToast(tr("{k} 已停止", { k }), { kind: "success" });
        } else if (name === "restart") {
          pushToast(tr("{k} 已重启", { k }), { kind: "success" });
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
  const compilePackage = () => act("package", () => post("/compile", { kind: "package" }));
  const compilePartial = (targets) => {
    setShowPartial(false);
    act("compile", () => post("/compile", { kind: "partial", targets }));
  };
  const cancelCompile = () => post("/compile/cancel").catch((e) => setMessage(e.message));

  async function reload() {
    try {
      await api(`/api/projects/${encodeURIComponent(sel.project)}/reload`, { method: "POST" });
      setMessage(null);
      pushToast(t("配置已重载"), { kind: "success" });
      await refresh();
    } catch (e) {
      setMessage(e.message);
    }
  }

  return (
    <div className="flex h-full">
      {isMobile && mobileNav && (
        <div
          className="fixed inset-0 z-40 bg-[var(--scrim)] backdrop-blur-[2px]"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div
        className={
          isMobile
            ? `fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ${
                mobileNav ? "translate-x-0" : "-translate-x-full"
              }`
            : "contents"
        }
      >
      <Sidebar
        projects={projects}
        sel={sel}
        view={view}
        selectedProject={selectedProject}
        online={online}
        collapsed={isMobile ? false : collapsed}
        onToggleCollapsed={isMobile ? () => setMobileNav(false) : () => setCollapsed((c) => !c)}
        onSelect={(p, pr, src) => {
          openDetail(p, pr, src);
          if (isMobile) setMobileNav(false);
        }}
        onSelectProject={(p) => {
          setSelectedProject(p);
          setView("services");
          if (isMobile) setMobileNav(false);
        }}
        onNavigate={(v) => {
          setView(v);
          if (v !== "services") setSelectedProject(null);
          if (isMobile) setMobileNav(false);
        }}
        onOpenAddProject={() => {
          setRegisterKind("project");
          setShowRegister(true);
          if (isMobile) setMobileNav(false);
        }}
        onManageProject={(p) => setManageProject(p)}
        onAddServiceToProject={(p) => {
          setSelectedProject(p);
          setRegisterKind("service");
          setShowRegister(true);
        }}
      />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        {isMobile && (
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg1)] px-3 py-1.5">
            <button
              type="button"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[var(--mut)] transition-colors hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
              onClick={() => setMobileNav(true)}
              title={t("打开导航")}
            >
              <Icon name="menu" size={16} />
            </button>
            <Logo size={22} />
            <span className="text-sm font-semibold tracking-tight">LifeCycle</span>
            <span
              className={`dot ml-auto flex-none ${online ? "dot-running" : "dot-crashed"}`}
              title={online ? t("后端服务在线（端口 39517）") : t("后端服务离线")}
            />
          </div>
        )}
        {view === "services" ? (
          <ServicesView
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
            onOpenAdd={() => {
              setRegisterKind("service");
              setShowRegister(true);
            }}
            onManageProject={(p) => setManageProject(p)}
            onOpen={openDetail}
          />
        ) : view === "groups" ? (
          <GroupsView projects={projects} onOpen={openDetail} />
        ) : view === "mcp" ? (
          <McpView />
        ) : view === "settings" ? (
          <SettingsPanel />
        ) : current ? (
          <>
            <div className="border-b border-[var(--line)] bg-[var(--bg1)] p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-start xl:justify-between">
                <StatusCard status={current} project={sel.project} onRefresh={refresh} onSelect={openDetail} />

                {/* 运行与编译操作区分开展示 */}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg2)]/60 px-2 py-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)] mr-1">
                      {t("运行")}
                    </span>
                    <button
                      className="btn btn-success btn-sm"
                      disabled={running || isBusy}
                      onClick={start}
                      title={t("启动服务并等待就绪检查")}
                    >
                      <Icon name="play" size={12} />
                      {t("启动")}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={running || isBusy}
                      onClick={startFast}
                      title={t("跳过等待就绪，直接拉起")}
                    >
                      <Icon name="zap" size={12} />
                      {t("快速")}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={!running || isBusy}
                      onClick={stop}
                      title={t("停止服务")}
                    >
                      <Icon name="stop" size={12} />
                      {t("停止")}
                    </button>
                    <button
                      className="btn btn-warn btn-sm"
                      disabled={isBusy}
                      onClick={restart}
                      title={t("重启服务")}
                    >
                      <Icon name="restart" size={12} />
                      {t("重启")}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg2)]/60 px-2 py-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)] mr-1">
                      {t("编译")}
                    </span>
                    {compiling ? (
                      <button className="btn btn-danger btn-sm" onClick={cancelCompile}>
                        <span className="spinner" />
                        {t("取消编译…")}
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={isBusy}
                          onClick={compileQuick}
                          title={t("增量快速编译")}
                        >
                          <Icon name="compile" size={12} />
                          {t("快速编译")}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={isBusy}
                          onClick={() => setShowPartial(true)}
                          title={t("指定模块部分编译")}
                        >
                          <Icon name="grid" size={12} />
                          {t("部分")}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={isBusy}
                          onClick={compileFull}
                          title={t("全量完整编译")}
                        >
                          <Icon name="boxes" size={12} />
                          {t("全量")}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg2)]/60 px-2 py-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)] mr-1">
                      {t("产物")}
                    </span>
                    {packaging ? (
                      <button className="btn btn-danger btn-sm" onClick={cancelCompile} title={t("取消正在进行的打包")}>
                        <span className="spinner" />
                        {t("取消打包…")}
                      </button>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isBusy || !current?.compile_package}
                        onClick={compilePackage}
                        title={
                          current?.compile_package
                            ? t("打包产物（app/bundle/dist，按 compile.package 配置）")
                            : t("未配置打包命令（compile.package）")
                        }
                      >
                        <Icon name="pkg" size={12} />
                        {t("打包")}
                      </button>
                    )}
                  </div>
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
              {TABS.map(([id, label, icon]) => (
                <button
                  key={id}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                    tab === id
                      ? "border-b-2 border-[var(--blu)] font-medium text-[var(--blu)]"
                      : "text-[var(--mut)] hover:text-[var(--txt)]"
                  }`}
                  onClick={() => setTab(id)}
                >
                  <Icon name={icon} size={13} />
                  {t(label)}
                  {id === "errors" && currentErrors ? ` (${currentErrors.errors.length})` : ""}
                </button>
              ))}
              <span className="flex-1" />
              <button className="btn btn-ghost btn-sm" title={t("重新读取 lifecycle.toml，无需重启")} onClick={reload}>
                <Icon name="refresh" size={12} />
                {t("重载配置")}
              </button>
            </div>

            <div className="min-h-0 flex-1" key={key}>
              {tab === "logs" ? (
                <LogPanel
                  project={sel.project}
                  profile={sel.profile}
                  maxLines={settings.log_lines ?? 5000}
                  initialSource={logSource}
                />
              ) : tab === "errors" ? (
                <ErrorsPanel result={currentErrors} />
              ) : (
                <ConfigPanel project={sel.project} profile={sel.profile} current={current} onRefresh={refresh} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--dim)]">
            {message ? (
              <>
                <Icon name="warn" size={28} className="text-[var(--red)]" />
                <div className="text-sm">{t("无法连接后端：{msg}", { msg: message })}</div>
                <p className="max-w-md text-center text-xs leading-5">
                  {t("请确认 LifeCycle 后端已启动（默认端口 39517），或运行 {cmd}。", { cmd: "cargo run -p lifecycle-http" })}
                </p>
              </>
            ) : (
              <>
                <span className="spinner !h-5 !w-5 text-[var(--blu)]" />
                <div className="text-sm">{t("加载中…")}</div>
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
      {showRegister && (
        <RegisterModal
          kind={registerKind}
          projects={projects}
          defaultProject={selectedProject || sel.project}
          onClose={() => setShowRegister(false)}
          onSaved={async (newProject, newProfile) => {
            setShowRegister(false);
            const data = await refresh();
            if (newProject) {
              setSelectedProject(newProject);
              setView("services");
            }
            if (newProject && newProfile) openDetail(newProject, newProfile);
          }}
        />
      )}
      {manageProject && (
        <ProjectManageModal
          project={manageProject}
          projects={projects}
          onClose={() => setManageProject(null)}
          onRenamed={(newName) => {
            if (selectedProject === manageProject) setSelectedProject(newName);
            if (sel.project === manageProject) setSel((s) => ({ ...s, project: newName }));
            setManageProject(newName);
            refresh();
          }}
          onRemoved={(removedName) => {
            if (selectedProject === removedName) setSelectedProject(null);
            if (sel.project === removedName) setSel({ project: null, profile: null });
            setManageProject(null);
            refresh();
          }}
          onAddService={() => {
            setSelectedProject(manageProject);
            setRegisterKind("service");
            setShowRegister(true);
          }}
          onRefresh={refresh}
        />
      )}
      <ToastHost />
    </div>
  );
}