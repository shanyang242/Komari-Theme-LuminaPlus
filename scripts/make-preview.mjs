import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "preview.png");
const width = 1280;
const height = 720;
const pixels = new Uint8Array(width * height * 4);

const font = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4;
  pixels[index] = r;
  pixels[index + 1] = g;
  pixels[index + 2] = b;
  pixels[index + 3] = a;
}

function blendPixel(x, y, r, g, b, a = 255) {
  if (a >= 255) {
    setPixel(x, y, r, g, b, 255);
    return;
  }
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4;
  const alpha = a / 255;
  pixels[index] = Math.round(r * alpha + pixels[index] * (1 - alpha));
  pixels[index + 1] = Math.round(g * alpha + pixels[index + 1] * (1 - alpha));
  pixels[index + 2] = Math.round(b * alpha + pixels[index + 2] * (1 - alpha));
  pixels[index + 3] = 255;
}

function fillRect(x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      blendPixel(xx, yy, ...color);
    }
  }
}

function fillRoundedRect(x, y, w, h, radius, color) {
  const r = Math.max(0, radius);
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const dx = xx < x + r ? x + r - xx : xx >= x + w - r ? xx - (x + w - r - 1) : 0;
      const dy = yy < y + r ? y + r - yy : yy >= y + h - r ? yy - (y + h - r - 1) : 0;
      if (dx * dx + dy * dy <= r * r || dx === 0 || dy === 0) {
        blendPixel(xx, yy, ...color);
      }
    }
  }
}

function drawText(text, x, y, scale, color) {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    if (char === " ") {
      cursor += scale * 4;
      continue;
    }
    const glyph = font[char];
    if (!glyph) {
      cursor += scale * 6;
      continue;
    }
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((value, columnIndex) => {
        if (value === "1") {
          fillRect(cursor + columnIndex * scale, y + rowIndex * scale, scale, scale, color);
        }
      });
    });
    cursor += scale * 6;
  }
}

function drawBackground() {
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const wave = Math.sin((x / width) * Math.PI * 2 + t * 3.2) * 10;
      const r = Math.round(237 - t * 24 + wave * 0.28);
      const g = Math.round(243 - t * 16 + wave * 0.18);
      const b = Math.round(248 - t * 4 + wave * 0.12);
      setPixel(x, y, r, g, b, 255);
    }
  }
}

function drawDashboard() {
  fillRoundedRect(640, 94, 520, 402, 28, [255, 255, 255, 210]);
  fillRoundedRect(674, 134, 452, 42, 14, [47, 75, 111, 235]);
  for (let row = 0; row < 3; row += 1) {
    const top = 208 + row * 82;
    fillRoundedRect(680, top, 196, 54, 16, [248, 250, 252, 245]);
    fillRoundedRect(902, top, 196, 54, 16, [248, 250, 252, 245]);
    fillRoundedRect(702, top + 20, 86 + row * 18, 10, 5, [77, 120, 209, 230]);
    fillRoundedRect(924, top + 20, 118 - row * 12, 10, 5, [70, 166, 126, 230]);
  }
  fillRoundedRect(546, 374, 470, 232, 24, [31, 41, 59, 236]);
  fillRoundedRect(586, 422, 390, 24, 12, [99, 126, 179, 255]);
  for (let index = 0; index < 18; index += 1) {
    const barHeight = 22 + ((index * 19) % 70);
    fillRoundedRect(590 + index * 20, 548 - barHeight, 10, barHeight, 5, [98, 192, 143, 235]);
  }
}

function writePng() {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(outPath, png);
}

drawBackground();
fillRoundedRect(52, 50, 1176, 620, 34, [255, 255, 255, 72]);
drawText("KOMARI", 82, 96, 11, [25, 34, 47, 255]);
drawText("THEME", 86, 196, 8, [25, 44, 70, 255]);
drawText("REALTIME COST THEME", 86, 292, 5, [70, 82, 102, 255]);
fillRoundedRect(84, 382, 190, 42, 21, [31, 41, 59, 226]);
drawText("FAST", 120, 395, 4, [246, 248, 252, 255]);
fillRoundedRect(294, 382, 240, 42, 21, [255, 255, 255, 190]);
drawText("PING COST", 330, 395, 4, [31, 41, 59, 255]);
fillRoundedRect(84, 446, 280, 42, 21, [226, 236, 246, 220]);
drawText("THEME SETTINGS", 118, 459, 4, [31, 56, 88, 255]);
drawDashboard();
writePng();
console.log(`Wrote ${outPath}`);
