import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { STATE_LABEL } from "./format.js";
import { useI18n } from "./i18n.js";
import GroupModal from "./GroupModal.jsx";
import Icon from "./Icon.jsx";

export default function GroupsView({ projects, onOpen }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState({});
  const [results, setResults] = useState({});
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    try {
      setGroups(await api("/api/groups"));
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!confirming) return;
    const tm = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(tm);
  }, [confirming]);

  const statusOf = (m) =>
    projects.find((p) => p.project === m.project)?.profiles.find((s) => s.profile === m.profile);
  const runningCount = (g) => g.members.filter((m) => statusOf(m)?.state === "running").length;

  async function op(g, name) {
    setBusy((b) => ({ ...b, [g.id]: name }));
    setResults((r) => ({ ...r, [g.id]: null }));
    try {
      const r = await api(`/api/groups/${g.id}/${name}`, {
        method: "POST",
        body: JSON.stringify({ wait: name !== "stop" }),
      });
      setResults((prev) => ({ ...prev, [g.id]: r.results }));
      const ok = r.results.filter((x) => x.ok).length;
      const label = t({ start: "启动", stop: "停止", restart: "重启" }[name]);
      pushToast(t("分组「{name}」{label}完成 {ok}/{total}", { name: g.name, label, ok, total: r.results.length }), {
        kind: ok === r.results.length ? "success" : "error",
      });
    } catch (e) {
      pushToast(t("分组「{name}」: {err}", { name: g.name, err: e.message }), { kind: "error" });
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[g.id];
        return next;
      });
    }
  }

  async function remove(g) {
    if (confirming !== g.id) {
      setConfirming(g.id);
      return;
    }
    setConfirming(null);
    try {
      const removed = await api(`/api/groups/${g.id}`, { method: "DELETE" });
      await load();
      pushToast(t("已删除分组「{name}」", { name: g.name }), {
        duration: 15000,
        action: {
          label: t("撤销"),
          fn: async () => {
            try {
              await api(`/api/groups/${removed.id}`, {
                method: "PUT",
                body: JSON.stringify({ name: removed.name, members: removed.members }),
              });
              await load();
              pushToast(t("已恢复分组「{name}」", { name: removed.name }), { kind: "success" });
            } catch (e) {
              pushToast(e.message, { kind: "error" });
            }
          },
        },
      });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    }
  }

  const totalRunning = groups.reduce((n, g) => n + runningCount(g), 0);

  return (
    <div className="view flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="group" size={16} className="text-[var(--vio)]" />
          {t("服务分组")}
        </h1>
        <span className="text-xs text-[var(--mut)]">
          {t("微服务一键启停 · {n} 个分组 · {r} 个成员运行中", { n: groups.length, r: totalRunning })}
        </span>
        <span className="flex-1" />
        <button
          className="btn btn-vio"
          onClick={() => {
            setEditing(null);
            setShowModal(true);
          }}
        >
          <Icon name="plus" />
          {t("新建分组")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {groups.map((g) => {
            const run = runningCount(g);
            const all = run === g.members.length && g.members.length > 0;
            return (
              <div key={g.id} className="panel flex flex-col p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: "var(--vio)", boxShadow: "0 0 8px color-mix(in oklab, var(--vio) 70%, transparent)" }}
                  />
                  <h2 className="truncate text-sm font-semibold">{g.name}</h2>
                  <span className="text-xs text-[var(--dim)]">{t("{n} 个服务", { n: g.members.length })}</span>
                  <span className="flex-1" />
                  <span className={`mono text-xs ${all ? "text-[var(--grn)]" : "text-[var(--mut)]"}`}>
                    {t("{run}/{total} 运行中", { run, total: g.members.length })}
                  </span>
                </div>

                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bg3)]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${g.members.length ? (run / g.members.length) * 100 : 0}%`,
                      background: "linear-gradient(90deg, var(--acc-grn), var(--grn))",
                    }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {g.members.map((m) => {
                    const s = statusOf(m);
                    const key = `${m.project}/${m.profile}`;
                    return (
                      <button
                        key={key}
                        className="chip"
                        title={s ? t(STATE_LABEL[s.state] ?? s.state) : t("未知（服务已卸载）")}
                        onClick={() => onOpen(m.project, m.profile)}
                      >
                        <span className={`dot dot-${s?.state ?? "idle"}`} />
                        <span className="mono">{key}</span>
                      </button>
                    );
                  })}
                </div>

                {results[g.id] && (
                  <div className="well mt-3 space-y-1 p-2">
                    {results[g.id].map((r) => (
                      <div key={`${r.project}/${r.profile}`} className="flex items-center gap-2 text-xs">
                        <Icon
                          name={r.ok ? "check" : "x"}
                          size={12}
                          className={r.ok ? "text-[var(--grn)]" : "text-[var(--red)]"}
                        />
                        <span className="mono text-[var(--mut)]">
                          {r.project}/{r.profile}
                        </span>
                        <span className="truncate text-[var(--dim)]">{r.ok ? r.state : r.error}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button className="btn btn-sm btn-success" disabled={!!busy[g.id]} onClick={() => op(g, "start")}>
                    {busy[g.id] === "start" ? <span className="spinner" /> : <Icon name="play" size={12} />}
                    {t("一键启动")}
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={!!busy[g.id]} onClick={() => op(g, "stop")}>
                    {busy[g.id] === "stop" ? <span className="spinner" /> : <Icon name="stop" size={12} />}
                    {t("一键停止")}
                  </button>
                  <button className="btn btn-sm btn-warn" disabled={!!busy[g.id]} onClick={() => op(g, "restart")}>
                    {busy[g.id] === "restart" ? <span className="spinner" /> : <Icon name="restart" size={12} />}
                    {t("重启")}
                  </button>
                  <span className="flex-1" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setEditing(g);
                      setShowModal(true);
                    }}
                  >
                    <Icon name="edit" size={12} />
                    {t("编辑")}
                  </button>
                  <button
                    className={`btn btn-sm btn-ghost ${confirming === g.id ? "!text-[var(--red)]" : ""}`}
                    title={confirming === g.id ? t("再次点击确认删除") : t("删除分组")}
                    onClick={() => remove(g)}
                  >
                    <Icon name="trash" size={12} />
                    {confirming === g.id ? t("确认?") : t("删除")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {groups.length === 0 && (
          <div className="panel flex flex-col items-center gap-3 p-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--vio-soft)] text-[var(--vio)]">
              <Icon name="group" size={26} />
            </span>
            <div className="text-sm text-[var(--mut)]">{t("还没有分组")}</div>
            <p className="max-w-md text-xs leading-5 text-[var(--dim)]">
              {t("把多个微服务编成一组（如「后端核心」= 注册中心 + 网关 + 用户服务），即可一键启动整批，按依赖顺序并行拉起。")}
            </p>
            <button
              className="btn btn-vio btn-sm"
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
            >
              <Icon name="plus" />
              {t("新建分组")}
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <GroupModal
          group={editing}
          projects={projects}
          onClose={() => setShowModal(false)}
          onSaved={async () => {
            setShowModal(false);
            await load();
          }}
        />
      )}
    </div>
  );
}