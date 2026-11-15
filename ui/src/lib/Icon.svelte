<script>
  // 轻量内联 SVG 图标集（stroke 风格，随 currentColor）。
  let { name, size = 14, class: cls = "" } = $props();

  const P = {
    play: "M6 4l14 8-14 8z",
    stop: "M6 6h12v12H6z",
    restart: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
    compile: "M14 3l7 7-9 9-7-7zM3 21l4-1 1-4",
    logs: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
    settings: "M4 8h10M18 8h2M4 16h2M10 16h10M14 5v6M8 13v6",
    config: "M4 4h16v16H4zM9 9l-2 3 2 3M15 9l2 3-2 3",
    diag: "M3 12h4l3-8 4 16 3-8h4",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
    edit: "M4 20l4-1L20 7l-3-3L5 16z",
    x: "M6 6l12 12M18 6L6 18",
    check: "M4 12l5 5L20 6",
    warn: "M12 3l10 18H2zM12 10v5M12 18v.5",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
    up: "M12 19V5M5 12l7-7 7 7",
    down: "M12 5v14M19 12l-7 7-7-7",
    group: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5",
    zap: "M13 2L4 14h6l-1 8 9-12h-6z",
    folder: "M3 6h6l2 2h10v12H3z",
    open: "M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6",
    refresh: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
    server: "M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.5M8 16.5h.5",
  };
  const d = $derived(P[name] ?? P.server);
</script>

<svg
  class={cls}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
><path d={d} /></svg>