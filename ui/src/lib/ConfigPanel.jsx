import { useEffect, useState } from "react";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import { copyText } from "./clipboard.js";
import { pushToast } from "./toast.js";

export default function ConfigPanel({ project, profile, current, onRefresh }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);

  // 可视化命令表单状态
  const [serviceName, setServiceName] = useState("");
  const [form, setForm] = useState({
    start_command: "",
    fast_start_command: "",
    stop_command: "",
    restart_command: "",
    compile_quick: "",
    compile_partial: "",
    compile_full: "",
    workdir: "",
    ready_port: "",
  });
  const [savingForm, setSavingForm] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (current) {
      setServiceName(current.service || current.profile || "");
      setForm({
        start_command: current.command || "",
        fast_start_command: current.fast_start_command || "",
        stop_command: current.stop_command || "",
        restart_command: current.restart_command || "",
        compile_quick: current.compile_quick || "",
        compile_partial: current.compile_partial || "",
        compile_full: current.compile_full || "",
        workdir: current.workdir || "",
        ready_port: current.port ? String(current.port) : "",
      });
    }
  }, [current]);

  async function loadConfig() {
    try {
      const c = await api(`/api/projects/${encodeURIComponent(project)}/config`);
      setCfg(c);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    loadConfig();
  }, [project]);

  async function handleSaveForm(e) {
    e?.preventDefault();
    if (!form.start_command.trim() || savingForm) return;
    setSavingForm(true);
    try {
      // 1. 如果修改了服务名称，先重命名服务
      const origService = current?.service || current?.profile;
      const trimmedService = serviceName.trim();
      if (trimmedService && origService && trimmedService !== origService) {
        await api(`/api/projects/${encodeURIComponent(project)}/services/${encodeURIComponent(origService)}/rename`, {
          method: "POST",
          body: JSON.stringify({ name: trimmedService }),
        });
      }

      // 2. 更新命令配置
      const targetProfile = profile || current?.profile;
      if (targetProfile) {
        await api(`/api/projects/${encodeURIComponent(project)}/profiles/${encodeURIComponent(targetProfile)}`, {
          method: "PUT",
          body: JSON.stringify({
            start_command: form.start_command.trim(),
            fast_start_command: form.fast_start_command.trim() || undefined,
            stop_command: form.stop_command.trim() || undefined,
            restart_command: form.restart_command.trim() || undefined,
            compile_quick: form.compile_quick.trim() || undefined,
            compile_partial: form.compile_partial.trim() || undefined,
            compile_full: form.compile_full.trim() || undefined,
            workdir: form.workdir.trim() || undefined,
            ready_port: form.ready_port ? Number(form.ready_port) : undefined,
          }),
        });
      }

      pushToast(t("服务配置已保存并立即生效"), { kind: "success" });
      await loadConfig();
      if (onRefresh) await onRefresh();
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setSavingForm(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg0)] p-4 space-y-4">
      {/* 结构化服务与命令编辑面板 */}
      {current && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg1)] p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--txt)] flex items-center gap-1.5">
                <Icon name="settings" size={15} className="text-[var(--blu)]" />
                {t("服务与命令配置")} · <span className="mono text-[var(--blu)]">{current.service || current.profile}</span>
                <span className="ml-2 rounded bg-[var(--bg3)] border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--mut)] mono font-medium">
                  {current.env_name || current.profile}
                </span>
              </h3>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {t("在此直接修改运行命令、编译命令与端口，保存后即时写入配置文件并热生效。")}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              disabled={savingForm || !form.start_command.trim()}
              onClick={handleSaveForm}
            >
              {savingForm ? <span className="spinner" /> : <Icon name="save" size={12} />}
              {t("保存配置")}
            </button>
          </div>

          <form onSubmit={handleSaveForm} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="block">
              <span className="field-label flex items-center gap-1">
                <Icon name="edit" size={11} className="text-[var(--blu)]" />
                {t("服务名称")}
              </span>
              <input
                className="input mono w-full"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder={t("例如 web / desktop / api")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1">
                <Icon name="tag" size={11} className="text-[var(--dim)]" />
                {t("当前环境 (Profile)")}
              </span>
              <input
                className="input mono w-full bg-[var(--bg2)] cursor-not-allowed text-[var(--mut)]"
                value={current.env_name || current.profile}
                disabled
                title={t("环境配置")}
              />
            </label>

            <label className="block md:col-span-2">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="play" size={12} className="text-[var(--grn)]" />
                {t("启动命令")} <span className="text-[var(--red)]">*</span>
              </span>
              <input
                className="input mono w-full"
                value={form.start_command}
                onChange={(e) => setForm({ ...form, start_command: e.target.value })}
                placeholder={t("例如 npm run dev / cargo run")}
                required
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="zap" size={12} className="text-[var(--yel)]" />
                {t("快速启动命令（可选，跳过就绪检查）")}
              </span>
              <input
                className="input mono w-full"
                value={form.fast_start_command}
                onChange={(e) => setForm({ ...form, fast_start_command: e.target.value })}
                placeholder={t("如为空则使用默认启动命令且跳过等待就绪")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="stop" size={12} className="text-[var(--red)]" />
                {t("停止命令（可选自定义优雅停止）")}
              </span>
              <input
                className="input mono w-full"
                value={form.stop_command}
                onChange={(e) => setForm({ ...form, stop_command: e.target.value })}
                placeholder={t("如为空则默认发送 SIGTERM 终止进程组")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="restart" size={12} className="text-[var(--yel)]" />
                {t("重启命令（可选自定义重启）")}
              </span>
              <input
                className="input mono w-full"
                value={form.restart_command}
                onChange={(e) => setForm({ ...form, restart_command: e.target.value })}
                placeholder={t("如为空则执行先停止后启动")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="compile" size={12} className="text-[var(--blu)]" />
                {t("快速编译命令（增量）")}
              </span>
              <input
                className="input mono w-full"
                value={form.compile_quick}
                onChange={(e) => setForm({ ...form, compile_quick: e.target.value })}
                placeholder={t("例如 npm run build:check / cargo check")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="grid" size={12} className="text-[var(--cyan)]" />
                {t("部分编译命令（可选，支持 {targets} 占位）")}
              </span>
              <input
                className="input mono w-full"
                value={form.compile_partial}
                onChange={(e) => setForm({ ...form, compile_partial: e.target.value })}
                placeholder="例如 cargo check -p {targets}"
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="boxes" size={12} className="text-[var(--pur)]" />
                {t("全量编译命令（清理与完整构建）")}
              </span>
              <input
                className="input mono w-full"
                value={form.compile_full}
                onChange={(e) => setForm({ ...form, compile_full: e.target.value })}
                placeholder={t("例如 npm run build / cargo build")}
              />
            </label>

            <label className="block">
              <span className="field-label">{t("工作目录（相对项目根）")}</span>
              <input
                className="input mono w-full"
                value={form.workdir}
                onChange={(e) => setForm({ ...form, workdir: e.target.value })}
                placeholder="."
              />
            </label>

            <label className="block">
              <span className="field-label">{t("就绪端口（可选）")}</span>
              <input
                className="input mono w-full"
                type="number"
                value={form.ready_port}
                onChange={(e) => setForm({ ...form, ready_port: e.target.value })}
                placeholder="5173 / 8080"
              />
            </label>
          </form>
        </div>
      )}

      {/* 原生 TOML 配置文件折叠/预览 */}
      {cfg ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg1)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--line)] mb-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="config" size={14} className="text-[var(--blu)] flex-none" />
              <span className="font-semibold text-[var(--txt)] flex-none">{t("配置文件原文 (TOML)")}</span>
              <span className="mono text-[11px] text-[var(--dim)] truncate select-all">{cfg.path}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-none">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  api("/api/open-editor", { method: "POST", body: JSON.stringify({ file: cfg.path, line: 1 }) }).catch(() => {})
                }
                title={t("在本地代码编辑器中打开")}
              >
                <Icon name="open" size={12} />
                {t("在编辑器中打开")}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (await copyText(cfg.content)) pushToast(t("配置已复制"), { kind: "success", duration: 2500 });
                }}
                title={t("复制配置文件内容")}
              >
                <Icon name="copy" size={12} />
                {t("复制")}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setShowRaw((v) => !v)}
              >
                <Icon name={showRaw ? "down" : "right"} size={12} />
                {showRaw ? t("折叠原文") : t("展开原文")}
              </button>
            </div>
          </div>

          {showRaw && (
            <pre className="well mono overflow-x-auto p-3 text-xs leading-5 text-[var(--log-info)] rounded-lg border border-[var(--line)]">
              {cfg.content}
            </pre>
          )}
        </div>
      ) : err ? (
        <div className="text-sm text-[var(--red)] p-4 bg-[var(--red-soft)] border border-[var(--red)] rounded-lg">
          {err}
        </div>
      ) : (
        <div className="text-sm text-[var(--dim)]">{t("加载中…")}</div>
      )}
    </div>
  );
}