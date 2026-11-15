import json
import os
import platform


def shared_dir():
    path = os.environ.get("WOW_SEER_DIR")
    if not path:
        system = platform.system()
        if system == "Darwin":
            path = os.path.expanduser("~/Library/Caches/wow-seer")
        elif system == "Windows":
            path = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "wow-seer")
        else:
            path = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "wow-seer")
    os.makedirs(os.path.join(path, "requests"), exist_ok=True)
    return path


class LeaderLock:
    def __init__(self, folder):
        self.path = os.path.join(folder, "leader.lock")
        self.handle = None

    def acquire(self):
        if self.handle:
            return True
        handle = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True


def write_json(path, data):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
