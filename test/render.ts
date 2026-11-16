import fs from "node:fs";
import zlib from "node:zlib";
import { roundHalfEven } from "../src/frame.js";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

export function renderPng(cells: number[][], width: number, height: number, sx = 1, sy = 1, squeeze = true): Buffer {
  const img = Array.from({ length: height }, () => {
    const row = Buffer.alloc(width * 3);
    for (let i = 0; i < width; i++) row.set([0x5a, 0x8c, 0x3c], i * 3);
    return row;
  });
  for (const [x, y, s, r, g, b] of cells) {
    let col = [r, g, b].map((v) => roundHalfEven(v * 255));
    if (squeeze) col = col.map((c) => 3 + Math.trunc((c * 249) / 255));
    for (let py = 0; py < height; py++) {
      if (!(y * sy <= py + 0.5 && py + 0.5 < (y + s) * sy)) continue;
      const row = img[py];
      const end = Math.min(width, Math.trunc((x + s) * sx) + 2);
      for (let px = Math.max(0, Math.trunc(x * sx) - 1); px < end; px++) {
        if (x * sx <= px + 0.5 && px + 0.5 < (x + s) * sx) row.set(col, 3 * px);
      }
    }
  }
  const raw = Buffer.concat(img.map((row) => Buffer.concat([Buffer.from([0]), row])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function readCells(file: string): number[][] {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/).map(Number));
}
