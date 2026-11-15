import { api } from "./api.js";
import Icon from "./Icon.jsx";

export default function ErrorsPanel({ result }) {
  function open(d) {
    api("/api/open-editor", {
      method: "POST",
      body: JSON.stringify({ file: d.file, line: d.line, col: d.col }),
    }).catch(() => {});
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg0)] p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg2)] text-[var(--dim)]">
          <Icon name="compile" size={26} />
        </span>
        <div className="text-sm text-[var(--mut)]">暂无编译结果</div>
        <p className="max-w-md text-xs leading-5 text-[var(--dim)]">
          点击「快速编译 / 部分编译 / 完整编译」后，结构化错误会显示在这里，点击任意一条可直接跳到编辑器对应行列。
        </p>
      </div>
    );
  }

  const diagnostics = [...result.errors, ...result.warnings];
  return (
    <div className="h-full overflow-y-auto bg-[var(--bg0)] p-4">
      <div
        className="mb-3 flex items-center gap-2 text-sm"
        style={{ color: result.success ? "var(--grn)" : "var(--red)" }}
      >
        <Icon name={result.cancelled ? "info" : result.success ? "check" : "warn"} size={15} />
        {result.cancelled ? "编译已取消" : result.success ? "编译成功" : "编译失败"} · {result.duration_ms}ms ·{" "}
        {result.errors.length} 错误 / {result.warnings.length} 警告
      </div>
      {diagnostics.map((d, i) => (
        <button
          key={`${d.file}:${d.line}:${d.col}:${i}`}
          className="panel mb-1.5 flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors hover:border-[var(--blu)]"
          onClick={() => open(d)}
          title="点击在编辑器中打开"
        >
          <span
            className="shrink-0 rounded px-1.5 text-xs"
            style={{
              background: d.level === "error" ? "var(--red-soft)" : "var(--amb-soft)",
              color: d.level === "error" ? "var(--log-error)" : "var(--amb)",
            }}
          >
            {d.level}
          </span>
          <span className="mono shrink-0 text-xs text-[var(--blu)]">
            {d.file}:{d.line}:{d.col}
          </span>
          <span className="truncate text-[var(--mut)]">{d.message}</span>
          <Icon name="open" size={12} className="ml-auto shrink-0 text-[var(--dim)]" />
        </button>
      ))}
      {result.raw && (
        <pre className="well mono mt-3 overflow-x-auto p-3 text-xs leading-5 text-[var(--mut)]">{result.raw}</pre>
      )}
    </div>
  );
}