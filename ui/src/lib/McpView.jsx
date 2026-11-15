import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { copyText, downloadText } from "./clipboard.js";
import { probeMcp } from "./mcp.js";
import { useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";
import Segmented from "./Segmented.jsx";
import CallRecords from "./CallRecords.jsx";

const GROUP_ICON = { 查询: "eye", 进程: "play", 编译: "compile", 配置: "settings", 分组: "group" };
const TONE_OF = { read: "blu", control: "grn", build: "amb", danger: "red" };

function matches(expose, tool) {
  if (expose.length === 0) return tool !== "reload_config";
  return expose.some((p) => (p.endsWith("*") ? tool.startsWith(p.slice(0, -1)) : p === tool));
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

export default function McpView() {
  const { t, lang } = useI18n();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sel, setSel] = useState(null);
  const [transport, setTransport] = useState("stdio");
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("stdio");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState(null);
  const [probeError, setProbeError] = useState(null);
  const [busyClient, setBusyClient] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(null);
  const [tab, setTab] = useState("config");

  const toolSummary = (tool) => (lang === "zh" ? tool.summary : t(`tool.${tool.name}`));
  const presetName = (p) => (lang === "zh" ? p.name : t(`preset.${p.id}`));
  const presetDesc = (p) => (lang === "zh" ? p.description : t(`preset.${p.id}.desc`));
  const clientNote = (c) => (lang === "zh" ? c.note : t(`client.${c.id}.note`));

  const applyProject = useCallback((data, name) => {
    const p = data.projects.find((x) => x.project === name);
    if (!p) return;
    setSel(name);
    setTransport(p.transport);
    // 空白名单 = 隐式默认，展开成实际生效的勾选，避免"看起来全关其实全开"。
    setPicked(new Set(p.expose.length ? p.expose : data.tools.filter((x) => x.default_exposed).map((x) => x.name)));
  }, []);

  const load = useCallback(
    async (keepSel = true) => {
      try {
        const data = await api("/api/mcp");
        setInfo(data);
        setLoadError(null);
        const name = keepSel && data.projects.some((p) => p.project === sel) ? sel : data.projects[0]?.project;
        if (name) applyProject(data, name);
      } catch (e) {
        setLoadError(e.message);
      }
    },
    [sel, applyProject]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const project = useMemo(() => info?.projects.find((p) => p.project === sel) ?? null, [info, sel]);
  const savedPicked = useMemo(
    () =>
      new Set(
        project
          ? project.expose.length
            ? project.expose
            : info.tools.filter((x) => x.default_exposed).map((x) => x.name)
          : []
      ),
    [project, info]
  );
  const ordered = useMemo(() => (info ? info.tools.filter((x) => picked.has(x.name)).map((x) => x.name) : []), [info, picked]);
  const effective = useMemo(() => ordered.filter((n) => matches(ordered, n)), [ordered]);
  const dirty = useMemo(
    () => !!project && (transport !== project.transport || !sameSet(picked, savedPicked)),
    [project, transport, picked, savedPicked]
  );
  const grouped = useMemo(() => {
    const out = [];
    for (const x of info?.tools ?? []) {
      let g = out.find((y) => y.name === x.group);
      if (!g) out.push((g = { name: x.group, tools: [] }));
      g.tools.push(x);
    }
    return out;
  }, [info]);
  const tomlPreview = `[mcp]\ntransport = "${transport}"\nexpose = [${ordered.map((n) => `"${n}"`).join(", ")}]`;
  const probeDiff = useMemo(() => {
    if (!probe) return null;
    const seen = new Set(probe.tools.map((x) => x.name));
    return {
      missing: effective.filter((n) => !seen.has(n)),
      extra: probe.tools.map((x) => x.name).filter((n) => !effective.includes(n)),
    };
  }, [probe, effective]);

  function toggle(name) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleGroup(g) {
    const names = g.tools.map((x) => x.name);
    const all = names.every((n) => picked.has(n));
    setPicked((prev) => {
      const next = new Set(prev);
      for (const n of names) all ? next.delete(n) : next.add(n);
      return next;
    });
  }
  function applyPreset(p) {
    setPicked(new Set(p.expose));
    pushToast(t("已套用预设「{name}」，记得保存", { name: presetName(p) }), { kind: "info" });
  }

  const runProbe = useCallback(async () => {
    if (!info) return;
    setProbing(true);
    setProbeError(null);
    try {
      setProbe(await probeMcp(info.endpoint));
    } catch (e) {
      setProbe(null);
      setProbeError(e.message);
    } finally {
      setProbing(false);
    }
  }, [info]);

  async function save() {
    if (!project || picked.size === 0) return;
    setSaving(true);
    try {
      const r = await api(`/api/mcp/projects/${encodeURIComponent(sel)}`, {
        method: "PUT",
        body: JSON.stringify({ transport, expose: ordered }),
      });
      pushToast(t("已写入 {path} · {n} 个工具对 AI 可见", { path: r.config_path, n: r.effective.length }), { kind: "success" });
      await load();
      if (probe) runProbe();
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function copy(text, id) {
    if (await copyText(text)) {
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
      pushToast(t("已复制到剪贴板"), { kind: "success", duration: 2500 });
    } else {
      pushToast(t("复制失败，请手动选择文本"), { kind: "error" });
    }
  }

  const snippetOf = (c) => (mode === "http" && c.supports_http ? c.snippet_http : c.snippet_stdio);

  async function writeClient(c, action) {
    setBusyClient(c.id);
    try {
      const r = await api("/api/mcp/client-config", {
        method: "POST",
        body: JSON.stringify({ client: c.id, mode, action }),
      });
      await load();
      if (action === "remove") {
        pushToast(t("已从 {name} 移除 LifeCycle", { name: r.name }), { kind: "success" });
      } else {
        pushToast(t("已写入 {name}：{path}", { name: r.name, path: r.path }), {
          kind: "success",
          duration: 15000,
          action: { label: t("撤销"), fn: () => writeClient(c, "remove") },
        });
      }
    } catch (e) {
      pushToast(t("{name}: {err}", { name: c.name, err: e.message }), { kind: "error" });
    } finally {
      setBusyClient(null);
    }
  }

  return (
    <div className="view flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="plug" size={16} className="text-[var(--cyn)]" />
          {t("MCP 配置")}
        </h1>
        <span className="text-xs text-[var(--mut)]">{t("决定 AI 客户端能看到、能调用哪些工具")}</span>
        <span className="flex-1" />
        {info && (
          <>
            <button className="chip mono" title={t("点击复制 MCP 端点")} onClick={() => copy(info.endpoint, "endpoint")}>
              <Icon name={copied === "endpoint" ? "check" : "link"} size={12} />
              {info.endpoint}
            </button>
            <button className="btn btn-sm" disabled={probing} onClick={runProbe}>
              {probing ? <span className="spinner" /> : <Icon name="zap" size={12} />}
              {t("测试连接")}
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--bg1)] px-4">
        {[
          ["config", t("工具白名单"), "shield"],
          ["calls", t("调用记录"), "diag"],
        ].map(([id, label, icon]) => (
          <button
            key={id}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
              tab === id
                ? "border-b-2 border-[var(--cyn)] font-medium text-[var(--cyn)]"
                : "text-[var(--mut)] hover:text-[var(--txt)]"
            }`}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={13} />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-[11px] text-[var(--dim)]">{t("UI 与 MCP 的每次工具调用，含请求与响应")}</span>
      </div>

      {loadError && (
        <div className="m-4 rounded-lg border border-[var(--red)] bg-[var(--red-soft)] px-3 py-2 text-sm text-[var(--red)]">
          {t("无法读取 MCP 配置：{err}", { err: loadError })}
        </div>
      )}

      {tab === "calls" ? (
        <CallRecords />
      ) : info ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className="space-y-4">
                <div className="panel p-4">
                  <div className="field-label">{t("项目")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {info.projects.map((p) => (
                      <button
                        key={p.project}
                        className="chip"
                        data-active={sel === p.project}
                        onClick={() => applyProject(info, p.project)}
                      >
                        <Icon name="server" size={12} />
                        <span className="mono">{p.project}</span>
                        <span className="text-[var(--dim)]">{t("{n} 工具", { n: p.effective.length })}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-start gap-4">
                    <div>
                      <div className="field-label">{t("传输方式")}</div>
                      <Segmented
                        value={transport}
                        onChange={setTransport}
                        options={[
                          { value: "stdio", label: "stdio", icon: "terminal", title: t("客户端拉起本地进程") },
                          { value: "http", label: "HTTP", icon: "link", title: t("连接常驻 HTTP 服务") },
                          { value: "both", label: t("两者"), icon: "grid", title: t("同时声明两种传输") },
                        ]}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="field-label">{t("快速预设")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {info.presets.map((p) => (
                          <button key={p.id} className="btn btn-sm" title={presetDesc(p)} onClick={() => applyPreset(p)}>
                            {presetName(p)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {project && (
                    <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
                      <Icon name="info" size={12} className="mt-0.5 flex-none" />
                      <span>{t("写入 {path} 的 [mcp] 段，其余配置与注释保持不变；新的 MCP 会话立即生效。", { path: project.config_path })}</span>
                    </p>
                  )}
                </div>

                <div className="panel">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                    <Icon name="shield" size={15} className="text-[var(--grn)]" />
                    <h2 className="text-sm font-semibold">{t("工具白名单")}</h2>
                    <span className="mono text-xs text-[var(--mut)]">
                      {t("AI 可见 {a}/{b}", { a: effective.length, b: info.tools.length })}
                    </span>
                    <span className="flex-1" />
                    <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set(info.tools.map((x) => x.name)))}>
                      {t("全选")}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>
                      {t("清空")}
                    </button>
                  </div>

                  {picked.size === 0 && (
                    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-[var(--amb)] bg-[var(--amb-soft)] px-3 py-2 text-xs leading-5 text-[var(--amb)]">
                      <Icon name="warn" size={13} className="mt-0.5 flex-none" />
                      <span>{t("空白名单会回退到默认策略（除 reload_config 外全部开放）。请至少勾选一个工具后再保存。")}</span>
                    </div>
                  )}

                  <div className="p-2">
                    {grouped.map((g) => {
                      const names = g.tools.map((x) => x.name);
                      const all = names.every((n) => picked.has(n));
                      const some = names.some((n) => picked.has(n));
                      return (
                        <div key={g.name}>
                          <div className="mt-1 flex items-center gap-2 px-2 py-1">
                            <Checkbox
                              size="sm"
                              tone="vio"
                              checked={all}
                              indeterminate={some && !all}
                              onChange={() => toggleGroup(g)}
                              title={t("全选「{group}」", { group: t(g.name) })}
                            />
                            <Icon name={GROUP_ICON[g.name] ?? "grid"} size={12} className="text-[var(--dim)]" />
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{t(g.name)}</span>
                            <span className="text-[11px] text-[var(--dim)]">
                              {names.filter((n) => picked.has(n)).length}/{names.length}
                            </span>
                          </div>
                          {g.tools.map((tool) => (
                            <div className="cb-row" key={tool.name}>
                              <Checkbox
                                size="lg"
                                tone={TONE_OF[tool.risk]}
                                checked={picked.has(tool.name)}
                                onChange={() => toggle(tool.name)}
                                title={toolSummary(tool)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="mono text-[13px]">{tool.name}</span>
                                  <span className={`badge badge-${tool.risk}`}>{t(`risk.${tool.risk}`)}</span>
                                  {!tool.default_exposed && <span className="text-[11px] text-[var(--dim)]">{t("默认不暴露")}</span>}
                                </div>
                                <div className="truncate text-xs text-[var(--mut)]" title={toolSummary(tool)}>
                                  {toolSummary(tool)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-[var(--line)] p-4">
                    <div className="field-label">{t("将写入的配置")}</div>
                    <pre className="well mono overflow-x-auto p-3 text-xs leading-5 text-[var(--mut)]">{tomlPreview}</pre>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {(probe || probeError) && (
                  <div className="panel p-4">
                    {probe ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="dot dot-running" />
                          <h2 className="text-sm font-semibold text-[var(--grn)]">{t("连接正常")}</h2>
                          <span className="mono text-xs text-[var(--mut)]">{probe.ms}ms</span>
                          <span className="flex-1" />
                          <button className="btn btn-sm btn-ghost" onClick={() => setProbe(null)} aria-label={t("关闭")}>
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="well p-2">
                            <div className="text-[var(--dim)]">{t("服务端")}</div>
                            <div className="mono truncate">
                              {probe.serverInfo.name ?? "lifecycle"} {probe.serverInfo.version ?? ""}
                            </div>
                          </div>
                          <div className="well p-2">
                            <div className="text-[var(--dim)]">{t("协议版本")}</div>
                            <div className="mono truncate">{probe.protocol}</div>
                          </div>
                        </div>
                        <div className="field-label mt-3">{t("AI 此刻可见的 {n} 个工具", { n: probe.tools.length })}</div>
                        <div className="flex flex-wrap gap-1">
                          {probe.tools.map((x) => (
                            <span key={x.name} className="chip mono cursor-default" title={x.description}>
                              {x.name}
                            </span>
                          ))}
                        </div>
                        {probeDiff && (probeDiff.missing.length > 0 || probeDiff.extra.length > 0) && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[var(--amb)]">
                            <Icon name="warn" size={12} className="mt-0.5 flex-none" />
                            <span>
                              {t("与当前白名单不一致（{a} 缺失 / {b} 多余）。已连接的客户端需重开会话才会刷新。", {
                                a: probeDiff.missing.length,
                                b: probeDiff.extra.length,
                              })}
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Icon name="warn" size={15} className="text-[var(--red)]" />
                          <h2 className="text-sm font-semibold text-[var(--red)]">{t("连接失败")}</h2>
                          <span className="flex-1" />
                          <button className="btn btn-sm btn-ghost" onClick={() => setProbeError(null)} aria-label={t("关闭")}>
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                        <p className="mono mt-2 break-all text-xs text-[var(--mut)]">{probeError}</p>
                        <p className="mt-2 text-xs text-[var(--dim)]">{t("确认后端在 {port} 端口运行，且 /mcp 未被占用。", { port: info.port })}</p>
                      </>
                    )}
                  </div>
                )}

                <div className="panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon name="terminal" size={15} className="text-[var(--blu)]" />
                    <h2 className="text-sm font-semibold">{t("接入方式")}</h2>
                    <span className="flex-1" />
                    <Segmented
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "stdio", label: "stdio", icon: "terminal" },
                        { value: "http", label: "HTTP", icon: "link" },
                      ]}
                    />
                  </div>
                  <div className="mt-3">
                    <div className="field-label">
                      {mode === "stdio"
                        ? info.stdio.kind === "bundled"
                          ? t("启动命令（内置于 App）")
                          : t("启动命令（独立二进制）")
                        : t("Streamable HTTP 端点")}
                    </div>
                    <div className="well flex items-start gap-2 p-2">
                      <code className="mono min-w-0 flex-1 break-all text-xs leading-5">
                        {mode === "stdio" ? `${info.stdio.command} ${info.stdio.args.join(" ")}` : info.endpoint}
                      </code>
                      <button
                        className="btn btn-sm btn-ghost"
                        title={t("复制")}
                        onClick={() =>
                          copy(mode === "stdio" ? `${info.stdio.command} ${info.stdio.args.join(" ")}` : info.endpoint, "conn")
                        }
                      >
                        <Icon name={copied === "conn" ? "check" : "copy"} size={12} />
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--dim)]">
                      {mode === "stdio" ? (
                        <>
                          {t("配置中已注入当前 PATH，确保从 GUI 客户端拉起时能找到 node / npm / cargo。")}
                          {!info.stdio.available && <span className="text-[var(--red)]"> {t("未找到可执行文件，请先构建。")}</span>}
                        </>
                      ) : (
                        t("复用常驻后端，无需客户端再拉起进程；仅监听 127.0.0.1。")
                      )}
                    </p>
                  </div>
                </div>

                <div className="panel">
                  <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                    <Icon name="grid" size={15} className="text-[var(--cyn)]" />
                    <h2 className="text-sm font-semibold">{t("客户端接入")}</h2>
                    <span className="text-xs text-[var(--dim)]">
                      {t("{a}/{b} 已接入", {
                        a: info.clients.filter((c) => c.configured).length,
                        b: info.clients.length,
                      })}
                    </span>
                  </div>
                  <div className="space-y-2 p-3">
                    {info.clients.map((c) => (
                      <div key={c.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg0)] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{c.name}</span>
                          {c.configured ? (
                            <span className="badge badge-control">
                              <Icon name="check" size={10} />
                              {t("已接入")}
                            </span>
                          ) : c.exists ? (
                            <span className="badge badge-read">{t("已有配置")}</span>
                          ) : c.installed ? (
                            <span className="badge badge-build">{t("未配置")}</span>
                          ) : null}
                          <span className="flex-1" />
                          <span className="text-[11px] text-[var(--dim)]">{c.supports_http ? t("stdio + HTTP") : t("仅 stdio")}</span>
                        </div>
                        {c.path && (
                          <div className="mono mt-1 truncate text-[11px] text-[var(--dim)]" title={c.path}>
                            {c.path}
                          </div>
                        )}
                        <p className="mt-1 text-xs leading-5 text-[var(--mut)]">{clientNote(c)}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button className="btn btn-sm" onClick={() => copy(snippetOf(c), c.id)}>
                            <Icon name={copied === c.id ? "check" : "copy"} size={12} />
                            {copied === c.id ? t("已复制") : t("复制")}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              downloadText(
                                `lifecycle-mcp-${c.id}.${c.id === "codex" ? "toml" : "json"}`,
                                snippetOf(c),
                                c.id === "codex" ? "text/plain" : "application/json"
                              )
                            }
                          >
                            <Icon name="download" size={12} />
                            {t("下载")}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                          >
                            <Icon name="eye" size={12} />
                            {expanded === c.id ? t("收起") : t("查看")}
                          </button>
                          <span className="flex-1" />
                          {c.can_write &&
                            (c.configured ? (
                              <button
                                className="btn btn-sm btn-ghost"
                                disabled={busyClient === c.id}
                                onClick={() => writeClient(c, "remove")}
                              >
                                <Icon name="trash" size={12} />
                                {t("移除")}
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={busyClient === c.id}
                                onClick={() => writeClient(c, "write")}
                              >
                                {busyClient === c.id ? <span className="spinner" /> : <Icon name="save" size={12} />}
                                {t("写入配置")}
                              </button>
                            ))}
                        </div>
                        {expanded === c.id && (
                          <pre className="well mono mt-2 max-h-52 overflow-auto p-2 text-[11px] leading-4 text-[var(--mut)]">
                            {snippetOf(c)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {dirty && (
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--bg2)] px-4 py-2.5">
              <span className="dot dot-starting" />
              <span className="text-sm">{t("白名单有未保存的更改")}</span>
              <span className="mono text-xs text-[var(--mut)]">{t("{sel} · {n} 工具", { sel, n: effective.length })}</span>
              <span className="flex-1" />
              <button className="btn btn-sm" onClick={() => applyProject(info, sel)}>
                {t("放弃")}
              </button>
              <button className="btn btn-sm btn-primary" disabled={saving || picked.size === 0} onClick={save}>
                {saving ? <span className="spinner" /> : <Icon name="save" size={12} />}
                {t("保存到 lifecycle.toml")}
              </button>
            </div>
          )}
        </>
      ) : (
        !loadError && <div className="flex flex-1 items-center justify-center text-[var(--dim)]">{t("加载中…")}</div>
      )}
    </div>
  );
}