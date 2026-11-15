import { dismiss, useToasts } from "./toast.js";
import Icon from "./Icon.jsx";

export default function ToastHost() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast pointer-events-auto ${t.kind === "error" ? "toast-error" : t.kind === "success" ? "toast-success" : ""}`}
          role="status"
        >
          <Icon
            name={t.kind === "error" ? "warn" : t.kind === "success" ? "check" : "info"}
            size={14}
            className={t.kind === "error" ? "text-[var(--red)]" : t.kind === "success" ? "text-[var(--grn)]" : "text-[var(--blu)]"}
          />
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              className="btn btn-sm"
              onClick={() => {
                t.action.fn();
                dismiss(t.id);
              }}
            >
              <Icon name="undo" size={12} />
              {t.action.label}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => dismiss(t.id)} aria-label="关闭">
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}