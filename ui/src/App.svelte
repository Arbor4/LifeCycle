<script>
  import { onMount } from "svelte";
  import { api, profilePath, notify, BASE } from "./lib/api.js";
  import { pushToast } from "./lib/toast.svelte.js";
  import Sidebar from "./lib/Sidebar.svelte";
  import StatusCard from "./lib/StatusCard.svelte";
  import LogPanel from "./lib/LogPanel.svelte";
  import ErrorsPanel from "./lib/ErrorsPanel.svelte";
  import PartialModal from "./lib/PartialModal.svelte";
  import SettingsPanel from "./lib/SettingsPanel.svelte";
  import ConfigPanel from "./lib/ConfigPanel.svelte";
  import DiagnosticsPanel from "./lib/DiagnosticsPanel.svelte";
  import ServicesView from "./lib/ServicesView.svelte";
  import GroupsView from "./lib/GroupsView.svelte";
  import ToastHost from "./lib/ToastHost.svelte";

  let projects = $state([]);
  let sel = $state({ project: null, profile: null });
  let view = $state("services");
  let tab = $state("logs");
  let errorsByProfile = $state({});
  let busy = $state({});
  let message = $state(null);
  let showPartial = $state(false);
  let settings = $state({ notifications: true, log_lines: 5000 });
  let prevStates = {};

  const key = $derived(sel.project + "/" + sel.profile);
  const current = $derived(
    projects.find((p) => p.project === sel.project)?.profiles.find((p) => p.profile === sel.profile)
  );
  const currentErrors = $derived(errorsByProfile[key] ?? null);
  const isBusy = $derived(!!busy[key]);

  function openDetail(project, profile) {
    sel = { project, profile };
    view = "detail";
  }

  async function refresh() {
    projects = await api("/api/projects");
    if (!sel.project && projects.length) {
      sel = { project: projects[0].project, profile: projects[0].profiles[0]?.profile ?? "default" };
    }
  }

  function detectChanges(next) {
    for (const p of next) {
      for (const s of p.profiles) {
        const k = p.project + "/" + s.profile;
        const prev = prevStates[k];
        if (prev && settings.notifications) {
          if (s.state === "crashed" && prev.state !== "crashed") {
            notify("LifeCycle：进程崩溃", `${k} 意外退出`);
            pushToast(`${k} 崩溃`, { kind: "error" });
          }
          const ts = s.last_build?.finished_at_ms;
          if (ts && ts !== prev.buildTs && s.last_build && !s.last_build.success) {
            notify("LifeCycle：编译失败", `${k} 有 ${s.last_build.error_count} 个错误`);
          }
        }
        prevStates[k] = { state: s.state, buildTs: s.last_build?.finished_at_ms };
      }
    }
  }

  onMount(() => {
    (async () => {
      for (let i = 0; i < 20; i++) {
        try {
          await refresh();
          message = null;
          break;
        } catch (e) {
          message = e.message;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      api("/api/settings").then((s) => (settings = s)).catch(() => {});
    })();
    const es = new EventSource(BASE + "/api/events");
    es.addEventListener("status", (e) => {
      const next = JSON.parse(e.data);
      detectChanges(next);
      projects = next;
      message = null;
      if (!sel.project && next.length) {
        sel = { project: next[0].project, profile: next[0].profiles[0]?.profile ?? "default" };
      }
    });
    return () => es.close();
  });

  async function act(name, fn) {
    busy[key] = name;
    message = null;
    try {
      const r = await fn();
      if (r && Array.isArray(r.errors)) {
        errorsByProfile[key] = r;
        if (!r.success && r.errors.length) tab = "errors";
        pushToast(
          r.cancelled ? "编译已取消" : r.success ? `编译成功 · ${r.duration_ms}ms` : `编译失败 · ${r.errors.length} 错误`,
          { kind: r.success ? "success" : "error" }
        );
      } else if (name === "start") {
        pushToast(`${key} 已启动${r?.ready ? "（就绪）" : ""}`, { kind: "success" });
      } else if (name === "stop") {
        pushToast(`${key} 已停止`, { kind: "success" });
      } else if (name === "restart") {
        pushToast(`${key} 已重启`, { kind: "success" });
      }
      await refresh();
    } catch (e) {
      message = e.message;
      await refresh().catch(() => {});
    } finally {
      delete busy[key];
    }
  }

  const post = (suffix, body) => api(profilePath(sel.project, sel.profile, suffix), { method: "POST", body: JSON.stringify(body ?? {}) });

  const start = () => act("start", () => post("/start", { wait: true }));
  const startFast = () => act("start", () => post("/start", { wait: false }));
  const stop = () => act("stop", () => post("/stop"));
  const restart = () => act("restart", () => post("/restart", { wait: true }));
  const compileQuick = () => act("compile", () => post("/compile", { kind: "quick" }));
  const compileFull = () => act("compile", () => post("/compile", { kind: "full" }));
  const compilePartial = (targets) => { showPartial = false; act("compile", () => post("/compile", { kind: "partial", targets })); };
  const cancelCompile = () => post("/compile/cancel").catch((e) => (message = e.message));

  async function reload() {
    try {
      await api(`/api/projects/${encodeURIComponent(sel.project)}/reload`, { method: "POST" });
      message = null;
      pushToast("配置已重载", { kind: "success" });
      await refresh();
    } catch (e) {
      message = e.message;
    }
  }

  const running = $derived(current?.state === "running" || current?.state === "starting");
  const compiling = $derived(busy[key] === "compile");
</script>

<div class="flex h-full">
  <Sidebar {projects} bind:sel={sel} bind:view={view} onselect={openDetail} />

  <main class="flex min-w-0 flex-1 flex-col">
    {#if view === "services"}
      <ServicesView {projects} onopen={openDetail} />
    {:else if view === "groups"}
      <GroupsView {projects} onopen={openDetail} />
    {:else if current}
      <div class="border-b border-[var(--line)] bg-[var(--bg1)] p-4">
        <div class="flex items-start justify-between gap-4">
          <StatusCard status={current} project={sel.project} />
          <div class="flex flex-wrap justify-end gap-2">
            <button class="btn btn-success" disabled={running || isBusy} onclick={start}>启动</button>
            <button class="btn btn-success" disabled={running || isBusy} onclick={startFast} title="跳过等待就绪，直接拉起">快速启动</button>
            <button class="btn btn-danger" disabled={!running || isBusy} onclick={stop}>停止</button>
            <button class="btn btn-warn" disabled={isBusy} onclick={restart}>重启</button>
            <span class="mx-1 border-l border-[var(--line2)]"></span>
            {#if compiling}
              <button class="btn" onclick={cancelCompile}><span class="spinner"></span>取消编译…</button>
            {:else}
              <button class="btn btn-primary" disabled={isBusy} onclick={compileQuick}>快速编译</button>
              <button class="btn btn-primary" disabled={isBusy} onclick={() => (showPartial = true)}>部分编译</button>
              <button class="btn btn-primary" disabled={isBusy} onclick={compileFull}>完整编译</button>
            {/if}
          </div>
        </div>
        {#if message}
          <div class="mt-2 rounded-lg border border-[rgba(255,93,85,0.4)] bg-[rgba(255,93,85,0.1)] px-3 py-2 text-sm text-[#ff8a80]">{message}</div>
        {/if}
      </div>

      <div class="flex items-center gap-1 border-b border-[var(--line)] bg-[var(--bg1)] px-4">
        {#each [["logs", "日志"], ["errors", `错误${currentErrors ? " (" + currentErrors.errors.length + ")" : ""}`], ["config", "配置"], ["settings", "设置"], ["diagnostics", "诊断"]] as [t, label]}
          <button class="px-3 py-2 text-sm transition-colors {tab === t ? 'border-b-2 border-[var(--blu)] font-medium text-[var(--blu)]' : 'text-[var(--mut)] hover:text-[var(--txt)]'}" onclick={() => (tab = t)}>{label}</button>
        {/each}
        <span class="flex-1"></span>
        <button class="btn btn-ghost btn-sm" title="重新读取 lifecycle.toml，无需重启" onclick={reload}>重载配置</button>
      </div>

      <div class="min-h-0 flex-1">
        {#key key}
          {#if tab === "logs"}
            <LogPanel project={sel.project} profile={sel.profile} maxLines={settings.log_lines ?? 5000} />
          {:else if tab === "errors"}
            <ErrorsPanel result={currentErrors} />
          {:else if tab === "config"}
            <ConfigPanel project={sel.project} />
          {:else if tab === "settings"}
            <SettingsPanel />
          {:else}
            <DiagnosticsPanel />
          {/if}
        {/key}
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center text-[var(--dim)]">
        {message ? `无法连接后端：${message}` : "加载中…"}
      </div>
    {/if}
  </main>
</div>

{#if showPartial}
  <PartialModal project={sel.project} profile={sel.profile} onclose={() => (showPartial = false)} onsubmit={compilePartial} />
{/if}

<ToastHost />