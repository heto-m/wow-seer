import json
import os
import sys
import threading
import time

from . import __version__, frame, game, shared, views

SCAN_EVERY = 0.3
SYNC_EVERY = 0.5
SHARED_KEYS = ("sections", "pending", "acked", "addon", "meta", "cell", "got")
HEARTBEAT_EVERY = 30
FAILS_BEFORE_BIGGER_CELLS = 2


def log(*args):
    print("wow-seer:", *args, file=sys.stderr, flush=True)


class State:
    def __init__(self):
        self.lock = threading.Condition()
        self.sections = {}
        self.meta = {"frames": 0, "bad_frames": 0, "last_frame": None, "last_error": None}
        self.addon = {}
        self.pending = []
        self.acked = []
        # Forever's Lua integers are 32-bit; larger ids raise "integer overflow".
        self.next_id = (int(time.time()) % 10000000) * 100 + os.getpid() % 10
        self.assembler = frame.Assembler()
        self.seen = set()
        self.cell = 1
        self.listeners = []
        self.got = []
        self.role = None
        self.folder = None
        self.version = 0

    def request(self, kind, **fields):
        with self.lock:
            self.next_id += 10
            req = dict(fields, id=self.next_id, kind=kind)
            if self.role == "follower":
                shared.write_json(os.path.join(self.folder, "requests", "%d.json" % req["id"]), req)
            else:
                self.pending.append(req)
                self.version += 1
            self.lock.notify_all()
            return req["id"]

    def snapshot(self):
        with self.lock:
            return {k: getattr(self, k) for k in SHARED_KEYS}

    def load(self, data):
        with self.lock:
            for k in SHARED_KEYS:
                if k in data:
                    setattr(self, k, data[k])
            self.lock.notify_all()

    def apply(self, msg):
        now = time.time()
        with self.lock:
            sent = msg.get("t") or now
            for name, data in (msg.get("sections") or {}).items():
                old = self.sections.get(name)
                if old and old["game_time"] > sent:
                    continue
                self.sections[name] = {"data": data, "game_time": sent, "received": now}
            if msg.get("msg") is not None:
                self.got = (self.got + [msg["msg"]])[-20:]
            acks = set(msg.get("acks") or [])
            self.pending = [r for r in self.pending if r["id"] not in acks]
            self.acked = (self.acked + sorted(acks))[-200:]
            self.version += 1
            self.addon = {"slot": msg.get("slot"), "slots": msg.get("slots"), "build": msg.get("build"),
                          "last_message": now}
            self.lock.notify_all()
        for fn in self.listeners:
            fn(msg)

    def answered(self, req_id):
        return req_id in self.acked

    def wait(self, predicate, timeout):
        end = time.time() + timeout
        with self.lock:
            while not predicate():
                left = end - time.time()
                if left <= 0:
                    return False
                self.lock.wait(left)
            return True


def process_file(state, path):
    try:
        with open(path, "rb") as f:
            data = f.read()
        header, payload = frame.decode(data)
    except frame.NotSeer:
        return False
    except (frame.BadFrame, ValueError, OSError) as e:
        state.meta["bad_frames"] += 1
        state.meta["last_error"] = "%s: %s" % (os.path.basename(path), e)
        log("bad frame", state.meta["last_error"])
        if state.meta["bad_frames"] >= FAILS_BEFORE_BIGGER_CELLS and state.cell < 4:
            state.cell += 1
            state.meta["bad_frames"] = 0
            state.request("config", cell=state.cell)
        _remove(path)
        return True
    state.meta["frames"] += 1
    state.meta["last_frame"] = time.time()
    _remove(path)
    text = state.assembler.add(header, payload)
    if text is not None:
        try:
            state.apply(json.loads(text.decode("utf-8")))
        except ValueError as e:
            state.meta["last_error"] = "message %d: %s" % (header["msg"], e)
            log("bad message", state.meta["last_error"])
    state.version += 1
    return True


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def watch(state, stop):
    sizes = {}
    while not stop.is_set():
        try:
            folder = game.screenshots_dir()
            names = sorted(os.listdir(folder), key=lambda n: _mtime(os.path.join(folder, n)))
        except (OSError, game.GameError):
            names = []
        for name in names:
            if name in state.seen or not name.lower().endswith(".png"):
                continue
            path = os.path.join(folder, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if sizes.get(name) != size or size == 0:
                sizes[name] = size
                continue
            sizes.pop(name, None)
            state.seen.add(name)
            process_file(state, path)
        stop.wait(SCAN_EVERY)


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def heartbeat(state, stop):
    last_written, last_pending, slots = 0, None, 0
    while not stop.is_set():
        if not slots:
            try:
                slots = len(game.slot_dirs())
            except (OSError, game.GameError):
                slots = 0
        with state.lock:
            pending = list(state.pending)
            got = list(state.got)
        key = json.dumps([pending, got], sort_keys=True)
        if time.time() - last_written >= HEARTBEAT_EVERY or key != last_pending:
            try:
                # All slots, not just from the addon's last index: /reload starts it at slot 1 again.
                game.write_slots(1, slots, {"t": int(time.time()), "reqs": pending, "got": got})
                last_written, last_pending = time.time(), key
            except (OSError, game.GameError) as e:
                log("cannot write slots:", e)
        with state.lock:
            state.lock.wait(2)


SECTION_HELP = {
    "player": "level, class, race, money, xp, zone, base stats",
    "equipment": "equipped items with tooltip text",
    "bags": "bag contents",
    "bank": "bank contents (updated while the bank is open)",
    "quests": "quest log with objectives",
    "talents": "talents and unspent points",
    "skills": "profession levels",
    "trainer": "last trainer window",
    "profession": "last profession window",
    "merchant": "last vendor window",
    "auction": "last auction house browse/search results",
    "items": "tooltips fetched with get_item",
}

INSTRUCTIONS = ("Read-only access to the player's live WoW: Forever state, pushed by the Seer addon when it changes. "
                "age_seconds says how old the data is. Money and prices are in copper (10000 = 1 gold). "
                "quality: 0 poor, 1 common, 2 uncommon, 3 rare, 4 epic. Lists come as {cols, rows}. "
                "Text is in the game client's language. Prefer the narrowest tool and filters that answer the question.")

STR, INT, NUM, BOOL = {"type": "string"}, {"type": "integer"}, {"type": "number"}, {"type": "boolean"}
DETAIL = {"type": "string", "enum": ["summary", "full"]}
TIMEOUT = {"type": "number", "default": 30}
SLOT = {"type": "string", "enum": views.SLOTS}


def _schema(required=(), **props):
    schema = {"type": "object", "properties": props}
    if required:
        schema["required"] = list(required)
    return schema


def _gather(state, names):
    now = time.time()
    with state.lock:
        cached = {n: state.sections.get(n) for n in names}
    data, ages, missing, saved, saved_at, used_saved = {}, [], [], None, None, False
    for name in names:
        entry = cached[name]
        if entry is not None:
            data[name] = entry["data"]
            ages.append(max(0, int(now - entry["game_time"])))
            continue
        if saved is None:
            try:
                saved, saved_at = game.saved_state()
            except game.GameError:
                saved = {}
        if name in saved:
            data[name] = saved[name]
            used_saved = True
            if saved_at:
                ages.append(int(now - saved_at))
        else:
            data[name] = None
            missing.append(name)
    meta = {}
    if ages:
        meta["age_seconds"] = max(ages)
    if used_saved:
        meta["source"] = "saved at last logout or /reload"
    if names != ["bank"]:
        missing = [n for n in missing if n != "bank"]
    if missing:
        meta["not_seen_yet"] = {n: SECTION_HELP[n] for n in missing}
    return data, meta


def _bag_sections(args):
    where = args.get("where") or "bags"
    return ["bags", "bank"] if where == "both" else [where]


def _character(d, a):
    detail = a.get("detail") or "summary"
    return {"player": views.player(d["player"]), "equipment": views.equipment(d["equipment"], detail=detail),
            "talents": views.talents(d["talents"]), "skills": views.skills(d["skills"])}


TOOLS = [
    {"name": "get_character", "sections": ["player", "equipment", "talents", "skills"], "view": _character,
     "schema": _schema(detail=dict(DETAIL, description="summary (default): gear names only; full: gear tooltips")),
     "description": "Level, class, money, xp, zone, stats, equipped gear, talents taken, profession levels."},
    {"name": "get_equipment", "sections": ["equipment"],
     "view": lambda d, a: views.equipment(d["equipment"], a.get("slots"), a.get("detail") or "full"),
     "schema": _schema(slots={"type": "array", "items": SLOT, "description": "only these slots"},
                       detail=dict(DETAIL, description="full (default): tooltips; summary: names only")),
     "description": "Equipped items with tooltip stats; set bonuses listed once."},
    {"name": "get_talents", "sections": ["talents"],
     "view": lambda d, a: views.talents(d["talents"], bool(a.get("all"))),
     "schema": _schema(all=dict(BOOL, description="include talents with no points, in tree order")),
     "description": "Talents with points in them, unspent points, spec."},
    {"name": "get_bags", "sections": _bag_sections,
     "view": lambda d, a: views.bags(d, a.get("where") or "bags", a.get("name"), bool(a.get("equippable_only")),
                                     a.get("detail") or "summary"),
     "schema": _schema(where={"type": "string", "enum": ["bags", "bank", "both"]},
                       name=dict(STR, description="part of the item name"), equippable_only=BOOL,
                       detail=dict(DETAIL, description="full adds tooltips of equippable items")),
     "description": "Bag (or bank) contents, stacks merged, free space."},
    {"name": "find_item", "sections": ["equipment", "bags", "bank"],
     "view": lambda d, a: views.find_item(d, a["query"]),
     "schema": _schema(["query"], query=dict(STR, description="item ID or part of its name")),
     "description": "Where an item is: equipped slot, bag and slot, or bank."},
    {"name": "get_quests", "sections": ["quests"],
     "view": lambda d, a: views.quests(d["quests"], a.get("zone"), bool(a.get("unfinished_only"))),
     "schema": _schema(zone=dict(STR, description="part of the zone or quest title"), unfinished_only=BOOL),
     "description": "Quest log grouped by zone, with objective progress."},
    {"name": "search_auction", "sections": ["auction"],
     "view": lambda d, a: views.auction(d["auction"], a.get("name"), a.get("type"), a.get("slot"),
                                        a.get("min_level"), a.get("max_level"), a.get("max_price"),
                                        a.get("min_quality"), int(a.get("limit") or 25)),
     "schema": _schema(name=dict(STR, description="part of the item name"),
                       type=dict(STR, description="part of the item subtype, e.g. Varitas"),
                       slot=SLOT, min_level=dict(INT, description="required level"), max_level=INT,
                       max_price=dict(INT, description="copper"), min_quality=INT,
                       limit={"type": "integer", "default": 25}),
     "description": "Filter the auction house results the player last saw (browse list and the last item search)."},
    {"name": "get_trainer", "sections": ["trainer"],
     "view": lambda d, a: views.trainer(d["trainer"], bool(a.get("available_only")), a.get("name")),
     "schema": _schema(available_only=BOOL, name=STR),
     "description": "The last trainer window the player opened: services, cost, required level."},
    {"name": "get_profession", "sections": ["profession"],
     "view": lambda d, a: views.profession(d["profession"], a.get("name"), bool(a.get("craftable_only"))),
     "schema": _schema(name=dict(STR, description="part of the recipe name"), craftable_only=BOOL),
     "description": "The last profession window the player opened: known recipes and reagents."},
    {"name": "get_merchant", "sections": ["merchant"],
     "view": lambda d, a: views.merchant(d["merchant"], a.get("name"), bool(a.get("usable_only"))),
     "schema": _schema(name=STR, usable_only=BOOL),
     "description": "The last vendor window the player opened: items and prices."},
]
TOOL_BY_NAME = {t["name"]: t for t in TOOLS}

EXTRA_TOOLS = [
    {"name": "compare_item",
     "description": "An item's tooltip next to what is equipped in its slot, with the difference in simple stats.",
     "inputSchema": _schema(["item_id"], item_id=INT, timeout_seconds=TIMEOUT)},
    {"name": "get_item",
     "description": "The in-game tooltip of any item by ID (the game client must know the item).",
     "inputSchema": _schema(["item_id"], item_id=INT, timeout_seconds=TIMEOUT)},
    {"name": "refresh",
     "description": "Ask the game to resend sections now (up to ~15 s; data is already pushed on change). "
                    "Read them afterwards with the matching tool.",
     "inputSchema": _schema(sections={"type": "array", "items": {"type": "string", "enum": list(SECTION_HELP)}},
                            timeout_seconds=TIMEOUT)},
    {"name": "seer_status",
     "description": "Connection status: when the game last sent data, request slots left, decode errors.",
     "inputSchema": _schema()},
]


def tool_list():
    return [{"name": t["name"], "description": t["description"], "inputSchema": t["schema"]} for t in TOOLS] + EXTRA_TOOLS


def _fetch_item(state, item_id, timeout):
    req = state.request("item", item=item_id)
    return state.wait(lambda: state.answered(req), timeout)


def call_tool(state, name, args):
    tool = TOOL_BY_NAME.get(name)
    if tool:
        sections = tool["sections"](args) if callable(tool["sections"]) else tool["sections"]
        data, meta = _gather(state, sections)
        out = tool["view"](data, args) or {}
        out.update(meta)
        return out
    timeout = float(args.get("timeout_seconds", 30))
    if name in ("get_item", "compare_item"):
        item_id = int(args["item_id"])
        names = ["items", "bags", "bank"] + (["equipment"] if name == "compare_item" else [])
        data, meta = _gather(state, names)
        item = views.candidate(data, item_id)
        if item is None:
            if not _fetch_item(state, item_id, timeout):
                return {"error": "timed out waiting for the game"}
            data, meta = _gather(state, names)
            item = views.candidate(data, item_id)
            if item is None:
                return {"error": "the game does not know item %d yet; try again in a few seconds" % item_id}
        if name == "get_item":
            out = views.item_view(item, keys=("id", "name", "quality"))
            if views.LOC_SLOTS.get(item.get("loc")):
                out["slots"] = views.LOC_SLOTS[item["loc"]]
            return out
        out = views.compare(item, data["equipment"])
        out.update(meta)
        return out
    if name == "refresh":
        names = [s for s in (args.get("sections") or ["player", "equipment", "bags", "quests"]) if s in SECTION_HELP]
        req = state.request("refresh", sections=names)
        ok = state.wait(lambda: state.answered(req), timeout)
        now = time.time()
        with state.lock:
            ages = {n: int(now - state.sections[n]["game_time"]) if n in state.sections else None for n in names}
        out = {"age_seconds": ages}
        if not ok:
            out["warning"] = "timed out; is the game running with Seer enabled and out of combat?"
        return out
    if name == "seer_status":
        now = time.time()
        with state.lock:
            addon = dict(state.addon)
            pending = len(state.pending)
        last = addon.get("last_message")
        status = {
            "wow_dir": _safe(game.wow_dir), "frames_decoded": state.meta["frames"],
            "last_frame_seconds_ago": int(now - state.meta["last_frame"]) if state.meta["last_frame"] else None,
            "last_message_seconds_ago": int(now - last) if last else None,
            "pending_requests": pending, "last_error": state.meta["last_error"], "cell_px": state.cell,
            "client_build": addon.get("build"), "role": state.role,
        }
        if addon.get("slots"):
            status["request_slots_left"] = max(0, addon["slots"] - addon["slot"] + 1)
        return status
    raise KeyError(name)


def _safe(fn):
    try:
        return fn()
    except game.GameError as e:
        return str(e)


class Server:
    def __init__(self, state):
        self.state = state
        self.out_lock = threading.Lock()

    def send(self, obj):
        line = json.dumps(obj, ensure_ascii=False)
        with self.out_lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def handle(self, msg):
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:
            return
        try:
            if method == "initialize":
                params = msg.get("params") or {}
                result = {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                          "capabilities": {"tools": {}},
                          "serverInfo": {"name": "wow-seer", "version": __version__},
                          "instructions": INSTRUCTIONS}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": tool_list()}
            elif method == "tools/call":
                params = msg.get("params") or {}
                try:
                    data = call_tool(self.state, params.get("name"), params.get("arguments") or {})
                    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
                    result = {"content": [{"type": "text", "text": text}]}
                except KeyError:
                    result = {"content": [{"type": "text", "text": "unknown tool"}], "isError": True}
                except Exception as e:
                    result = {"content": [{"type": "text", "text": "error: %s" % e}], "isError": True}
            else:
                self.send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}})
                return
            self.send({"jsonrpc": "2.0", "id": mid, "result": result})
        except Exception as e:
            self.send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}})

    def run(self):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                self.send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
                continue
            threading.Thread(target=self.handle, args=(msg,), daemon=True).start()


def _lead(state, folder):
    changed = False
    req_dir = os.path.join(folder, "requests")
    for name in sorted(os.listdir(req_dir)):
        path = os.path.join(req_dir, name)
        req = shared.read_json(path) if name.endswith(".json") else None
        _remove(path)
        if isinstance(req, dict) and isinstance(req.get("id"), int):
            with state.lock:
                if all(r["id"] != req["id"] for r in state.pending):
                    state.pending.append(req)
                    changed = True
    return changed


def coordinate(state, stop):
    folder = shared.shared_dir()
    state.folder = folder
    state_file = os.path.join(folder, "state.json")
    lock = shared.LeaderLock(folder)
    published, seen_mtime = -1, None
    while not stop.is_set():
        if state.role != "leader" and lock.acquire():
            previous = shared.read_json(state_file)
            if previous:
                state.load(previous)
            state.role = "leader"
            log("leading: reading screenshots")
            for target in (watch, heartbeat):
                threading.Thread(target=target, args=(state, stop), daemon=True).start()
        elif state.role is None:
            state.role = "follower"
            log("following the wow-seer server that is already running")
        if state.role == "leader":
            if _lead(state, folder):
                state.version += 1
                with state.lock:
                    state.lock.notify_all()
            if state.version != published:
                published = state.version
                shared.write_json(state_file, state.snapshot())
        else:
            mtime = _mtime(state_file)
            if mtime != seen_mtime:
                seen_mtime = mtime
                data = shared.read_json(state_file)
                if data:
                    state.load(data)
        stop.wait(SYNC_EVERY)


def start_background(state):
    stop = threading.Event()
    threading.Thread(target=coordinate, args=(state, stop), daemon=True).start()
    return stop


def serve():
    state = State()
    try:
        game.wow_dir()
    except game.GameError as e:
        log(e)
    stop = start_background(state)
    try:
        Server(state).run()
    finally:
        stop.set()
