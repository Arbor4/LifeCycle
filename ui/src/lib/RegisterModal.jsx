import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";

export default function RegisterModal({ kind = "project", projects = [], defaultProject = null, onClose, onSaved }) {
  if (kind === "service") {
    return <ServiceModal projects={projects} defaultProject={defaultProject} onClose={onClose} onSaved={onSaved} />;
  }
  return <ProjectModal onClose={onClose} onSaved={onSaved} />;
}

function ServiceModal({ projects, defaultProject, onClose, onSaved }) {
  const { t } = useI18n();
  const [project, setProject] = useState(defaultProject || projects[0]?.project || "");
  const [service, setService] = useState("web");
  const [envChoice, setEnvChoice] = useState("dev");
  const [customEnv, setCustomEnv] = useState("");
  const [command, setCommand] = useState("npm run dev");
  const [fastCommand, setFastCommand] = useState("");
  const [stopCommand, setStopCommand] = useState("");
  const [restartCommand, setRestartCommand] = useState("");
  const [compileQuick, setCompileQuick] = useState("");
  const [compilePartial, setCompilePartial] = useState("");
  const [compileFull, setCompileFull] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [port, setPort] = useState("");
  const [pattern, setPattern] = useState("");
  const [timeout, setTimeoutMs] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const PRESETS = [
    {
      id: "web",
      icon: "globe",
      name: "Web 前端 (网页布局调试)",
      service: "web",
      env: "dev",
      command: "npm run dev",
      compileQuick: "npm run build:check",
      compileFull: "npm run build",
      workdir: "ui",
      port: "5173",
      desc: "只拉起前端 Vite/Webpack 调试页面布局，轻量快速",
    },
    {
      id: "desktop",
      icon: "monitor",
      name: "桌面端 (Tauri / App)",
      service: "desktop",
      env: "dev",
      command: "cargo tauri dev",
      compileQuick: "cargo check",
      compileFull: "cargo build",
      workdir: ".",
      port: "",
      desc: "拉起完整桌面端应用，测试系统交互与托盘",
    },
    {
      id: "dev",
      icon: "rocket",
      name: "开发环境 (dev)",
      service: "app",
      env: "dev",
      command: "npm run dev",
      compileQuick: "",
      compileFull: "",
      workdir: ".",
      port: "",
      desc: "日常开发环境调试",
    },
    {
      id: "test",
      icon: "flask",
      name: "测试环境 (test)",
      service: "app",
      env: "test",
      command: "npm run test",
      compileQuick: "",
      compileFull: "",
      workdir: ".",
      port: "",
      desc: "执行自动化测试与质量检查",
    },
    {
      id: "prod",
      icon: "pkg",
      name: "生产预览 (prod)",
      service: "app",
      env: "prod",
      command: "npm run preview",
      compileQuick: "",
      compileFull: "",
      workdir: ".",
      port: "4173",
      desc: "模拟真实打包后的生产预览环境",
    },
    {
      id: "api",
      icon: "cpu",
      name: "后端 API 服务",
      service: "api",
      env: "dev",
      command: "cargo run",
      compileQuick: "cargo check",
      compileFull: "cargo build",
      workdir: ".",
      port: "8080",
      desc: "独立后端服务与接口",
    },
  ];

  const proj = useMemo(() => projects.find((p) => p.project === project), [projects, project]);
  const finalEnv = envChoice === "custom" ? customEnv.trim() : envChoice;
  const svcName = service.trim();

  // 计算唯一的 profile key:
  const profileKey = useMemo(() => {
    if (!svcName) return "";
    if (finalEnv && finalEnv !== "default") {
      return `${svcName}:${finalEnv}`;
    }
    return svcName;
  }, [svcName, finalEnv]);

  const duplicate = !!profileKey && !!proj?.profiles?.some((s) => s.profile === profileKey);
  const canSave = !!project && !!svcName && !!finalEnv && !!command.trim() && !duplicate && !saving;

  function applyPreset(p) {
    setService(p.service);
    setEnvChoice(p.env || "dev");
    setCustomEnv("");
    setCommand(p.command || "");
    setCompileQuick(p.compileQuick || "");
    setCompileFull(p.compileFull || "");
    setWorkdir(p.workdir || "");
    setPort(p.port || "");
  }

  async function save(e) {
    e?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}/profiles`, {
        method: "POST",
        body: JSON.stringify({
          service: svcName,
          env_name: finalEnv,
          profile: profileKey,
          start_command: command.trim(),
          fast_start_command: fastCommand.trim() || undefined,
          stop_command: stopCommand.trim() || undefined,
          restart_command: restartCommand.trim() || undefined,
          compile_quick: compileQuick.trim() || undefined,
          compile_partial: compilePartial.trim() || undefined,
          compile_full: compileFull.trim() || undefined,
          workdir: workdir.trim() || undefined,
          ready_port: port ? Number(port) : undefined,
          ready_pattern: pattern.trim() || undefined,
          ready_timeout_ms: timeout ? Number(timeout) : undefined,
        }),
      });
      pushToast(t("已添加服务「{key}」", { key: `${project}/${profileKey}` }), { kind: "success" });
      onSaved(project, profileKey);
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("添加服务")}
      icon="plus"
      tone="grn"
      width={640}
      onClose={onClose}
      subtitle={t("在当前项目下新增服务与环境配置：包含运行命令、快速/全量编译命令，方便独立启动或调试。")}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button type="submit" form="add-service-form" className="btn btn-success" disabled={!canSave}>
            {saving ? <span className="spinner" /> : <Icon name="plus" />}
            {t("添加服务")}
          </button>
        </>
      }
    >
      <form id="add-service-form" onSubmit={save}>
        <label className="block">
          <span className="field-label">
            {t("所属项目")} <span className="text-[var(--red)]">*</span>
          </span>
          {projects.length ? (
            <select className="input w-full" value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p.project} value={p.project}>
                  {p.project}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-xs text-[var(--dim)]">
              {t("暂无已注册项目，请先在侧边栏添加项目")}
            </div>
          )}
        </label>
        {proj?.path && (
          <div
            className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--dim)]"
            title={t("项目根目录")}
          >
            <Icon name="folder" size={12} className="flex-none text-[var(--amb)]" />
            <span className="mono truncate">{proj.path}</span>
          </div>
        )}

        <div className="mt-3">
          <span className="field-label block text-xs">
            {t("环境与场景快速预设（点击自动填入）")}
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-1 text-xs text-[var(--txt)] hover:border-[var(--blu)] hover:text-[var(--blu)] transition-colors"
                title={t(p.desc)}
                onClick={() => applyPreset(p)}
              >
                <Icon name={p.icon} size={12} className="text-[var(--dim)]" />
                <span>{t(p.name)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">
              {t("服务名称")} <span className="text-[var(--red)]">*</span>
            </span>
            <input
              className="input mono w-full"
              placeholder={t("例如 web / desktop / api")}
              value={service}
              onChange={(e) => setService(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="field-label">
              {t("环境 / Profile")} <span className="text-[var(--red)]">*</span>
            </span>
            <div className="flex gap-1.5">
              <select
                className="input mono flex-1"
                value={envChoice}
                onChange={(e) => setEnvChoice(e.target.value)}
              >
                <option value="dev">dev ({t("开发环境")})</option>
                <option value="test">test ({t("测试环境")})</option>
                <option value="prod">prod ({t("生产环境")})</option>
                <option value="custom">{t("+ 自定义环境…")}</option>
              </select>
              {envChoice === "custom" && (
                <input
                  className="input mono w-28"
                  placeholder={t("环境名")}
                  value={customEnv}
                  onChange={(e) => setCustomEnv(e.target.value)}
                  required
                />
              )}
            </div>
          </label>
        </div>

        {duplicate && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--red)]">
            <Icon name="warn" size={12} className="flex-none" />
            {t("该项目下已存在配置「{key}」，请更换服务名或环境", { key: profileKey })}
          </p>
        )}

        <label className="mt-3 block">
          <span className="field-label flex items-center justify-between">
            <span>
              {t("启动命令")} <span className="text-[var(--red)]">*</span>
            </span>
            <span className="text-[11px] font-normal text-[var(--dim)]">{t("运行服务的主要命令")}</span>
          </span>
          <div className="relative">
            <input
              className="input mono w-full pl-7!"
              placeholder={t("例如 npm run dev / cargo tauri dev / cargo run")}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              required
            />
            <Icon name="play" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--grn)]" />
          </div>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label flex items-center gap-1">
              <Icon name="compile" size={11} className="text-[var(--blu)]" />
              {t("快速编译命令（可选）")}
            </span>
            <input
              className="input mono w-full"
              placeholder={t("例如 npm run build:check / cargo check")}
              value={compileQuick}
              onChange={(e) => setCompileQuick(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label flex items-center gap-1">
              <Icon name="boxes" size={11} className="text-[var(--pur)]" />
              {t("全量编译命令（可选）")}
            </span>
            <input
              className="input mono w-full"
              placeholder={t("例如 npm run build / cargo build")}
              value={compileFull}
              onChange={(e) => setCompileFull(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">{t("工作目录（相对项目根，可选）")}</span>
            <input
              className="input mono w-full"
              placeholder="."
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">{t("就绪端口（可选）")}</span>
            <input
              className="input mono w-full"
              type="number"
              min={1}
              max={65535}
              placeholder={t("例如 5173 / 8080")}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-2.5">
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--mut)] transition-colors hover:bg-[var(--bg2)] hover:text-[var(--txt)]"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Icon name={showAdvanced ? "down" : "right"} size={12} />
            {t("更多高级命令与就绪检查（快速启动 / 停止 / 重启 / 部分编译 / 正则）")}
          </button>
          {showAdvanced && (
            <div className="mt-1.5 grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg2)]/60 p-3">
              <label className="block">
                <span className="field-label flex items-center gap-1">
                  <Icon name="zap" size={11} className="text-[var(--yel)]" />
                  {t("快速启动命令（可选）")}
                </span>
                <input
                  className="input mono w-full"
                  placeholder={t("如为空则使用默认启动命令且跳过等待")}
                  value={fastCommand}
                  onChange={(e) => setFastCommand(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label flex items-center gap-1">
                  <Icon name="stop" size={11} className="text-[var(--red)]" />
                  {t("停止命令（可选）")}
                </span>
                <input
                  className="input mono w-full"
                  placeholder={t("自定义停止命令，如为空则发信号终止")}
                  value={stopCommand}
                  onChange={(e) => setStopCommand(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label flex items-center gap-1">
                  <Icon name="restart" size={11} className="text-[var(--yel)]" />
                  {t("重启命令（可选）")}
                </span>
                <input
                  className="input mono w-full"
                  placeholder={t("自定义重启命令，如为空则先停后启")}
                  value={restartCommand}
                  onChange={(e) => setRestartCommand(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label flex items-center gap-1">
                  <Icon name="grid" size={11} className="text-[var(--cyan)]" />
                  {t("部分编译命令（可选）")}
                </span>
                <input
                  className="input mono w-full"
                  placeholder="例如 cargo check -p {targets}"
                  value={compilePartial}
                  onChange={(e) => setCompilePartial(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label">{t("就绪正则（可选）")}</span>
                <input
                  className="input mono w-full"
                  placeholder={t("例如 Local:.*http")}
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label">{t("就绪超时（毫秒，可选）")}</span>
                <input
                  className="input mono w-full"
                  type="number"
                  min={1000}
                  step={1000}
                  placeholder="30000"
                  value={timeout}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
          <Icon name="shield" size={12} className="mt-0.5 flex-none text-[var(--grn)]" />
          <span>
            {t("配置将写入项目 lifecycle.toml 的 [profiles.\"{name}\"]，保存后热加载并立即生效。", {
              name: profileKey || "name",
            })}
          </span>
        </p>
      </form>
    </Modal>
  );
}

function ProjectModal({ onClose, onSaved }) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [detectedInfo, setDetectedInfo] = useState(null);
  const fileInputRef = useRef(null);

  const probePath = useCallback(async (dirPath) => {
    if (!dirPath || !dirPath.trim()) {
      setDetectedInfo(null);
      return;
    }
    try {
      const res = await api("/api/projects/detect", {
        method: "POST",
        body: JSON.stringify({ path: dirPath.trim() }),
      });
      if (res?.exists) {
        setDetectedInfo(res);
        setName((prev) => (prev ? prev : res.name || ""));
        if (!res.has_lifecycle_toml) {
          if (res.port && !port) setPort(String(res.port));
          if (res.start_command && !command) setCommand(res.start_command);
        }
      } else {
        setDetectedInfo(null);
      }
    } catch {
      setDetectedInfo(null);
    }
  }, [port, command]);

  async function chooseFolder() {
    setPicking(true);
    try {
      const res = await api("/api/projects/choose-directory", { method: "POST" });
      if (res?.path) {
        setPath(res.path);
        await probePath(res.path);
      }
    } catch (e) {
      // 后端弹窗不可用时回退到 HTML 原生目录选择
      if (fileInputRef.current) {
        fileInputRef.current.click();
      } else {
        pushToast(e.message || t("无法打开文件夹选择窗口"), { kind: "error" });
      }
    } finally {
      setPicking(false);
    }
  }

  function onHtmlFolderPicked(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const relPath = file.webkitRelativePath || "";
      const rootName = relPath.split("/")[0] || file.name;
      if (rootName && !name) setName(rootName);
      pushToast(t("已选取文件夹，请确认或完善绝对路径"), { kind: "info" });
    }
  }

  async function save(e) {
    e?.preventDefault();
    if (!path.trim() || saving) return;
    setSaving(true);
    try {
      const r = await api("/api/projects/register", {
        method: "POST",
        body: JSON.stringify({
          path: path.trim(),
          name: name.trim() || undefined,
          port: port ? Number(port) : undefined,
          command: command.trim() || undefined,
        }),
      });
      pushToast(
        r.generated
          ? t("已创建服务「{name}」并生成 lifecycle.toml", { name: r.project })
          : t("已导入服务「{name}」（使用已有 lifecycle.toml）", { name: r.project }),
        { kind: "success" }
      );
      onSaved(r.project);
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("添加 / 导入项目")}
      icon="folder"
      tone="grn"
      width={600}
      onClose={onClose}
      subtitle={t("选择或填入项目文件夹。没有 lifecycle.toml 时会自动探测工程类型（Node/Vite、Rust、Maven 等）并生成配置；已有配置则直接导入。")}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button type="submit" form="register-form" className="btn btn-success" disabled={saving || !path.trim()}>
            {saving ? <span className="spinner" /> : <Icon name="plus" />}
            {t("添加并注册")}
          </button>
        </>
      }
    >
      <form id="register-form" onSubmit={save}>
        <div>
          <span className="field-label flex items-center justify-between">
            <span>
              {t("项目文件夹")} <span className="text-[var(--red)]">*</span>
            </span>
            <span className="text-[11px] font-normal text-[var(--dim)]">{t("支持本地任意代码工程")}</span>
          </span>
          <div className="flex gap-2">
            <input
              className="input mono flex-1"
              placeholder="/Users/you/projects/my-service"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                probePath(e.target.value);
              }}
              onBlur={() => probePath(path)}
              required
            />
            <input
              ref={fileInputRef}
              type="file"
              webkitdirectory="true"
              directory="true"
              className="hidden"
              onChange={onHtmlFolderPicked}
            />
            <button
              type="button"
              className="btn btn-primary flex-none"
              disabled={picking}
              onClick={chooseFolder}
              title={t("打开系统文件夹选择窗口")}
            >
              {picking ? <span className="spinner" /> : <Icon name="folder" size={14} />}
              {t("选择文件夹…")}
            </button>
          </div>
        </div>

        {detectedInfo && (
          <div className="mt-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-xs">
            {detectedInfo.has_lifecycle_toml ? (
              <div className="flex items-center gap-1.5 text-[var(--grn)] font-medium">
                <Icon name="check" size={13} />
                <span>{t("已检测到 lifecycle.toml，将直接载入已有配置")}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--mut)]">
                <span className="inline-flex items-center gap-1 text-[var(--txt)] font-medium">
                  <Icon name="zap" size={12} className="text-[var(--amb)]" />
                  {t("探测到工程: {kind}", { kind: detectedInfo.kind || t("未知") })}
                </span>
                {detectedInfo.start_command && (
                  <span className="mono text-[var(--dim)]">
                    {t("默认启动: {cmd}", { cmd: detectedInfo.start_command })}
                  </span>
                )}
                {detectedInfo.port && (
                  <span className="mono text-[var(--dim)]">{t("默认端口: {port}", { port: detectedInfo.port })}</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">{t("项目/服务名称")}</span>
            <input
              className="input w-full"
              placeholder={t("默认取文件夹名称")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">{t("就绪端口（覆盖探测值）")}</span>
            <input
              className="input mono w-full"
              type="number"
              placeholder={detectedInfo?.port ? String(detectedInfo.port) : t("例如 5173 / 8080")}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="field-label">{t("启动命令（覆盖默认探测值）")}</span>
          <input
            className="input mono w-full"
            placeholder={detectedInfo?.start_command || t("例如 npm run dev / cargo run")}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </label>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
          <Icon name="shield" size={12} className="mt-0.5 flex-none text-[var(--grn)]" />
          <span>{t("项目配置将保存在工程目录的 lifecycle.toml 中，并在侧边栏与服务列表中实时显示。")}</span>
        </p>
      </form>
    </Modal>
  );
}