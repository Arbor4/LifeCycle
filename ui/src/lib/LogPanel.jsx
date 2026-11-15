import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BASE, profilePath } from "./api.js";
import { levelOf } from "./format.js";
import { pushToast } from "./toast.js";
import { useTheme } from "./theme.js";
import { useI18n } from "./i18n.js";
import { copyText } from "./clipboard.js";
import { LogContent } from "./logHighlight.jsx";
import Icon from "./Icon.jsx";
import Checkbox from "./Checkbox.jsx";
import Modal from "./Modal.jsx";

const ROW = 20;
const CAP = 100000;
const COLOR_KEY = "lifecycle-log-color";

export default function LogPanel({ project, profile, maxLines = 5000, initialSource = "run" }) {
  const { t } = useI18n();
  const [source, setSource] = useState(initialSource);

  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);
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
  const [showClear, setShowClear] = useState(false);
  const [clearScope, setClearScope] = useState("current");
  const [clearing, setClearing] = useState(false);
  const [showLogMenu, setShowLogMenu] = useState(false);
  const logMenuRef = useRef(null);
  const logMenuBtnRef = useRef(null);

  useEffect(() => {
    if (!showLogMenu) return;
    const onDown = (e) => {
      if (logMenuRef.current?.contains(e.target) || logMenuBtnRef.current?.contains(e.target)) return;
      setShowLogMenu(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setShowLogMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showLogMenu]);
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

  async function confirmClear() {
    if (clearing) return;
    setClearing(true);
    try {
      const scope = clearScope === "current" ? source : "all";
      const r = await api(profilePath(project, profile, "/logs/clear"), {
        method: "POST",
        body: JSON.stringify({ source: scope }),
      });
      const bytes = (r.cleared ?? []).reduce((n, c) => n + (c.bytes ?? 0), 0);
      setLines([]);
      setMatchPos(-1);
      setShowClear(false);
      pushToast(
        t("日志已清空（{scope}，释放 {kb} KB）", {
          scope: scope === "all" ? t("全部来源") : source === "run" ? t("启动日志") : t("编译日志"),
          kb: (bytes / 1024).toFixed(1),
        }),
        { kind: "success" }
      );
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setClearing(false);
    }
  }

  async function copyVisible() {
    if (!visible.length) return;
    const ok = await copyText(visible.map((l) => l.text).join("\n"));
    if (ok) pushToast(t("已复制 {n} 行日志", { n: visible.length }), { kind: "success" });
  }

  function openLogFile() {
    api("/api/reveal-log", { method: "POST", body: JSON.stringify({ project, profile, source }) }).catch(() => {});
  }

  const sourceBtn = (active) =>
    `flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all sm:px-3 ${
      active ? "bg-[var(--bg1)] text-[var(--txt)] shadow-sm font-semibold" : "text-[var(--mut)] hover:text-[var(--txt)]"
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] bg-[var(--bg1)] px-2 py-1.5 text-sm sm:gap-2 sm:px-3 sm:py-2">
        <div className="flex items-center rounded-lg bg-[var(--bg2)] p-0.5 border border-[var(--line)]">
          <button
            type="button"
            className={sourceBtn(source === "run")}
            onClick={() => setSource("run")}
            title={t("查看服务启动/运行控制台输出（一键切换）")}
          >
            <Icon name="play" size={11} className={source === "run" ? "text-[var(--grn)]" : ""} />
            <span className="hidden sm:inline">{t("启动日志")}</span>
          </button>
          <button
            type="button"
            className={sourceBtn(source === "build")}
            onClick={() => setSource("build")}
            title={t("查看构建与编译输出（一键切换）")}
          >
            <Icon name="compile" size={11} className={source === "build" ? "text-[var(--vio)]" : ""} />
            <span className="hidden sm:inline">{t("编译日志")}</span>
          </button>
        </div>
        <select className="input flex-none" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">{t("全部级别")}</option>
          <option value="error">ERROR</option>
          <option value="warn">WARN</option>
          <option value="info">INFO</option>
        </select>
        <div className="hidden md:block">
          <input
            className={`input w-40 ${regexText && !regexRe ? "!border-[var(--red)]" : ""}`}
            placeholder={t("正则过滤…")}
            value={regexText}
            onChange={(e) => setRegexText(e.target.value)}
          />
        </div>
        <span className="mx-1 hidden border-l border-[var(--line2)] md:block" />
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
          <input
            className="input w-full pl-7! pr-6! sm:w-36"
            placeholder={t("搜索…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
            }}
          />
          {search && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--dim)] hover:text-[var(--txt)] p-0.5 rounded"
              onClick={() => setSearch("")}
              title={t("清空")}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
        <button className="btn btn-sm hidden sm:inline-flex" onClick={() => gotoMatch(-1)} title={t("上一个匹配 (Shift+Enter)")}>
          <Icon name="up" size={12} />
        </button>
        <button className="btn btn-sm hidden sm:inline-flex" onClick={() => gotoMatch(1)} title={t("下一个匹配 (Enter)")}>
          <Icon name="down" size={12} />
        </button>
        <span className="mono hidden text-xs text-[var(--dim)] sm:inline">
          {matches.length ? `${matchPos + 1}/${matches.length}` : t("{n} 行", { n: visible.length })}
        </span>
        <span className="flex-1" />
        <Checkbox
          size="sm"
          tone="cyn"
          checked={colorOn}
          onChange={setColorOn}
          label={t("颜色")}
          labelClassName="hidden sm:inline"
          className="flex-none"
          title={t("解析 ANSI 终端色与 Spring/Vite 风格语义高亮；子进程需重启后才会输出 ANSI（[logs].color）")}
        />
        <Checkbox size="sm" checked={autoScroll} onChange={setAutoScroll} label={t("自动滚动")} labelClassName="hidden sm:inline" className="flex-none" />
        <button
          ref={logMenuBtnRef}
          type="button"
          className="btn btn-sm sm:hidden"
          onClick={() => setShowLogMenu((v) => !v)}
          title={t("更多日志控制")}
          aria-expanded={showLogMenu}
        >
          <Icon name="settings" size={12} />
        </button>
        <button
          className="btn btn-sm hidden sm:inline-flex"
          onClick={copyVisible}
          disabled={!visible.length}
          title={t("复制当前过滤出的日志内容")}
        >
          <Icon name="copy" size={12} />
          {t("复制")}
        </button>
        <button
          className="btn btn-sm hidden sm:inline-flex"
          onClick={() => setLines([])}
          title={t("仅清空当前显示，不删除日志数据")}
        >
          <Icon name="x" size={12} />
          {t("清屏")}
        </button>
        <button
          className="btn btn-sm btn-danger hidden sm:inline-flex"
          onClick={() => {
            setClearScope("current");
            setShowClear(true);
          }}
          title={t("删除磁盘日志文件与缓冲，不可恢复")}
        >
          <Icon name="trash" size={12} />
          {t("清空日志")}
        </button>
        <button
          className="btn btn-sm hidden sm:inline-flex"
          onClick={openLogFile}
        >
          <Icon name="open" size={12} />
          {t("打开日志文件")}
        </button>

        {showLogMenu && (
          <div
            ref={logMenuRef}
            className="absolute right-2 top-full z-40 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg1)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.4)] sm:hidden"
          >
            <input
              className={`input w-full ${regexText && !regexRe ? "!border-[var(--red)]" : ""}`}
              placeholder={t("正则过滤…")}
              value={regexText}
              onChange={(e) => setRegexText(e.target.value)}
            />
            <div className="flex items-center gap-1.5">
              <button className="btn btn-sm" onClick={() => gotoMatch(-1)} title={t("上一个匹配 (Shift+Enter)")}>
                <Icon name="up" size={12} />
              </button>
              <button className="btn btn-sm" onClick={() => gotoMatch(1)} title={t("下一个匹配 (Enter)")}>
                <Icon name="down" size={12} />
              </button>
              <span className="mono text-xs text-[var(--dim)]">
                {matches.length ? `${matchPos + 1}/${matches.length}` : t("{n} 行", { n: visible.length })}
              </span>
            </div>
            <button className="btn btn-sm justify-start" onClick={copyVisible} disabled={!visible.length}>
              <Icon name="copy" size={12} />
              {t("复制")}
            </button>
            <button
              className="btn btn-sm justify-start"
              onClick={() => {
                setLines([]);
                setShowLogMenu(false);
              }}
            >
              <Icon name="x" size={12} />
              {t("清屏")}
            </button>
            <button
              className="btn btn-sm btn-danger justify-start"
              onClick={() => {
                setClearScope("current");
                setShowClear(true);
                setShowLogMenu(false);
              }}
            >
              <Icon name="trash" size={12} />
              {t("清空日志")}
            </button>
            <button
              className="btn btn-sm justify-start"
              onClick={() => {
                openLogFile();
                setShowLogMenu(false);
              }}
            >
              <Icon name="open" size={12} />
              {t("打开日志文件")}
            </button>
          </div>
        )}
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
            {t("暂无日志。启动服务或执行编译后，输出会实时出现在这里。")}
          </div>
        )}
      </div>

      {showClear && (
        <Modal
          title={t("清空日志")}
          icon="trash"
          tone="red"
          width={460}
          onClose={() => setShowClear(false)}
          subtitle={t("不同于「清屏」：这会真正删除日志数据。")}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setShowClear(false)}>
                {t("取消")}
              </button>
              <button type="button" className="btn btn-danger" disabled={clearing} onClick={confirmClear}>
                {clearing ? <span className="spinner" /> : <Icon name="trash" size={12} />}
                {t("清空日志")}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            {[
              { id: "current", label: t("仅当前来源（{name}）", { name: source === "run" ? t("启动日志") : t("编译日志") }) },
              { id: "all", label: t("全部来源（启动 + 编译）") },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  clearScope === opt.id
                    ? "border-[var(--red)] bg-[var(--red-soft)] font-medium text-[var(--txt)]"
                    : "border-[var(--line)] text-[var(--mut)] hover:bg-[var(--bg2)]"
                }`}
                onClick={() => setClearScope(opt.id)}
              >
                <span
                  className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border ${
                    clearScope === opt.id ? "border-[var(--red)]" : "border-[var(--line2)]"
                  }`}
                >
                  {clearScope === opt.id && <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--dim)]">
            <Icon name="warn" size={12} className="mt-0.5 flex-none text-[var(--red)]" />
            <span>{t("将清空所选来源的磁盘日志文件，历史输出不可恢复；运行中的服务会继续写入新日志。")}</span>
          </p>
        </Modal>
      )}
    </div>
  );
}