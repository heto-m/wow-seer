import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as game from "../src/game.js";
import { readCells, renderPng } from "./render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LUA = ["lua5.1", "luajit"].find((bin) => !spawnSync(bin, ["-v"], { stdio: "ignore" }).error);
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
    await until(() => fs.readdirSync(path.join(wow, "Screenshots")).length === 0, 5);
  } finally {
    child.kill();
    delete process.env.WOW_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
