import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Switch from "./Switch.jsx";
import Segmented from "./Segmented.jsx";

export default function DiagnosticsPanel() {
  const { t } = useI18n();
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(true);
  const [tool, setTool] = useState("all");
  const [result, setResult] = useState("all");
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api("/api/diagnostics")
        .then((d) => {
          if (!alive) return;
          setEntries(d.slice().reverse());
          setUpdatedAt(Date.now());
        })
        .catch(() => {});
    load();
    if (!live) return () => { alive = false; };
    const tm = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(tm);
    };
  }, [live]);

  const tools = useMemo(() => [...new Set(entries.map((e) => e.tool))].sort(), [entries]);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (tool !== "all" && e.tool !== tool) return false;
        if (result === "ok" && e.exit_code !== 0) return false;
        if (result === "err" && e.exit_code === 0) return false;
        return true;
      }),
    [entries, tool, result]
  );

  const stats = useMemo(() => {
    const ok = entries.filter((e) => e.exit_code === 0).length;
    const total = entries.length;
    const avg = total ? Math.round(entries.reduce((n, e) => n + e.duration_ms, 0) / total) : 0;
    const max = entries.reduce((n, e) => Math.max(n, e.duration_ms), 0);
    return { total, ok, rate: total ? Math.round((ok / total) * 100) : 100, avg, max };
  }, [entries]);

  const tiles = [
    { label: t("总调用"), value: stats.total, icon: "diag", tone: "blu" },
    { label: t("成功率"), value: `${stats.rate}%`, icon: "check", tone: stats.rate >= 90 ? "grn" : "amb" },
    { label: t("平均耗时"), value: `${stats.avg}ms`, icon: "clock", tone: "cyn" },
    { label: t("最慢一次"), value: `${stats.max}ms`, icon: "gauge", tone: "vio" },
  ];

  return (
    <div className="view flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="diag" size={16} className="text-[var(--grn)]" />
          {t("诊断")}
        </h1>
        <span className="text-xs text-[var(--mut)]">{t("全局工具调用记录 · UI 与 MCP 共用 · 最近 200 条")}</span>
        <span className="flex-1" />
        {updatedAt && (
          <span className="mono text-[11px] text-[var(--dim)]">
            {t("更新于 {time}", { time: new Date(updatedAt).toLocaleTimeString() })}
          </span>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--mut)]">
          <Switch checked={live} onChange={setLive} label={t("实时刷新")} />
          {t("实时刷新")}
        </label>
        <button
          className="btn btn-sm"
          onClick={() =>
            api("/api/diagnostics")
              .then((d) => {
                setEntries(d.slice().reverse());
                setUpdatedAt(Date.now());
              })
              .catch(() => {})
          }
        >
          <Icon name="refresh" size={12} />
          {t("刷新")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-[var(--line)] bg-[var(--bg1)] p-3 lg:grid-cols-4">
        {tiles.map((tl) => (
          <div key={tl.label} className="panel flex items-center gap-3 px-3 py-2">
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in oklab, var(--${tl.tone}) 14%, transparent)`,
                color: `var(--${tl.tone})`,
              }}
            >
              <Icon name={tl.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="mono block text-lg font-semibold leading-tight">{tl.value}</span>
              <span className="block truncate text-[11px] text-[var(--dim)]">{tl.label}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <Icon name="filter" size={13} className="text-[var(--dim)]" />
        <select className="input" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="all">{t("全部工具")}</option>
          {tools.map((tl) => (
            <option key={tl} value={tl}>
              {tl}
            </option>
          ))}
        </select>
        <Segmented
          value={result}
          onChange={setResult}
          options={[
            { value: "all", label: t("全部结果") },
            { value: "ok", label: t("成功"), icon: "check" },
            { value: "err", label: t("失败"), icon: "x" },
          ]}
        />
        <span className="mono text-xs text-[var(--dim)]">{t("{a}/{b} 条", { a: filtered.length, b: entries.length })}</span>
        <span className="flex-1" />
        {(tool !== "all" || result !== "all") && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setTool("all");
              setResult("all");
            }}
          >
            {t("清除筛选")}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-32">{t("时间")}</th>
              <th>{t("工具")}</th>
              <th className="w-[38%]">{t("耗时")}</th>
              <th className="w-24">{t("结果")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={`${e.ts}-${i}`}>
                <td className="mono text-xs text-[var(--mut)]">{new Date(e.ts).toLocaleTimeString()}</td>
                <td className="mono text-xs">{e.tool}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="mono w-16 flex-none text-xs text-[var(--mut)]">{e.duration_ms}ms</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg3)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${stats.max ? Math.max(2, (e.duration_ms / stats.max) * 100) : 0}%`,
                          background:
                            e.exit_code === 0
                              ? "linear-gradient(90deg, var(--acc-blu), var(--cyn))"
                              : "linear-gradient(90deg, var(--acc-red), var(--red))",
                        }}
                      />
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`badge ${e.exit_code === 0 ? "badge-control" : "badge-danger"}`}>
                    <Icon name={e.exit_code === 0 ? "check" : "x"} size={10} />
                    {e.exit_code === 0 ? "ok" : "err"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg2)] text-[var(--dim)]">
              <Icon name="diag" size={26} />
            </span>
            <div className="text-sm text-[var(--mut)]">{entries.length === 0 ? t("暂无调用记录") : t("没有匹配的记录")}</div>
            <p className="max-w-md text-xs leading-5 text-[var(--dim)]">
              {entries.length === 0
                ? t("在界面上启停服务、执行编译，或通过 MCP 调用工具后，记录会实时出现在这里。")
                : t("试试清除筛选条件。")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}