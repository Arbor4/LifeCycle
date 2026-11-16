#!/usr/bin/env node
// 生成 LifeCycle 应用图标：与 docs/logo.svg / 侧边栏 Logo 同源的「循环 + 播放」标记。
// 圆角深色底之外全透明（headless Chrome 透明背景光栅化，QuickLook 会垫白底故弃用），
// sips 缩放、iconutil 打 icns、多尺寸 PNG 条目打 ico；内置 PNG alpha 校验。
import { writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import zlib from "node:zlib";

const OUT = "crates/lifecycle-app/icons";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const MARK = (sw) => `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${sw}">
    <path stroke="url(#a)" d="M12 48a36 36 0 0 1 36-36 39 39 0 0 1 26.96 10.96L84 32"/>
    <path stroke="url(#a)" d="M84 12v20h-20"/>
    <path stroke="url(#b)" d="M84 48a36 36 0 0 1-36 36 39 39 0 0 1-26.96-10.96L12 64"/>
    <path stroke="url(#b)" d="M32 64H12v20"/>
  </g>
  <path fill="url(#c)" d="M40 33.5 63 48 40 62.5Z"/>`;

const DEFS = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2e42"/><stop offset="1" stop-color="#0a0f16"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.62"><stop offset="0" stop-color="#2fd49f" stop-opacity="0.20"/><stop offset="0.55" stop-color="#2f7fe0" stop-opacity="0.10"/><stop offset="1" stop-color="#2f7fe0" stop-opacity="0"/></radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25d09a"/><stop offset="1" stop-color="#3f8cf3"/></linearGradient>
    <linearGradient id="b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3f8cf3"/><stop offset="1" stop-color="#45cbe8"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ae4a8"/><stop offset="1" stop-color="#5fb0ff"/></linearGradient>
  </defs>`;

const appSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}">
  ${DEFS}
  <rect x="0" y="0" width="96" height="96" rx="22" fill="url(#tile)"/>
  <rect x="0" y="0" width="96" height="96" rx="22" fill="url(#glow)"/>
  <rect x="0.8" y="0.8" width="94.4" height="94.4" rx="21.2" fill="none" stroke="url(#edge)" stroke-width="1.2"/>
  ${MARK(8.5)}
</svg>`;

// 托盘模板图：仅标记、纯黑 + alpha，macOS 按模板着色适配明暗菜单栏
const traySvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}">
  <g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="9">
    <path d="M12 48a36 36 0 0 1 36-36 39 39 0 0 1 26.96 10.96L84 32"/>
    <path d="M84 12v20h-20"/>
    <path d="M84 48a36 36 0 0 1-36 36 39 39 0 0 1-26.96-10.96L12 64"/>
    <path d="M32 64H12v20"/>
  </g>
  <path fill="#000000" d="M40 33.5 63 48 40 62.5Z"/>
</svg>`;

const work = join(tmpdir(), `lc-icons-${process.pid}`);
mkdirSync(work, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- headless Chrome 透明光栅化 ----
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(work, "profile")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });
const cleanup = () => {
  chrome.kill("SIGKILL");
  rmSync(work, { recursive: true, force: true });
};
process.on("exit", cleanup);

let version = null;
for (let i = 0; i < 50 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    await sleep(200);
  }
}
if (!version) throw new Error("headless Chrome 未就绪");
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
let loadResolve = null;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Page.loadEventFired" && loadResolve) {
    loadResolve();
    loadResolve = null;
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Page.enable");
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

async function rasterize(svgText, size, name) {
  const file = join(work, `${name}.svg`);
  writeFileSync(file, svgText);
  await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((r) => (loadResolve = r));
  await send("Page.navigate", { url: `file://${file}` });
  await Promise.race([loaded, sleep(3000)]);
  await sleep(150);
  const m = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(m.result.data, "base64");
  const out = join(work, `${name}.png`);
  writeFileSync(out, buf);
  return out;
}

const base = await rasterize(appSvg(512), 512, "app");
const tray = await rasterize(traySvg(128), 128, "tray");
chrome.kill("SIGKILL");

// ---- PNG alpha 校验（纯 node 解码，非隔行 8bit RGB/RGBA） ----
function decode(buf) {
  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2)) throw new Error(`unsupported png depth=${depth} color=${color}`);
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
    pos += stride;
  }
  return { w, h, bpp, data: out };
}
const alphaAt = (img, x, y) => (img.bpp === 4 ? img.data[(y * img.w + x) * img.bpp + 3] : 255);
function assertTransparentCorners(file) {
  const img = decode(readFileSync(file));
  const pts = [[0, 0], [img.w - 1, 0], [0, img.h - 1], [img.w - 1, img.h - 1]];
  if (img.w >= 128) pts.push([2, 2]);
  for (const [x, y] of pts) {
    if (alphaAt(img, x, y) !== 0) throw new Error(`${file}: 角落不透明 (${x},${y}) a=${alphaAt(img, x, y)}`);
  }
  if (alphaAt(img, img.w >> 1, img.h >> 1) !== 255) throw new Error(`${file}: 中心应不透明`);
}
assertTransparentCorners(base);

// ---- 尺寸与打包 ----
const render = (s) => {
  const out = join(work, `s${s}.png`);
  copyFileSync(base, out);
  if (s !== 512) execSync(`sips -z ${s} ${s} ${out} >/dev/null 2>&1`);
  assertTransparentCorners(out);
  return out;
};
const cache = new Map();
for (const s of [16, 32, 48, 64, 128, 256, 512]) cache.set(s, render(s));

writeFileSync(join(OUT, "icon.png"), readFileSync(cache.get(512)));
writeFileSync(join(OUT, "512x512.png"), readFileSync(cache.get(512)));
for (const s of [32, 128, 256]) writeFileSync(join(OUT, `${s}x${s}.png`), readFileSync(cache.get(s)));
const tray64 = join(work, "tray64.png");
copyFileSync(tray, tray64);
execSync(`sips -z 64 64 ${tray64} >/dev/null 2>&1`);
writeFileSync(join(OUT, "trayTemplate.png"), readFileSync(tray64));

const iconset = join(OUT, "icon.iconset");
mkdirSync(iconset, { recursive: true });
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${s}x${s}.png`), readFileSync(cache.get(s)));
  if (s <= 256) writeFileSync(join(iconset, `icon_${s}x${s}@2x.png`), readFileSync(cache.get(s * 2)));
}
try {
  execSync(`iconutil -c icns ${iconset} -o ${join(OUT, "icon.icns")}`);
} catch {
  console.warn("iconutil 不可用，跳过 icns");
}

// 多尺寸 PNG 条目 ICO（Vista+ 支持 PNG 压缩条目，保留 alpha）
const icoSizes = [16, 32, 48, 64, 128, 256];
const payloads = icoSizes.map((s) => readFileSync(cache.get(s)));
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header[e] = s === 256 ? 0 : s;
  header[e + 1] = s === 256 ? 0 : s;
  header[e + 2] = 0;
  header[e + 3] = 0;
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(payloads[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += payloads[i].length;
});
writeFileSync(join(OUT, "icon.ico"), Buffer.concat([header, ...payloads]));

rmSync(work, { recursive: true, force: true });
console.log("icons generated (transparent corners, multi-size ico):", OUT);