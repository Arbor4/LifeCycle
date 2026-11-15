<script>
  import { tick } from "svelte";
  import { api, profilePath, BASE } from "./api.js";
  import { levelOf } from "./format.js";
  import Icon from "./Icon.svelte";

  let { project, profile, maxLines = 5000 } = $props();

  let source = $state("run");
  let lines = $state([]);
  let level = $state("all");
  let regexText = $state("");
  let autoScroll = $state(true);
  let search = $state("");
  let matchPos = $state(-1);
  let scrollTop = $state(0);
  let viewH = $state(400);
  let container;
  let es;
  const ROW = 20;
  const CAP = 100000;

  const regexRe = $derived.by(() => {
    if (!regexText) return null;
    try { return new RegExp(regexText, "i"); } catch { return null; }
  });

  const visible = $derived(
    lines.filter((l) => {
      if (level !== "all" && levelOf(l.text) !== level) return false;
      if (regexRe && !regexRe.test(l.text)) return false;
      return true;
    })
  );

  const matches = $derived(
    search ? visible.map((l, i) => (l.text.toLowerCase().includes(search.toLowerCase()) ? i : -1)).filter((i) => i >= 0) : []
  );

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 5));
  const end = $derived(Math.min(visible.length, start + Math.ceil(viewH / ROW) + 10));
  const slice = $derived(visible.slice(start, end));
  const currentMatch = $derived(matchPos >= 0 && matchPos < matches.length ? matches[matchPos] : -1);

  async function scrollToEnd() {
    await tick();
    if (container && autoScroll) container.scrollTop = container.scrollHeight;
  }

  function append(newLines) {
    lines = [...lines, ...newLines].slice(-CAP);
    scrollToEnd();
  }

  function gotoMatch(delta) {
    if (!matches.length) return;
    matchPos = (matchPos + delta + matches.length) % matches.length;
    if (container) container.scrollTop = matches[matchPos] * ROW - viewH / 2;
  }

  async function load() {
    es?.close();
    lines = [];
    const page = await api(profilePath(project, profile, `/logs?source=${source}&lines=${maxLines}`));
    lines = page.lines;
    await scrollToEnd();
    es = new EventSource(BASE + profilePath(project, profile, `/logs/stream?source=${source}&since=${page.nextCursor}`));
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      append(data.lines);
    };
  }

  $effect(() => {
    source;
    load().catch(() => {});
    return () => es?.close();
  });
</script>

<div class="flex h-full flex-col">
  <div class="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--bg1)] px-3 py-2 text-sm">
    <select class="input" bind:value={source}>
      <option value="run">启动日志</option>
      <option value="build">编译日志</option>
    </select>
    <select class="input" bind:value={level}>
      <option value="all">全部级别</option>
      <option value="error">ERROR</option>
      <option value="warn">WARN</option>
      <option value="info">INFO</option>
    </select>
    <input class="input w-40" placeholder="正则过滤…" bind:value={regexText} />
    <span class="mx-1 border-l border-[var(--line2)]"></span>
    <input class="input w-36" placeholder="搜索…" bind:value={search} />
    <button class="btn btn-sm" onclick={() => gotoMatch(-1)} title="上一个匹配"><Icon name="up" size={12} /></button>
    <button class="btn btn-sm" onclick={() => gotoMatch(1)} title="下一个匹配"><Icon name="down" size={12} /></button>
    <span class="mono text-xs text-[var(--dim)]">{matches.length ? `${matchPos + 1}/${matches.length}` : `${visible.length} 行`}</span>
    <span class="flex-1"></span>
    <label class="flex items-center gap-1.5 text-xs text-[var(--mut)]">
      <input type="checkbox" bind:checked={autoScroll} /> 自动滚动
    </label>
    <button class="btn btn-sm" onclick={() => (lines = [])}><Icon name="x" size={12} />清屏</button>
    <button class="btn btn-sm" onclick={() => api("/api/reveal-log", { method: "POST", body: JSON.stringify({ project, profile, source }) }).catch(() => {})}><Icon name="open" size={12} />打开日志文件</button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto bg-[var(--bg0)]" bind:this={container} bind:clientHeight={viewH} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
    <div style="height: {visible.length * ROW}px; position: relative;">
      <div style="position: absolute; top: {start * ROW}px; left: 0; right: 0;">
        {#each slice as l, i (start + i)}
          <div class="log-line lv-{levelOf(l.text)} {start + i === currentMatch ? 'bg-[rgba(255,178,36,0.18)]' : ''}">{l.text}</div>
        {/each}
      </div>
    </div>
  </div>
</div>