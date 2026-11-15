import argparse
import json
import os
import sys

from . import __version__, frame, game


def cmd_install(args):
    if game.game_running():
        print("WoW is running. Close it first: new addons only load after a full restart.")
        return 1
    root = game.install(args.slots)
    print("Installed Seer and %d request slots in %s" % (args.slots, root))
    print("Next: start the game, then add the MCP server to your AI client, for example:")
    print("  claude mcp add wow-seer -- %s -m wow_seer serve" % sys.executable)
    return 0


def cmd_remove(_args):
    if game.game_running():
        print("WoW is running. Close it first.")
        return 1
    print("Removed Seer and its slots from %s" % game.remove())
    return 0


def cmd_serve(_args):
    from .server import serve
    serve()
    return 0


def cmd_watch(args):
    import time
    from .server import State, start_background

    def show(msg):
        sizes = ", ".join("%s %d B" % (k, len(json.dumps(v, ensure_ascii=False)))
                          for k, v in (msg.get("sections") or {}).items())
        print("%s message %s: %s%s" % (time.strftime("%H:%M:%S"), msg.get("msg"), sizes or "no sections",
                                        " acks %s" % msg["acks"] if msg.get("acks") else ""), flush=True)
        if args.dump:
            with open(args.dump, "w", encoding="utf-8") as f:
                json.dump(state.sections, f, ensure_ascii=False, indent=1)

    state = State()
    state.listeners.append(show)
    start_background(state)
    print("Watching; Seer sends once it sees this server (within about 60 s). Ctrl+C to stop.", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        return 0


def cmd_decode(args):
    for path in args.files:
        with open(path, "rb") as f:
            data = f.read()
        try:
            header, payload = frame.decode(data)
        except frame.NotSeer:
            print("%s: no Seer strip" % path)
            continue
        except frame.BadFrame as e:
            print("%s: bad frame: %s" % (path, e))
            continue
        print("%s: message %d part %d/%d, %d bytes, cell %d, scale %.3f x %.3f" % (
            path, header["msg"], header["part"], header["parts"], len(payload), header["cell"],
            header["scale"][0], header["scale"][1]))
        if header["parts"] == 1:
            print(json.dumps(json.loads(payload.decode("utf-8")), ensure_ascii=False, indent=1)[:args.chars])
    return 0


def cmd_status(_args):
    print("wow-seer %s" % __version__)
    try:
        print("game folder: %s" % game.wow_dir())
        print("addon installed: %s" % os.path.isdir(os.path.join(game.addons_dir(), "Seer")))
        print("request slots: %d" % len(game.slot_dirs()))
        sections, at = game.saved_state()
        print("saved sections: %s" % (", ".join(sorted(sections)) or "none"))
    except game.GameError as e:
        print(e)
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(prog="wow-seer", description="Install the Seer addon and run the MCP server.")
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("install", help="install the Seer addon and request slots (game closed)")
    p.add_argument("--slots", type=int, default=game.DEFAULT_SLOTS)
    sub.add_parser("remove", help="remove the addon and its slots")
    sub.add_parser("serve", help="run the MCP server on stdio")
    sub.add_parser("status", help="show what is installed")
    p = sub.add_parser("watch", help="run without an AI client and print what arrives")
    p.add_argument("--dump", help="write the latest state to this JSON file after each message")
    p = sub.add_parser("decode", help="decode Seer screenshots (debugging)")
    p.add_argument("files", nargs="+")
    p.add_argument("--chars", type=int, default=2000)
    args = ap.parse_args()
    return globals()["cmd_" + args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
