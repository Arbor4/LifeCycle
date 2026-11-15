import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BASE, profilePath } from "./api.js";
import { levelOf } from "./format.js";
import { pushToast } from "./toast.js";
import { useTheme } from "./theme.js";
import { LogContent } from "./logHighlight.jsx";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";

const ROW = 20;
const CAP = 100000;
const COLOR_KEY = "lifecycle-log-color";

export default function LogPanel({ project, profile, maxLines = 5000 }) {
  const [source, setSource] = useState("run");
  const [lines, setLines] = useState([]);
  const [level, setLevel] = useState("all");
  const [regexText, setRegexText] = useState("");
  const [search, setSearch] = useState("");
  const [matchPos, setMatchPos] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [colorOn, setColorOn] = useState(() => {
    try {
      return localStorage.getItem(COLOR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const container = useRef(null);
  const autoRef = useRef(autoScroll);
  autoRef.current = autoScroll;
  const { resolved: theme } = useTheme();

  useEffect(() => {
    try {
      localStorage.setItem(COLOR_KEY, colorOn ? "1" : "0");
    } catch {
      // ignore
    }
  }, [colorOn]);

  const openLink = useCallback((link) => {
    if (link.file) {
      api("/api/open-editor", {
        method: "POST",
        body: JSON.stringify({ file: link.file, line: link.line, col: link.col ?? 1 }),
      }).catch((e) => pushToast(e.message, { kind: "error" }));
      return;
    }
    if ("__TAURI_INTERNALS__" in window) {
      api("/api/open-url", { method: "POST", body: JSON.stringify({ url: link.url }) }).catch((e) =>
        pushToast(e.message, { kind: "error" })
      );
    } else {
      window.open(link.url, "_blank", "noopener");
    }
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let es;
    let cancelled = false;
    setLines([]);
    setMatchPos(-1);
    (async () => {
      try {
        const page = await api(profilePath(project, profile, `/logs?source=${source}&lines=${maxLines}`));
        if (cancelled) return;
        setLines(page.lines);
        requestAnimationFrame(() => {
          if (container.current && autoRef.current) container.current.scrollTop = container.current.scrollHeight;
        });
        es = new EventSource(
          BASE + profilePath(project, profile, `/logs/stream?source=${source}&since=${page.nextCursor}`)
        );
        es.onmessage = (e) => {
          const data = JSON.parse(e.data);
          setLines((prev) => [...prev, ...data.lines].slice(-CAP));
        };
      } catch {
        // 后端未就绪时静默重试由上层负责
      }
    })();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [project, profile, source, maxLines]);

  const regexRe = useMemo(() => {
    if (!regexText) return null;
    try {
      return new RegExp(regexText, "i");
    } catch {
      return null;
    }
  }, [regexText]);

  const visible = useMemo(
    () =>
      lines.filter((l) => {
        if (level !== "all" && levelOf(l.text) !== level) return false;
        if (regexRe && !regexRe.test(l.text)) return false;
        return true;
      }),
    [lines, level, regexRe]
  );

  const matches = useMemo(() => {
    if (!search) return [];
    const needle = search.toLowerCase();
    const out = [];
    visible.forEach((l, i) => {
      if (l.text.toLowerCase().includes(needle)) out.push(i);
    });
    return out;
  }, [visible, search]);

  useEffect(() => {
    if (autoRef.current && container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [visible.length]);

  useEffect(() => setMatchPos(-1), [search, source, level, regexText]);

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const end = Math.min(visible.length, start + Math.ceil(viewH / ROW) + 10);
  const slice = visible.slice(start, end);
  const currentMatch = matchPos >= 0 && matchPos < matches.length ? matches[matchPos] : -1;

  const gotoMatch = useCallback(
    (delta) => {
      if (!matches.length) return;
      const next = (matchPos + delta + matches.length) % matches.length;
      setMatchPos(next);
      if (container.current) container.current.scrollTop = matches[next] * ROW - viewH / 2;
    },
    [matches, matchPos, viewH]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--bg1)] px-3 py-2 text-sm">
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="run">启动日志</option>
          <option value="build">编译日志</option>
        </select>
        <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">全部级别</option>
          <option value="error">ERROR</option>
          <option value="warn">WARN</option>
          <option value="info">INFO</option>
        </select>
        <input
          className={`input w-40 ${regexText && !regexRe ? "!border-[var(--red)]" : ""}`}
          placeholder="正则过滤…"
          value={regexText}
          onChange={(e) => setRegexText(e.target.value)}
        />
        <span className="mx-1 border-l border-[var(--line2)]" />
        <div className="relative">
          <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            className="input w-36 pl-7"
            placeholder="搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
            }}
          />
        </div>
        <button className="btn btn-sm" onClick={() => gotoMatch(-1)} title="上一个匹配 (Shift+Enter)">
          <Icon name="up" size={12} />
        </button>
        <button className="btn btn-sm" onClick={() => gotoMatch(1)} title="下一个匹配 (Enter)">
          <Icon name="down" size={12} />
        </button>
        <span className="mono text-xs text-[var(--dim)]">
          {matches.length ? `${matchPos + 1}/${matches.length}` : `${visible.length} 行`}
        </span>
        <span className="flex-1" />
        <Checkbox
          size="sm"
          tone="cyn"
          checked={colorOn}
          onChange={setColorOn}
          label="颜色"
          title="解析 ANSI 终端色与 Spring/Vite 风格语义高亮；子进程需重启后才会输出 ANSI（[logs].color）"
        />
        <Checkbox size="sm" checked={autoScroll} onChange={setAutoScroll} label="自动滚动" />
        <button className="btn btn-sm" onClick={() => setLines([])}>
          <Icon name="x" size={12} />
          清屏
        </button>
        <button
          className="btn btn-sm"
          onClick={() =>
            api("/api/reveal-log", { method: "POST", body: JSON.stringify({ project, profile, source }) }).catch(() => {})
          }
        >
          <Icon name="open" size={12} />
          打开日志文件
        </button>
      </div>

      <div
        ref={container}
        className="min-h-0 flex-1 overflow-auto bg-[var(--well)]"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: visible.length * ROW, position: "relative" }}>
          <div style={{ position: "absolute", top: start * ROW, left: 0, minWidth: "100%", width: "max-content" }}>
            {slice.map((l, i) => (
              <div
                key={start + i}
                className={`log-line ${colorOn ? "" : `lv-${levelOf(l.text)}`}`}
                style={start + i === currentMatch ? { background: "var(--amb-soft)" } : undefined}
              >
                <LogContent text={l.text} color={colorOn} theme={theme} onOpen={openLink} />
              </div>
            ))}
          </div>
        </div>
        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-[var(--dim)]">
            暂无日志。启动服务或执行编译后，输出会实时出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}