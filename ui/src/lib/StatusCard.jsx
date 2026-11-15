import { useEffect, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { STATE_LABEL, uptime } from "./format.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";

const STATE_COLOR = {
  running: "var(--grn)",
  crashed: "var(--red)",
  starting: "var(--amb)",
  stopping: "var(--amb)",
  idle: "var(--mut)",
};

export default function StatusCard({ status, project, onRefresh, onSelect }) {
  const { t } = useI18n();
  const [, setNow] = useState(Date.now());
  const [renaming, setRenaming] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  useEffect(() => {
    const t2 = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t2);
  }, []);

  const currentServiceName = status.service || status.profile;

  async function handleSaveRename(e) {
    e?.preventDefault();
    const trimmed = newServiceName.trim();
    if (!trimmed || trimmed === currentServiceName || savingRename) return;
    setSavingRename(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/services/${encodeURIComponent(currentServiceName)}/rename`, {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      pushToast(t("服务名已修改为「{name}」", { name: trimmed }), { kind: "success" });
      setRenaming(false);
      if (onRefresh) await onRefresh();
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setSavingRename(false);
    }
  }

  const color = STATE_COLOR[status.state] ?? "var(--mut)";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-[var(--txt)]">
            {currentServiceName}
          </span>
          <button
            type="button"
            className="text-[var(--dim)] hover:text-[var(--blu)] p-1 rounded hover:bg-[var(--bg2)] transition-colors"
            title={t("修改服务名称")}
            onClick={() => {
              setNewServiceName(currentServiceName);
              setRenaming(true);
            }}
          >
            <Icon name="edit" size={12} />
          </button>
          <span className="rounded bg-[var(--bg3)] border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--mut)] mono font-medium">
            {status.env_name || status.profile}
          </span>
          <span className="text-xs text-[var(--dim)] mono">({project})</span>
        </div>
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

      {status.command && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <div className="mono truncate text-[var(--dim)] bg-[var(--bg2)]/60 border border-[var(--line)] rounded px-2 py-0.5 max-w-xl">
            $ {status.command}
          </div>
        </div>
      )}

      {/* 修改服务名称弹窗 */}
      {renaming && (
        <Modal
          title={t("修改服务名称")}
          icon="edit"
          tone="blu"
          width={400}
          onClose={() => setRenaming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRenaming(false)}>
                {t("取消")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingRename || !newServiceName.trim() || newServiceName.trim() === currentServiceName}
                onClick={handleSaveRename}
              >
                {savingRename ? <span className="spinner" /> : <Icon name="save" size={12} />}
                {t("保存服务名")}
              </button>
            </>
          }
        >
          <label className="block">
            <span className="field-label">{t("服务名称")}</span>
            <input
              className="input mono w-full"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
              placeholder={t("输入新的服务名称")}
              autoFocus
            />
          </label>
          <p className="mt-2 text-xs text-[var(--dim)] leading-5">
            {t("重命名将同步更新 lifecycle.toml 中该服务在全部环境（dev/test/prod）下的配置。")}
          </p>
        </Modal>
      )}
    </div>
  );
}