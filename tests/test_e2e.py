import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
import unittest
import zlib

from wow_seer import frame, game, server

HERE = os.path.dirname(os.path.abspath(__file__))
LUA = shutil.which("lua5.1") or shutil.which("luajit")


def render_png(cells, width, height, sx=1.0, sy=1.0, squeeze=True):
    img = [bytearray(b"\x5a\x8c\x3c" * width) for _ in range(height)]
    for x, y, s, r, g, b in cells:
        col = [int(round(v * 255)) for v in (r, g, b)]
        if squeeze:
            col = [3 + int(c * 249 / 255) for c in col]
        for py in range(height):
            if not (y * sy <= py + 0.5 < (y + s) * sy):
                continue
            row = img[py]
            for px in range(max(0, int(x * sx) - 1), min(width, int((x + s) * sx) + 2)):
                if x * sx <= px + 0.5 < (x + s) * sx:
                    row[3 * px:3 * px + 3] = bytes(col)
    raw = b"".join(b"\x00" + bytes(row) for row in img)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def read_cells(path):
    with open(path) as f:
        return [tuple(map(float, line.split())) for line in f if line.strip()]


@unittest.skipUnless(LUA, "needs lua5.1")
class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.wow = os.path.join(self.tmp, "_forever_")
        os.makedirs(os.path.join(self.wow, "Interface", "AddOns"))
        os.makedirs(os.path.join(self.wow, "Screenshots"))
        os.environ["WOW_DIR"] = self.wow
        game.install(slots=5)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_game(self, seconds):
        shots = os.path.join(self.tmp, "shots")
        shutil.rmtree(shots, ignore_errors=True)
        os.makedirs(shots)
        subprocess.run([LUA, os.path.join(HERE, "mock_wow.lua"), game.addons_dir(), shots, str(seconds)],
                       check=True, capture_output=True, text=True)
        return [os.path.join(shots, n) for n in sorted(os.listdir(shots))]

    def feed(self, state, shot_files, width=1100, **render):
        for i, path in enumerate(shot_files):
            png = os.path.join(self.wow, "Screenshots", "WoWScrnShot_%03d.png" % i)
            with open(png, "wb") as f:
                f.write(render_png(read_cells(path), width, 50, **render))
            self.assertTrue(server.process_file(state, png))
            self.assertFalse(os.path.exists(png))

    def test_no_server_means_no_shots(self):
        self.assertEqual(self.run_game(30), [])

    def test_push_and_request(self):
        state = server.State()
        req = state.request("item", item=4242)
        game.write_slots(1, 5, {"t": int(time.time()), "reqs": state.pending})
        shots = self.run_game(40)
        self.assertTrue(shots)
        self.feed(state, shots)
        for name in ("player", "equipment", "bags", "quests", "talents", "items"):
            self.assertIn(name, state.sections, name)
        self.assertEqual(state.sections["player"]["data"]["level"], 23)
        bag = state.sections["bags"]["data"][0]["items"]
        self.assertEqual(bag[0]["name"], "Cosa ñ 2589")
        self.assertEqual(bag[1]["tooltip"], ["Varita"])
        self.assertEqual(bag[1]["loc"], "INVTYPE_RANGEDRIGHT")
        self.assertEqual(state.sections["equipment"]["data"][0]["tooltip"][1], "Cabeza\tTela")
        self.assertEqual(state.sections["items"]["data"][0]["id"], 4242)
        self.assertEqual([r for r in state.pending if r["id"] == req], [])
        view = server.call_tool(state, "get_character", {})
        self.assertEqual(view["player"]["level"], 23)
        self.assertNotIn("source", view)

    def test_fractional_scale(self):
        state = server.State()
        game.write_slots(1, 5, {"t": int(time.time()), "reqs": []})
        shots = self.run_game(15)
        self.feed(state, shots, width=1400, sx=1.25, sy=1.25)
        self.assertIn("bags", state.sections)


    def test_multi_part(self):
        state = server.State()
        game.write_slots(1, 5, {"t": int(time.time()), "reqs": []})
        os.environ["MOCK_BIG"] = "1"
        try:
            shots = self.run_game(15)
        finally:
            del os.environ["MOCK_BIG"]
        self.assertGreater(len(shots), 1)
        self.feed(state, shots)
        self.assertEqual(len(state.sections["bags"]["data"][0]["items"][1]["tooltip"]), 401)


class Coordination(unittest.TestCase):
    def test_leader_and_follower(self):
        tmp = tempfile.mkdtemp()
        os.environ["WOW_SEER_DIR"] = tmp
        os.environ["WOW_DIR"] = os.path.join(tmp, "missing")
        try:
            leader, follower = server.State(), server.State()
            stops = [server.start_background(leader)]
            self.assertTrue(leader.wait(lambda: leader.role == "leader", 3))
            stops.append(server.start_background(follower))
            self.assertTrue(follower.wait(lambda: follower.role == "follower", 3))
            req = follower.request("item", item=7)
            self.assertTrue(leader.wait(lambda: any(r["id"] == req for r in leader.pending), 3))
            leader.apply({"msg": 1, "t": time.time(), "acks": [req], "sections": {"player": {"level": 24}}})
            self.assertTrue(follower.wait(lambda: follower.answered(req), 3))
            self.assertEqual(follower.sections["player"]["data"]["level"], 24)
            for stop in stops:
                stop.set()
        finally:
            del os.environ["WOW_SEER_DIR"]
            shutil.rmtree(tmp)


class Units(unittest.TestCase):
    def test_lua_value(self):
        self.assertEqual(game.lua_value({"t": 5, "reqs": [{"kind": "refresh", "sections": ["bags"]}]}),
                         '{["t"]=5,["reqs"]={{["kind"]="refresh",["sections"]={"bags"}}}}')
        self.assertEqual(game.lua_value('a"b\\'), '"a\\034b\\092"')

    def test_not_seer(self):
        with self.assertRaises(frame.NotSeer):
            frame.decode(render_png([], 400, 20))

    def test_saved_state(self):
        tmp = tempfile.mkdtemp()
        try:
            sv = os.path.join(tmp, "_forever_", "WTF", "Account", "X", "SavedVariables")
            os.makedirs(sv)
            os.makedirs(os.path.join(tmp, "_forever_", "Interface"))
            payload = json.dumps({"name": 'Testera "ñ"'}, ensure_ascii=False)
            lua = payload.replace("\\", "\\\\").replace('"', '\\"')
            with open(os.path.join(sv, "Seer.lua"), "w", encoding="utf-8") as f:
                f.write('\nSeerDB = {\n["saved"] = {\n["player"] = "%s",\n},\n["savedAt"] = 1700000000,\n}\n' % lua)
            os.environ["WOW_DIR"] = os.path.join(tmp, "_forever_")
            sections, at = game.saved_state()
            self.assertEqual(sections["player"]["name"], 'Testera "ñ"')
            self.assertEqual(at, 1700000000)
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
