import { useCallback, useRef, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";

export default function RegisterModal({ onClose, onSaved }) {
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
      subtitle={t(
        "选择或填入项目文件夹。没有 lifecycle.toml 时会自动探测工程类型（Node/Vite、Rust、Maven 等）并生成配置；已有配置则直接导入。"
      )}
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