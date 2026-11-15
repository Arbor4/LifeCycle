export const STATE_LABEL = {
  running: "运行中",
  starting: "启动中",
  stopping: "停止中",
  crashed: "崩溃",
  idle: "未启动",
};

export function uptime(ms) {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m" + (s % 60) + "s";
  return Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m";
}

export function levelOf(text) {
  if (/error|exception|fatal|panic/i.test(text)) return "error";
  if (/warn/i.test(text)) return "warn";
  return "info";
}