<script>
  import { api } from "./api.js";
  import { pushToast } from "./toast.svelte.js";
  import Icon from "./Icon.svelte";

  let { onclose, onsaved } = $props();

  let path = $state("");
  let name = $state("");
  let port = $state("");
  let command = $state("");
  let saving = $state(false);

  function keydown(e) {
    if (e.key === "Escape") onclose();
  }

  async function save() {
    saving = true;
    try {
      const body = {
        path: path.trim(),
        name: name.trim() || undefined,
        port: port ? Number(port) : undefined,
        command: command.trim() || undefined,
      };
      const r = await api("/api/projects/register", { method: "POST", body: JSON.stringify(body) });
      pushToast(
        r.generated
          ? `已创建服务「${r.project}」并生成 lifecycle.toml`
          : `已导入服务「${r.project}」（使用已有 lifecycle.toml）`,
        { kind: "success" }
      );
      onsaved(r.project);
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,8,12,0.65)] backdrop-blur-[2px]" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <form class="panel view w-[560px] p-5" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="flex items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(49,212,159,0.15)] text-[var(--grn)]"><Icon name="folder" size={16} /></span>
      <h2 class="text-base font-semibold">创建 / 导入服务</h2>
    </div>
    <p class="mt-2 text-xs leading-5 text-[var(--mut)]">
      填入项目目录即可。若目录中没有 <span class="mono text-[var(--txt)]">lifecycle.toml</span>，会自动探测工程类型
      （Node/Vite、Rust、Maven）并生成配置；已有配置则直接导入。注册后无需重启，立即出现在服务列表。
    </p>

    <label class="mt-4 block text-sm">
      <span class="text-[var(--mut)]">项目目录 <span class="text-[var(--red)]">*</span></span>
      <input class="input mono mt-1 w-full" placeholder="/Users/you/projects/my-service" bind:value={path} required />
    </label>
    <div class="mt-3 grid grid-cols-2 gap-3">
      <label class="block text-sm">
        <span class="text-[var(--mut)]">服务名称（默认目录名）</span>
        <input class="input mt-1 w-full" placeholder="my-service" bind:value={name} />
      </label>
      <label class="block text-sm">
        <span class="text-[var(--mut)]">就绪端口（覆盖探测值）</span>
        <input class="input mono mt-1 w-full" type="number" placeholder="5173" bind:value={port} />
      </label>
    </div>
    <label class="mt-3 block text-sm">
      <span class="text-[var(--mut)]">启动命令（留空用探测值）</span>
      <input class="input mono mt-1 w-full" placeholder="npm run dev" bind:value={command} />
    </label>

    <div class="mt-5 flex items-center justify-end gap-2">
      <button type="button" class="btn" onclick={onclose}>取消</button>
      <button type="submit" class="btn btn-success" disabled={saving || !path.trim()}>
        {#if saving}<span class="spinner"></span>{:else}<Icon name="plus" />{/if}注册服务
      </button>
    </div>
  </form>
</div>