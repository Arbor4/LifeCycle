import { useEffect, useState } from "react";
import { STATE_LABEL, uptime } from "./format.js";
import Icon from "./Icon.jsx";

const STATE_COLOR = {
  running: "var(--grn)",
  crashed: "var(--red)",
  starting: "var(--amb)",
  stopping: "var(--amb)",
  idle: "var(--mut)",
};

export default function StatusCard({ status, project }) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const color = STATE_COLOR[status.state] ?? "var(--mut)";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mono text-lg font-semibold">
          {project}
          <span className="text-[var(--dim)]">/</span>
          {status.profile}
        </h1>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
          style={{ borderColor: "var(--line2)", background: "var(--bg2)", color }}
        >
          <span className={`dot dot-${status.state}`} />
          {STATE_LABEL[status.state] ?? status.state}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--mut)]">
        <span>
          PID <span className="mono text-[var(--txt)]">{status.pid ?? "—"}</span>
        </span>
        <span>
          运行时长 <span className="mono text-[var(--txt)]">{uptime(status.uptime_ms)}</span>
        </span>
        <span>
          端口 <span className="mono text-[var(--txt)]">{status.port ?? "—"}</span>
        </span>
        {status.last_build ? (
          <span className="inline-flex items-center gap-1.5">
            最近编译
            <span className="mono inline-flex items-center gap-1" style={{ color: status.last_build.success ? "var(--grn)" : "var(--red)" }}>
              <Icon name={status.last_build.success ? "check" : "x"} size={11} />
              {status.last_build.kind}
            </span>
            <span className="text-[var(--dim)]">
              {status.last_build.duration_ms}ms · {status.last_build.error_count} 错误
            </span>
          </span>
        ) : (
          <span>
            最近编译 <span className="text-[var(--dim)]">—</span>
          </span>
        )}
      </div>
      {status.command && <div className="mono mt-1 truncate text-xs text-[var(--dim)]">$ {status.command}</div>}
    </div>
  );
}