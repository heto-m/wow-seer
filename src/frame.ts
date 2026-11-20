import { Png } from "./png.js";

const HEADER_X = 68, HEADER_CELLS = 54, HEADER_BYTES = 20;
const TAIL_X = HEADER_X + 4 * HEADER_CELLS;

export class NotSeer extends Error {}
export class BadFrame extends Error {}

export interface Header {
  version: number;
  bits: number;
  cell: number;
  msg: number;
  part: number;
  parts: number;
  length: number;
  cols: number;
  rows: number;
  adler: number;
  scale?: [number, number];
}

const trunc = Math.trunc;

export function roundHalfEven(v: number): number {
  const f = Math.floor(v), d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

type Pixel = [number, number, number] | null;

interface Pixels {
  cols: number;
  rows: number;
  px(x: number, y: number): Pixel;
}

export class Raw implements Pixels {
  constructor(private data: Buffer, public cols: number, public rows: number, private bpp = 4) {}

  px(x: number, y: number): Pixel {
    if (!(x >= 0 && x < this.cols && y >= 0 && y < this.rows)) return null;
    const i = (y * this.cols + x) * this.bpp;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
}

function white(p: Pixel): boolean {
  return p !== null && Math.min(...p) > 127;
}

function fit(units: number[], pixels: number[]): [number, number] {
  const n = units.length;
  const mu = units.reduce((a, b) => a + b, 0) / n;
  const mp = pixels.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (units[i] - mu) * (pixels[i] - mp);
    den += (units[i] - mu) ** 2;
  }
  const scale = num / den;
  return [scale, mp - scale * mu];
}

function edges(img: Pixels, alongX: boolean, fixed: number, count: number): number[] {
  const found: number[] = [];
  let state = true;
  const limit = alongX ? img.cols : img.rows;
  for (let i = 1; i < limit && found.length < count; i++) {
    const s = white(alongX ? img.px(i, fixed) : img.px(fixed, i));
    if (s !== state) {
      found.push(i);
      state = s;
    }
  }
  return found;
}

const NEAR = [0, -1, 1, -2, 2, -3, 3];

function nearestEdge(img: Pixels, guess: number, y: number): number | null {
  for (const d of NEAR) {
    const i = guess + d;
    if (i >= 1 && white(img.px(i, y)) !== white(img.px(i - 1, y))) return i;
  }
  return null;
}

export function adler32(data: Buffer): number {
  let a = 1, b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function decode(source: Buffer | Raw): { header: Header; payload: Buffer } {
  const load = (rows: number, cols: number): Pixels => (source instanceof Raw ? source : new Png(source, rows, cols));
  let img = load(8, 1200);
  if (!white(img.px(0, 1))) throw new NotSeer();
  const ex = edges(img, true, 1, 16);
  if (ex.length < 16) throw new NotSeer();
  const ux = Array.from({ length: 16 }, (_, j) => 4 * (j + 1));
  let [sx, x0] = fit(ux, ex);
  const worst = Math.max(...ux.map((u, i) => Math.abs(x0 + sx * u - ex[i])));
  if (!(sx > 0.3 && sx < 4) || worst > 1.5) throw new NotSeer();
  const bits: number[] = [];
  for (let k = 0; k < HEADER_CELLS; k++) {
    const p = img.px(trunc(x0 + (HEADER_X + 2 + 4 * k) * sx), trunc(2 * sx));
    if (p === null) throw new BadFrame("header out of view");
    for (const v of p) bits.push(v > 127 ? 1 : 0);
  }
  const h: number[] = [];
  for (let i = 0; i < HEADER_BYTES; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    h.push(byte);
  }
  if (h[0] !== 83 || h[1] !== 82) throw new NotSeer();
  if (h.slice(0, -1).reduce((a, b) => a + b, 0) % 256 !== h[HEADER_BYTES - 1]) throw new BadFrame("header checksum");
  const header: Header = {
    version: h[2], bits: h[3], cell: h[4], msg: h[5] * 256 + h[6], part: h[7], parts: h[8],
    length: h[9] * 256 + h[10], cols: h[11] * 256 + h[12], rows: h[13],
    adler: ((h[14] << 24) | (h[15] << 16) | (h[16] << 8) | h[17]) >>> 0,
  };
  if (header.version !== 1 || header.bits !== 2) {
    throw new BadFrame(`unsupported frame version ${header.version} bits ${header.bits}`);
  }
  const { cell, cols, rows } = header;
  const height = 8 + rows * cell;
  const width = Math.max(4 + cols * cell, TAIL_X + 32);
  img = load(trunc((height + 8) * sx * 1.5) + 8, trunc((width + 8) * sx) + 8);
  for (let m = 1; m < Math.floor((width - TAIL_X) / 4); m++) {
    const u = TAIL_X + 4 * m;
    const e = nearestEdge(img, trunc(roundHalfEven(x0 + u * sx)), 1);
    if (e !== null) {
      ux.push(u);
      ex.push(e);
      [sx, x0] = fit(ux, ex);
    }
  }
  const nv = Math.ceil(height / 4);
  const ey = edges(img, false, trunc(x0 + 2 * sx), nv - 1);
  if (ey.length < nv - 1) throw new BadFrame("sync column cut");
  const [sy, y0] = fit(Array.from({ length: nv - 1 }, (_, j) => 4 * (j + 1)), ey);
  const length = header.length;
  const groups = Math.ceil(length / 3);
  const out = Buffer.alloc(groups * 3);
  for (let g = 0; g < groups; g++) {
    let v = 0;
    for (let c = 0; c < 4; c++) {
      const n = 4 * g + c;
      const x = trunc(x0 + (4 + ((n % cols) + 0.5) * cell) * sx);
      const y = trunc(y0 + (8 + (Math.floor(n / cols) + 0.5) * cell) * sy);
      const p = img.px(x, y);
      if (p === null) throw new BadFrame("payload out of view");
      for (const ch of p) v = (v << 2) | Math.min(3, roundHalfEven((ch * 3) / 255));
    }
    out[3 * g] = (v >> 16) & 255;
    out[3 * g + 1] = (v >> 8) & 255;
    out[3 * g + 2] = v & 255;
  }
  const payload = out.subarray(0, length);
  if (adler32(payload) !== header.adler) throw new BadFrame("payload checksum");
  header.scale = [sx, sy];
  return { header, payload };
}

export class Assembler {
  private parts = new Map<string, Map<number, Buffer>>();

  constructor(private keep = 8) {}

  add(header: Header, payload: Buffer): Buffer | null {
    const key = `${header.msg}/${header.parts}`;
    let got = this.parts.get(key);
    if (!got) {
      got = new Map();
      this.parts.set(key, got);
    }
    got.set(header.part, payload);
    if (got.size === header.parts) {
      this.parts.delete(key);
      const all: Buffer[] = [];
      for (let i = 1; i <= header.parts; i++) all.push(got.get(i) as Buffer);
      return Buffer.concat(all);
    }
    while (this.parts.size > this.keep) this.parts.delete(this.parts.keys().next().value as string);
    return null;
  }
}
