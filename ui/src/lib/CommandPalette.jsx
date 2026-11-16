import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { useI18n } from "./i18n.js";

export default function CommandPalette({
  open,
  onClose,
  projects = [],
  currentProject,
  currentProfile,
  onSelectService,
  onNavigate,
  onStart,
  onStop,
  onRestart,
  onCompile,
  onToggleTheme,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 生成所有可执行动作和快速跳转项
  const items = useMemo(() => {
    const list = [];
    const q = query.trim().toLowerCase();

    // 1. 快速导航到项目下的各个服务
    for (const p of projects) {
      for (const s of p.profiles) {
        const svc = s.service || s.profile;
        const env = s.env_name || s.profile;
        const title = `${p.project} / ${svc} (${env})`;
        if (!q || title.toLowerCase().includes(q)) {
          list.push({
            id: `nav-${p.project}-${s.profile}`,
            kind: "service",
            title,
            subtitle: t("跳转至该服务详情与日志"),
            icon: "box",
            state: s.state,
            action: () => {
              onSelectService(p.project, s.profile);
              onClose();
            },
          });
        }
      }
    }

    // 2. 常用操作指令
    const commands = [
      {
        id: "cmd-restart",
        kind: "action",
        title: t("重启当前服务"),
        subtitle: currentProject && currentProfile ? `${currentProject} / ${currentProfile}` : "",
        icon: "restart",
        shortcut: "⌘ R",
        action: () => {
          if (onRestart) onRestart();
          onClose();
        },
      },
      {
        id: "cmd-compile",
        kind: "action",
        title: t("增量快速编译当前服务"),
        subtitle: currentProject && currentProfile ? `${currentProject} / ${currentProfile}` : "",
        icon: "compile",
        shortcut: "⌘ B",
        action: () => {
          if (onCompile) onCompile();
          onClose();
        },
      },
      {
        id: "cmd-start",
        kind: "action",
        title: t("启动当前服务"),
        subtitle: currentProject && currentProfile ? `${currentProject} / ${currentProfile}` : "",
        icon: "play",
        action: () => {
          if (onStart) onStart();
          onClose();
        },
      },
      {
        id: "cmd-stop",
        kind: "action",
        title: t("停止当前服务"),
        subtitle: currentProject && currentProfile ? `${currentProject} / ${currentProfile}` : "",
        icon: "stop",
        action: () => {
          if (onStop) onStop();
          onClose();
        },
      },
      {
        id: "nav-services-view",
        kind: "view",
        title: t("切换到服务总览列表"),
        icon: "list",
        action: () => {
          onNavigate("services");
          onClose();
        },
      },
      {
        id: "nav-groups-view",
        kind: "view",
        title: t("切换到服务分组"),
        icon: "group",
        action: () => {
          onNavigate("groups");
          onClose();
        },
      },
      {
        id: "nav-mcp-view",
        kind: "view",
        title: t("打开 MCP 配置与调用日志"),
        icon: "plug",
        action: () => {
          onNavigate("mcp");
          onClose();
        },
      },
      {
        id: "cmd-toggle-theme",
        kind: "tool",
        title: t("切换界面主题（亮色 / 暗色）"),
        icon: "sparkles",
        action: () => {
          if (onToggleTheme) onToggleTheme();
          onClose();
        },
      },
    ];

    for (const cmd of commands) {
      if (!q || cmd.title.toLowerCase().includes(q) || cmd.subtitle?.toLowerCase().includes(q)) {
        list.push(cmd);
      }
    }

    return list;
  }, [projects, query, currentProject, currentProfile, t, onSelectService, onClose, onRestart, onCompile, onStart, onStop, onNavigate, onToggleTheme]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (items[activeIndex]) {
        items[activeIndex].action();
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg1)] shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索框 */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <Icon name="search" size={18} className="text-[var(--dim)]" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-[var(--txt)] outline-none placeholder:text-[var(--dim)]"
            placeholder={t("输入指令、服务名、环境进行搜索或跳转… (↑↓ 移动，Enter 执行)")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="mono rounded border border-[var(--line)] bg-[var(--bg2)] px-1.5 py-0.5 text-[10px] text-[var(--dim)]">
            ESC
          </kbd>
        </div>

        {/* 结果列表 */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-0.5">
          {items.map((item, idx) => {
            const isSelected = idx === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                  isSelected ? "bg-[var(--blu-soft)] text-[var(--blu)]" : "text-[var(--txt)] hover:bg-[var(--bg2)]"
                }`}
                onClick={item.action}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.state ? (
                    <span className={`dot dot-${item.state} flex-none`} />
                  ) : (
                    <Icon name={item.icon || "command"} size={15} className={isSelected ? "text-[var(--blu)]" : "text-[var(--dim)]"} />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{item.title}</div>
                    {item.subtitle && (
                      <div className="truncate text-[10px] text-[var(--dim)]">{item.subtitle}</div>
                    )}
                  </div>
                </div>

                {item.shortcut && (
                  <kbd className="mono ml-2 flex-none rounded border border-[var(--line)] bg-[var(--bg2)] px-1.5 py-0.5 text-[10px] text-[var(--dim)]">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}

          {items.length === 0 && (
            <div className="p-6 text-center text-xs text-[var(--dim)]">
              {t("未找到匹配的命令或服务")}
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--bg2)]/40 px-4 py-2 text-[11px] text-[var(--dim)]">
          <span>{t("快捷键: ⌘K 命令面板 · ⌘R 重启 · ⌘B 编译 · ⌘L 清屏")}</span>
          <span className="mono">{items.length} {t("项")}</span>
        </div>
      </div>
    </div>
  );
}
