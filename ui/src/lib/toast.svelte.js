let items = $state([]);
let seq = 0;

export function toasts() {
  return items;
}

export function pushToast(text, opts = {}) {
  const id = ++seq;
  items = [...items, { id, text, kind: opts.kind ?? "info", action: opts.action }];
  setTimeout(() => dismiss(id), opts.duration ?? 6000);
  return id;
}

export function dismiss(id) {
  items = items.filter((t) => t.id !== id);
}