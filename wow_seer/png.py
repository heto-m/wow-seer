import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PngError(ValueError):
    pass


class Png:
    # Decoding only the left columns is safe: Sub/Average/Paeth never read pixels to the right.

    def __init__(self, data, rows, cols):
        if data[:8] != SIGNATURE:
            raise PngError("not a PNG")
        pos, idat = 8, []
        self.width = self.height = 0
        while pos + 8 <= len(data):
            length, kind = struct.unpack(">I4s", data[pos:pos + 8])
            body = data[pos + 8:pos + 8 + length]
            pos += 12 + length
            if kind == b"IHDR":
                self.width, self.height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
                if depth != 8 or ctype not in (2, 6) or interlace:
                    raise PngError("unsupported PNG (depth %d, colour type %d)" % (depth, ctype))
                self.bpp = 3 if ctype == 2 else 4
            elif kind == b"IDAT":
                idat.append(body)
            elif kind == b"IEND":
                break
        if not self.width:
            raise PngError("no IHDR")
        self.rows = min(rows, self.height)
        self.cols = min(cols, self.width)
        stride = self.width * self.bpp + 1
        try:
            raw = zlib.decompressobj().decompress(b"".join(idat), self.rows * stride)
        except zlib.error as e:
            raise PngError(str(e))
        self.rows = min(self.rows, len(raw) // stride)
        n, bpp = self.cols * self.bpp, self.bpp
        prev = bytearray(n)
        self.lines = []
        for y in range(self.rows):
            off = y * stride
            ft = raw[off]
            line = bytearray(raw[off + 1:off + 1 + n])
            if ft == 1:
                for i in range(bpp, n):
                    line[i] = (line[i] + line[i - bpp]) & 255
            elif ft == 2:
                for i in range(n):
                    line[i] = (line[i] + prev[i]) & 255
            elif ft == 3:
                for i in range(n):
                    left = line[i - bpp] if i >= bpp else 0
                    line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
            elif ft == 4:
                for i in range(n):
                    a = line[i - bpp] if i >= bpp else 0
                    b = prev[i]
                    c = prev[i - bpp] if i >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                    line[i] = (line[i] + pred) & 255
            self.lines.append(line)
            prev = line

    def px(self, x, y):
        if not (0 <= x < self.cols and 0 <= y < self.rows):
            return None
        i = x * self.bpp
        return tuple(self.lines[y][i:i + 3])
