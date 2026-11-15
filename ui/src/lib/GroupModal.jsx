import { useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";
import Checkbox from "./Checkbox.jsx";

export default function GroupModal({ group, projects, onClose, onSaved }) {
  const [name, setName] = useState(group?.name ?? "");
  const [selected, setSelected] = useState(
    new Set((group?.members ?? []).map((m) => `${m.project}/${m.profile}`))
  );
  const [saving, setSaving] = useState(false);

  const allKeys = useMemo(
    () => projects.flatMap((p) => p.profiles.map((s) => `${p.project}/${s.profile}`)),
    [projects]
  );
  const allChecked = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someChecked = allKeys.some((k) => selected.has(k));

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleProject(p, keys) {
    const all = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) all ? next.delete(k) : next.add(k);
      return next;
    });
  }

  async function save(e) {
    e?.preventDefault();
    if (!name.trim() || selected.size === 0 || saving) return;
    const members = [...selected].map((k) => {
      const [project, ...rest] = k.split("/");
      return { project, profile: rest.join("/") };
    });
    setSaving(true);
    try {
      const body = JSON.stringify({ name: name.trim(), members });
      if (group) await api(`/api/groups/${group.id}`, { method: "PUT", body });
      else await api("/api/groups", { method: "POST", body });
      pushToast(group ? `分组「${name}」已更新` : `分组「${name}」已创建`, { kind: "success" });
      onSaved();
    } catch (err) {
      pushToast(err.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={group ? "编辑分组" : "新建分组"}
      icon="group"
      tone="vio"
      width={560}
      onClose={onClose}
      subtitle="勾选要编入一组的服务，之后可一键启动 / 停止 / 重启整批微服务。"
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--dim)]">已选 {selected.size} 个服务</span>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="group-form"
            className="btn btn-vio"
            disabled={saving || !name.trim() || selected.size === 0}
          >
            {saving ? <span className="spinner" /> : <Icon name="save" />}
            保存
          </button>
        </>
      }
    >
      <form id="group-form" onSubmit={save}>
        <label className="block">
          <span className="field-label">分组名称</span>
          <input
            className="input w-full"
            placeholder="如：后端核心"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <div className="mt-3 flex items-center gap-2">
          <Checkbox
            size="sm"
            tone="vio"
            checked={allChecked}
            indeterminate={someChecked && !allChecked}
            onChange={() => setSelected(allChecked ? new Set() : new Set(allKeys))}
            label="全选"
          />
          <span className="flex-1" />
          <span className="text-xs text-[var(--dim)]">{allKeys.length} 个可选服务</span>
        </div>

        <div className="well mt-2 max-h-72 overflow-y-auto p-2">
          {projects.map((p) => {
            const keys = p.profiles.map((s) => `${p.project}/${s.profile}`);
            const all = keys.every((k) => selected.has(k));
            const some = keys.some((k) => selected.has(k));
            return (
              <div key={p.project}>
                <div className="mt-1 flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    size="sm"
                    tone="vio"
                    checked={all}
                    indeterminate={some && !all}
                    onChange={() => toggleProject(p, keys)}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{p.project}</span>
                </div>
                {p.profiles.map((s) => {
                  const key = `${p.project}/${s.profile}`;
                  return (
                    <div className="cb-row" key={key}>
                      <Checkbox
                        checked={selected.has(key)}
                        onChange={() => toggle(key)}
                        tone={s.state === "running" ? "grn" : "vio"}
                      />
                      <span className={`dot dot-${s.state}`} />
                      <span className="mono flex-1 truncate text-[13px]">{s.profile}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {projects.length === 0 && <div className="p-3 text-sm text-[var(--dim)]">还没有注册服务。</div>}
        </div>
      </form>
    </Modal>
  );
}