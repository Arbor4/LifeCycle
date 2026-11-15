import { useMemo } from "react";
import { useI18n } from "./i18n.js";

/* ── 调色板：ANSI 16 色在亮暗两套主题下都保证可读 ───────────── */
const BASIC = {
  dark: [
    "#7d8b9d", "#ff6b66", "#3ddc97", "#ffc247", "#5aa7ff", "#c792ea", "#4dd0e1", "#e6edf3",
    "#93a3b5", "#ff8a80", "#69f0ae", "#ffd54f", "#82b1ff", "#ea80fc", "#84ffff", "#ffffff",
  ],
  light: [
    "#33404d", "#c62828", "#0f7a4d", "#8a6100", "#1f6feb", "#8e24aa", "#00798c", "#16202c",
    "#5a6b80", "#d93a34", "#12855a", "#9a6700", "#2f7fe0", "#9c27b0", "#0e8ba8", "#0b1420",
  ],
};

const hex = (r, g, b) => `rgb(${r}, ${g}, ${b})`;
function luminance(r, g, b) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function mix(a, b, k) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}
/// 终端色是为黑底设计的；亮色主题下把过亮的颜色压暗，暗色主题下把过暗的提亮。
function adapt(rgb, theme) {
  const l = luminance(...rgb);
  if (theme === "light" && l > 0.5) return mix(rgb, [22, 32, 44], 0.5);
  if (theme === "dark" && l < 0.09) return mix(rgb, [230, 237, 243], 0.45);
  return rgb;
}
function xterm(n, theme) {
  let rgb;
  if (n < 16) return BASIC[theme][n];
  if (n < 232) {
    const i = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    rgb = [levels[Math.floor(i / 36) % 6], levels[Math.floor(i / 6) % 6], levels[i % 6]];
  } else {
    const g = 8 + (n - 232) * 10;
    rgb = [g, g, g];
  }
  return hex(...adapt(rgb, theme));
}

/* ── ANSI 解析：SGR 颜色/粗体/淡体/下划线 + OSC 8 超链接 ─────── */
const ANSI_RE =
  /\x1b\[([0-9;]*)m|\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>]|\r/g;

function parseAnsi(text, theme) {
  const segs = [];
  let st = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
  let url = null;
  let last = 0;
  const push = (t) => {
    if (!t) return;
    const prev = segs[segs.length - 1];
    const style = styleOf(st, theme);
    if (prev && prev.url === url && JSON.stringify(prev.style) === JSON.stringify(style)) prev.t += t;
    else segs.push({ t, style, url });
  };
  for (const m of text.matchAll(ANSI_RE)) {
    push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const p = (m[1] || "0").split(";").map((x) => parseInt(x || "0", 10));
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === 0) st = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
        else if (c === 1) st.bold = true;
        else if (c === 2) st.dim = true;
        else if (c === 3) st.italic = true;
        else if (c === 4) st.underline = true;
        else if (c === 22) { st.bold = false; st.dim = false; }
        else if (c === 23) st.italic = false;
        else if (c === 24) st.underline = false;
        else if (c >= 30 && c <= 37) st.fg = BASIC[theme][c - 30];
        else if (c === 39) st.fg = null;
        else if (c >= 40 && c <= 47) st.bg = BASIC[theme][c - 40];
        else if (c === 49) st.bg = null;
        else if (c >= 90 && c <= 97) st.fg = BASIC[theme][c - 90 + 8];
        else if (c >= 100 && c <= 107) st.bg = BASIC[theme][c - 100 + 8];
        else if (c === 38 || c === 48) {
          const mode = p[i + 1];
          let color = null;
          if (mode === 5 && p[i + 2] !== undefined) { color = xterm(p[i + 2], theme); i += 2; }
          else if (mode === 2 && p[i + 4] !== undefined) {
            color = hex(...adapt([p[i + 2], p[i + 3], p[i + 4]], theme));
            i += 4;
          }
          if (color) c === 38 ? (st.fg = color) : (st.bg = color);
        }
      }
    } else if (m[2] !== undefined) {
      url = m[2] || null;
    }
  }
  push(text.slice(last));
  return segs;
}

function styleOf(st, theme) {
  const s = {};
  if (st.fg) s.color = st.fg;
  if (st.bg) s.backgroundColor = st.bg.startsWith("#") ? `${st.bg}38` : st.bg;
  if (st.bold) s.fontWeight = 600;
  if (st.dim) s.opacity = 0.62;
  if (st.italic) s.fontStyle = "italic";
  if (st.underline) s.textDecoration = "underline";
  void theme;
  return s;
}

/* ── 无 ANSI 时的语义高亮：Spring Boot / Vite / npm / 编译输出 ── */
const PLAIN_RE = new RegExp(
  [
    "(?<url>https?://[^\\s\"'<>）】\\]]+)",
    "(?<host>(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)(?::\\d{2,5})?)",
    "(?<file>(?:[\\w.@-]+/)*[\\w.@-]+\\.(?:rs|java|kt|ts|tsx|js|jsx|mjs|cjs|svelte|vue|toml|json|xml|ya?ml|py|go|c|cpp|h|sh):\\d+(?::\\d+)?)",
    "(?<ts>\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{1,9})?(?:Z|[+-]\\d{2}:?\\d{2})?)",
    "(?<time>\\b\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{1,9})?\\b)",
    "(?<level>\\b(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|SEVERE|CRITICAL)\\b|\\bpanic:)",
    "(?<thread>\\[[^\\[\\]]{1,48}\\])",
    "(?<logger>(?:[a-z][\\w$]*\\.){2,}[A-Za-z_$][\\w$]*)",
    "(?<npm>^npm (?:notice|warn|error|verb)\\b)",
    "(?<vite>VITE v[\\d.]+|ready in \\d+(?:\\.\\d+)? ms|➜|\\bLocal:|\\bNetwork:)",
    "(?<err>command not found|Exception(?: in thread \"[^\"]*\")?|\\berror:|BUILD FAILURE|COMPILATION ERROR|\\bFAILED\\b)",
    "(?<dur>\\b\\d+(?:\\.\\d+)?(?:ms|ns|µs|s|MiB|KiB|MB|KB|GB)\\b)",
  ].join("|"),
  "gm"
);

const LEVEL_STYLE = {
  TRACE: { color: "var(--dim)" },
  DEBUG: { color: "var(--cyn)" },
  INFO: { color: "var(--grn)", fontWeight: 600 },
  NOTICE: { color: "var(--blu)" },
  WARN: { color: "var(--amb)", fontWeight: 600 },
  WARNING: { color: "var(--amb)", fontWeight: 600 },
  ERROR: { color: "var(--red)", fontWeight: 700 },
  FATAL: { color: "var(--red)", fontWeight: 700 },
  SEVERE: { color: "var(--red)", fontWeight: 700 },
  CRITICAL: { color: "var(--red)", fontWeight: 700 },
  "panic:": { color: "var(--red)", fontWeight: 700 },
};

function parsePlain(text) {
  const segs = [];
  let last = 0;
  for (const m of text.matchAll(PLAIN_RE)) {
    if (m.index > last) segs.push({ t: text.slice(last, m.index), style: null, url: null });
    const g = m.groups;
    let style = null;
    let url = null;
    if (g.url) { style = { color: "var(--blu)" }; url = { url: g.url }; }
    else if (g.host) { style = { color: "var(--blu)" }; url = { url: `http://${g.host}` }; }
    else if (g.file) {
      const parts = g.file.split(":");
      style = { color: "var(--blu)" };
      url = { file: parts[0], line: Number(parts[1]), col: Number(parts[2] ?? 1) };
    }
    else if (g.ts || g.time) style = { color: "var(--dim)" };
    else if (g.level) style = LEVEL_STYLE[g.level] ?? { color: "var(--mut)" };
    else if (g.thread) style = { color: "var(--vio)", opacity: 0.85 };
    else if (g.logger) style = { color: "var(--cyn)" };
    else if (g.npm) {
      style = g.npm.includes("error") ? { color: "var(--red)" } : g.npm.includes("warn") ? { color: "var(--amb)" } : { color: "var(--dim)" };
    }
    else if (g.vite) {
      style = g.vite.startsWith("VITE")
        ? { color: "var(--vio)", fontWeight: 700 }
        : g.vite.startsWith("ready") || g.vite === "➜" || g.vite === "Local:"
          ? { color: "var(--grn)", fontWeight: 600 }
          : { color: "var(--dim)" };
    }
    else if (g.err) style = { color: "var(--red)", fontWeight: 600 };
    else if (g.dur) style = { color: "var(--cyn)" };
    segs.push({ t: m[0], style, url });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ t: text.slice(last), style: null, url: null });
  return segs;
}

/* ── 缓存：虚拟列表滚动时避免重复分词 ───────────────────────── */
const LINK_RE = new RegExp(
  [
    "(?<url>https?://[^\\s\"'<>）】\\]]+)",
    "(?<host>(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)(?::\\d{2,5})?)",
    "(?<file>(?:[\\w.@-]+/)*[\\w.@-]+\\.(?:rs|java|kt|ts|tsx|js|jsx|mjs|cjs|svelte|vue|toml|json|xml|ya?ml|py|go|c|cpp|h|sh):\\d+(?::\\d+)?)",
  ].join("|"),
  "g"
);

/// ANSI 段内的裸 URL / host:port / file:line 也变成可点击链接，保留原有颜色样式。
function linkify(segs) {
  const out = [];
  for (const s of segs) {
    if (s.url) {
      out.push(s);
      continue;
    }
    let last = 0;
    for (const m of s.t.matchAll(LINK_RE)) {
      if (m.index > last) out.push({ ...s, t: s.t.slice(last, m.index) });
      const g = m.groups;
      let url;
      if (g.url) url = { url: g.url };
      else if (g.host) url = { url: `http://${g.host}` };
      else {
        const p = g.file.split(":");
        url = { file: p[0], line: Number(p[1]), col: Number(p[2] ?? 1) };
      }
      out.push({ ...s, t: m[0], url, style: { ...s.style, color: "var(--blu)" } });
      last = m.index + m[0].length;
    }
    if (last < s.t.length) out.push({ ...s, t: s.t.slice(last) });
  }
  return out;
}

const cache = new Map();
export function tokenize(text, color, theme) {
  if (!color) return [{ t: text, style: null, url: null }];
  const key = `${theme}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const segs = /\x1b/.test(text) ? linkify(parseAnsi(text, theme)) : parsePlain(text);
  if (cache.size > 4000) cache.clear();
  cache.set(key, segs);
  return segs;
}

export function LogContent({ text, color = true, theme = "dark", onOpen }) {
  const { t } = useI18n();
  const segs = useMemo(() => tokenize(text, color, theme), [text, color, theme]);
  return (
    <>
      {segs.map((s, i) =>
        s.url ? (
          <span
            key={i}
            className="log-link"
            style={s.style ?? undefined}
            title={
              s.url.file
                ? t("⌘/Ctrl + 点击在编辑器中打开 {file}:{line}", { file: s.url.file, line: s.url.line })
                : t("⌘/Ctrl + 点击打开 {url}", { url: s.url.url })
            }
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                onOpen?.(s.url);
              }
            }}
          >
            {s.t}
          </span>
        ) : (
          <span key={i} style={s.style ?? undefined}>
            {s.t}
          </span>
        )
      )}
    </>
  );
}