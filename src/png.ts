import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class PngError extends Error {}

function inflatePrefix(data: Buffer, want: number): Buffer {
  let take = Math.min(data.length, Math.max(4096, want));
  for (;;) {
    let out: Buffer;
    try {
      out = zlib.inflateSync(data.subarray(0, take), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch (e) {
      throw new PngError(String((e as Error).message));
    }
    if (out.length >= want || take >= data.length) return out;
    take = Math.min(data.length, take * 2);
  }
}

export class Png {
  width = 0;
  height = 0;
  rows = 0;
  cols = 0;
  bpp = 3;
  private lines: Buffer[] = [];

  // Decoding only the left columns is safe: Sub/Average/Paeth never read pixels to the right.
  constructor(data: Buffer, rows: number, cols: number) {
    if (data.length < 8 || !data.subarray(0, 8).equals(SIGNATURE)) throw new PngError("not a PNG");
    let pos = 8;
    const idat: Buffer[] = [];
    while (pos + 8 <= data.length) {
      const length = data.readUInt32BE(pos);
      const kind = data.toString("latin1", pos + 4, pos + 8);
      const body = data.subarray(pos + 8, pos + 8 + length);
      pos += 12 + length;
      if (kind === "IHDR") {
        this.width = body.readUInt32BE(0);
        this.height = body.readUInt32BE(4);
        const depth = body[8], ctype = body[9], interlace = body[12];
        if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace) {
          throw new PngError(`unsupported PNG (depth ${depth}, colour type ${ctype})`);
        }
        this.bpp = ctype === 2 ? 3 : 4;
      } else if (kind === "IDAT") {
        idat.push(body);
      } else if (kind === "IEND") {
        break;
      }
    }
    if (!this.width) throw new PngError("no IHDR");
    this.rows = Math.min(rows, this.height);
    this.cols = Math.min(cols, this.width);
    const stride = this.width * this.bpp + 1;
    const raw = inflatePrefix(Buffer.concat(idat), this.rows * stride);
    this.rows = Math.min(this.rows, Math.floor(raw.length / stride));
    const bpp = this.bpp, n = this.cols * bpp;
    let prev = Buffer.alloc(n);
    for (let y = 0; y < this.rows; y++) {
      const off = y * stride;
      const ft = raw[off];
      const line = Buffer.from(raw.subarray(off + 1, off + 1 + n));
      if (ft === 1) {
        for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255;
      } else if (ft === 2) {
        for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255;
      } else if (ft === 3) {
        for (let i = 0; i < n; i++) {
          const left = i >= bpp ? line[i - bpp] : 0;
          line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255;
        }
      } else if (ft === 4) {
        for (let i = 0; i < n; i++) {
          const a = i >= bpp ? line[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[i] = (line[i] + pred) & 255;
        }
      }
      this.lines.push(line);
      prev = line;
    }
  }

  px(x: number, y: number): [number, number, number] | null {
    if (!(x >= 0 && x < this.cols && y >= 0 && y < this.rows)) return null;
    const i = x * this.bpp, line = this.lines[y];
    return [line[i], line[i + 1], line[i + 2]];
  }
}
