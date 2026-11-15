import { useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";

export default function RegisterModal({ onClose, onSaved }) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);

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
          ? `已创建服务「${r.project}」并生成 lifecycle.toml`
          : `已导入服务「${r.project}」（使用已有 lifecycle.toml）`,
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
      title="创建 / 导入服务"
      icon="folder"
      tone="grn"
      width={580}
      onClose={onClose}
      subtitle="填入项目目录即可。没有 lifecycle.toml 时会自动探测工程类型（Node/Vite、Rust、Maven）并生成配置；已有配置则直接导入，注册后立即出现在服务列表。"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" form="register-form" className="btn btn-success" disabled={saving || !path.trim()}>
            {saving ? <span className="spinner" /> : <Icon name="plus" />}
            注册服务
          </button>
        </>
      }
    >
      <form id="register-form" onSubmit={save}>
        <label className="block">
          <span className="field-label">
            项目目录 <span className="text-[var(--red)]">*</span>
          </span>
          <input
            className="input mono w-full"
            placeholder="/Users/you/projects/my-service"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">服务名称（默认目录名）</span>
            <input className="input w-full" placeholder="my-service" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">就绪端口（覆盖探测值）</span>
            <input
              className="input mono w-full"
              type="number"
              placeholder="5173"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="field-label">启动命令（留空用探测值）</span>
          <input
            className="input mono w-full"
            placeholder="npm run dev"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </label>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
          <Icon name="shield" size={12} className="mt-0.5 flex-none" />
          <span>命令只会写入项目内的 lifecycle.toml，工作目录限制在项目根目录；不会执行任意 shell。</span>
        </p>
      </form>
    </Modal>
  );
}