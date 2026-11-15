<script>
  import { onMount } from "svelte";
  import { api } from "./api.js";

  let entries = $state([]);
  onMount(() => {
    const load = () => api("/api/diagnostics").then((d) => (entries = d.slice().reverse())).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  });

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString();
</script>

<div class="h-full overflow-y-auto bg-[var(--bg0)] p-4">
  <h2 class="mb-2 text-base font-semibold">诊断 · 最近工具调用</h2>
  <table class="table">
    <thead>
      <tr><th>时间</th><th>工具</th><th>耗时</th><th>结果</th></tr>
    </thead>
    <tbody>
      {#each entries as e, i (i)}
        <tr>
          <td class="mono text-xs text-[var(--mut)]">{fmtTime(e.ts)}</td>
          <td class="mono text-xs">{e.tool}</td>
          <td class="text-[var(--mut)]">{e.duration_ms}ms</td>
          <td class={e.exit_code === 0 ? "text-[var(--grn)]" : "text-[var(--red)]"}>{e.exit_code === 0 ? "ok" : "err"}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if entries.length === 0}<div class="mt-2 text-sm text-[var(--dim)]">暂无调用记录。</div>{/if}
</div>