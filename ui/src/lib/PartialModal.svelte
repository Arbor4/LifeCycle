<script>
  import { onMount } from "svelte";
  import { api } from "./api.js";

  let { project, profile, onclose, onsubmit } = $props();
  let modules = $state([]);
  let selected = $state(new Set());
  let custom = $state("");

  const storageKey = `partial-targets-${project}-${profile}`;

  onMount(async () => {
    try {
      const data = await api(`/api/projects/${encodeURIComponent(project)}/modules`);
      modules = data.find((m) => m.profile === profile)?.modules ?? [];
    } catch { modules = []; }
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      selected = new Set(saved);
    } catch { /* ignore */ }
  });

  function toggle(m) {
    const next = new Set(selected);
    next.has(m) ? next.delete(m) : next.add(m);
    selected = next;
  }

  function submit() {
    const targets = [...selected, ...custom.split(",").map((s) => s.trim()).filter(Boolean)];
    localStorage.setItem(storageKey, JSON.stringify([...selected]));
    onsubmit(targets);
  }

  function keydown(e) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,8,12,0.65)] backdrop-blur-[2px]" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel view w-[480px] p-5">
    <h2 class="text-base font-semibold">部分编译 · <span class="mono text-[var(--blu)]">{project}/{profile}</span></h2>
    <p class="mt-1 text-xs text-[var(--mut)]">选择模块/目录，或直接输入目标（逗号分隔）。</p>
    <div class="mt-3 max-h-60 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg0)] p-2">
      {#if modules.length === 0}
        <div class="p-2 text-sm text-[var(--dim)]">未发现模块目录，可手动输入目标。</div>
      {/if}
      {#each modules as m}
        <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--bg2)]">
          <input type="checkbox" checked={selected.has(m)} onchange={() => toggle(m)} />
          <span class="mono">{m}</span>
        </label>
      {/each}
    </div>
    <input class="input mt-3 w-full" placeholder="自定义目标，如 mod-a,mod-b" bind:value={custom} />
    <div class="mt-4 flex justify-end gap-2">
      <button class="btn" onclick={onclose}>取消</button>
      <button class="btn btn-primary" onclick={submit}>编译所选</button>
    </div>
  </div>
</div>