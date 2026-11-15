#!/usr/bin/env node
// 生成 LifeCycle 应用图标：与 docs/logo.svg / 侧边栏 Logo 同源的「循环 + 播放」标记 + 圆角深色底。
// 用 macOS QuickLook 光栅化 SVG、sips 缩放，保证与品牌标记像素一致，无需浏览器。
import { writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OUT = "crates/lifecycle-app/icons";
mkdirSync(OUT, { recursive: true });

const MARK = `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="7.5">
    <path stroke="url(#a)" d="M12 48a36 36 0 0 1 36-36 39 39 0 0 1 26.96 10.96L84 32"/>
    <path stroke="url(#a)" d="M84 12v20h-20"/>
    <path stroke="url(#b)" d="M84 48a36 36 0 0 1-36 36 39 39 0 0 1-26.96-10.96L12 64"/>
    <path stroke="url(#b)" d="M32 64H12v20"/>
  </g>
  <path fill="url(#c)" d="M40 33.5 63 48 40 62.5Z"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="512" height="512">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#152230"/><stop offset="1" stop-color="#0a0e13"/></linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1fb583"/><stop offset="1" stop-color="#2f7fe0"/></linearGradient>
    <linearGradient id="b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f7fe0"/><stop offset="1" stop-color="#39c6e0"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#31d49f"/><stop offset="1" stop-color="#4da3ff"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="96" height="96" rx="21" fill="url(#tile)"/>
  ${MARK}
</svg>`;

const work = join(tmpdir(), `lc-icons-${process.pid}`);
mkdirSync(work, { recursive: true });
const svgPath = join(work, "lifecycle-icon.svg");
writeFileSync(svgPath, svg);
execSync(`qlmanage -t -s 512 -o ${work} ${svgPath} >/dev/null 2>&1`);
const base = join(work, "lifecycle-icon.svg.png");

const render = (s) => {
  const out = join(work, `s${s}.png`);
  copyFileSync(base, out);
  if (s !== 512) execSync(`sips -z ${s} ${s} ${out} >/dev/null 2>&1`);
  return out;
};

const cache = new Map();
for (const s of [16, 32, 64, 128, 256, 512]) cache.set(s, render(s));

writeFileSync(join(OUT, "icon.png"), readFileSync(cache.get(512)));
writeFileSync(join(OUT, "512x512.png"), readFileSync(cache.get(512)));
for (const s of [32, 128, 256]) writeFileSync(join(OUT, `${s}x${s}.png`), readFileSync(cache.get(s)));

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
const p256 = readFileSync(cache.get(256));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(p256.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(join(OUT, "icon.ico"), Buffer.concat([ico, p256]));
rmSync(work, { recursive: true, force: true });
console.log("icons generated from logo:", OUT);