import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as game from "../src/game.js";
import { compareVersions, VERSION } from "../src/version.js";

function withWowDir<T>(dir: string, fn: () => T): T {
  const old = process.env.WOW_DIR;
  process.env.WOW_DIR = dir;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.WOW_DIR;
    else process.env.WOW_DIR = old;
  }
}

test("luaValue", () => {
  assert.equal(game.luaValue({ t: 5, reqs: [{ kind: "refresh", sections: ["bags"] }] }),
    '{["t"]=5,["reqs"]={{["kind"]="refresh",["sections"]={"bags"}}}}');
  assert.equal(game.luaValue('a"b\\'), '"a\\034b\\092"');
  assert.equal(game.luaValue("ñ"), '"\\195\\177"');
  assert.equal(game.luaValue([true, null, 1.5, 1e-5, 0.1]), "{true,nil,1.5,1e-05,0.1}");
});

test("savedState", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-"));
  try {
    const sv = path.join(tmp, "_forever_", "WTF", "Account", "X", "SavedVariables");
    fs.mkdirSync(sv, { recursive: true });
    fs.mkdirSync(path.join(tmp, "_forever_", "Interface"));
    const payload = JSON.stringify({ name: 'Testera "ñ"' });
    const lua = payload.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    fs.writeFileSync(path.join(sv, "Seer.lua"),
      `\nSeerDB = {\n["saved"] = {\n["player"] = "${lua}",\n},\n["savedAt"] = 1700000000,\n}\n`, "utf8");
    const { sections, savedAt } = withWowDir(path.join(tmp, "_forever_"), () => game.savedState());
    assert.equal(sections.player.name, 'Testera "ñ"');
    assert.equal(savedAt, 1700000000);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("install, writeSlots and remove", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-"));
  try {
    const wow = path.join(tmp, "_forever_");
    fs.mkdirSync(path.join(wow, "Interface", "AddOns"), { recursive: true });
    withWowDir(wow, () => {
      game.install(3);
      assert.deepEqual(game.slotDirs(), ["Seer_S0001", "Seer_S0002", "Seer_S0003"]);
      assert.ok(fs.existsSync(path.join(game.addonsDir(), "Seer", "Seer.toc")));
      game.writeSlots(1, 3, { t: 1, reqs: [] });
      assert.equal(fs.readFileSync(path.join(game.addonsDir(), "Seer_S0002", "body.lua"), "utf8"),
        'SeerInbox = {["t"]=1,["reqs"]={}}\n');
      game.install(2);
      assert.deepEqual(game.slotDirs(), ["Seer_S0001", "Seer_S0002"]);
      game.remove();
      assert.deepEqual(fs.readdirSync(game.addonsDir()), []);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the bundled addon's version matches the package", () => {
  assert.equal(game.tocVersion(path.join(game.ADDON_SRC, "Seer.toc")), VERSION);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.0-beta", "1.0.0"), null);
});

test("install keeps a newer Seer and replaces an older one", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-"));
  try {
    const wow = path.join(tmp, "_forever_");
    const seer = path.join(wow, "Interface", "AddOns", "Seer");
    const toc = path.join(seer, "Seer.toc");
    fs.mkdirSync(seer, { recursive: true });
    withWowDir(wow, () => {
      fs.writeFileSync(toc, "## Title: Seer\n## Version: 99.0.0\n");
      fs.writeFileSync(path.join(seer, "Extra.lua"), "");
      assert.equal(game.install(2).kept, "99.0.0");
      assert.equal(game.tocVersion(toc), "99.0.0");
      assert.ok(fs.existsSync(path.join(seer, "Extra.lua")));
      assert.deepEqual(game.slotDirs(), ["Seer_S0001", "Seer_S0002"]);

      fs.writeFileSync(toc, "## Title: Seer\n## Version: 0.0.1\n");
      assert.equal(game.install(2).kept, null);
      assert.equal(game.tocVersion(toc), VERSION);
      assert.ok(!fs.existsSync(path.join(seer, "Extra.lua")));

      fs.writeFileSync(toc, "## Version: @project-version@\n");
      assert.equal(game.install(2).kept, null);
      assert.equal(game.tocVersion(toc), VERSION);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
