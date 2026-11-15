import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";
import { persistTheme, setTheme, useTheme } from "./theme.js";
import { useI18n } from "./i18n.js";
import { STATE_LABEL, shortUptime } from "./format.js";

const NAV = [
  { id: "services", label: "服务列表", icon: "list", tone: "blu" },
  { id: "groups", label: "服务分组", icon: "group", tone: "vio" },
  { id: "mcp", label: "MCP 配置", icon: "plug", tone: "cyn" },
];

const THEME_ORDER = ["light", "dark", "system"];
const THEME_ICON = { light: "sun", dark: "moon", system: "monitor" };

export default function Sidebar({
  projects = [],
  sel,
  view,
  selectedProject,
  online,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onSelectProject,
  onNavigate,
  onOpenAddProject,
  onManageProject,
  onAddServiceToProject,
}) {
  const { t } = useI18n();
  const { mode } = useTheme();
  const [search, setSearch] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState(new Set());

  const running = useMemo(
    () => projects.reduce((n, p) => n + p.profiles.filter((s) => s.state === "running").length, 0),
    [projects]
  );
  const total = useMemo(() => projects.reduce((n, p) => n + p.profiles.length, 0), [projects]);

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

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
    setTheme(next);
    persistTheme().catch(() => {});
  }

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

  const iconBtn =
    "flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[var(--mut)] transition-colors hover:bg-[var(--bg2)] hover:text-[var(--txt)]";

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg1)] transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      {/* 顶部 Brand 栏 */}
      <div className={`flex items-center gap-2.5 border-b border-[var(--line)] p-3 ${collapsed ? "justify-center px-0" : ""}`}>
        <Logo size={collapsed ? 26 : 30} className="flex-none" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold leading-tight tracking-tight">LifeCycle</span>
              <span
                className={`dot flex-none ${online ? "dot-running" : "dot-crashed"}`}
                title={online ? t("后端服务在线（端口 39517）") : t("后端服务离线")}
              />
            </div>
            <div className="mono text-[11px] text-[var(--dim)]">
              {t("{running}/{total} 服务运行中", { running, total })}
            </div>
          </div>
        )}
        {collapsed && (
          <span
            className={`dot flex-none absolute top-2 right-2 ${online ? "dot-running" : "dot-crashed"}`}
            title={online ? t("后端已连接") : t("后端未连接")}
          />
        )}
      </div>

      {/* 顶部主导航 */}
      <nav className={`flex flex-col gap-1 p-2 ${collapsed ? "items-center" : ""}`}>
        {NAV.map((n) => {
          const active =
            view === n.id && (n.id !== "services" || !selectedProject);
          return (
            <button
              key={n.id}
              title={t(n.label)}
              className={
                collapsed
                  ? `${iconBtn} ${active ? "!text-[var(--blu)] bg-[var(--blu-soft)]" : ""}`
                  : "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors"
              }
              style={
                collapsed
                  ? undefined
                  : active
                    ? { background: `color-mix(in oklab, var(--${n.tone}) 14%, transparent)`, color: `var(--${n.tone})`, fontWeight: 600 }
                    : { color: "var(--mut)" }
              }
              onClick={() => {
                if (n.id === "services" && onSelectProject) onSelectProject(null);
                onNavigate(n.id);
              }}
            >
              <Icon name={n.icon} size={16} />
              {!collapsed && t(n.label)}
              {!collapsed && active && <Icon name="right" size={13} className="ml-auto opacity-60" />}
            </button>
          );
        })}
      </nav>

      {/* 展开状态下的搜索框与项目树 */}
      {!collapsed && (
        <>
          <div className="px-3 pb-2">
            <div className="relative">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
              <input
                className="input w-full pl-8! pr-7! text-xs"
                placeholder={t("搜索项目或服务…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--dim)] hover:text-[var(--txt)] p-0.5 rounded"
                  onClick={() => setSearch("")}
                  title={t("清空")}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Projects 列表顶栏：参考用户布局（Projects 标题 + 折叠切换 + 添加项目按钮） */}
          <div className="flex items-center justify-between border-y border-[var(--line)] px-3 py-1.5 bg-[var(--bg1)]">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-tight text-[var(--txt)]">Projects</span>
              <span className="rounded-full bg-[var(--bg2)] px-1.5 py-0.2 text-[10px] font-semibold mono text-[var(--dim)]">
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
                className="flex items-center gap-1 rounded bg-[var(--blu-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--blu)] hover:bg-[var(--blu)] hover:text-white transition-colors"
                title={t("添加项目（支持文件夹直接选择）")}
                onClick={onOpenAddProject}
              >
                <Icon name="folderPlus" size={13} />
                <span className="text-[11px]">{t("添加")}</span>
              </button>
            </div>
          </div>

          {/* 可滚动的项目与服务层级树 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.map((p) => {
              const isCollapsed = collapsedProjects.has(p.project) && !search.trim();
              const isProjectActive = view === "services" && selectedProject === p.project;
              const projectRunning = p.profiles.filter((s) => s.state === "running").length;

              return (
                <div key={p.project} className="rounded-lg">
                  {/* 项目文件夹栏：点击选择项目，展示该项目服务列表 */}
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
                    <div className="flex items-center gap-1 ml-2">
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
                        className="p-0.5 text-[var(--dim)] hover:text-[var(--blu)] rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onAddServiceToProject) onAddServiceToProject(p.project);
                        }}
                        title={t("为项目「{name}」添加服务/环境", { name: p.project })}
                      >
                        <Icon name="plus" size={11} />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 text-[var(--dim)] hover:text-[var(--txt)] rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onManageProject) onManageProject(p.project);
                        }}
                        title={t("项目信息、路径与管理")}
                      >
                        <Icon name="settings" size={11} />
                      </button>
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

                  {/* 展开时显示项目下的各服务/profile */}
                  {!isCollapsed && (
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--line2)] pl-2">
                      {p.profiles.map((s) => {
                        const active = view === "detail" && sel?.project === p.project && sel?.profile === s.profile;
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
                            <span className="mono text-[11px] text-[var(--dim)] flex-none">
                              {s.state === "running" && s.uptime_ms != null
                                ? shortUptime(s.uptime_ms) || "0s"
                                : t(STATE_LABEL[s.state] ?? s.state)}
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
        </>
      )}

      {/* 折叠模式下占位弹性空间 */}
      {collapsed && <div className="flex-1" />}

      {/* 底部操作区 */}
      <div className={`flex border-t border-[var(--line)] p-2 ${collapsed ? "flex-col items-center gap-1" : "items-center gap-1"}`}>
        <button
          className={
            collapsed
              ? iconBtn
              : `flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors ${
                  view === "settings"
                    ? "bg-[var(--blu-soft)] font-medium text-[var(--blu)]"
                    : "text-[var(--mut)] hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
                }`
          }
          title={t("全局设置")}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings" size={16} />
          {!collapsed && t("设置")}
        </button>
        <button
          className={iconBtn}
          title={t("切换主题（亮 → 暗 → 跟随系统）")}
          onClick={cycleTheme}
        >
          <Icon name={THEME_ICON[mode]} size={16} />
        </button>
        <button
          className={iconBtn}
          title={collapsed ? t("展开侧边栏") : t("收缩侧边栏")}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? "expand" : "collapse"} size={16} />
        </button>
      </div>
    </aside>
  );
}
