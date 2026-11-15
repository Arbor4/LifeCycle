<script>
  import { onMount } from "svelte";
  import { api } from "./api.js";
  import { pushToast } from "./toast.svelte.js";

  let settings = $state(null);

  onMount(() => api("/api/settings").then((s) => (settings = s)));

  async function save() {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    pushToast("设置已保存", { kind: "success" });
  }
</script>

<div class="h-full overflow-y-auto bg-[var(--bg0)] p-6">
  {#if settings}
    <div class="max-w-lg space-y-4">
      <h2 class="text-base font-semibold">设置</h2>
      <label class="block text-sm">
        <span class="text-[var(--mut)]">编辑器跳转命令（{"{file}"} / {"{line}"} / {"{col}"} 占位）</span>
        <input class="input mono mt-1 w-full" bind:value={settings.editor_command} />
      </label>
      <label class="flex items-center gap-2 text-sm text-[var(--mut)]">
        <input type="checkbox" bind:checked={settings.notifications} /> 崩溃 / 编译失败系统通知
      </label>
      <label class="block text-sm">
        <span class="text-[var(--mut)]">日志缓冲行数</span>
        <input type="number" class="input mt-1 w-full" bind:value={settings.log_lines} />
      </label>
      <label class="block text-sm">
        <span class="text-[var(--mut)]">默认可就绪超时（ms）</span>
        <input type="number" class="input mt-1 w-full" bind:value={settings.ready_timeout_ms} />
      </label>
      <label class="block text-sm">
        <span class="text-[var(--mut)]">默认编译超时（ms）</span>
        <input type="number" class="input mt-1 w-full" bind:value={settings.compile_timeout_ms} />
      </label>
      <button class="btn btn-primary" onclick={save}>保存</button>
      <p class="text-xs text-[var(--dim)]">设置持久化于 ~/.lifecycle/settings.json。实际超时以 lifecycle.toml 为准。</p>
    </div>
  {/if}
</div>