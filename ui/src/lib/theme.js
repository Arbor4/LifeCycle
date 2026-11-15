import { useSyncExternalStore } from "react";
import { api } from "./api.js";

const KEY = "lifecycle-theme";
const MODES = ["system", "light", "dark"];
const listeners = new Set();

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

let mode = read();
let systemLight =
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)").matches : false;
let state = { mode, resolved: resolve() };

function resolve() {
  return mode === "system" ? (systemLight ? "light" : "dark") : mode;
}

function paint(animate) {
  const resolved = resolve();
  const root = document.documentElement;
  if (animate && root.dataset.theme !== resolved) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 340);
  }
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  state = { mode, resolved };
  for (const l of listeners) l();
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => state);
}

export function themeMode() {
  return mode;
}

export function initTheme() {
  paint(false);
  const mq = matchMedia("(prefers-color-scheme: light)");
  const onChange = (e) => {
    systemLight = e.matches;
    if (mode === "system") paint(true);
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function setTheme(next, { animate = true } = {}) {
  if (!MODES.includes(next) || next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 隐私模式下忽略
  }
  paint(animate);
}

/// 采纳后端持久化的主题（启动时），不回写。
export function adoptTheme(next) {
  if (!MODES.includes(next) || next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore
  }
  paint(false);
}

export async function persistTheme() {
  const settings = await api("/api/settings");
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ ...settings, theme: mode }),
  });
}