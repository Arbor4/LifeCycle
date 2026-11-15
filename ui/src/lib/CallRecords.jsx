import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { copyText } from "./clipboard.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Switch from "./Switch.jsx";
import Segmented from "./Segmented.jsx";
import Modal from "./Modal.jsx";

const pretty = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

export default function CallRecords() {
  const { t } = useI18n();
  const [records, setRecords] = useState([]);
  const [live, setLive] = useState(true);
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("all");
  const [selected, setSelected] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api("/api/diagnostics");
      setRecords(d.slice().reverse());
      setUpdatedAt(Date.now());
    } catch {
      // 后端未就绪时静默
    }
  }, []);

  useEffect(() => {
    load();
    if (!live) return undefined;
    const tm = setInterval(load, 3000);
    return () => clearInterval(tm);
  }, [live, load]);

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        if (source !== "all" && r.source !== source) return false;
        if (result === "ok" && r.exit_code !== 0) return false;
        if (result === "err" && r.exit_code === 0) return false;
        return true;
      }),
    [records, source, result]
  );

  const stats = useMemo(() => {
    const total = records.length;
    const ok = records.filter((r) => r.exit_code === 0).length;
    const avg = total ? Math.round(records.reduce((n, r) => n + r.duration_ms, 0) / total) : 0;
    const mcp = records.filter((r) => r.source === "mcp").length;
    return { total, rate: total ? Math.round((ok / total) * 100) : 100, avg, mcp };
  }, [records]);

  async function copy(value, label) {
    if (await copyText(pretty(value))) pushToast(t("已复制到剪贴板"), { kind: "success", duration: 2500 });
    else pushToast(t("复制失败，请手动选择文本"), { kind: "error" });
    void label;
  }

  const tiles = [
    { label: t("总调用"), value: stats.total, icon: "diag", tone: "blu" },
    { label: t("成功率"), value: `${stats.rate}%`, icon: "check", tone: stats.rate >= 90 ? "grn" : "amb" },
    { label: t("平均耗时"), value: `${stats.avg}ms`, icon: "clock", tone: "cyn" },
    { label: "MCP", value: stats.mcp, icon: "plug", tone: "vio" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-2 gap-2 border-b border-[var(--line)] bg-[var(--bg1)] p-3 lg:grid-cols-4">
        {tiles.map((tl) => (
          <div key={tl.label} className="panel flex items-center gap-3 px-3 py-2">
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
              style={{ background: `color-mix(in oklab, var(--${tl.tone}) 14%, transparent)`, color: `var(--${tl.tone})` }}
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
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: t("全部来源") },
            { value: "ui", label: t("界面"), icon: "monitor" },
            { value: "mcp", label: "MCP", icon: "plug" },
          ]}
        />
        <Segmented
          value={result}
          onChange={setResult}
          options={[
            { value: "all", label: t("全部结果") },
            { value: "ok", label: t("成功"), icon: "check" },
            { value: "err", label: t("失败"), icon: "x" },
          ]}
        />
        <span className="mono text-xs text-[var(--dim)]">{t("{a}/{b} 条", { a: filtered.length, b: records.length })}</span>
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
        <button className="btn btn-sm" onClick={load}>
          <Icon name="refresh" size={12} />
          {t("刷新")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-28">{t("时间")}</th>
              <th className="w-20">{t("来源")}</th>
              <th>{t("工具")}</th>
              <th className="w-[30%]">{t("耗时")}</th>
              <th className="w-20">{t("结果")}</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id ?? `${r.ts}-${i}`} className="cursor-pointer" onClick={() => setSelected(r)}>
                <td className="mono text-xs text-[var(--mut)]">{new Date(r.ts).toLocaleTimeString()}</td>
                <td>
                  <span className={`badge ${r.source === "mcp" ? "badge-build" : "badge-read"}`}>
                    <Icon name={r.source === "mcp" ? "plug" : "monitor"} size={10} />
                    {r.source === "mcp" ? "MCP" : t("界面")}
                  </span>
                </td>
                <td className="mono text-xs">{r.tool}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="mono w-16 flex-none text-xs text-[var(--mut)]">{r.duration_ms}ms</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg3)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(2, Math.min(100, (r.duration_ms / Math.max(1, stats.avg * 4)) * 100))}%`,
                          background:
                            r.exit_code === 0
                              ? "linear-gradient(90deg, var(--acc-blu), var(--cyn))"
                              : "linear-gradient(90deg, var(--acc-red), var(--red))",
                        }}
                      />
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`badge ${r.exit_code === 0 ? "badge-control" : "badge-danger"}`}>
                    <Icon name={r.exit_code === 0 ? "check" : "x"} size={10} />
                    {r.exit_code === 0 ? "ok" : "err"}
                  </span>
                </td>
                <td className="text-[var(--dim)]">
                  <Icon name="right" size={12} />
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
            <div className="text-sm text-[var(--mut)]">{records.length === 0 ? t("暂无调用") : t("没有匹配的记录")}</div>
            <p className="max-w-md text-xs leading-5 text-[var(--dim)]">
              {t("在界面上启停服务、执行编译，或通过 MCP 调用工具后，记录会实时出现在这里。")}
            </p>
          </div>
        )}
      </div>

      {selected && (
        <Modal
          title={`${t("调用详情")} · ${selected.tool}`}
          icon="diag"
          tone={selected.exit_code === 0 ? "grn" : "red"}
          width={860}
          onClose={() => setSelected(null)}
          subtitle={`${selected.source === "mcp" ? "MCP" : t("界面")} · ${new Date(selected.ts).toLocaleString()} · ${selected.duration_ms}ms · exit ${selected.exit_code}`}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="field-label !mb-0">{t("请求")}</span>
                <span className="flex-1" />
                <button className="btn btn-sm btn-ghost" onClick={() => copy(selected.input)}>
                  <Icon name="copy" size={12} />
                  {t("复制请求")}
                </button>
              </div>
              <pre className="well mono max-h-[46vh] overflow-auto p-3 text-[11px] leading-4 text-[var(--log-info)]">
                {pretty(selected.input)}
              </pre>
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="field-label !mb-0">{t("响应")}</span>
                <span className="flex-1" />
                <button className="btn btn-sm btn-ghost" onClick={() => copy(selected.output)}>
                  <Icon name="copy" size={12} />
                  {t("复制响应")}
                </button>
              </div>
              <pre
                className="well mono max-h-[46vh] overflow-auto p-3 text-[11px] leading-4"
                style={{ color: selected.exit_code === 0 ? "var(--log-info)" : "var(--log-error)" }}
              >
                {pretty(selected.output)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}