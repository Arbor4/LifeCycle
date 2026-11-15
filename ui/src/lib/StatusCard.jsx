import { useEffect, useState } from "react";
import { STATE_LABEL, uptime } from "./format.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";

const STATE_COLOR = {
  running: "var(--grn)",
  crashed: "var(--red)",
  starting: "var(--amb)",
  stopping: "var(--amb)",
  idle: "var(--mut)",
};

export default function StatusCard({ status, project }) {
  const { t } = useI18n();
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t2 = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t2);
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
          {t(STATE_LABEL[status.state] ?? status.state)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--mut)]">
        <span>
          PID <span className="mono text-[var(--txt)]">{status.pid ?? "—"}</span>
        </span>
        <span>
          {t("运行时长")} <span className="mono text-[var(--txt)]">{uptime(status.uptime_ms)}</span>
        </span>
        <span>
          {t("端口")}{" "}
          {status.port ? (
            status.state === "running" ? (
              <a
                href={`http://localhost:${status.port}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[var(--blu)] hover:underline inline-flex items-center gap-1 font-semibold"
                title={t("在浏览器中打开 http://localhost:{port}", { port: status.port })}
              >
                {status.port}
                <Icon name="open" size={11} />
              </a>
            ) : (
              <span className="mono text-[var(--txt)]">{status.port}</span>
            )
          ) : (
            <span className="mono text-[var(--txt)]">—</span>
          )}
        </span>
        {status.last_build ? (
          <span className="inline-flex items-center gap-1.5">
            {t("最近编译")}
            <span className="mono inline-flex items-center gap-1" style={{ color: status.last_build.success ? "var(--grn)" : "var(--red)" }}>
              <Icon name={status.last_build.success ? "check" : "x"} size={11} />
              {status.last_build.kind}
            </span>
            <span className="text-[var(--dim)]">
              {t("{ms}ms · {n} 错误", { ms: status.last_build.duration_ms, n: status.last_build.error_count })}
            </span>
          </span>
        ) : (
          <span>
            {t("最近编译")} <span className="text-[var(--dim)]">—</span>
          </span>
        )}
      </div>
      {status.command && <div className="mono mt-1 truncate text-xs text-[var(--dim)]">$ {status.command}</div>}
    </div>
  );
}