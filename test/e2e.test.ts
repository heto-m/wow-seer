import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as game from "../src/game.js";
import { LUA } from "./lua.js";
import { readCells, renderPng } from "./render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

class Client {
  private waiting = new Map<number, (msg: any) => void>();
  private nextId = 1;

  constructor(private child: ReturnType<typeof spawn>) {
    readline.createInterface({ input: child.stdout! }).on("line", (line) => {
      const msg = JSON.parse(line);
      this.waiting.get(msg.id)?.(msg);
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve) => this.waiting.set(id, resolve));
  }

  async tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await this.request("tools/call", { _meta: META, name, arguments: args });
    assert.equal(r.result.resultType, "complete");
    return JSON.parse(r.result.content[0].text);
  }
}

async function until(predicate: () => boolean, seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("the real server reads the mock game end to end", { skip: !LUA && "needs lua5.1", timeout: 60_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-e2e-"));
  const wow = path.join(tmp, "_forever_");
  const env = { ...process.env, WOW_DIR: wow, WOW_SEER_DIR: path.join(tmp, "shared") };
  fs.mkdirSync(path.join(wow, "Interface", "AddOns"), { recursive: true });
  fs.mkdirSync(path.join(wow, "Screenshots"));
  process.env.WOW_DIR = wow;
  game.install(5);
  const child = spawn(process.execPath, [path.join(ROOT, "dist", "src", "cli.js"), "serve"], { env });
  const client = new Client(child);
  const body = path.join(game.addonsDir(), "Seer_S0001", "body.lua");
  try {
    const init = await client.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const discover = await client.request("server/discover", { _meta: META });
    assert.ok(discover.result.supportedVersions.includes("2026-07-28"));

    const item = client.tool("get_item", { item_id: 4242, timeout_seconds: 30 });
    await until(() => fs.readFileSync(body, "utf8").includes("4242"), 10);

    const shots = path.join(tmp, "shots");
    fs.mkdirSync(shots);
    const r = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), shots, "40"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const files = fs.readdirSync(shots).sort();
    assert.ok(files.length > 0);
    files.forEach((name, i) => {
      const png = renderPng(readCells(path.join(shots, name)), 1100, 50);
      fs.writeFileSync(path.join(wow, "Screenshots", `WoWScrnShot_${String(i).padStart(3, "0")}.png`), png);
    });

    assert.equal((await item).id, 4242);
    const character = await client.tool("get_character");
    assert.equal(character.player.level, 23);
    assert.equal(character.source, undefined);
    const bags = await client.tool("get_bags", { equippable_only: true });
    assert.deepEqual(bags.items.cols.slice(0, 2), ["id", "name"]);
    const status = await client.tool("seer_status");
    assert.equal(status.role, "leader");
    assert.equal(status.last_error, null);
    assert.equal(status.addon_version, status.server_version);
    assert.equal(status.warning, undefined);
    await until(() => fs.readdirSync(path.join(wow, "Screenshots")).length === 0, 5);
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    delete process.env.WOW_DIR;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("the addon asks for PNG and sends nothing while screenshots are JPEG", { skip: !LUA && "needs lua5.1" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-png-"));
  process.env.WOW_DIR = path.join(tmp, "_forever_");
  try {
    fs.mkdirSync(path.join(process.env.WOW_DIR, "Interface", "AddOns"), { recursive: true });
    game.install(3);
    const run = (format: string) => {
      const shots = fs.mkdtempSync(path.join(tmp, "shots-"));
      const r = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), shots, "20"], {
        encoding: "utf8",
        env: { ...process.env, MOCK_SEND: "1", MOCK_FORMAT: format },
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    const locales = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), tmp, "0"], {
      encoding: "utf8",
      env: { ...process.env, MOCK_LOCALES: "1" },
    });
    assert.equal(locales.status, 0, locales.stderr);
    assert.match(locales.stdout, /locales ok/);
    const priced = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), tmp, "0"], {
      encoding: "utf8",
      env: { ...process.env, MOCK_PRICES: "1" },
    });
    assert.equal(priced.status, 0, priced.stderr);
    const p = JSON.parse(priced.stdout);
    assert.equal(p.auctionator, true);
    assert.deepEqual(p.items.map((i: any) => [i.id, i.price ?? null, i.age ?? null, i.vendor, i.count ?? null]), [
      [5240, 9000, 3, 52400, null], [777, null, null, 7770, null],
      [2589, 40, 0, 25890, 5], [5240, 9000, 3, 52400, 10], [159, null, null, 1590, 15],
    ]);
    const hooked = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), tmp, "0"], {
      encoding: "utf8",
      env: { ...process.env, MOCK_ADDONS: "1" },
    });
    assert.equal(hooked.status, 0, hooked.stderr);
    const h = JSON.parse(hooked.stdout);
    assert.deepEqual(h.player.bisWeights, { spec: "Shadow", stats: { INT: 1, SPI: 0.8 }, source: "Wowhead", fromLevel: 1, toLevel: 30 });
    assert.deepEqual(h.player.dungeonLockout, { lastHour: 5, limit: 5, last24h: 7, freeIn: 600 });
    assert.deepEqual(h.bags[0].items.map((i: any) => i.bis ?? null), [null, 12.3, null]);
    assert.deepEqual(h.alts.map((c: any) => [c.name, c.level, c.class, c.zone, c.mails ?? null, c.mailExpiresDays ?? null]), [
      ["Palla", 27, "PRIEST", "Tierras Altas", null, null], ["Bank", 5, "WARRIOR", "Entrañas", 2, 3.2],
    ]);
    const comms = spawnSync(LUA!, [path.join(ROOT, "test", "mock_wow.lua"), game.addonsDir(), tmp, "20"], {
      encoding: "utf8",
      env: { ...process.env, MOCK_COMMS: "1" },
    });
    assert.equal(comms.status, 0, comms.stderr);
    const updates = comms.stdout.split("\n").filter((l) => l.includes("npx -y wow-seer install") && /\d+\.\d+\.\d+/.test(l));
    assert.equal(updates.length, 1, comms.stdout);
    assert.match(updates[0], /0\.9\.0/);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    assert.deepEqual(comms.stdout.split("\n").filter((l) => l.startsWith("sent ")), [`sent Seer v:${version} GUILD`, `sent Seer v:${version} PARTY`]);
    const jpeg = run("jpeg");
    assert.match(jpeg, /popup SEER_PNG jpeg/);
    assert.match(jpeg, /shots 0/);
    const png = run("png");
    assert.doesNotMatch(png, /popup/);
    assert.match(png, /shots [1-9]/);
  } finally {
    delete process.env.WOW_DIR;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});
