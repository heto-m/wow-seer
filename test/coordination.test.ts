import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startBackground, State } from "../src/server.js";
import { LeaderLock } from "../src/shared.js";

test("one leader, followers forward requests and see its state", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-coord-"));
  process.env.WOW_SEER_DIR = tmp;
  process.env.WOW_DIR = path.join(tmp, "missing");
  const leader = new State();
  const follower = new State();
  const stops = [startBackground(leader)];
  try {
    assert.ok(await leader.wait(() => leader.role === "leader", 3));
    stops.push(startBackground(follower));
    assert.ok(await follower.wait(() => follower.role === "follower", 3));
    const req = follower.request("item", { item: 7 });
    assert.ok(await waitFor(() => leader.pending.some((r) => r.id === req), 3));
    leader.apply({ msg: 1, t: Date.now() / 1000, acks: [req], sections: { player: { level: 24 } } });
    assert.ok(await waitFor(() => follower.answered(req), 3));
    assert.equal(follower.sections.player.data.level, 24);
  } finally {
    for (const stop of stops) stop();
    delete process.env.WOW_SEER_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a stale lock socket left by a dead process is taken over", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-lock-"));
  try {
    const first = new LeaderLock(tmp);
    assert.ok(await first.acquire());
    assert.equal(await new LeaderLock(tmp).acquire(), false);
    first.release();
    if (process.platform !== "win32") fs.writeFileSync(path.join(tmp, "leader.sock"), "");
    const second = new LeaderLock(tmp);
    assert.ok(await second.acquire());
    second.release();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean, seconds: number): Promise<boolean> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}
