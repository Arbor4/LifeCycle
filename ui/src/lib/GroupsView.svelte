<script>
  import { onMount } from "svelte";
  import { api } from "./api.js";
  import { pushToast } from "./toast.svelte.js";
  import { STATE_LABEL } from "./format.js";
  import GroupModal from "./GroupModal.svelte";
  import Icon from "./Icon.svelte";

  let { projects, onopen } = $props();

  let groups = $state([]);
  let busy = $state({});
  let results = $state({});
  let editing = $state(null);
  let showModal = $state(false);

  async function load() {
    groups = await api("/api/groups");
  }
  onMount(load);

  const statusOf = (m) =>
    projects.find((p) => p.project === m.project)?.profiles.find((s) => s.profile === m.profile);

  function runningCount(g) {
    return g.members.filter((m) => statusOf(m)?.state === "running").length;
  }

  async function op(g, name) {
    busy[g.id] = name;
    results[g.id] = null;
    try {
      const r = await api(`/api/groups/${g.id}/${name}`, {
        method: "POST",
        body: JSON.stringify({ wait: name !== "stop" }),
      });
      results[g.id] = r.results;
      const ok = r.results.filter((x) => x.ok).length;
      const label = { start: "启动", stop: "停止", restart: "重启" }[name];
      pushToast(`分组「${g.name}」${label}完成 ${ok}/${r.results.length}`, {
        kind: ok === r.results.length ? "success" : "error",
      });
    } catch (e) {
      pushToast(`分组「${g.name}」: ${e.message}`, { kind: "error" });
    } finally {
      delete busy[g.id];
    }
  }

  async function remove(g) {
    try {
      const removed = await api(`/api/groups/${g.id}`, { method: "DELETE" });
      await load();
      pushToast(`已删除分组「${g.name}」`, {
        duration: 15000,
        action: {
          label: "撤销",
          fn: async () => {
            await api(`/api/groups/${removed.id}`, {
              method: "PUT",
              body: JSON.stringify({ name: removed.name, members: removed.members }),
            });
            await load();
          },
        },
      });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    }
  }
</script>

<div class="view flex h-full flex-col">
  <div class="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
    <h1 class="text-base font-semibold">服务分组</h1>
    <span class="text-xs text-[var(--mut)]">微服务一键启停 · {groups.length} 个分组</span>
    <span class="flex-1"></span>
    <button class="btn btn-vio" onclick={() => { editing = null; showModal = true; }}><Icon name="plus" />新建分组</button>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {#each groups as g (g.id)}
        <div class="panel flex flex-col p-4">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full bg-[var(--vio)] shadow-[0_0_8px_rgba(177,140,255,0.7)]"></span>
            <h2 class="text-sm font-semibold">{g.name}</h2>
            <span class="text-xs text-[var(--dim)]">{g.members.length} 个服务</span>
            <span class="flex-1"></span>
            <span class="mono text-xs {runningCount(g) === g.members.length ? 'text-[var(--grn)]' : 'text-[var(--mut)]'}">
              {runningCount(g)}/{g.members.length} 运行中
            </span>
          </div>

          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each g.members as m (m.project + "/" + m.profile)}
              {@const s = statusOf(m)}
              <button class="chip" title={STATE_LABEL[s?.state] ?? "未知"} onclick={() => onopen(m.project, m.profile)}>
                <span class="dot dot-{s?.state ?? 'idle'}"></span>
                <span class="mono">{m.project}/{m.profile}</span>
              </button>
            {/each}
          </div>

          {#if results[g.id]}
            <div class="mt-3 space-y-1 rounded-lg border border-[var(--line)] bg-[var(--bg0)] p-2">
              {#each results[g.id] as r (r.project + "/" + r.profile)}
                <div class="flex items-center gap-2 text-xs">
                  <span class={r.ok ? "text-[var(--grn)]" : "text-[var(--red)]"}>{r.ok ? "✓" : "✗"}</span>
                  <span class="mono text-[var(--mut)]">{r.project}/{r.profile}</span>
                  <span class="text-[var(--dim)]">{r.ok ? r.state : r.error}</span>
                </div>
              {/each}
            </div>
          {/if}

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button class="btn btn-sm btn-success" disabled={!!busy[g.id]} onclick={() => op(g, "start")}>
              {#if busy[g.id] === "start"}<span class="spinner"></span>{/if}<Icon name="play" size={12} />一键启动
            </button>
            <button class="btn btn-sm btn-danger" disabled={!!busy[g.id]} onclick={() => op(g, "stop")}>
              {#if busy[g.id] === "stop"}<span class="spinner"></span>{/if}<Icon name="stop" size={12} />一键停止
            </button>
            <button class="btn btn-sm btn-warn" disabled={!!busy[g.id]} onclick={() => op(g, "restart")}>
              {#if busy[g.id] === "restart"}<span class="spinner"></span>{/if}<Icon name="restart" size={12} />重启
            </button>
            <span class="flex-1"></span>
            <button class="btn btn-sm btn-ghost" onclick={() => { editing = g; showModal = true; }}><Icon name="edit" size={12} />编辑</button>
            <button class="btn btn-sm btn-ghost hover:!text-[var(--red)]" onclick={() => remove(g)}><Icon name="trash" size={12} />删除</button>
          </div>
        </div>
      {/each}
    </div>
    {#if groups.length === 0}
      <div class="panel mt-2 p-10 text-center text-sm text-[var(--dim)]">
        还没有分组。点「新建分组」把多个微服务编成一组，即可一键启动整批服务。
      </div>
    {/if}
  </div>
</div>

{#if showModal}
  <GroupModal
    group={editing}
    {projects}
    onclose={() => (showModal = false)}
    onsaved={async () => { showModal = false; await load(); }}
  />
{/if}