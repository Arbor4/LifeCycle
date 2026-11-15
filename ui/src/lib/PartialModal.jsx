import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";
import Checkbox from "./Checkbox.jsx";

export default function PartialModal({ project, profile, onClose, onSubmit }) {
  const [modules, setModules] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [custom, setCustom] = useState("");
  const storageKey = `partial-targets-${project}-${profile}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api(`/api/projects/${encodeURIComponent(project)}/modules`);
        if (alive) setModules(data.find((m) => m.profile === profile)?.modules ?? []);
      } catch {
        if (alive) setModules([]);
      }
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        if (alive) setSelected(new Set(saved));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [project, profile, storageKey]);

  const allChecked = modules.length > 0 && modules.every((m) => selected.has(m));
  const someChecked = modules.some((m) => selected.has(m));
  const targets = useMemo(
    () => [...selected, ...custom.split(",").map((s) => s.trim()).filter(Boolean)],
    [selected, custom]
  );

  function toggle(m) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  function submit() {
    localStorage.setItem(storageKey, JSON.stringify([...selected]));
    onSubmit(targets);
  }

  return (
    <Modal
      title={`部分编译 · ${project}/${profile}`}
      icon="compile"
      tone="blu"
      width={520}
      onClose={onClose}
      subtitle="选择模块/目录，或直接输入目标（逗号分隔）。只编译选中的部分，速度远快于完整编译。"
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--dim)]">已选 {targets.length} 个目标</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={targets.length === 0} onClick={submit}>
            <Icon name="compile" size={12} />
            编译所选
          </button>
        </>
      }
    >
      {modules.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Checkbox
            size="sm"
            checked={allChecked}
            indeterminate={someChecked && !allChecked}
            onChange={() => setSelected(allChecked ? new Set() : new Set(modules))}
            label="全选模块"
          />
        </div>
      )}
      <div className="well max-h-60 overflow-y-auto p-2">
        {modules.length === 0 ? (
          <div className="p-2 text-sm text-[var(--dim)]">未发现模块目录，可在下方手动输入目标。</div>
        ) : (
          modules.map((m) => (
            <div className="cb-row" key={m}>
              <Checkbox checked={selected.has(m)} onChange={() => toggle(m)} />
              <span className="mono flex-1 truncate text-[13px]">{m}</span>
            </div>
          ))
        )}
      </div>
      <label className="mt-3 block">
        <span className="field-label">自定义目标</span>
        <input
          className="input mono w-full"
          placeholder="mod-a,mod-b"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      </label>
    </Modal>
  );
}