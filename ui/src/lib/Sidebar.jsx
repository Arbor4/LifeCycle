import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import Segmented from "./Segmented.jsx";
import { persistTheme, setTheme, useTheme } from "./theme.js";
import { STATE_LABEL } from "./format.js";

const NAV = [
  { id: "services", label: "服务列表", icon: "list", tone: "blu" },
  { id: "groups", label: "服务分组", icon: "group", tone: "vio" },
  { id: "mcp", label: "MCP 配置", icon: "plug", tone: "cyn" },
];

const GLOBAL_NAV = [
  { id: "settings", label: "全局设置", icon: "settings", tone: "amb" },
  { id: "diagnostics", label: "诊断", icon: "diag", tone: "grn" },
];

function NavButton({ n, active, onNavigate }) {
  return (
    <button
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors"
      style={
        active
          ? { background: `color-mix(in oklab, var(--${n.tone}) 14%, transparent)`, color: `var(--${n.tone})`, fontWeight: 600 }
          : { color: "var(--mut)" }
      }
      onClick={() => onNavigate(n.id)}
    >
      <Icon name={n.icon} size={15} />
      {n.label}
      {active && <Icon name="right" size={13} className="ml-auto opacity-60" />}
    </button>
  );
}

export default function Sidebar({ projects, sel, view, onSelect, onNavigate, online }) {
  const [search, setSearch] = useState("");
  const { mode } = useTheme();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        profiles: p.profiles.filter((s) => !q || `${p.project}/${s.profile}`.toLowerCase().includes(q)),
      }))
      .filter((p) => p.profiles.length);
  }, [projects, search]);

  const running = useMemo(
    () => projects.reduce((n, p) => n + p.profiles.filter((s) => s.state === "running").length, 0),
    [projects]
  );
  const total = useMemo(() => projects.reduce((n, p) => n + p.profiles.length, 0), [projects]);

  function changeTheme(v) {
    setTheme(v);
    persistTheme().catch(() => {});
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg1)]">
      <div className="border-b border-[var(--line)] p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--acc-grn),var(--acc-blu))] text-sm font-bold text-white shadow-[var(--shadow-sm)]">
            L
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold leading-tight tracking-tight">LifeCycle</div>
            <div className="mono text-[11px] text-[var(--dim)]">
              {running}/{total} 运行中
            </div>
          </div>
        </div>

        <nav className="mt-3 flex flex-col gap-1">
          {NAV.map((n) => (
            <NavButton key={n.id} n={n} active={view === n.id || (n.id === "services" && view === "detail")} onNavigate={onNavigate} />
          ))}
          <div className="mt-2 flex items-center gap-2 px-2.5 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">全局</span>
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          {GLOBAL_NAV.map((n) => (
            <NavButton key={n.id} n={n} active={view === n.id} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="relative mt-2">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            className="input w-full pl-8"
            placeholder="搜索项目/profile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.map((p) => (
          <div key={p.project}>
            <div className="mt-2 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">
              <Icon name="folder" size={11} />
              <span className="truncate">{p.project}</span>
            </div>
            {p.profiles.map((s) => {
              const active = view === "detail" && sel.project === p.project && sel.profile === s.profile;
              return (
                <button
                  key={s.profile}
                  className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    active ? "bg-[var(--bg3)] text-[var(--blu)]" : "text-[var(--mut)] hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
                  }`}
                  onClick={() => onSelect(p.project, s.profile)}
                >
                  <span className={`dot dot-${s.state}`} />
                  <span className="mono flex-1 truncate">{s.profile}</span>
                  <span className="text-[11px] text-[var(--dim)]">{STATE_LABEL[s.state] ?? s.state}</span>
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--dim)]">没有匹配的项目。</div>
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--line)] p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">主题</span>
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--dim)]" title={online ? "后端已连接" : "后端未连接"}>
            <span className={`dot ${online ? "dot-running" : "dot-crashed"}`} />
            {online ? "在线" : "离线"}
          </span>
        </div>
        <Segmented
          className="w-full [&>.seg-item]:flex-1"
          value={mode}
          onChange={changeTheme}
          options={[
            { value: "light", label: "亮", icon: "sun", title: "亮色主题" },
            { value: "dark", label: "暗", icon: "moon", title: "暗色主题" },
            { value: "system", label: "自动", icon: "monitor", title: "跟随系统" },
          ]}
        />
      </div>
    </aside>
  );
}