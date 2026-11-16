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

export default function LogPanel({ project, profile, maxLines = 5000, initialSource = "run", currentPort = null, onRestart = null }) {
  const { t } = useI18n();
  const [source, setSource] = useState(initialSource);

  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);
  const [lines, setLines] = useState([]);
  const [level, setLevel] = useState("all");
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
  const [releasingPort, setReleasingPort] = useState(false);

  // 检测日志中是否存在端口冲突错误（如 os error 48 / Address already in use）
  const detectedPortError = useMemo(() => {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
      const txt = lines[i]?.text || "";
      if (txt.includes("Address already in use") || txt.includes("os error 48") || txt.includes("EADDRINUSE")) {
        // 尝试从文本中解析端口号，或使用传入的 currentPort / 默认 39517
        const m = txt.match(/(?:127\.0\.0\.1:|:)(\d{4,5})/);
        const p = m ? parseInt(m[1], 10) : currentPort || 39517;
        return p;
      }
    }
    return null;
  }, [lines, currentPort]);

  async function handleReleasePort(portToRelease) {
    if (releasingPort || !portToRelease) return;
    setReleasingPort(true);
    try {
      const res = await api("/api/ports/release", {
        method: "POST",
        body: JSON.stringify({ port: portToRelease }),
      });
      pushToast(t("端口 {port} 已成功释放（终止 {n} 个占用进程）", { port: portToRelease, n: res.killed_processes }), { kind: "success" });
      if (onRestart) {
        await onRestart();
      }
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setReleasingPort(false);
    }
  }
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

  const errorCount = useMemo(() => lines.filter((l) => levelOf(l.text) === "error").length, [lines]);
  const warnCount = useMemo(() => lines.filter((l) => levelOf(l.text) === "warn").length, [lines]);

  const searchRe = useMemo(() => {
    if (!search) return null;
    if (search.startsWith("/") && search.length > 2) {
      try {
        const lastSlash = search.lastIndexOf("/");
        if (lastSlash > 0) {
          const pattern = search.slice(1, lastSlash);
          const flags = search.slice(lastSlash + 1) || "i";
          return new RegExp(pattern, flags);
        }
      } catch {
        // fallback to normal
      }
    }
    return null;
  }, [search]);

  const visible = useMemo(
    () =>
      lines.filter((l) => {
        if (level !== "all" && levelOf(l.text) !== level) return false;
        if (searchRe && !searchRe.test(l.text)) return false;
        return true;
      }),
    [lines, level, searchRe]
  );

  const matches = useMemo(() => {
    if (!search) return [];
    if (searchRe) {
      const out = [];
      visible.forEach((l, i) => {
        if (searchRe.test(l.text)) out.push(i);
      });
      return out;
    }
    const needle = search.toLowerCase();
    const out = [];
    visible.forEach((l, i) => {
      if (l.text.toLowerCase().includes(needle)) out.push(i);
    });
    return out;
  }, [visible, search, searchRe]);

  useEffect(() => {
    if (autoRef.current && container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [visible.length]);

  useEffect(() => setMatchPos(-1), [search, source, level]);

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
      {/* 端口占用错误一键修复横幅（智能诊断） */}
      {detectedPortError && (
        <div className="flex items-center justify-between border-b border-[var(--red)]/40 bg-[var(--red-soft)] px-3 py-1.5 text-xs text-[var(--red)]">
          <div className="flex items-center gap-2">
            <Icon name="x" size={14} className="flex-none" />
            <span className="font-semibold">
              {t("检测到端口 {port} 被占用（Address already in use / os error 48）", { port: detectedPortError })}
            </span>
          </div>
          <button
            type="button"
            disabled={releasingPort}
            className="flex items-center gap-1.5 rounded bg-[var(--red)] px-2.5 py-0.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition-opacity"
            onClick={() => handleReleasePort(detectedPortError)}
          >
            {releasingPort ? <span className="spinner" /> : <Icon name="refresh" size={12} />}
            {t("一键释放端口并重启")}
          </button>
        </div>
      )}

      {/* 单行紧凑高能工具栏（高度 38px，极度节省垂直空间） */}
      <div className="flex h-10 flex-none items-center justify-between border-b border-[var(--line)] bg-[var(--bg1)] px-2.5 sm:px-3 gap-2">
        {/* 左侧：日志源分段胶囊 + 级别快捷筛选徽标 */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center rounded-lg bg-[var(--bg2)] p-0.5 border border-[var(--line)]">
            <button
              type="button"
              className={sourceBtn(source === "run")}
              onClick={() => setSource("run")}
              title={t("查看服务启动/运行控制台输出")}
            >
              <Icon name="play" size={11} className={source === "run" ? "text-[var(--grn)]" : ""} />
              <span className="text-xs">{t("启动日志")}</span>
            </button>
            <button
              type="button"
              className={sourceBtn(source === "build")}
              onClick={() => setSource("build")}
              title={t("查看构建与编译输出")}
            >
              <Icon name="compile" size={11} className={source === "build" ? "text-[var(--vio)]" : ""} />
              <span className="text-xs">{t("编译日志")}</span>
            </button>
          </div>

          {/* 级别筛选分段徽标 */}
          <div className="hidden lg:flex items-center rounded-md bg-[var(--bg2)]/60 p-0.5 border border-[var(--line)] text-[11px]">
            <button
              type="button"
              className={`px-2 py-0.5 rounded transition-colors ${level === "all" ? "bg-[var(--bg1)] font-semibold text-[var(--txt)] shadow-xs" : "text-[var(--dim)] hover:text-[var(--txt)]"}`}
              onClick={() => setLevel("all")}
            >
              {t("全部")}
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${level === "error" ? "bg-[var(--red-soft)] font-semibold text-[var(--red)] shadow-xs" : "text-[var(--dim)] hover:text-[var(--red)]"}`}
              onClick={() => setLevel(level === "error" ? "all" : "error")}
            >
              <span>{t("错误")}</span>
              {errorCount > 0 && <span className="mono rounded-full bg-[var(--red)] px-1 text-[9px] text-white">{errorCount}</span>}
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${level === "warn" ? "bg-[var(--amb-soft)] font-semibold text-[var(--amb)] shadow-xs" : "text-[var(--dim)] hover:text-[var(--amb)]"}`}
              onClick={() => setLevel(level === "warn" ? "all" : "warn")}
            >
              <span>{t("警告")}</span>
              {warnCount > 0 && <span className="mono rounded-full bg-[var(--amb)] px-1 text-[9px] text-black">{warnCount}</span>}
            </button>
          </div>
        </div>

        {/* 中间：多合一搜索框（支持普通文本与 /regex/） */}
        <div className="flex items-center gap-1.5 mx-1 min-w-0 max-w-xs sm:max-w-sm flex-1">
          <div className="relative w-full">
            <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
            <input
              className="input h-7 w-full pl-7! pr-14! text-xs"
              placeholder={t("搜索或 /正则/…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
              }}
            />
            {search && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <span className="mono text-[10px] text-[var(--dim)] px-1">
                  {matches.length ? `${matchPos + 1}/${matches.length}` : "0"}
                </span>
                <button
                  type="button"
                  className="p-0.5 text-[var(--dim)] hover:text-[var(--txt)] rounded"
                  onClick={() => setSearch("")}
                  title={t("清空")}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            )}
          </div>
          {matches.length > 0 && (
            <div className="hidden sm:flex items-center gap-0.5">
              <button className="btn btn-sm h-7 w-7 p-0 justify-center" onClick={() => gotoMatch(-1)} title={t("上一个匹配 (Shift+Enter)")}>
                <Icon name="up" size={11} />
              </button>
              <button className="btn btn-sm h-7 w-7 p-0 justify-center" onClick={() => gotoMatch(1)} title={t("下一个匹配 (Enter)")}>
                <Icon name="down" size={11} />
              </button>
            </div>
          )}
        </div>

        {/* 右侧：极简紧凑图标按钮组 */}
        <div className="flex items-center gap-1 flex-none">
          {/* 行数统计 */}
          <span className="mono hidden text-[11px] text-[var(--dim)] xl:inline mr-1">
            {t("{n} 行", { n: visible.length })}
          </span>

          {/* 自动滚动开关 */}
          <button
            type="button"
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors ${
              autoScroll ? "bg-[var(--blu-soft)] text-[var(--blu)] font-medium" : "text-[var(--dim)] hover:text-[var(--txt)] hover:bg-[var(--bg2)]"
            }`}
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? t("自动滚动已开启，点击暂停跟随") : t("自动滚动已暂停，点击开启跟随")}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoScroll ? "bg-[var(--blu)]" : "bg-[var(--dim)]"}`} />
            <span className="hidden sm:inline text-[11px]">{t("滚动")}</span>
          </button>

          {/* 颜色高亮开关 */}
          <button
            type="button"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors ${
              colorOn ? "bg-[var(--cyn-soft)] text-[var(--cyn)]" : "text-[var(--dim)] hover:text-[var(--txt)] hover:bg-[var(--bg2)]"
            }`}
            onClick={() => setColorOn((v) => !v)}
            title={t("切换 ANSI 语法高亮与主题色彩")}
          >
            <Icon name="sparkles" size={13} />
          </button>

          {/* 复制当前日志 */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--dim)] hover:text-[var(--txt)] hover:bg-[var(--bg2)] transition-colors"
            onClick={copyVisible}
            disabled={!visible.length}
            title={t("复制当前过滤出的日志内容")}
          >
            <Icon name="copy" size={13} />
          </button>

          {/* 清屏 */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--dim)] hover:text-[var(--txt)] hover:bg-[var(--bg2)] transition-colors"
            onClick={() => setLines([])}
            title={t("仅清空当前屏幕显示，不删除日志文件 (Cmd+L)")}
          >
            <Icon name="trash" size={13} />
          </button>

          {/* 打开日志文件 */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--dim)] hover:text-[var(--txt)] hover:bg-[var(--bg2)] transition-colors"
            onClick={openLogFile}
            title={t("在系统文件管理器或编辑器中打开该日志文件")}
          >
            <Icon name="open" size={13} />
          </button>
        </div>
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