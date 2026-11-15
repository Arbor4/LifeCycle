import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

export default function Modal({ title, subtitle, icon, tone = "blu", width = 520, onClose, children, footer }) {
  const panel = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 仅挂载时聚焦一次：onClose 多为内联箭头函数，若作为依赖会随父级每秒
  // 重渲染（SSE 状态推送）反复执行 focus()，抢走下拉框/输入框焦点
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    const body = panel.current?.querySelector("[data-modal-body]");
    const first = body?.querySelector("input,select,textarea") ?? panel.current?.querySelector("button");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const color = `var(--${tone})`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        className="panel view flex max-h-[90vh] w-full flex-col overflow-hidden"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4">
          {icon && (
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
              style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
            >
              <Icon name={icon} size={16} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-xs leading-5 text-[var(--mut)]">{subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-modal-body>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] bg-[var(--bg2)] p-3">{footer}</div>}
      </div>
    </div>
  );
}