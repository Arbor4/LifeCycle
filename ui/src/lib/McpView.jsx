import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { copyText, downloadText } from "./clipboard.js";
import { probeMcp } from "./mcp.js";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";
import Segmented from "./Segmented.jsx";

const RISK_LABEL = { read: "只读", control: "进程", build: "编译", danger: "高危" };
const GROUP_ICON = { 查询: "eye", 进程: "play", 编译: "compile", 配置: "settings" };
const TONE_OF = { read: "blu", control: "grn", build: "amb", danger: "red" };

function matches(expose, tool) {
  if (expose.length === 0) return tool !== "reload_config";
  return expose.some((p) => (p.endsWith("*") ? tool.startsWith(p.slice(0, -1)) : p === tool));
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

export default function McpView() {
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

  const applyProject = useCallback((data, name) => {
    const p = data.projects.find((x) => x.project === name);
    if (!p) return;
    setSel(name);
    setTransport(p.transport);
    // 空白名单 = 隐式默认，展开成实际生效的勾选，避免"看起来全关其实全开"。
    setPicked(new Set(p.expose.length ? p.expose : data.tools.filter((t) => t.default_exposed).map((t) => t.name)));
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
  // 空白名单 = 隐式默认；比较时先归一化，避免一打开就提示"未保存"。
  const savedPicked = useMemo(
    () =>
      new Set(
        project
          ? project.expose.length
            ? project.expose
            : info.tools.filter((t) => t.default_exposed).map((t) => t.name)
          : []
      ),
    [project, info]
  );
  const ordered = useMemo(() => (info ? info.tools.filter((t) => picked.has(t.name)).map((t) => t.name) : []), [info, picked]);
  const effective = useMemo(() => ordered.filter((n) => matches(ordered, n)), [ordered]);
  const dirty = useMemo(
    () => !!project && (transport !== project.transport || !sameSet(picked, savedPicked)),
    [project, transport, picked, savedPicked]
  );
  const grouped = useMemo(() => {
    const out = [];
    for (const t of info?.tools ?? []) {
      let g = out.find((x) => x.name === t.group);
      if (!g) out.push((g = { name: t.group, tools: [] }));
      g.tools.push(t);
    }
    return out;
  }, [info]);
  const tomlPreview = `[mcp]\ntransport = "${transport}"\nexpose = [${ordered.map((n) => `"${n}"`).join(", ")}]`;
  const probeDiff = useMemo(() => {
    if (!probe) return null;
    const seen = new Set(probe.tools.map((t) => t.name));
    return {
      missing: effective.filter((n) => !seen.has(n)),
      extra: probe.tools.map((t) => t.name).filter((n) => !effective.includes(n)),
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
    const names = g.tools.map((t) => t.name);
    const all = names.every((n) => picked.has(n));
    setPicked((prev) => {
      const next = new Set(prev);
      for (const n of names) all ? next.delete(n) : next.add(n);
      return next;
    });
  }
  function applyPreset(p) {
    setPicked(new Set(p.expose));
    pushToast(`已套用预设「${p.name}」，记得保存`, { kind: "info" });
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
      pushToast(`已写入 ${r.config_path} · ${r.effective.length} 个工具对 AI 可见`, { kind: "success" });
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
      pushToast("已复制到剪贴板", { kind: "success", duration: 2500 });
    } else {
      pushToast("复制失败，请手动选择文本", { kind: "error" });
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
        pushToast(`已从 ${r.name} 移除 LifeCycle`, { kind: "success" });
      } else {
        pushToast(`已写入 ${r.name}：${r.path}`, {
          kind: "success",
          duration: 15000,
          action: { label: "撤销", fn: () => writeClient(c, "remove") },
        });
      }
    } catch (e) {
      pushToast(`${c.name}: ${e.message}`, { kind: "error" });
    } finally {
      setBusyClient(null);
    }
  }

  return (
    <div className="view flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="plug" size={16} className="text-[var(--cyn)]" />
          MCP 配置
        </h1>
        <span className="text-xs text-[var(--mut)]">决定 AI 客户端能看到、能调用哪些工具</span>
        <span className="flex-1" />
        {info && (
          <>
            <button className="chip mono" title="点击复制 MCP 端点" onClick={() => copy(info.endpoint, "endpoint")}>
              <Icon name={copied === "endpoint" ? "check" : "link"} size={12} />
              {info.endpoint}
            </button>
            <button className="btn btn-sm" disabled={probing} onClick={runProbe}>
              {probing ? <span className="spinner" /> : <Icon name="zap" size={12} />}
              测试连接
            </button>
          </>
        )}
      </div>

      {loadError && (
        <div className="m-4 rounded-lg border border-[var(--red)] bg-[var(--red-soft)] px-3 py-2 text-sm text-[var(--red)]">
          无法读取 MCP 配置：{loadError}
        </div>
      )}

      {info ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className="space-y-4">
                <div className="panel p-4">
                  <div className="field-label">项目</div>
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
                        <span className="text-[var(--dim)]">{p.effective.length} 工具</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-start gap-4">
                    <div>
                      <div className="field-label">传输方式</div>
                      <Segmented
                        value={transport}
                        onChange={setTransport}
                        options={[
                          { value: "stdio", label: "stdio", icon: "terminal", title: "客户端拉起本地进程" },
                          { value: "http", label: "HTTP", icon: "link", title: "连接常驻 HTTP 服务" },
                          { value: "both", label: "两者", icon: "grid", title: "同时声明两种传输" },
                        ]}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="field-label">快速预设</div>
                      <div className="flex flex-wrap gap-1.5">
                        {info.presets.map((p) => (
                          <button key={p.id} className="btn btn-sm" title={p.description} onClick={() => applyPreset(p)}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {project && (
                    <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
                      <Icon name="info" size={12} className="mt-0.5 flex-none" />
                      <span>
                        写入 <span className="mono">{project.config_path}</span> 的 [mcp] 段，其余配置与注释保持不变；新的 MCP
                        会话立即生效。
                      </span>
                    </p>
                  )}
                </div>

                <div className="panel">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                    <Icon name="shield" size={15} className="text-[var(--grn)]" />
                    <h2 className="text-sm font-semibold">工具白名单</h2>
                    <span className="mono text-xs text-[var(--mut)]">
                      AI 可见 {effective.length}/{info.tools.length}
                    </span>
                    <span className="flex-1" />
                    <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set(info.tools.map((t) => t.name)))}>
                      全选
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>
                      清空
                    </button>
                  </div>

                  {picked.size === 0 && (
                    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-[var(--amb)] bg-[var(--amb-soft)] px-3 py-2 text-xs leading-5 text-[var(--amb)]">
                      <Icon name="warn" size={13} className="mt-0.5 flex-none" />
                      <span>空白名单会回退到默认策略（除 reload_config 外全部开放）。请至少勾选一个工具后再保存。</span>
                    </div>
                  )}

                  <div className="p-2">
                    {grouped.map((g) => {
                      const names = g.tools.map((t) => t.name);
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
                              title={`全选「${g.name}」`}
                            />
                            <Icon name={GROUP_ICON[g.name] ?? "grid"} size={12} className="text-[var(--dim)]" />
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{g.name}</span>
                            <span className="text-[11px] text-[var(--dim)]">
                              {names.filter((n) => picked.has(n)).length}/{names.length}
                            </span>
                          </div>
                          {g.tools.map((t) => (
                            <div className="cb-row" key={t.name}>
                              <Checkbox
                                size="lg"
                                tone={TONE_OF[t.risk]}
                                checked={picked.has(t.name)}
                                onChange={() => toggle(t.name)}
                                title={t.summary}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="mono text-[13px]">{t.name}</span>
                                  <span className={`badge badge-${t.risk}`}>{RISK_LABEL[t.risk]}</span>
                                  {!t.default_exposed && <span className="text-[11px] text-[var(--dim)]">默认不暴露</span>}
                                </div>
                                <div className="truncate text-xs text-[var(--mut)]" title={t.summary}>
                                  {t.summary}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-[var(--line)] p-4">
                    <div className="field-label">将写入的配置</div>
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
                          <h2 className="text-sm font-semibold text-[var(--grn)]">连接正常</h2>
                          <span className="mono text-xs text-[var(--mut)]">{probe.ms}ms</span>
                          <span className="flex-1" />
                          <button className="btn btn-sm btn-ghost" onClick={() => setProbe(null)} aria-label="关闭">
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="well p-2">
                            <div className="text-[var(--dim)]">服务端</div>
                            <div className="mono truncate">
                              {probe.serverInfo.name ?? "lifecycle"} {probe.serverInfo.version ?? ""}
                            </div>
                          </div>
                          <div className="well p-2">
                            <div className="text-[var(--dim)]">协议版本</div>
                            <div className="mono truncate">{probe.protocol}</div>
                          </div>
                        </div>
                        <div className="field-label mt-3">AI 此刻可见的 {probe.tools.length} 个工具</div>
                        <div className="flex flex-wrap gap-1">
                          {probe.tools.map((t) => (
                            <span key={t.name} className="chip mono cursor-default" title={t.description}>
                              {t.name}
                            </span>
                          ))}
                        </div>
                        {probeDiff && (probeDiff.missing.length > 0 || probeDiff.extra.length > 0) && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[var(--amb)]">
                            <Icon name="warn" size={12} className="mt-0.5 flex-none" />
                            <span>
                              与当前白名单不一致（{probeDiff.missing.length} 缺失 / {probeDiff.extra.length} 多余）。已连接的客户端需重开会话才会刷新。
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Icon name="warn" size={15} className="text-[var(--red)]" />
                          <h2 className="text-sm font-semibold text-[var(--red)]">连接失败</h2>
                          <span className="flex-1" />
                          <button className="btn btn-sm btn-ghost" onClick={() => setProbeError(null)} aria-label="关闭">
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                        <p className="mono mt-2 break-all text-xs text-[var(--mut)]">{probeError}</p>
                        <p className="mt-2 text-xs text-[var(--dim)]">确认后端在 {info.port} 端口运行，且 /mcp 未被占用。</p>
                      </>
                    )}
                  </div>
                )}

                <div className="panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon name="terminal" size={15} className="text-[var(--blu)]" />
                    <h2 className="text-sm font-semibold">接入方式</h2>
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
                        ? `启动命令（${info.stdio.kind === "bundled" ? "内置于 App" : "独立二进制"}）`
                        : "Streamable HTTP 端点"}
                    </div>
                    <div className="well flex items-start gap-2 p-2">
                      <code className="mono min-w-0 flex-1 break-all text-xs leading-5">
                        {mode === "stdio" ? `${info.stdio.command} ${info.stdio.args.join(" ")}` : info.endpoint}
                      </code>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="复制"
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
                          配置中已注入当前 PATH，确保从 GUI 客户端拉起时能找到 node / npm / cargo。
                          {!info.stdio.available && <span className="text-[var(--red)]"> 未找到可执行文件，请先构建。</span>}
                        </>
                      ) : (
                        "复用常驻后端，无需客户端再拉起进程；仅监听 127.0.0.1。"
                      )}
                    </p>
                  </div>
                </div>

                <div className="panel">
                  <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                    <Icon name="grid" size={15} className="text-[var(--cyn)]" />
                    <h2 className="text-sm font-semibold">客户端接入</h2>
                    <span className="text-xs text-[var(--dim)]">
                      {info.clients.filter((c) => c.configured).length}/{info.clients.length} 已接入
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
                              已接入
                            </span>
                          ) : c.exists ? (
                            <span className="badge badge-read">已有配置</span>
                          ) : c.installed ? (
                            <span className="badge badge-build">未配置</span>
                          ) : null}
                          <span className="flex-1" />
                          <span className="text-[11px] text-[var(--dim)]">{c.supports_http ? "stdio + HTTP" : "仅 stdio"}</span>
                        </div>
                        {c.path && (
                          <div className="mono mt-1 truncate text-[11px] text-[var(--dim)]" title={c.path}>
                            {c.path}
                          </div>
                        )}
                        <p className="mt-1 text-xs leading-5 text-[var(--mut)]">{c.note}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button className="btn btn-sm" onClick={() => copy(snippetOf(c), c.id)}>
                            <Icon name={copied === c.id ? "check" : "copy"} size={12} />
                            {copied === c.id ? "已复制" : "复制"}
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
                            下载
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                          >
                            <Icon name="eye" size={12} />
                            {expanded === c.id ? "收起" : "查看"}
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
                                移除
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={busyClient === c.id}
                                onClick={() => writeClient(c, "write")}
                              >
                                {busyClient === c.id ? <span className="spinner" /> : <Icon name="save" size={12} />}
                                写入配置
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
              <span className="text-sm">白名单有未保存的更改</span>
              <span className="mono text-xs text-[var(--mut)]">
                {sel} · {effective.length} 工具
              </span>
              <span className="flex-1" />
              <button className="btn btn-sm" onClick={() => applyProject(info, sel)}>
                放弃
              </button>
              <button className="btn btn-sm btn-primary" disabled={saving || picked.size === 0} onClick={save}>
                {saving ? <span className="spinner" /> : <Icon name="save" size={12} />}
                保存到 lifecycle.toml
              </button>
            </div>
          )}
        </>
      ) : (
        !loadError && <div className="flex flex-1 items-center justify-center text-[var(--dim)]">加载中…</div>
      )}
    </div>
  );
}