<script>
  import { api, profilePath } from "./api.js";
  import { pushToast } from "./toast.svelte.js";
  import { STATE_LABEL, uptime } from "./format.js";
  import Icon from "./Icon.svelte";
  import RegisterModal from "./RegisterModal.svelte";

  let { projects, onopen } = $props();

  let q = $state("");
  let statusFilter = $state("all");
  let selected = $state(new Set());
  let busy = $state({});
  let confirming = $state(null);
  let showRegister = $state(false);
  let now = $state(Date.now());

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  $effect(() => {
    if (!confirming) return;
    const t = setTimeout(() => (confirming = null), 3000);
    return () => clearTimeout(t);
  });

  const rows = $derived(
    projects.flatMap((p) =>
      p.profiles.map((s) => ({ ...s, project: p.project, key: p.project + "/" + s.profile }))
    )
  );
  const filtered = $derived(
    rows.filter((r) => {
      if (statusFilter !== "all" && r.state !== statusFilter) return false;
      if (q && !r.key.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    })
  );
  const runningCount = $derived(rows.filter((r) => r.state === "running").length);

  function toggle(key) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    selected = next;
  }

  async function act(key, fn, okMsg) {
    busy[key] = true;
    try {
      await fn();
      if (okMsg) pushToast(okMsg, { kind: "success" });
    } catch (e) {
      pushToast(`${key}: ${e.message}`, { kind: "error" });
    } finally {
      delete busy[key];
    }
  }

  const post = (r, suffix, body) =>
    api(profilePath(r.project, r.profile, suffix), { method: "POST", body: JSON.stringify(body ?? {}) });

  const start = (r) => act(r.key, () => post(r, "/start", { wait: true }), `${r.key} 已启动`);
  const stop = (r) => act(r.key, () => post(r, "/stop"), `${r.key} 已停止`);
  const restart = (r) => act(r.key, () => post(r, "/restart", { wait: true }), `${r.key} 已重启`);
  const compile = (r) => act(r.key, () => post(r, "/compile", { kind: "quick" }));

  async function unregister(r) {
    if (confirming !== r.key) {
      confirming = r.key;
      return;
    }
    confirming = null;
    busy[r.key] = true;
    try {
      await api(`/api/projects/${encodeURIComponent(r.project)}`, { method: "DELETE" });
      pushToast(`已卸载服务「${r.project}」`, { kind: "success" });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      delete busy[r.key];
    }
  }

  async function bulk(op) {
    const targets = filtered.filter((r) => selected.has(r.key));
    selected = new Set();
    let ok = 0;
    for (const r of targets) {
      try {
        await post(r, op === "start" ? "/start" : "/stop", op === "start" ? { wait: true } : {});
        ok++;
      } catch (e) {
        pushToast(`${r.key}: ${e.message}`, { kind: "error" });
      }
    }
    pushToast(`批量${op === "start" ? "启动" : "停止"}完成 ${ok}/${targets.length}`, {
      kind: ok === targets.length ? "success" : "error",
    });
  }

  function rowClick(e, r) {
    if (e.target.closest("button,input,a,select")) return;
    onopen(r.project, r.profile);
  }
</script>

<div class="view flex h-full flex-col">
  <div class="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
    <h1 class="flex items-center gap-2 text-base font-semibold"><Icon name="list" size={16} class="text-[var(--blu)]" />服务列表</h1>
    <span class="mono text-xs text-[var(--mut)]">{runningCount}/{rows.length} 运行中</span>
    <span class="flex-1"></span>
    <div class="relative">
      <Icon name="search" size={13} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
      <input class="input w-52 pl-8" placeholder="搜索服务…" bind:value={q} />
    </div>
    <select class="input" bind:value={statusFilter}>
      <option value="all">全部状态</option>
      <option value="running">运行中</option>
      <option value="starting">启动中</option>
      <option value="crashed">崩溃</option>
      <option value="idle">未启动</option>
    </select>
    <button class="btn btn-success" onclick={() => (showRegister = true)}><Icon name="plus" />创建服务</button>
  </div>

  {#if selected.size > 0}
    <div class="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg2)] px-4 py-2 text-sm">
      <span class="text-[var(--mut)]">已选 {selected.size} 个服务</span>
      <button class="btn btn-sm btn-success" onclick={() => bulk("start")}><Icon name="play" size={12} />批量启动</button>
      <button class="btn btn-sm btn-danger" onclick={() => bulk("stop")}><Icon name="stop" size={12} />批量停止</button>
      <button class="btn btn-sm btn-ghost" onclick={() => (selected = new Set())}>清除选择</button>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    <table class="table">
      <thead>
        <tr>
          <th class="w-8"></th>
          <th>服务名称</th>
          <th>状态</th>
          <th>PID</th>
          <th>uptime</th>
          <th>端口</th>
          <th>最近编译</th>
          <th class="text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as r (r.key)}
          <tr class="cursor-pointer" onclick={(e) => rowClick(e, r)}>
            <td>
              <input type="checkbox" checked={selected.has(r.key)} onchange={() => toggle(r.key)} onclick={(e) => e.stopPropagation()} />
            </td>
            <td>
              <span class="mono text-[var(--blu)]">{r.project}<span class="text-[var(--dim)]">/</span>{r.profile}</span>
            </td>
            <td>
              <span class="inline-flex items-center gap-2">
                <span class="dot dot-{r.state}"></span>
                <span class={r.state === "crashed" ? "text-[var(--red)]" : r.state === "running" ? "text-[var(--grn)]" : "text-[var(--mut)]"}>{STATE_LABEL[r.state] ?? r.state}</span>
              </span>
            </td>
            <td class="mono text-[var(--mut)]">{r.pid ?? "—"}</td>
            <td class="mono text-[var(--mut)]">{uptime(r.uptime_ms)}</td>
            <td class="mono text-[var(--mut)]">{r.port ?? "—"}</td>
            <td>
              {#if r.last_build}
                <span class="mono inline-flex items-center gap-1 text-xs {r.last_build.success ? 'text-[var(--grn)]' : 'text-[var(--red)]'}">
                  <Icon name={r.last_build.success ? "check" : "x"} size={11} />{r.last_build.kind}
                </span>
                <span class="text-xs text-[var(--dim)]">{r.last_build.duration_ms}ms</span>
              {:else}
                <span class="text-[var(--dim)]">—</span>
              {/if}
            </td>
            <td>
              <div class="flex justify-end gap-1">
                {#if busy[r.key]}
                  <span class="spinner self-center text-[var(--blu)]"></span>
                {/if}
                <button class="btn btn-sm btn-success" title="启动" disabled={r.state === "running" || r.state === "starting" || busy[r.key]} onclick={() => start(r)}><Icon name="play" size={12} />启动</button>
                <button class="btn btn-sm btn-danger" title="停止" disabled={r.state !== "running" && r.state !== "starting"} onclick={() => stop(r)}><Icon name="stop" size={12} />停止</button>
                <button class="btn btn-sm btn-warn" title="重启" disabled={busy[r.key]} onclick={() => restart(r)}><Icon name="restart" size={12} /></button>
                <button class="btn btn-sm" title="快速编译" disabled={busy[r.key]} onclick={() => compile(r)}><Icon name="compile" size={12} /></button>
                <button class="btn btn-sm btn-ghost" title="查看日志" onclick={() => onopen(r.project, r.profile)}><Icon name="logs" size={12} /></button>
                <button class="btn btn-sm btn-ghost {confirming === r.key ? '!text-[var(--red)]' : ''}" title={confirming === r.key ? "再次点击确认卸载" : "卸载服务（停止并移除注册）"} onclick={() => unregister(r)}>
                  {#if confirming === r.key}<span class="text-xs">确认?</span>{:else}<Icon name="trash" size={12} />{/if}
                </button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if filtered.length === 0}
      <div class="flex flex-col items-center gap-3 p-12 text-center">
        <span class="text-[var(--dim)]"><Icon name="server" size={32} /></span>
        <div class="text-sm text-[var(--dim)]">没有匹配的服务。</div>
        <button class="btn btn-success btn-sm" onclick={() => (showRegister = true)}><Icon name="plus" />创建第一个服务</button>
      </div>
    {/if}
  </div>
</div>

{#if showRegister}
  <RegisterModal onclose={() => (showRegister = false)} onsaved={() => (showRegister = false)} />
{/if}