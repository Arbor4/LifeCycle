<script>
  import { api } from "./api.js";
  let { result } = $props();

  function open(d) {
    api("/api/open-editor", {
      method: "POST",
      body: JSON.stringify({ file: d.file, line: d.line, col: d.col }),
    }).catch(() => {});
  }
</script>

<div class="h-full overflow-y-auto bg-[var(--bg0)] p-4">
  {#if !result}
    <div class="text-sm text-[var(--dim)]">暂无编译结果。点击「快速编译 / 部分编译 / 完整编译」后，结构化错误会显示在这里。</div>
  {:else}
    <div class="mb-3 text-sm {result.success ? 'text-[var(--grn)]' : 'text-[var(--red)]'}">
      {result.cancelled ? "编译已取消" : result.success ? "编译成功" : "编译失败"} · {result.duration_ms}ms · {result.errors.length} 错误 / {result.warnings.length} 警告
    </div>
    {#each [...result.errors, ...result.warnings] as d}
      <button class="panel mb-1.5 flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors hover:border-[var(--blu)]" onclick={() => open(d)} title="点击在编辑器中打开">
        <span class="shrink-0 rounded px-1.5 text-xs {d.level === 'error' ? 'bg-[rgba(255,93,85,0.15)] text-[#ff8a80]' : 'bg-[rgba(255,178,36,0.15)] text-[var(--amb)]'}">{d.level}</span>
        <span class="mono shrink-0 text-xs text-[var(--blu)]">{d.file}:{d.line}:{d.col}</span>
        <span class="truncate text-[var(--mut)]">{d.message}</span>
      </button>
    {/each}
    {#if result.raw}
      <pre class="mono mt-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[#0d1117] p-3 text-xs text-[#b9c6d4]">{result.raw}</pre>
    {/if}
  {/if}
</div>