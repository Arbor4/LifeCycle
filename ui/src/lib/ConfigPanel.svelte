<script>
  import { api } from "./api.js";

  let { project } = $props();
  let cfg = $state(null);
  let err = $state(null);

  $effect(() => {
    project;
    cfg = null;
    err = null;
    api(`/api/projects/${encodeURIComponent(project)}/config`)
      .then((c) => (cfg = c))
      .catch((e) => (err = e.message));
  });

  function open() {
    api("/api/open-editor", {
      method: "POST",
      body: JSON.stringify({ file: cfg.path, line: 1 }),
    }).catch(() => {});
  }
</script>

<div class="h-full overflow-y-auto bg-[var(--bg0)] p-4">
  {#if cfg}
    <div class="mb-2 flex flex-wrap items-center gap-3 text-sm">
      <span class="mono text-xs text-[var(--mut)]">{cfg.path}</span>
      <button class="btn btn-sm" onclick={open}>在编辑器中打开</button>
      <span class="text-xs text-[var(--dim)]">启动命令在 [profiles.*.start]，编译命令在 [profiles.*.compile.*]；改完点「重载配置」</span>
    </div>
    <pre class="mono overflow-x-auto rounded-lg border border-[var(--line)] bg-[#0d1117] p-3 text-xs leading-5 text-[#b9c6d4]">{cfg.content}</pre>
  {:else if err}
    <div class="text-sm text-[var(--red)]">{err}</div>
  {:else}
    <div class="text-sm text-[var(--dim)]">加载中…</div>
  {/if}
</div>