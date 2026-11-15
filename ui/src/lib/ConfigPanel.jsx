import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import { copyText } from "./clipboard.js";
import { pushToast } from "./toast.js";

const FORM_KEYS = [
  "env_name",
  "start_command",
  "fast_start_command",
  "stop_command",
  "restart_command",
  "compile_quick",
  "compile_partial",
  "compile_full",
  "compile_package",
  "workdir",
  "ready_port",
];

function seedForm(c) {
  return {
    env_name: c?.env_name || "",
    start_command: c?.command || "",
    fast_start_command: c?.fast_start_command || "",
    stop_command: c?.stop_command || "",
    restart_command: c?.restart_command || "",
    compile_quick: c?.compile_quick || "",
    compile_partial: c?.compile_partial || "",
    compile_full: c?.compile_full || "",
    compile_package: c?.compile_package || "",
    workdir: c?.workdir || "",
    ready_port: c?.port ? String(c.port) : "",
  };
}

function configSig(c) {
  return JSON.stringify([
    c?.service,
    ...FORM_KEYS.map((k) => (k === "ready_port" ? c?.port : c?.[k === "start_command" ? "command" : k])),
  ]);
}

export default function ConfigPanel({ project, profile, current, onRefresh }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);

  const [serviceName, setServiceName] = useState("");
  const [form, setForm] = useState(seedForm(null));
  const [savingForm, setSavingForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawEdit, setRawEdit] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [rawSaving, setRawSaving] = useState(false);
  const [rawErr, setRawErr] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const dirtyRef = useRef(false);

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    markDirty();
  }

  function applySeed(c) {
    setServiceName(c?.service || c?.profile || "");
    setForm(seedForm(c));
    dirtyRef.current = false;
    setDirty(false);
    setStale(false);
  }

  // 配置签名变化（含 SSE 推送）时重新 seeding；编辑中不覆盖，仅提示
  const sig = configSig(current);
  useEffect(() => {
    if (!current) return;
    if (dirtyRef.current) {
      setStale(true);
      return;
    }
    setServiceName(current.service || current.profile || "");
    setForm(seedForm(current));
    setStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // 切换服务时丢弃编辑态并立即 seeding
  useEffect(() => {
    dirtyRef.current = false;
    setDirty(false);
    setStale(false);
    if (current) {
      setServiceName(current.service || current.profile || "");
      setForm(seedForm(current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, profile]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function syncFromConfig() {
    if (syncing) return;
    setSyncing(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/reload`, { method: "POST" });
      const data = await onRefresh();
      const fresh = data?.find((p) => p.project === project)?.profiles.find((p) => p.profile === profile);
      applySeed(fresh ?? current);
      await loadConfig();
      setRawEdit(false);
      setRawErr(null);
      pushToast(t("已与配置文件同步"), { kind: "success", duration: 2000 });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setSyncing(false);
    }
  }

  function startRawEdit() {
    setRawDraft(cfg?.content ?? "");
    setRawErr(null);
    setRawEdit(true);
    setShowRaw(true);
  }

  async function saveRaw() {
    if (rawSaving || !cfg) return;
    setRawSaving(true);
    setRawErr(null);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/config`, {
        method: "PUT",
        body: JSON.stringify({ content: rawDraft }),
      });
      pushToast(t("配置原文已保存并热加载"), { kind: "success" });
      setRawEdit(false);
      await loadConfig();
      const data = await onRefresh();
      const fresh = data?.find((p) => p.project === project)?.profiles.find((p) => p.profile === profile);
      if (fresh) applySeed(fresh);
    } catch (e) {
      setRawErr(e.message);
    } finally {
      setRawSaving(false);
    }
  }

  async function handleSaveForm(e) {
    e?.preventDefault();
    if (!form.start_command.trim() || savingForm) return;
    setSavingForm(true);
    try {
      const origService = current?.service || current?.profile;
      const trimmedService = serviceName.trim();
      if (trimmedService && origService && trimmedService !== origService) {
        await api(`/api/projects/${encodeURIComponent(project)}/services/${encodeURIComponent(origService)}/rename`, {
          method: "POST",
          body: JSON.stringify({ name: trimmedService }),
        });
      }

      const targetProfile = profile || current?.profile;
      if (targetProfile) {
        // 可选字段空串 = 清空配置键；后端 None 才表示保持不变
        await api(`/api/projects/${encodeURIComponent(project)}/profiles/${encodeURIComponent(targetProfile)}`, {
          method: "PUT",
          body: JSON.stringify({
            env_name: form.env_name.trim(),
            start_command: form.start_command.trim(),
            fast_start_command: form.fast_start_command.trim(),
            stop_command: form.stop_command.trim(),
            restart_command: form.restart_command.trim(),
            compile_quick: form.compile_quick.trim(),
            compile_partial: form.compile_partial.trim(),
            compile_full: form.compile_full.trim(),
            compile_package: form.compile_package.trim(),
            workdir: form.workdir.trim(),
            ready_port: form.ready_port ? Number(form.ready_port) : 0,
          }),
        });
      }

      pushToast(t("服务配置已保存并立即生效"), { kind: "success" });
      dirtyRef.current = false;
      setDirty(false);
      setStale(false);
      await loadConfig();
      const data = await onRefresh();
      const fresh = data?.find((p) => p.project === project)?.profiles.find((p) => p.profile === targetProfile);
      if (fresh) {
        setServiceName(fresh.service || fresh.profile || "");
        setForm(seedForm(fresh));
      }
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setSavingForm(false);
    }
  }

  const inputCls = "input mono w-full";

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg0)] p-4 space-y-4">
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
                {dirty && (
                  <span className="ml-1 rounded-full bg-[var(--amb-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--amb)]">
                    {t("未保存")}
                  </span>
                )}
              </h3>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {t("在此直接修改运行命令、编译命令与端口，保存后即时写入配置文件并热生效。")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn btn-sm btn-ghost flex items-center gap-1.5"
                disabled={syncing}
                onClick={syncFromConfig}
                title={t("重新读取 lifecycle.toml 并覆盖表单（丢弃未保存编辑）")}
              >
                {syncing ? <span className="spinner" /> : <Icon name="restart" size={12} />}
                {t("从配置文件同步")}
              </button>
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
          </div>

          {stale && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--amb)] bg-[var(--amb-soft)] px-3 py-2 text-xs text-[var(--amb)]">
              <Icon name="warn" size={13} className="flex-none" />
              <span className="flex-1">{t("配置文件在他处已变更；当前编辑保留，未被覆盖。")}</span>
              <button type="button" className="btn btn-sm btn-ghost !py-0.5" onClick={syncFromConfig}>
                {t("载入最新配置")}
              </button>
              <button type="button" className="btn btn-sm btn-ghost !py-0.5" onClick={() => setStale(false)}>
                {t("继续编辑")}
              </button>
            </div>
          )}

          <form onSubmit={handleSaveForm} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="block">
              <span className="field-label flex items-center gap-1">
                <Icon name="edit" size={11} className="text-[var(--blu)]" />
                {t("服务名称")}
              </span>
              <input
                className={inputCls}
                value={serviceName}
                onChange={(e) => {
                  setServiceName(e.target.value);
                  markDirty();
                }}
                placeholder={t("例如 web / desktop / api")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1">
                <Icon name="tag" size={11} className="text-[var(--blu)]" />
                {t("环境名称（env_name）")}
              </span>
              <input
                className={inputCls}
                value={form.env_name}
                onChange={(e) => updateField("env_name", e.target.value)}
                placeholder="dev / test / prod"
                title={t("环境名写入 lifecycle.toml 的 env_name，用于区分同一服务的不同环境配置。")}
              />
            </label>

            <label className="block md:col-span-2">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="play" size={12} className="text-[var(--grn)]" />
                {t("启动命令")} <span className="text-[var(--red)]">*</span>
              </span>
              <input
                className={inputCls}
                value={form.start_command}
                onChange={(e) => updateField("start_command", e.target.value)}
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
                className={inputCls}
                value={form.fast_start_command}
                onChange={(e) => updateField("fast_start_command", e.target.value)}
                placeholder={t("如为空则使用默认启动命令且跳过等待就绪")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="stop" size={12} className="text-[var(--red)]" />
                {t("停止命令（可选自定义优雅停止）")}
              </span>
              <input
                className={inputCls}
                value={form.stop_command}
                onChange={(e) => updateField("stop_command", e.target.value)}
                placeholder={t("如为空则默认发送 SIGTERM 终止进程组")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="restart" size={12} className="text-[var(--yel)]" />
                {t("重启命令（可选自定义重启）")}
              </span>
              <input
                className={inputCls}
                value={form.restart_command}
                onChange={(e) => updateField("restart_command", e.target.value)}
                placeholder={t("如为空则执行先停止后启动")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="compile" size={12} className="text-[var(--blu)]" />
                {t("快速编译命令（增量）")}
              </span>
              <input
                className={inputCls}
                value={form.compile_quick}
                onChange={(e) => updateField("compile_quick", e.target.value)}
                placeholder={t("例如 npm run build:check / cargo check")}
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="grid" size={12} className="text-[var(--cyan)]" />
                {t("部分编译命令（可选，支持 {targets} 占位）")}
              </span>
              <input
                className={inputCls}
                value={form.compile_partial}
                onChange={(e) => updateField("compile_partial", e.target.value)}
                placeholder="例如 cargo check -p {targets}"
              />
            </label>

            <label className="block">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="boxes" size={12} className="text-[var(--vio)]" />
                {t("全量编译命令（清理与完整构建）")}
              </span>
              <input
                className={inputCls}
                value={form.compile_full}
                onChange={(e) => updateField("compile_full", e.target.value)}
                placeholder={t("例如 npm run build / cargo build")}
              />
            </label>

            <label className="block md:col-span-2">
              <span className="field-label flex items-center gap-1.5">
                <Icon name="pkg" size={12} className="text-[var(--vio)]" />
                {t("打包命令（可选，产物构建：app/bundle/dist）")}
              </span>
              <input
                className={inputCls}
                value={form.compile_package}
                onChange={(e) => updateField("compile_package", e.target.value)}
                placeholder={t("例如 cargo tauri build / npm run build")}
              />
            </label>

            <label className="block">
              <span className="field-label">{t("工作目录（相对项目根）")}</span>
              <input
                className={inputCls}
                value={form.workdir}
                onChange={(e) => updateField("workdir", e.target.value)}
                placeholder="."
              />
            </label>

            <label className="block">
              <span className="field-label">{t("就绪端口（可选）")}</span>
              <input
                className={inputCls}
                type="number"
                min={0}
                max={65535}
                value={form.ready_port}
                onChange={(e) => updateField("ready_port", e.target.value)}
                placeholder="5173 / 8080"
              />
            </label>
          </form>
          <p className="mt-2.5 text-[11px] leading-4 text-[var(--dim)]">
            {t("可选字段清空后保存即从 lifecycle.toml 删除对应配置；「从配置文件同步」可放弃编辑并载入磁盘最新值。")}
          </p>
        </div>
      )}

      {cfg ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg1)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--line)] mb-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="config" size={14} className="text-[var(--blu)] flex-none" />
              <span className="font-semibold text-[var(--txt)] flex-none">{t("配置文件原文 (TOML)")}</span>
              <span className="mono text-[11px] text-[var(--dim)] truncate select-all">{cfg.path}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-none">
              {rawEdit && rawDraft !== cfg.content && (
                <span className="rounded-full bg-[var(--amb-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--amb)]">
                  {t("未保存")}
                </span>
              )}
              {rawEdit ? (
                <>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={rawSaving}
                    onClick={() => {
                      setRawEdit(false);
                      setRawErr(null);
                    }}
                  >
                    {t("取消")}
                  </button>
                  <button
                    className="btn btn-sm btn-primary flex items-center gap-1.5"
                    disabled={rawSaving || rawDraft === cfg.content}
                    onClick={saveRaw}
                    title={t("校验通过后整份写盘并热加载（Ctrl/⌘+S）")}
                  >
                    {rawSaving ? <span className="spinner" /> : <Icon name="save" size={12} />}
                    {t("保存原文")}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-sm btn-ghost flex items-center gap-1.5"
                  onClick={startRawEdit}
                  title={t("直接编辑 lifecycle.toml 全文")}
                >
                  <Icon name="edit" size={12} />
                  {t("编辑原文")}
                </button>
              )}
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
                  if (await copyText(rawEdit ? rawDraft : cfg.content)) pushToast(t("配置已复制"), { kind: "success", duration: 2500 });
                }}
                title={t("复制配置文件内容")}
              >
                <Icon name="copy" size={12} />
                {t("复制")}
              </button>
              {!rawEdit && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  <Icon name={showRaw ? "down" : "right"} size={12} />
                  {showRaw ? t("折叠原文") : t("展开原文")}
                </button>
              )}
            </div>
          </div>

          {rawErr && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--red)] bg-[var(--red-soft)] px-3 py-2 text-xs text-[var(--red)]">
              <Icon name="warn" size={13} className="mt-0.5 flex-none" />
              <span className="mono whitespace-pre-wrap break-all">{rawErr}</span>
            </div>
          )}

          {rawEdit ? (
            <>
              <textarea
                className="well mono w-full resize-y rounded-lg border border-[var(--line)] p-3 text-xs leading-5 text-[var(--log-info)] outline-none focus:border-[var(--blu)]"
                style={{ minHeight: 280 }}
                rows={Math.min(28, rawDraft.split("\n").length + 2)}
                spellCheck={false}
                value={rawDraft}
                onChange={(e) => {
                  setRawDraft(e.target.value);
                  setRawErr(null);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                    e.preventDefault();
                    saveRaw();
                  }
                }}
              />
              <p className="mt-2 text-[11px] leading-4 text-[var(--dim)]">
                {t("原文保存会整份替换 lifecycle.toml（注释需自行保留）；保存前自动校验，失败不写盘。")}
              </p>
            </>
          ) : (
            showRaw && (
              <pre className="well mono overflow-x-auto p-3 text-xs leading-5 text-[var(--log-info)] rounded-lg border border-[var(--line)]">
                {cfg.content}
              </pre>
            )
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