import glob
import json
import os
import platform
import re
import shutil
import subprocess

ADDON_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "addon", "Seer")
SLOT_FORMAT = "Seer_S%04d"
SLOT_RE = re.compile(r"^Seer_S\d{4}$")
DEFAULT_SLOTS = 1000
SECTIONS = ("player", "equipment", "bags", "bank", "quests", "talents", "skills",
            "trainer", "profession", "merchant", "auction", "items")
DEFAULT_DIRS = {
    "Linux": [
        "~/Faugus/battle-net/drive_c/Program Files (x86)/World of Warcraft/_forever_",
        "~/Games/battlenet/drive_c/Program Files (x86)/World of Warcraft/_forever_",
        "~/.wine/drive_c/Program Files (x86)/World of Warcraft/_forever_",
    ],
    "Darwin": ["/Applications/World of Warcraft/_forever_"],
    "Windows": [r"C:\Program Files (x86)\World of Warcraft\_forever_"],
}


class GameError(Exception):
    pass


def wow_dir():
    env = os.environ.get("WOW_DIR")
    candidates = [env] if env else DEFAULT_DIRS.get(platform.system(), [])
    for path in candidates:
        path = os.path.expanduser(path)
        if os.path.isdir(os.path.join(path, "Interface")):
            return path
    raise GameError("WoW: Forever folder not found. Set WOW_DIR to the _forever_ folder.")


def addons_dir():
    return os.path.join(wow_dir(), "Interface", "AddOns")


def screenshots_dir():
    return os.path.join(wow_dir(), "Screenshots")


def game_running():
    if platform.system() == "Windows":
        return False
    pattern = "^World of Warcraft$" if platform.system() == "Darwin" else "^wow.exe$"
    try:
        return subprocess.run(["pgrep", "-i", pattern], capture_output=True).returncode == 0
    except OSError:
        return False


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def slot_dirs():
    root = addons_dir()
    return sorted(d for d in os.listdir(root) if SLOT_RE.match(d) and os.path.isdir(os.path.join(root, d)))


def install(slots=DEFAULT_SLOTS):
    root = addons_dir()
    dest = os.path.join(root, "Seer")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(ADDON_SRC, dest)
    for name in slot_dirs():
        if int(name[6:]) > slots:
            shutil.rmtree(os.path.join(root, name))
    for n in range(1, slots + 1):
        folder = os.path.join(root, SLOT_FORMAT % n)
        os.makedirs(folder, exist_ok=True)
        toc = ("## Interface: 16001\n## Title: Seer slot %04d\n## Notes: Request slot for Seer.\n"
               "## Group: Seer\n## LoadOnDemand: 1\n\nbody.lua\n") % n
        write_atomic(os.path.join(folder, (SLOT_FORMAT % n) + ".toc"), toc)
        body = os.path.join(folder, "body.lua")
        if not os.path.exists(body):
            write_atomic(body, "SeerInbox = nil\n")
    return root


def remove():
    root = addons_dir()
    for name in ["Seer"] + slot_dirs():
        shutil.rmtree(os.path.join(root, name))
    return root


def lua_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return '"' + "".join(chr(b) if (b < 128 and chr(b).isalnum()) or chr(b) in " _-.:" else "\\%03d" % b
                             for b in v.encode("utf-8")) + '"'
    if isinstance(v, (list, tuple)):
        return "{" + ",".join(lua_value(x) for x in v) + "}"
    if isinstance(v, dict):
        return "{" + ",".join("[%s]=%s" % (lua_value(k), lua_value(x)) for k, x in v.items()) + "}"
    return "nil"


def write_slots(first, last, inbox):
    root = addons_dir()
    body = "SeerInbox = %s\n" % lua_value(inbox)
    for n in range(max(1, first), last + 1):
        folder = os.path.join(root, SLOT_FORMAT % n)
        if os.path.isdir(folder):
            write_atomic(os.path.join(folder, "body.lua"), body)


_LUA_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "a": "\a", "b": "\b", "f": "\f", "v": "\v",
                "\\": "\\", '"': '"', "'": "'", "\n": "\n"}


def _lua_unescape(s):
    out, i = bytearray(), 0
    raw = s.encode("utf-8", "surrogateescape")
    while i < len(raw):
        c = raw[i:i + 1]
        if c != b"\\":
            out += c
            i += 1
            continue
        nxt = raw[i + 1:i + 2].decode("latin-1")
        if nxt.isdigit():
            j = i + 1
            while j < len(raw) and j < i + 4 and chr(raw[j]).isdigit():
                j += 1
            out.append(int(raw[i + 1:j]) & 255)
            i = j
        else:
            out += _LUA_ESCAPES.get(nxt, nxt).encode("latin-1")
            i += 2
    return out.decode("utf-8", "replace")


def saved_state():
    files = glob.glob(os.path.join(wow_dir(), "WTF", "Account", "*", "SavedVariables", "Seer.lua"))
    if not files:
        return {}, None
    path = max(files, key=os.path.getmtime)
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        text = f.read()
    sections = {}
    for key, value in re.findall(r'\["(\w+)"\]\s*=\s*"((?:[^"\\]|\\.)*)"', text, re.S):
        if key in SECTIONS:
            try:
                sections[key] = json.loads(_lua_unescape(value))
            except ValueError:
                pass
    at = re.search(r'\["savedAt"\]\s*=\s*(\d+)', text)
    return sections, (int(at.group(1)) if at else os.path.getmtime(path))
