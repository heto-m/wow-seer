from .png import Png

HEADER_X, HEADER_CELLS, HEADER_BYTES = 68, 54, 20
TAIL_X = HEADER_X + 4 * HEADER_CELLS
MAGIC = (83, 82)


class NotSeer(Exception):
    pass


class BadFrame(Exception):
    pass


def _white(p):
    return p is not None and min(p) > 127


def _fit(units, pixels):
    n = len(units)
    mu, mp = sum(units) / n, sum(pixels) / n
    scale = sum((u - mu) * (p - mp) for u, p in zip(units, pixels)) / sum((u - mu) ** 2 for u in units)
    return scale, mp - scale * mu


def _edges(img, along_x, fixed, count):
    found, state, i = [], True, 1
    limit = img.cols if along_x else img.rows
    while i < limit and len(found) < count:
        s = _white(img.px(i, fixed) if along_x else img.px(fixed, i))
        if s != state:
            found.append(i)
            state = s
        i += 1
    return found


def _nearest_edge(img, guess, y, window=3):
    for d in sorted(range(-window, window + 1), key=abs):
        i = guess + d
        if i >= 1 and _white(img.px(i, y)) != _white(img.px(i - 1, y)):
            return i
    return None


def adler32(data):
    a, b = 1, 0
    for byte in data:
        a = (a + byte) % 65521
        b = (b + a) % 65521
    return (b << 16) | a


def decode(data):
    img = Png(data, 8, 1200)
    if not _white(img.px(0, 1)):
        raise NotSeer()
    ex = _edges(img, True, 1, 16)
    if len(ex) < 16:
        raise NotSeer()
    ux = [4 * (j + 1) for j in range(16)]
    sx, x0 = _fit(ux, ex)
    if not 0.3 < sx < 4 or max(abs(x0 + sx * u - e) for u, e in zip(ux, ex)) > 1.5:
        raise NotSeer()
    bits = []
    for k in range(HEADER_CELLS):
        p = img.px(int(x0 + (HEADER_X + 2 + 4 * k) * sx), int(2 * sx))
        if p is None:
            raise BadFrame("header out of view")
        bits.extend(1 if v > 127 else 0 for v in p)
    h = [int("".join(map(str, bits[i * 8:i * 8 + 8])), 2) for i in range(HEADER_BYTES)]
    if tuple(h[:2]) != MAGIC:
        raise NotSeer()
    if sum(h[:-1]) % 256 != h[-1]:
        raise BadFrame("header checksum")
    header = {
        "version": h[2], "bits": h[3], "cell": h[4], "msg": h[5] * 256 + h[6], "part": h[7], "parts": h[8],
        "length": h[9] * 256 + h[10], "cols": h[11] * 256 + h[12], "rows": h[13],
        "adler": (h[14] << 24) | (h[15] << 16) | (h[16] << 8) | h[17],
    }
    if header["version"] != 1 or header["bits"] != 2:
        raise BadFrame("unsupported frame version %d bits %d" % (header["version"], header["bits"]))
    cell, cols, rows = header["cell"], header["cols"], header["rows"]
    height = 8 + rows * cell
    width = max(4 + cols * cell, TAIL_X + 32)
    img = Png(data, int((height + 8) * sx * 1.5) + 8, int((width + 8) * sx) + 8)
    for m in range(1, (width - TAIL_X) // 4):
        u = TAIL_X + 4 * m
        e = _nearest_edge(img, int(round(x0 + u * sx)), 1)
        if e is not None:
            ux.append(u)
            ex.append(e)
            sx, x0 = _fit(ux, ex)
    nv = -(-height // 4)
    ey = _edges(img, False, int(x0 + 2 * sx), nv - 1)
    if len(ey) < nv - 1:
        raise BadFrame("sync column cut")
    sy, y0 = _fit([4 * (j + 1) for j in range(nv - 1)], ey)
    length = header["length"]
    groups = -(-length // 3)
    out = bytearray()
    for g in range(groups):
        v = 0
        for c in range(4):
            n = 4 * g + c
            x = int(x0 + (4 + (n % cols + 0.5) * cell) * sx)
            y = int(y0 + (8 + (n // cols + 0.5) * cell) * sy)
            p = img.px(x, y)
            if p is None:
                raise BadFrame("payload out of view")
            for ch in p:
                v = (v << 2) | min(3, int(round(ch * 3 / 255.0)))
        out += bytes(((v >> 16) & 255, (v >> 8) & 255, v & 255))
    payload = bytes(out[:length])
    if adler32(payload) != header["adler"]:
        raise BadFrame("payload checksum")
    header["scale"] = (sx, sy)
    return header, payload


class Assembler:
    def __init__(self, keep=8):
        self.parts = {}
        self.keep = keep

    def add(self, header, payload):
        key = (header["msg"], header["parts"])
        got = self.parts.setdefault(key, {})
        got[header["part"]] = payload
        if len(got) == header["parts"]:
            del self.parts[key]
            return b"".join(got[i] for i in range(1, header["parts"] + 1))
        while len(self.parts) > self.keep:
            self.parts.pop(next(iter(self.parts)))
        return None
