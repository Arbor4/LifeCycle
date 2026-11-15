<script>
  import { api } from "./api.js";
  import { pushToast } from "./toast.svelte.js";

  let { group, projects, onclose, onsaved } = $props();

  let name = $state(group?.name ?? "");
  let selected = $state(new Set((group?.members ?? []).map((m) => m.project + "/" + m.profile)));
  let saving = $state(false);

  function keydown(e) {
    if (e.key === "Escape") onclose();
  }

  function toggle(key) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    selected = next;
  }

  async function save() {
    const members = [...selected].map((k) => {
      const [project, ...rest] = k.split("/");
      return { project, profile: rest.join("/") };
    });
    saving = true;
    try {
      const body = JSON.stringify({ name, members });
      if (group) {
        await api(`/api/groups/${group.id}`, { method: "PUT", body });
      } else {
        await api("/api/groups", { method: "POST", body });
      }
      pushToast(group ? `分组「${name}」已更新` : `分组「${name}」已创建`, { kind: "success" });
      onsaved();
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,8,12,0.65)] backdrop-blur-[2px]" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <form class="panel view w-[520px] p-5" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <h2 class="text-base font-semibold">{group ? "编辑分组" : "新建分组"}</h2>
    <p class="mt-1 text-xs text-[var(--mut)]">勾选要编入一组的服务，之后可一键启动 / 停止整批。</p>
    <input class="input mt-3 w-full" placeholder="分组名称，如：后端核心" bind:value={name} />
    <div class="mt-3 max-h-72 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg0)] p-2">
      {#each projects as p (p.project)}
        <div class="mt-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">{p.project}</div>
        {#each p.profiles as s (s.profile)}
          {@const key = p.project + "/" + s.profile}
          <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--bg2)]">
            <input type="checkbox" checked={selected.has(key)} onchange={() => toggle(key)} />
            <span class="dot dot-{s.state}"></span>
            <span class="mono">{s.profile}</span>
          </label>
        {/each}
      {/each}
    </div>
    <div class="mt-4 flex items-center justify-end gap-2">
      <span class="mr-auto text-xs text-[var(--dim)]">已选 {selected.size} 个服务</span>
      <button type="button" class="btn" onclick={onclose}>取消</button>
      <button type="submit" class="btn btn-primary" disabled={saving || !name.trim() || selected.size === 0}>
        {#if saving}<span class="spinner"></span>{/if}保存
      </button>
    </div>
  </form>
</div>