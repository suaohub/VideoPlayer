// 用 Node.js 内置模块生成 assets/icon.ico（无需额外 npm 包）
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = 256, H = 256;
const pixels = new Uint8Array(W * H * 4); // RGBA

// 背景色 #13161F，播放按钮 #818CF8
const BG_R = 19, BG_G = 22, BG_B = 31;
const AC_R = 129, AC_G = 140, AC_B = 248;

// ① 圆角矩形背景（用 SDF 实现平滑边缘）
const CORNER = 44;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = Math.max(Math.abs(x - 127.5) - (128 - CORNER), 0);
    const dy = Math.max(Math.abs(y - 127.5) - (128 - CORNER), 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    let a = 0;
    if (dist <= CORNER)        a = 255;
    else if (dist < CORNER + 1.5) a = Math.round(255 * (CORNER + 1.5 - dist) / 1.5);

    const i = (y * W + x) * 4;
    pixels[i] = BG_R; pixels[i+1] = BG_G; pixels[i+2] = BG_B; pixels[i+3] = a;
  }
}

// ② 播放三角形（2×超采样抗锯齿）
const tx1 = 84, ty1 = 64,  tx2 = 84, ty2 = 192,  tx3 = 192, ty3 = 128;

function ptInTri(px, py) {
  function s(ax, ay, bx, by) { return (px - bx) * (ay - by) - (ax - bx) * (py - by); }
  const d1 = s(tx1, ty1, tx2, ty2);
  const d2 = s(tx2, ty2, tx3, ty3);
  const d3 = s(tx3, ty3, tx1, ty1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const SS = 3; // 3×3 超采样
for (let y = 62; y <= 194; y++) {
  for (let x = 82; x <= 194; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        if (ptInTri(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
      }
    }
    if (hit === 0) continue;
    const fa = hit / (SS * SS);
    const i = (y * W + x) * 4;
    const ba = pixels[i+3] / 255;
    const oa = fa + ba * (1 - fa);
    if (oa > 0) {
      pixels[i]   = Math.round((AC_R * fa + pixels[i]   * ba * (1-fa)) / oa);
      pixels[i+1] = Math.round((AC_G * fa + pixels[i+1] * ba * (1-fa)) / oa);
      pixels[i+2] = Math.round((AC_B * fa + pixels[i+2] * ba * (1-fa)) / oa);
      pixels[i+3] = Math.round(oa * 255);
    }
  }
}

// ===================== PNG 编码 =====================
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([t, data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, t, data, c]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit depth, RGBA

// IDAT: 每行加 filter byte(0)，然后 zlib 压缩
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4;
    const di = y * (W * 4 + 1) + 1 + x * 4;
    raw.set(pixels.subarray(si, si + 4), di);
  }
}
const idat = deflateSync(raw, { level: 6 });

const pngBuf = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG 签名
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ===================== ICO 编码 =====================
// ICO = 6-byte 头 + N×16-byte 目录项 + PNG 数据
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: ICO
icoHeader.writeUInt16LE(1, 4); // 1 image

const dirEntry = Buffer.alloc(16);
dirEntry[0] = 0;  // width  (0 = 256)
dirEntry[1] = 0;  // height (0 = 256)
dirEntry[2] = 0;  // palette count
dirEntry[3] = 0;  // reserved
dirEntry.writeUInt16LE(1, 4);               // planes
dirEntry.writeUInt16LE(32, 6);              // bit depth
dirEntry.writeUInt32LE(pngBuf.length, 8);   // data size
dirEntry.writeUInt32LE(6 + 16, 12);         // data offset (header + 1 entry)

const icoBuf = Buffer.concat([icoHeader, dirEntry, pngBuf]);

const outDir = join(__dirname, '..', 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.ico'), icoBuf);
writeFileSync(join(outDir, 'icon.png'), pngBuf);

console.log(`✅ icon.ico  ${icoBuf.length} bytes`);
console.log(`✅ icon.png  ${pngBuf.length} bytes`);
console.log(`   → ${outDir}`);
