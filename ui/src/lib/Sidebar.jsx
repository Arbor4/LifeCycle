import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";
import { persistTheme, setTheme, useTheme } from "./theme.js";
import { useI18n } from "./i18n.js";

const NAV = [
  { id: "services", label: "服务列表", icon: "list", tone: "blu" },
  { id: "groups", label: "服务分组", icon: "group", tone: "vio" },
  { id: "mcp", label: "MCP 配置", icon: "plug", tone: "cyn" },
];

const THEME_ORDER = ["light", "dark", "system"];
const THEME_ICON = { light: "sun", dark: "moon", system: "monitor" };

export default function Sidebar({ projects, view, online, collapsed, onToggleCollapsed, onNavigate }) {
  const { t } = useI18n();
  const { mode } = useTheme();

  const running = projects.reduce((n, p) => n + p.profiles.filter((s) => s.state === "running").length, 0);
  const total = projects.reduce((n, p) => n + p.profiles.length, 0);

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
    setTheme(next);
    persistTheme().catch(() => {});
  }

  const iconBtn =
    "flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[var(--mut)] transition-colors hover:bg-[var(--bg2)] hover:text-[var(--txt)]";

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg1)] transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className={`flex items-center gap-2.5 border-b border-[var(--line)] p-3 ${collapsed ? "justify-center px-0" : ""}`}>
        <Logo size={collapsed ? 26 : 30} className="flex-none" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold leading-tight tracking-tight">LifeCycle</div>
            <div className="mono text-[11px] text-[var(--dim)]">
              {t("{running}/{total} 服务运行中", { running, total })}
            </div>
          </div>
        )}
        {!collapsed && (
          <span
            className={`dot flex-none ${online ? "dot-running" : "dot-crashed"}`}
            title={online ? t("后端已连接") : t("后端未连接")}
          />
        )}
      </div>

      <nav className={`flex flex-col gap-1 p-2 ${collapsed ? "items-center" : ""}`}>
        {NAV.map((n) => {
          const active = view === n.id || (n.id === "services" && view === "detail");
          return (
            <button
              key={n.id}
              title={t(n.label)}
              className={
                collapsed
                  ? `${iconBtn} ${active ? "!text-[var(--blu)] bg-[var(--blu-soft)]" : ""}`
                  : "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors"
              }
              style={
                collapsed
                  ? undefined
                  : active
                    ? { background: `color-mix(in oklab, var(--${n.tone}) 14%, transparent)`, color: `var(--${n.tone})`, fontWeight: 600 }
                    : { color: "var(--mut)" }
              }
              onClick={() => onNavigate(n.id)}
            >
              <Icon name={n.icon} size={16} />
              {!collapsed && t(n.label)}
              {!collapsed && active && <Icon name="right" size={13} className="ml-auto opacity-60" />}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className={`flex border-t border-[var(--line)] p-2 ${collapsed ? "flex-col items-center gap-1" : "items-center gap-1"}`}>
        <button
          className={collapsed ? iconBtn : `${iconBtn} !w-auto flex-1 gap-2 px-2.5 text-[13px]`}
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