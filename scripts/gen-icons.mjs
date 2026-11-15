#!/usr/bin/env node
// 生成 LifeCycle 应用图标：绿底白色循环箭头，输出 png/icns/ico。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const OUT = "crates/lifecycle-app/icons";
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2, r = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角矩形背景
      const rad = size * 0.18;
      const dx = Math.max(Math.abs(x - c) - (c - rad), 0);
      const dy = Math.max(Math.abs(y - c) - (c - rad), 0);
      const inside = dx * dx + dy * dy <= rad * rad;
      let [R, G, B, A] = inside ? [22, 163, 74, 255] : [0, 0, 0, 0];
      // 白色圆环（循环符号）
      const d = Math.hypot(x - c, y - c);
      const ring = d > r * 0.62 && d < r * 0.82;
      const angle = Math.atan2(y - c, x - c);
      const gap = angle > -0.5 && angle < 0.35; // 环的缺口
      if (ring && !gap) [R, G, B] = [255, 255, 255];
      // 缺口处的箭头
      const ax = c + r * 0.72 * Math.cos(0.35), ay = c + r * 0.72 * Math.sin(0.35);
      if (Math.hypot(x - ax, y - ay) < size * 0.09) [R, G, B] = [255, 255, 255];
      px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = A;
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const big = png(512);
writeFileSync(join(OUT, "icon.png"), big);
writeFileSync(join(OUT, "512x512.png"), big);
for (const s of [32, 128, 256]) {
  writeFileSync(join(OUT, `${s}x${s}.png`), png(s));
}
// iconset → icns
const iconset = join(OUT, "icon.iconset");
mkdirSync(iconset, { recursive: true });
const sizes = [16, 32, 128, 256, 512];
for (const s of sizes) {
  writeFileSync(join(iconset, `icon_${s}x${s}.png`), png(s));
  if (s <= 256) writeFileSync(join(iconset, `icon_${s}x${s}@2x.png`), png(s * 2));
}
try {
  execSync(`iconutil -c icns ${iconset} -o ${join(OUT, "icon.icns")}`);
} catch {
  console.warn("iconutil 不可用，跳过 icns");
}
// ICO（内嵌 256px PNG）
const p256 = png(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(p256.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(join(OUT, "icon.ico"), Buffer.concat([ico, p256]));
console.log("icons generated:", OUT);