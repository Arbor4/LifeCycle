<script>
  import { STATE_LABEL, uptime } from "./format.js";

  let { status, project } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const stateColor = {
    running: "text-[var(--grn)]",
    crashed: "text-[var(--red)]",
    starting: "text-[var(--amb)]",
    stopping: "text-[var(--amb)]",
    idle: "text-[var(--mut)]",
  };
</script>

<div class="min-w-0">
  <div class="flex items-center gap-2">
    <h1 class="mono text-lg font-semibold">{project}<span class="text-[var(--dim)]">/</span>{status.profile}</h1>
    <span class="inline-flex items-center gap-1.5 rounded-full border border-[var(--line2)] bg-[var(--bg2)] px-2 py-0.5 text-xs {stateColor[status.state] ?? ''}">
      <span class="dot dot-{status.state}"></span>{STATE_LABEL[status.state] ?? status.state}
    </span>
  </div>
  <div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--mut)]">
    <span>PID <span class="mono text-[var(--txt)]">{status.pid ?? "—"}</span></span>
    <span>uptime <span class="mono text-[var(--txt)]">{uptime(status.uptime_ms)}</span></span>
    <span>端口 <span class="mono text-[var(--txt)]">{status.port ?? "—"}</span></span>
    {#if status.last_build}
      <span>
        最近编译
        <span class="mono {status.last_build.success ? 'text-[var(--grn)]' : 'text-[var(--red)]'}">
          {status.last_build.success ? "✓" : "✗"} {status.last_build.kind}
        </span>
        <span class="text-[var(--dim)]">{status.last_build.duration_ms}ms · {status.last_build.error_count} 错误</span>
      </span>
    {:else}
      <span>最近编译 <span class="text-[var(--dim)]">—</span></span>
    {/if}
  </div>
  {#if status.command}
    <div class="mono mt-1 truncate text-xs text-[var(--dim)]">$ {status.command}</div>
  {/if}
</div>