import { useMemo, useState } from "react";
import { api } from "./api.js";
import { copyText } from "./clipboard.js";
import { pushToast } from "./toast.js";
import { useI18n } from "./i18n.js";
import { STATE_LABEL } from "./format.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";

export default function ProjectManageModal({
  project,
  projects = [],
  onClose,
  onRenamed,
  onRemoved,
  onAddService,
  onRefresh,
}) {
  const { t } = useI18n();
  const proj = useMemo(() => projects.find((p) => p.project === project) ?? null, [projects, project]);

  const [name, setName] = useState(project || "");
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingService, setDeletingService] = useState(null);
  const [removingProject, setRemovingProject] = useState(false);

  // 项目根目录
  const dirPath = proj?.path ? String(proj.path).replace(/\/lifecycle\.toml$/, "") : "";

  async function handleRename(e) {
    e?.preventDefault();
    const newName = name.trim();
    if (!newName || newName === project || renaming) return;
    setRenaming(true);
    try {
      const res = await api(`/api/projects/${encodeURIComponent(project)}/rename`, {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      });
      pushToast(t("项目已重命名为「{name}」", { name: res.new_name }), { kind: "success" });
      if (onRenamed) onRenamed(res.new_name);
      if (onRefresh) await onRefresh();
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setRenaming(false);
    }
  }

  async function handleRevealFinder() {
    if (!dirPath) return;
    try {
      await api("/api/reveal-path", {
        method: "POST",
        body: JSON.stringify({ path: dirPath }),
      });
      pushToast(t("已在文件管理器中定位"), { kind: "success" });
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    }
  }

  async function handleOpenEditor() {
    if (!dirPath) return;
    try {
      await api("/api/open-editor", {
        method: "POST",
        body: JSON.stringify({ file: dirPath }),
      });
      pushToast(t("已在代码编辑器中打开"), { kind: "success" });
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    }
  }

  async function handleCopyPath() {
    if (!dirPath) return;
    if (await copyText(dirPath)) {
      pushToast(t("已复制项目路径"), { kind: "success" });
    }
  }

  async function handleDeleteService(profileName) {
    if (deletingService === profileName) {
      try {
        await api(`/api/projects/${encodeURIComponent(project)}/profiles/${encodeURIComponent(profileName)}`, {
          method: "DELETE",
        });
        pushToast(t("已删除服务「{profile}」", { profile: profileName }), { kind: "success" });
        setDeletingService(null);
        if (onRefresh) await onRefresh();
      } catch (err) {
        pushToast(err.message, { kind: "error" });
      }
    } else {
      setDeletingService(profileName);
      setTimeout(() => setDeletingService(null), 4000);
    }
  }

  async function handleRemoveProject() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }
    setRemovingProject(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" });
      pushToast(t("已从 LifeCycle 移除项目「{project}」", { project }), { kind: "success" });
      if (onRemoved) onRemoved(project);
      if (onRefresh) await onRefresh();
      onClose();
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setRemovingProject(false);
    }
  }

  return (
    <Modal
      title={t("项目信息与环境管理")}
      icon="folder"
      tone="blu"
      width={640}
      onClose={onClose}
      subtitle={t("管理项目名称、物理路径、以及该项目下的各环境/端服务列表。")}
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            className={`btn btn-sm ${confirmDelete ? "btn-danger" : "btn-ghost !text-[var(--red)]"}`}
            disabled={removingProject}
            onClick={handleRemoveProject}
            title={t("停止所有运行服务并从 LifeCycle 移除，不会删除物理代码文件")}
          >
            {removingProject ? (
              <span className="spinner" />
            ) : (
              <Icon name="trash" size={13} />
            )}
            {confirmDelete ? t("再次点击确认移除项目") : t("移除此项目")}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("关闭")}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 项目名称编辑 */}
        <form onSubmit={handleRename} className="rounded-lg border border-[var(--line)] bg-[var(--bg2)]/50 p-3">
          <span className="field-label block font-semibold text-[var(--txt)]">
            {t("项目名称")}
          </span>
          <div className="mt-1.5 flex gap-2">
            <input
              className="input flex-1 text-sm font-medium"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("项目显示名称")}
              required
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm flex-none"
              disabled={renaming || !name.trim() || name.trim() === project}
            >
              {renaming ? <span className="spinner" /> : <Icon name="check" size={13} />}
              {t("保存名称")}
            </button>
          </div>
        </form>

        {/* 项目路径与物理操作 */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg2)]/50 p-3">
          <span className="field-label block font-semibold text-[var(--txt)]">
            {t("项目路径")}
          </span>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-[var(--bg1)] px-3 py-2 border border-[var(--line)]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Icon name="folder" size={15} className="text-[var(--amb)] flex-none" />
              <span className="mono text-xs text-[var(--txt)] truncate select-all">{dirPath || "—"}</span>
            </div>
            <div className="flex items-center gap-1 flex-none">
              <button
                type="button"
                className="btn btn-ghost btn-sm !p-1.5"
                title={t("复制项目路径")}
                onClick={handleCopyPath}
              >
                <Icon name="copy" size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm !p-1.5"
                title={t("在文件管理器中显示")}
                onClick={handleRevealFinder}
              >
                <Icon name="open" size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm !p-1.5"
                title={t("在代码编辑器中打开")}
                onClick={handleOpenEditor}
              >
                <Icon name="edit" size={13} />
              </button>
            </div>
          </div>
          {proj?.path && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--dim)] mono">
              <span>{t("配置文件:")}</span>
              <span className="truncate">{proj.path}</span>
            </div>
          )}
        </div>

        {/* 项目下的服务与环境列表 */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg2)]/50 p-3">
          <div className="flex items-center justify-between pb-2">
            <div>
              <span className="field-label block font-semibold text-[var(--txt)]">
                {t("环境与服务列表")} ({proj?.profiles?.length ?? 0})
              </span>
              <span className="text-[11px] text-[var(--dim)]">
                {t("例如同时管理 web 端调试与桌面端 Tauri 服务，或 dev / test / prod 等不同环境")}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-success btn-sm flex items-center gap-1"
              onClick={() => {
                onClose();
                if (onAddService) onAddService(project);
              }}
            >
              <Icon name="plus" size={12} />
              {t("添加服务 / 环境")}
            </button>
          </div>

          <div className="space-y-1.5 mt-1">
            {proj?.profiles?.map((s) => {
              const isDeleting = deletingService === s.profile;
              return (
                <div
                  key={s.profile}
                  className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--bg1)] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`dot dot-${s.state}`} />
                    <span className="mono font-semibold text-[var(--blu)]">{s.profile}</span>
                    <span className="text-[11px] text-[var(--dim)]">
                      {t(STATE_LABEL[s.state] ?? s.state)}
                    </span>
                    {s.port && (
                      <span className="mono rounded bg-[var(--bg2)] px-1.5 py-0.5 text-[10px] text-[var(--mut)]">
                        :{s.port}
                      </span>
                    )}
                    {s.pid && (
                      <span className="mono text-[10px] text-[var(--dim)]">
                        PID {s.pid}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {proj.profiles.length > 1 && (
                      <button
                        type="button"
                        className={`btn btn-sm btn-ghost !p-1 ${isDeleting ? "!text-[var(--red)] font-semibold" : "text-[var(--dim)] hover:text-[var(--red)]"}`}
                        title={isDeleting ? t("点击确认删除该服务") : t("删除此服务/环境")}
                        onClick={() => handleDeleteService(s.profile)}
                      >
                        {isDeleting ? t("确认删除?") : <Icon name="trash" size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
