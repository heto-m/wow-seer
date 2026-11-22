import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as game from "../src/game.js";
import { Assembler, NotSeer, decode } from "../src/frame.js";
import { messageText, startCapture, State } from "../src/server.js";
import { VERSION } from "../src/version.js";
import { LUA } from "./lua.js";
import { readCells, renderPng, renderRaw } from "./render.js";

const MOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "mock_wow.lua");

function messages(seconds: number, opts: {
  width?: number; sx?: number; sy?: number; env?: Record<string, string>; reqs?: unknown[];
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-"));
  const old = process.env.WOW_DIR;
  try {
    const wow = path.join(tmp, "_forever_");
    fs.mkdirSync(path.join(wow, "Interface", "AddOns"), { recursive: true });
    process.env.WOW_DIR = wow;
    game.install(5);
    const reqs = [{ id: 1010, kind: "item", item: 4242 }, ...(opts.reqs ?? [])];
    game.writeSlots(1, 5, { t: Math.floor(Date.now() / 1000), reqs });
    const shots = path.join(tmp, "shots");
    fs.mkdirSync(shots);
    const r = spawnSync(LUA as string, [MOCK, game.addonsDir(), shots, String(seconds)],
      { env: { ...process.env, ...opts.env }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const files = fs.readdirSync(shots).sort().map((n) => path.join(shots, n));
    const assembler = new Assembler();
    const out: any[] = [];
    const cells = files.map(readCells);
    for (const c of cells) {
      const png = renderPng(c, opts.width ?? 1100, 50, opts.sx ?? 1, opts.sy ?? 1);
      const { header, payload } = decode(png);
      const text = assembler.add(header, payload);
      if (text) out.push(JSON.parse(messageText(text)));
    }
    return { files: files.map((f) => path.basename(f)), out, cells, stdout: r.stdout };
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

test("capture mode holds the strip for the window capture instead of calling Screenshot()", { skip: !LUA && "needs lua5.1" }, () => {
  const { files, out, stdout } = messages(15, { env: { MOCK_CAPTURE: "1" }, reqs: [{ id: 1011, kind: "capture", on: true }] });
  assert.match(stdout, /shots 0/);
  assert.ok(files.every((f) => f.startsWith("cap")));
  const unique = new Set(out.map((m) => m.msg));
  assert.ok(out.length > unique.size, "each strip is up for more than one capture");
  assert.ok(merged(out).bags);
  assert.equal(out[0].capture, true);
});

test("unconfirmed captures are resent by screenshot, and two in a row end capture mode", { skip: !LUA && "needs lua5.1" }, () => {
  const { files, out, stdout } = messages(70, { env: { MOCK_CAPTURE: "saved" } });
  assert.match(stdout, /shots [1-9]/);
  assert.ok(files.some((f) => f.startsWith("cap")));
  assert.equal(out[0].capture, true);
  assert.equal(out.at(-1).capture, false);
});

test("a new login starts without capture mode; a /reload keeps it", { skip: !LUA && "needs lua5.1" }, () => {
  const login = messages(15, { env: { MOCK_CAPTURE: "saved", MOCK_LOGIN: "1" } });
  assert.ok(login.files.every((f) => f.startsWith("shot")));
  assert.equal(login.out[0].capture, false);
  const reload = messages(15, { env: { MOCK_CAPTURE: "saved" } });
  assert.ok(reload.files.every((f) => f.startsWith("cap")));
});

async function until(predicate: () => boolean, seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("the server reads each held strip once and asks the addon to capture", { skip: !LUA && "needs lua5.1" }, async () => {
  const { cells } = messages(15, { env: { MOCK_CAPTURE: "1" }, reqs: [{ id: 1011, kind: "capture", on: true }] });
  const frames = cells.map((c) => renderRaw(c, 1100, 50));
  const state = new State();
  state.role = "leader";
  let i = 0;
  const stop = startCapture(state, async () => ({ grab: async () => frames[i++] ?? null }));
  try {
    await until(() => i > frames.length, 30);
    assert.equal(state.meta.capture, "on");
    assert.ok(state.pending.some((r) => r.kind === "capture" && r.on === true));
    assert.equal(state.sections.player.data.level, 23);
    assert.ok(state.meta.frames < frames.length);
  } finally {
    stop();
  }
});

test("the server turns capture off when it can't, or when the addon keeps falling back", async () => {
  const off = new State();
  off.role = "leader";
  const stopOff = startCapture(off, async () => "no window library");
  await until(() => off.meta.capture !== null, 2);
  stopOff();
  assert.equal(off.meta.capture, "off: no window library");
  assert.ok(off.pending.some((r) => r.kind === "capture" && r.on === false));

  const state = new State();
  state.role = "leader";
  const stop = startCapture(state, async () => ({ grab: async () => null }));
  await until(() => state.meta.capture === "on", 2);
  const msg = { version: VERSION, capture: true };
  state.emit("received", msg, "screenshot");
  state.emit("received", msg, "screenshot");
  state.emit("received", { ...msg, msg: 7 }, "capture");
  state.emit("received", msg, "screenshot");
  state.emit("received", msg, "screenshot");
  assert.equal(state.meta.capture, "on");
  state.emit("received", msg, "screenshot");
  stop();
  assert.match(state.meta.capture!, /^off: /);
  assert.deepEqual(state.pending.filter((r) => r.kind === "capture").map((r) => r.on), [false]);
});

test("node-screenshots loads on this system", async () => {
  const name = "node-screenshots";
  const lib: any = await import(name);
  assert.equal(typeof (lib.Window ?? lib.default?.Window)?.all, "function");
});
