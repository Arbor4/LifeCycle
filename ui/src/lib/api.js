export const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:39517";

export async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

export function profilePath(project, profile, suffix = "") {
  return `/api/projects/${encodeURIComponent(project)}/profiles/${encodeURIComponent(profile)}${suffix}`;
}

export async function notify(title, body) {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const n = await import("@tauri-apps/plugin-notification");
      let granted = await n.isPermissionGranted();
      if (!granted) granted = (await n.requestPermission()) === "granted";
      if (granted) n.sendNotification({ title, body });
      return;
    }
    if ("Notification" in window) {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    }
  } catch {
    // 通知失败不影响主流程
  }
}