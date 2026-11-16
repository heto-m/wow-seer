import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as game from "../src/game.js";
import { Assembler, NotSeer, decode } from "../src/frame.js";
import { LUA } from "./lua.js";
import { readCells, renderPng } from "./render.js";

const MOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "mock_wow.lua");

function messages(seconds: number, opts: { width?: number; sx?: number; sy?: number; env?: Record<string, string> } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-"));
  const old = process.env.WOW_DIR;
  try {
    const wow = path.join(tmp, "_forever_");
    fs.mkdirSync(path.join(wow, "Interface", "AddOns"), { recursive: true });
    process.env.WOW_DIR = wow;
    game.install(5);
    game.writeSlots(1, 5, { t: Math.floor(Date.now() / 1000), reqs: [{ id: 1010, kind: "item", item: 4242 }] });
    const shots = path.join(tmp, "shots");
    fs.mkdirSync(shots);
    const r = spawnSync(LUA as string, [MOCK, game.addonsDir(), shots, String(seconds)],
      { env: { ...process.env, ...opts.env }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const files = fs.readdirSync(shots).sort().map((n) => path.join(shots, n));
    const assembler = new Assembler();
    const out: any[] = [];
    for (const file of files) {
      const png = renderPng(readCells(file), opts.width ?? 1100, 50, opts.sx ?? 1, opts.sy ?? 1);
      const { header, payload } = decode(png);
      const text = assembler.add(header, payload);
      if (text) out.push(JSON.parse(text.toString("utf8")));
    }
    return { files, out };
  } finally {
    if (old === undefined) delete process.env.WOW_DIR;
    else process.env.WOW_DIR = old;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function merged(out: any[]) {
  return Object.assign({}, ...out.map((m) => m.sections ?? {}));
}

test("a PNG without a strip is not Seer", () => {
  assert.throws(() => decode(renderPng([], 400, 20)), NotSeer);
});

test("decodes the real addon's strips", { skip: !LUA && "needs lua5.1" }, () => {
  const { out } = messages(40);
  const s = merged(out);
  assert.equal(s.player.level, 23);
  assert.equal(s.bags[0].items[0].name, "Cosa ñ 2589");
  assert.deepEqual(s.bags[0].items[1].tooltip, ["Varita"]);
  assert.equal(s.bags[0].items[1].loc, "INVTYPE_RANGEDRIGHT");
  assert.equal(s.equipment[0].tooltip[1], "Cabeza\tTela");
  assert.equal(s.items[0].id, 4242);
  assert.ok(out.some((m) => (m.acks ?? []).includes(1010)));
});

test("decodes at a fractional scale", { skip: !LUA && "needs lua5.1" }, () => {
  const { out } = messages(15, { width: 1400, sx: 1.25, sy: 1.25 });
  assert.ok(merged(out).bags);
});

test("joins multi-part messages", { skip: !LUA && "needs lua5.1" }, () => {
  const { files, out } = messages(15, { env: { MOCK_BIG: "1" } });
  assert.ok(files.length > 1);
  assert.equal(merged(out).bags[0].items[1].tooltip.length, 401);
});
