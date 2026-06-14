// =====================================================================
// gen-icons.mjs — PWA 아이콘(PNG) 생성기 (외부 의존성 0 — Node 내장 zlib만)
//
// 디자인: 브랜드색(#2b5cd9) 전면 배경 + 가운데 흰 '문서(계약서)' 카드
//         (제목 띠 + 본문 줄). maskable 안전영역(중앙 80%) 안에 내용 배치.
// 실행: node tools/gen-icons.mjs  → icons/*.png 생성.
// =====================================================================
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BRAND = [43, 92, 217];    // #2b5cd9
const PAPER = [255, 255, 255];
const LINE = [201, 209, 224];   // #c9d1e0
const TITLE = [43, 92, 217];    // 제목 띠 = 브랜드색

// ---- CRC32 (PNG 청크용) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// 둥근 사각형 안쪽인지 (간단 AA 없음)
function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || x >= rx + w || y < ry || y >= ry + h) return false;
  const minX = rx + r, maxX = rx + w - 1 - r, minY = ry + r, maxY = ry + h - 1 - r;
  let cx = null, cy = null;
  if (x < minX && y < minY) { cx = minX; cy = minY; }
  else if (x > maxX && y < minY) { cx = maxX; cy = minY; }
  else if (x < minX && y > maxY) { cx = minX; cy = maxY; }
  else if (x > maxX && y > maxY) { cx = maxX; cy = maxY; }
  if (cx === null) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  // 전면 배경(maskable: 코너까지 채움)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BRAND);

  // 흰 문서 카드 (중앙, 안전영역 내부)
  const pw = Math.round(size * 0.52);
  const ph = Math.round(size * 0.64);
  const px = Math.round((size - pw) / 2);
  const py = Math.round((size - ph) / 2);
  const pr = Math.round(size * 0.045);
  for (let y = py; y < py + ph; y++)
    for (let x = px; x < px + pw; x++)
      if (inRoundRect(x, y, px, py, pw, ph, pr)) set(x, y, PAPER);

  // 제목 띠 (문서 상단)
  const mx = Math.round(pw * 0.16);
  const tw = Math.round(pw * 0.5);
  const tH = Math.round(ph * 0.085);
  const tY = py + Math.round(ph * 0.12);
  for (let y = tY; y < tY + tH; y++)
    for (let x = px + mx; x < px + mx + tw; x++) set(x, y, TITLE);

  // 본문 줄 4개
  const lineW = pw - mx * 2;
  const lineH = Math.max(2, Math.round(ph * 0.05));
  const gap = Math.round(ph * 0.115);
  let ly = py + Math.round(ph * 0.34);
  for (let n = 0; n < 4; n++) {
    const w = n === 3 ? Math.round(lineW * 0.66) : lineW;
    for (let y = ly; y < ly + lineH; y++)
      for (let x = px + mx; x < px + mx + w; x++) set(x, y, LINE);
    ly += gap;
  }
  return rgba;
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const buf = encodePNG(size, drawIcon(size));
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), buf);
  console.log(`wrote icons/${name} (${size}x${size}, ${buf.length} bytes)`);
}
console.log("done");
