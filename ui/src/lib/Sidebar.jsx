import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import Segmented from "./Segmented.jsx";
import { persistTheme, setTheme, useTheme } from "./theme.js";
import { persistLang, useI18n } from "./i18n.js";
import { STATE_LABEL } from "./format.js";

const NAV = [
  { id: "services", label: "全部服务", icon: "list", tone: "blu" },
  { id: "groups", label: "服务分组", icon: "group", tone: "vio" },
  { id: "mcp", label: "MCP 配置", icon: "plug", tone: "cyn" },
];

const GLOBAL_NAV = [
  { id: "settings", label: "全局设置", icon: "settings", tone: "amb" },
  { id: "diagnostics", label: "诊断", icon: "diag", tone: "grn" },
];

function NavButton({ n, active, onNavigate, t }) {
  return (
    <button
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors"
      style={
        active
          ? { background: `color-mix(in oklab, var(--${n.tone}) 14%, transparent)`, color: `var(--${n.tone})`, fontWeight: 600 }
          : { color: "var(--mut)" }
      }
      onClick={() => onNavigate(n.id)}
    >
      <Icon name={n.icon} size={15} />
      {t(n.label)}
      {active && <Icon name="right" size={13} className="ml-auto opacity-60" />}
    </button>
  );
}

export default function Sidebar({
  projects,
  sel,
  view,
  selectedProject,
  onSelect,
  onSelectProject,
  onNavigate,
  onOpenAddProject,
  online,
}) {
  const { t, lang, setLang } = useI18n();
  const [search, setSearch] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState(new Set());
  const { mode } = useTheme();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        profiles: p.profiles.filter(
          (s) => !q || `${p.project}/${s.profile}`.toLowerCase().includes(q)
        ),
      }))
      .filter((p) => p.profiles.length);
  }, [projects, search]);

  const running = useMemo(
    () => projects.reduce((n, p) => n + p.profiles.filter((s) => s.state === "running").length, 0),
    [projects]
  );
  const total = useMemo(() => projects.reduce((n, p) => n + p.profiles.length, 0), [projects]);

  function toggleCollapse(projectName, e) {
    e?.stopPropagation();
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  }

  function toggleExpandAll() {
    if (collapsedProjects.size === 0) {
      setCollapsedProjects(new Set(projects.map((p) => p.project)));
    } else {
      setCollapsedProjects(new Set());
    }
  }

  function handleProjectClick(projectName) {
    if (onSelectProject) {
      onSelectProject(projectName);
    }
    if (collapsedProjects.has(projectName)) {
      setCollapsedProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectName);
        return next;
      });
    }
  }

  function changeTheme(v) {
    setTheme(v);
    persistTheme().catch(() => {});
  }

  function changeLang(v) {
    setLang(v);
    persistLang().catch(() => {});
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg1)]">
      <div className="border-b border-[var(--line)] p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--acc-grn),var(--acc-blu))] text-sm font-bold text-white shadow-[var(--shadow-sm)]">
            L
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold leading-tight tracking-tight">LifeCycle</span>
              <span
                className="flex items-center gap-1.5 text-[11px] text-[var(--dim)]"
                title={online ? t("后端服务在线（端口 39517）") : t("后端服务离线")}
              >
                <span className={`dot ${online ? "dot-running" : "dot-crashed"}`} />
                {online ? t("在线") : t("离线")}
              </span>
            </div>
            <div className="mono text-[11px] text-[var(--dim)]">
              {t("{running}/{total} 服务运行中", { running, total })}
            </div>
          </div>
        </div>

        <nav className="mt-2.5 flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavButton
              key={n.id}
              n={n}
              t={t}
              active={view === n.id && (!selectedProject || n.id !== "services")}
              onNavigate={(id) => {
                if (id === "services" && onSelectProject) onSelectProject(null);
                onNavigate(id);
              }}
            />
          ))}
          <div className="mt-1.5 flex items-center gap-2 px-2.5 pb-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">{t("全局")}</span>
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          {GLOBAL_NAV.map((n) => (
            <NavButton key={n.id} n={n} t={t} active={view === n.id} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="relative mt-2">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            className="input w-full pl-8 text-xs"
            placeholder={t("搜索项目或服务…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2 bg-[var(--bg1)]">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold tracking-tight text-[var(--txt)]">Projects</span>
          <span className="rounded-full bg-[var(--bg2)] px-1.5 py-0.5 text-[10px] font-semibold mono text-[var(--dim)]">
            {projects.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-[var(--dim)] hover:bg-[var(--bg2)] hover:text-[var(--txt)] transition-colors"
            title={collapsedProjects.size === 0 ? t("折叠全部项目") : t("展开全部项目")}
            onClick={toggleExpandAll}
          >
            <Icon name={collapsedProjects.size === 0 ? "filter" : "down"} size={13} />
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded bg-[var(--blu-soft)] px-1.5 py-1 text-xs font-medium text-[var(--blu)] hover:bg-[var(--blu)] hover:text-white transition-colors"
            title={t("添加/导入项目（快捷键 n，可直接选择文件夹）")}
            onClick={onOpenAddProject}
          >
            <Icon name="folderPlus" size={13} />
            <span className="text-[11px]">{t("添加")}</span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.map((p) => {
          const isCollapsed = collapsedProjects.has(p.project) && !search.trim();
          const isProjectActive = view === "services" && selectedProject === p.project;
          const projectRunning = p.profiles.filter((s) => s.state === "running").length;

          return (
            <div key={p.project} className="rounded-lg">
              <div
                className={`group flex items-center justify-between rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                  isProjectActive
                    ? "bg-[var(--blu-soft)] text-[var(--blu)] font-medium"
                    : "text-[var(--txt)] hover:bg-[var(--bg2)]"
                }`}
                onClick={() => handleProjectClick(p.project)}
                title={t("点击查看「{name}」的服务列表", { name: p.project })}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon
                    name="folder"
                    size={14}
                    className={isProjectActive ? "text-[var(--blu)]" : "text-[var(--amb)]"}
                  />
                  <span className="truncate text-xs font-semibold">{p.project}</span>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  {projectRunning > 0 ? (
                    <span className="mono rounded-full bg-[var(--grn-soft)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--grn)]">
                      {t("{n} 运行", { n: projectRunning })}
                    </span>
                  ) : (
                    <span className="mono text-[10px] text-[var(--dim)]">
                      {t("{n} 服务", { n: p.profiles.length })}
                    </span>
                  )}
                  <button
                    type="button"
                    className="p-0.5 text-[var(--dim)] hover:text-[var(--txt)]"
                    onClick={(e) => toggleCollapse(p.project, e)}
                    title={isCollapsed ? t("展开服务列表") : t("折叠服务列表")}
                  >
                    <Icon name={isCollapsed ? "right" : "down"} size={11} />
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--line2)] pl-2">
                  {p.profiles.map((s) => {
                    const active = view === "detail" && sel.project === p.project && sel.profile === s.profile;
                    return (
                      <button
                        key={s.profile}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                          active
                            ? "bg-[var(--bg3)] text-[var(--blu)] font-medium"
                            : "text-[var(--mut)] hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
                        }`}
                        onClick={() => onSelect(p.project, s.profile)}
                        title={t("进入 {key} 详情与日志", { key: `${p.project}/${s.profile}` })}
                      >
                        <span className={`dot dot-${s.state}`} />
                        <span className="mono flex-1 truncate">{s.profile}</span>
                        <span className="text-[10px] text-[var(--dim)]">
                          {t(STATE_LABEL[s.state] ?? s.state)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--dim)]">
            {search.trim() ? t("没有匹配的项目或服务") : t("暂无项目，点击右上角「+ 添加」注册工程")}
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-[var(--line)] p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{t("语言")}</span>
        </div>
        <Segmented
          className="w-full [&>.seg-item]:flex-1"
          value={lang}
          onChange={changeLang}
          options={[
            { value: "zh", label: "中文", title: "简体中文" },
            { value: "en", label: "EN", title: "English" },
          ]}
        />
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{t("外观主题")}</span>
        </div>
        <Segmented
          className="w-full [&>.seg-item]:flex-1"
          value={mode}
          onChange={changeTheme}
          options={[
            { value: "light", label: t("亮色"), icon: "sun", title: t("亮色主题") },
            { value: "dark", label: t("暗色"), icon: "moon", title: t("暗色主题") },
            { value: "system", label: t("跟随系统"), icon: "monitor", title: t("跟随系统") },
          ]}
        />
      </div>
    </aside>
  );
}