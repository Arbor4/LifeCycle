<script>
  import { STATE_LABEL } from "./format.js";
  import Icon from "./Icon.svelte";

  let { projects, sel = $bindable(), view = $bindable(), onselect } = $props();
  let search = $state("");

  const filtered = $derived(
    projects
      .map((p) => ({
        ...p,
        profiles: p.profiles.filter(
          (s) => !search || (p.project + "/" + s.profile).toLowerCase().includes(search.toLowerCase())
        ),
      }))
      .filter((p) => p.profiles.length)
  );
</script>

<aside class="flex w-60 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg1)]">
  <div class="border-b border-[var(--line)] p-3">
    <div class="flex items-center gap-2">
      <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#17966c,#2f7fe0)] text-sm font-bold text-white">L</span>
      <span class="text-lg font-semibold tracking-tight">LifeCycle</span>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-1">
      <button class="btn btn-sm {view === 'services' ? 'btn-primary' : 'btn-ghost'}" onclick={() => (view = 'services')}><Icon name="list" size={13} />服务列表</button>
      <button class="btn btn-sm {view === 'groups' ? 'btn-vio' : 'btn-ghost'}" onclick={() => (view = 'groups')}><Icon name="group" size={13} />服务分组</button>
    </div>
    <input class="input mt-2 w-full" placeholder="搜索项目/profile…" bind:value={search} />
  </div>
  <div class="flex-1 overflow-y-auto p-2">
    {#each filtered as p (p.project)}
      <div class="mt-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{p.project}</div>
      {#each p.profiles as s (s.profile)}
        <button
          class="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors {view === 'detail' && sel.project === p.project && sel.profile === s.profile ? 'bg-[var(--bg3)] text-[var(--blu)]' : 'text-[var(--mut)] hover:bg-[var(--bg2)] hover:text-[var(--txt)]'}"
          onclick={() => onselect(p.project, s.profile)}
        >
          <span class="dot dot-{s.state}"></span>
          <span class="mono flex-1 truncate">{s.profile}</span>
          <span class="text-[11px] text-[var(--dim)]">{STATE_LABEL[s.state] ?? s.state}</span>
        </button>
      {/each}
    {/each}
  </div>
  <div class="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--dim)]">
    本地生命周期控制台 · MCP :39517/mcp
  </div>
</aside>