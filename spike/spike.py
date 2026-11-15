#!/usr/bin/env python3
import argparse
import glob
import io
import os
import platform
import shutil
import struct
import subprocess
import sys
import time
import wave
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON_SRC = os.path.join(HERE, "addon", "SeerSpike")
SLOTS = 20
PROBES = 5
LCG_M = 2147483647
DEFAULT_DIRS = {
    "Linux": "~/Faugus/battle-net/drive_c/Program Files (x86)/World of Warcraft/_forever_",
    "Darwin": "/Applications/World of Warcraft/_forever_",
}
FONT_CANDIDATES = [
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Geneva.ttf",
]


def wow_dir():
    path = os.environ.get("WOW_DIR") or DEFAULT_DIRS.get(platform.system())
    if not path:
        sys.exit("Set WOW_DIR to the _forever_ folder.")
    path = os.path.expanduser(path)
    if not os.path.isdir(os.path.join(path, "Interface")):
        sys.exit("No Interface folder in %s. Set WOW_DIR to the _forever_ folder." % path)
    return path


def addons_dir():
    return os.path.join(wow_dir(), "Interface", "AddOns")


def slot_name(n):
    return "SeerSpike_S%02d" % n


def game_running():
    pattern = "^World of Warcraft$" if platform.system() == "Darwin" else "^wow.exe$"
    try:
        return subprocess.run(["pgrep", "-i", pattern], capture_output=True).returncode == 0
    except OSError:
        return False


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def lua_string(data):
    out = ['"']
    for b in data:
        if b in (34, 92):
            out.append("\\" + chr(b))
        elif 32 <= b < 127:
            out.append(chr(b))
        else:
            out.append("\\%03d" % b)
    out.append('"')
    return "".join(out)


def write_slot(n, text):
    folder = os.path.join(addons_dir(), slot_name(n))
    if not os.path.isdir(folder):
        sys.exit("%s is missing. Run install with the game closed." % folder)
    body = "SeerSpikeInbox = SeerSpikeInbox or {}\nSeerSpikeInbox[%s] = %s\n" % (
        lua_string(slot_name(n).encode()), lua_string(text.encode("utf-8")))
    write_atomic(os.path.join(folder, "body.lua"), body.encode())


def probe_dir():
    return os.path.join(addons_dir(), "SeerSpike", "probe")


def font_bytes():
    fonts = glob.glob(os.path.join(wow_dir(), "Fonts", "*.[tT][tT][fF]"))
    for path in fonts + FONT_CANDIDATES:
        if os.path.isfile(path):
            with open(path, "rb") as f:
                return f.read()
    sys.exit("No TTF font found; edit FONT_CANDIDATES.")


def tga_bytes(size=8):
    header = struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, size, size, 32, 0x28)
    return header + bytes([40, 200, 120, 255]) * (size * size)


def wav_bytes():
    buf = io.BytesIO()
    w = wave.open(buf, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(22050)
    w.writeframes(b"\0\0" * 1100)
    w.close()
    return buf.getvalue()


def probe_files(i):
    return {kind: os.path.join(probe_dir(), "%s%02d%s" % (kind, i, ext))
            for kind, ext in (("font", ".ttf"), ("tex", ".tga"), ("snd", ".wav"))}


def parse_indices(spec):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return out


def cmd_install(_args):
    if game_running():
        print("The game is running. New folders only show up after a full client restart.")
    root = addons_dir()
    dest = os.path.join(root, "SeerSpike")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(ADDON_SRC, dest)
    os.makedirs(probe_dir())
    for i in range(1, PROBES + 1):
        for path in probe_files(i).values():
            open(path, "wb").close()
    for n in range(1, SLOTS + 1):
        folder = os.path.join(root, slot_name(n))
        os.makedirs(folder, exist_ok=True)
        toc = "## Interface: 16001\n## Title: Seer Spike slot %02d\n## LoadOnDemand: 1\n\nbody.lua\n" % n
        write_atomic(os.path.join(folder, slot_name(n) + ".toc"), toc.encode())
        write_slot(n, "initial body of slot %02d" % n)
    print("Installed SeerSpike, %d slots and %d empty probe sets in %s" % (SLOTS, PROBES, root))


def cmd_remove(_args):
    root = addons_dir()
    names = ["SeerSpike"] + [slot_name(n) for n in range(1, SLOTS + 1)]
    for name in names:
        path = os.path.join(root, name)
        if os.path.isdir(path):
            shutil.rmtree(path)
    print("Removed SeerSpike and its slots from %s" % root)


def cmd_slot(args):
    if args.kb:
        unit = "Seer slot payload 0123456789 abcdefghijklmnopqrstuvwxyz. "
        text = (unit * (args.kb * 1024 // len(unit) + 1))[: args.kb * 1024]
    else:
        text = " ".join(args.text) or time.strftime("written %H:%M:%S")
    write_slot(args.n, text)
    print("Slot %02d now holds %d chars. In game: /seerspike slot %d" % (args.n, len(text), args.n))


def cmd_probe(args):
    makers = {"font": font_bytes, "tex": tga_bytes, "snd": wav_bytes}
    for i in parse_indices(args.indices):
        for kind, path in probe_files(i).items():
            data = makers[kind]() if args.state == "valid" else b""
            write_atomic(path, data)
        print("probe %d: %s" % (i, args.state))


class Png:
    # Decoding only the left columns is safe: Sub/Average/Paeth never read pixels to the right.

    def __init__(self, path, rows, cols):
        with open(path, "rb") as f:
            data = f.read()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a PNG (type /seerspike png in game)")
        pos, idat = 8, []
        while pos < len(data):
            length, kind = struct.unpack(">I4s", data[pos:pos + 8])
            body = data[pos + 8:pos + 8 + length]
            pos += 12 + length
            if kind == b"IHDR":
                self.width, self.height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
                if depth != 8 or ctype not in (2, 6) or interlace:
                    raise ValueError("unsupported PNG (depth %d, type %d)" % (depth, ctype))
                self.bpp = 3 if ctype == 2 else 4
            elif kind == b"IDAT":
                idat.append(body)
            elif kind == b"IEND":
                break
        self.rows = min(rows, self.height)
        self.cols = min(cols, self.width)
        stride = self.width * self.bpp + 1
        raw = zlib.decompressobj().decompress(b"".join(idat), self.rows * stride)
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


def is_white(p):
    return p is not None and min(p) > 127


def fit(units, pixels):
    n = len(units)
    mu, mp = sum(units) / n, sum(pixels) / n
    scale = sum((u - mu) * (p - mp) for u, p in zip(units, pixels)) / sum((u - mu) ** 2 for u in units)
    offset = mp - scale * mu
    resid = max(abs(offset + scale * u - p) for u, p in zip(units, pixels))
    return scale, offset, resid


def edges(img, along_x, fixed, count):
    found, state, i = [], True, 1
    limit = img.cols if along_x else img.rows
    while i < limit and len(found) < count:
        s = is_white(img.px(i, fixed) if along_x else img.px(fixed, i))
        if s != state:
            found.append(i)
            state = s
        i += 1
    return found


def nearest_edge(img, along_x, guess, fixed, window=3):
    def white(i):
        return is_white(img.px(i, fixed) if along_x else img.px(fixed, i))
    for d in sorted(range(-window, window + 1), key=abs):
        i = guess + d
        if i >= 1 and white(i) != white(i - 1):
            return i
    return None


def lcg_levels(seq, count, levels):
    state = (seq * 7919 + 17) % LCG_M
    out = []
    for _ in range(count):
        state = (state * 16807) % LCG_M
        out.append(state % levels)
    return out


def decode(path):
    img = Png(path, 40, 700)
    if not is_white(img.px(0, 1)):
        return {"file": path, "found": False, "why": "no strip (top-left not white)"}
    ex = edges(img, True, 1, 16)
    if len(ex) < 16:
        return {"file": path, "found": False, "why": "no strip (sync row)"}
    sx, x0, rx = fit([4 * (j + 1) for j in range(16)], ex)
    if rx > 1.5 or not 0.3 < sx < 4:
        return {"file": path, "found": False, "why": "sync row irregular (scale %.3f, residual %.2f)" % (sx, rx)}
    hy = int(2 * sx)
    bits = []
    for k in range(32):
        p = img.px(int(x0 + (70 + 4 * k) * sx), hy)
        if p is None:
            return {"file": path, "found": False, "why": "header out of view"}
        bits.extend(1 if v > 127 else 0 for v in p)
    hb = [int("".join(map(str, bits[i * 8:i * 8 + 8])), 2) for i in range(12)]
    if hb[:2] != [83, 69] or sum(hb[:11]) % 256 != hb[11]:
        return {"file": path, "found": False, "why": "header checksum failed %s" % hb}
    nbits, cell, hide = hb[3], hb[4], hb[5]
    seq, cols, rows = hb[6] * 256 + hb[7], hb[8] * 256 + hb[9], hb[10]
    height = 8 + rows * cell
    nv = -(-height // 4)
    width = max(4 + cols * cell, 196)
    img = Png(path, int((height + 8) * sx * 1.5) + 8, int((width + 8) * sx) + 8)
    ux = [4 * (j + 1) for j in range(16)]
    for m in range(1, (width - 196) // 4):
        u = 196 + 4 * m
        e = nearest_edge(img, True, int(round(x0 + u * sx)), 1)
        if e is not None:
            ux.append(u)
            ex.append(e)
            sx, x0, rx = fit(ux, ex)
    ey = edges(img, False, int(x0 + 2 * sx), nv - 1)
    if len(ey) < nv - 1:
        return {"file": path, "found": False, "why": "sync column cut (%d of %d edges)" % (len(ey), nv - 1)}
    sy, y0, ry = fit([4 * (j + 1) for j in range(nv - 1)], ey)
    levels = 2 ** nbits
    expected = lcg_levels(seq, cols * rows * 3, levels)
    cell_err = chan_err = max_dev = 0
    i = 0
    for r in range(rows):
        y = int(y0 + (8 + (r + 0.5) * cell) * sy)
        for c in range(cols):
            p = img.px(int(x0 + (4 + (c + 0.5) * cell) * sx), y)
            wrong = False
            for ch in range(3):
                exp = expected[i]
                i += 1
                if p is None:
                    wrong = True
                    chan_err += 1
                    continue
                level = int(round(p[ch] * (levels - 1) / 255.0))
                max_dev = max(max_dev, abs(p[ch] - exp * 255.0 / (levels - 1)))
                if level != exp:
                    wrong = True
                    chan_err += 1
            cell_err += wrong
    per_row = int(img.width / (cell * sx))
    per_100 = per_row * int(100 / (cell * sy)) * 3 * nbits // 8
    return {
        "file": path, "found": True, "seq": seq, "bits": nbits, "cell": cell,
        "hide": "event" if hide == 255 else str(hide), "cells": cols * rows, "cell_err": cell_err,
        "chan_err": chan_err, "max_dev": max_dev, "sx": sx, "sy": sy, "resid": max(rx, ry),
        "bytes": cols * rows * 3 * nbits // 8, "per_100": per_100, "size": "%dx%d" % (img.width, img.height),
    }


def report(res):
    name = os.path.basename(res["file"])
    if not res["found"]:
        return "%s  %s" % (name, res["why"])
    verdict = "OK " if res["cell_err"] == 0 else "BAD"
    return ("%s  %s #%d bits %d cell %d hide %-5s %d/%d cells wrong, %d channels, max dev %.1f, "
            "pitch %.3f x %.3f (resid %.2f), %d B/frame, %d B per 100 px full width, image %s") % (
        name, verdict, res["seq"], res["bits"], res["cell"], res["hide"], res["cell_err"], res["cells"],
        res["chan_err"], res["max_dev"], res["sx"], res["sy"], res["resid"], res["bytes"], res["per_100"],
        res["size"])


def screenshots():
    files = glob.glob(os.path.join(wow_dir(), "Screenshots", "*"))
    return sorted((f for f in files if os.path.isfile(f)), key=os.path.getmtime)


def decode_safe(path):
    try:
        return report(decode(path))
    except (ValueError, OSError, zlib.error, struct.error) as e:
        return "%s  error: %s" % (os.path.basename(path), e)


def cmd_decode(args):
    files = args.files or screenshots()
    if not args.files:
        files = files[-args.last:] if args.last else files[-1:]
    if not files:
        sys.exit("No screenshots found.")
    for path in files:
        print(decode_safe(path))


def cmd_watch(args):
    seen = set(screenshots())
    print("Watching %s (Ctrl+C to stop)" % os.path.join(wow_dir(), "Screenshots"))
    while True:
        time.sleep(0.5)
        for path in screenshots():
            if path in seen:
                continue
            size = os.path.getsize(path)
            time.sleep(0.3)
            if os.path.getsize(path) != size:
                continue
            seen.add(path)
            print(decode_safe(path))
            if args.delete:
                os.remove(path)


def cmd_results(_args):
    found = glob.glob(os.path.join(wow_dir(), "WTF", "Account", "*", "SavedVariables", "SeerSpike.lua"))
    if not found:
        sys.exit("No SeerSpike.lua yet. Type /reload in game first.")
    for path in found:
        print("-- %s" % path)
        with open(path, encoding="utf-8", errors="replace") as f:
            print(f.read())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("install", help="copy the addon, create slots and empty probes (game closed)")
    sub.add_parser("remove", help="delete the addon and its slots")
    p = sub.add_parser("slot", help="write text into slot N")
    p.add_argument("n", type=int, choices=range(1, SLOTS + 1), metavar="N")
    p.add_argument("text", nargs="*")
    p.add_argument("--kb", type=int, help="write N KiB of filler instead of text")
    p = sub.add_parser("probe", help="make probe files valid or empty, e.g. probe 1-4 valid")
    p.add_argument("indices")
    p.add_argument("state", choices=["valid", "empty"])
    p = sub.add_parser("decode", help="decode screenshots (default: the newest)")
    p.add_argument("files", nargs="*")
    p.add_argument("--last", type=int, help="decode the newest N screenshots")
    p = sub.add_parser("watch", help="decode new screenshots as they appear")
    p.add_argument("--delete", action="store_true")
    sub.add_parser("results", help="print the saved results (after /reload)")
    args = ap.parse_args()
    globals()["cmd_" + args.cmd](args)


if __name__ == "__main__":
    main()
