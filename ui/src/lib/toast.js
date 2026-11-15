import { useSyncExternalStore } from "react";

let items = [];
let seq = 0;
const listeners = new Set();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function pushToast(text, opts = {}) {
  const id = ++seq;
  items = [...items, { id, text, kind: opts.kind ?? "info", action: opts.action }];
  emit();
  setTimeout(() => dismiss(id), opts.duration ?? 6000);
  return id;
}

export function dismiss(id) {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

export function useToasts() {
  return useSyncExternalStore(subscribe, () => items);
}