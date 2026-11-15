import { useEffect, useState } from "react";
import { api } from "./api.js";
import Icon from "./Icon.jsx";
import { copyText } from "./clipboard.js";
import { pushToast } from "./toast.js";

export default function ConfigPanel({ project }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setCfg(null);
    setErr(null);
    api(`/api/projects/${encodeURIComponent(project)}/config`)
      .then((c) => alive && setCfg(c))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [project]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg0)] p-4">
      {cfg ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Icon name="config" size={15} className="text-[var(--blu)]" />
            <span className="mono text-xs text-[var(--mut)]">{cfg.path}</span>
            <button
              className="btn btn-sm"
              onClick={() =>
                api("/api/open-editor", { method: "POST", body: JSON.stringify({ file: cfg.path, line: 1 }) }).catch(() => {})
              }
            >
              <Icon name="open" size={12} />
              在编辑器中打开
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                if (await copyText(cfg.content)) pushToast("配置已复制", { kind: "success", duration: 2500 });
              }}
            >
              <Icon name="copy" size={12} />
              复制
            </button>
          </div>
          <p className="mb-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
            <Icon name="info" size={12} className="mt-0.5 flex-none" />
            <span>
              启动命令在 <span className="mono">[profiles.*.start]</span>，编译命令在{" "}
              <span className="mono">[profiles.*.compile.*]</span>，MCP 白名单在 <span className="mono">[mcp]</span>
              ；改完点上方「重载配置」即可生效，无需重启。
            </span>
          </p>
          <pre className="well mono overflow-x-auto p-3 text-xs leading-5 text-[var(--log-info)]">{cfg.content}</pre>
        </>
      ) : err ? (
        <div className="text-sm text-[var(--red)]">{err}</div>
      ) : (
        <div className="text-sm text-[var(--dim)]">加载中…</div>
      )}
    </div>
  );
}