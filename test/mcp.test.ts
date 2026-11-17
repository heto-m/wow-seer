import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { McpServer } from "../src/mcp.js";
import { State } from "../src/server.js";

const MODERN = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};

async function ask(msg: Record<string, unknown>, state = new State()): Promise<any> {
  const lines: string[] = [];
  await new McpServer(state, (line) => lines.push(line)).handle({ jsonrpc: "2.0", ...msg } as any);
  assert.ok(lines.every((l) => l.endsWith("\n") && !l.slice(0, -1).includes("\n")));
  return lines.length ? JSON.parse(lines[0]) : null;
}

test("server/discover describes both eras", async () => {
  const r = await ask({ id: 1, method: "server/discover", params: { _meta: MODERN } });
  assert.equal(r.result.resultType, "complete");
  assert.deepEqual(r.result.supportedVersions.slice(0, 2), ["2026-07-28", "2025-11-25"]);
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result._meta["io.modelcontextprotocol/serverInfo"].name, "wow-seer");
});

test("modern tools/list is cacheable and needs no handshake", async () => {
  const r = await ask({ id: 2, method: "tools/list", params: { _meta: MODERN } });
  assert.equal(r.result.resultType, "complete");
  assert.equal(r.result.cacheScope, "public");
  assert.ok(r.result.ttlMs > 0);
  assert.ok(r.result.tools.some((t: any) => t.name === "search_auction"));
});

test("modern tools/call carries resultType", async () => {
  const r = await ask({ id: 3, method: "tools/call", params: { _meta: MODERN, name: "get_talents", arguments: {} } });
  assert.equal(r.result.resultType, "complete");
  assert.equal(r.result.content[0].type, "text");
  const unknown = await ask({ id: 4, method: "tools/call", params: { _meta: MODERN, name: "nope" } });
  assert.equal(unknown.result.isError, true);
});

test("unsupported version and missing capabilities are rejected", async () => {
  const meta = { ...MODERN, "io.modelcontextprotocol/protocolVersion": "2099-01-01" };
  const bad = await ask({ id: 5, method: "tools/list", params: { _meta: meta } });
  assert.equal(bad.error.code, -32022);
  assert.equal(bad.error.data.requested, "2099-01-01");
  assert.ok(bad.error.data.supported.includes("2026-07-28"));
  const { ["io.modelcontextprotocol/clientCapabilities"]: _, ...noCaps } = MODERN;
  const missing = await ask({ id: 6, method: "tools/list", params: { _meta: noCaps } });
  assert.equal(missing.error.code, -32602);
  const bare = await ask({ id: 7, method: "server/discover", params: {} });
  assert.equal(bare.error.code, -32602);
});

test("legacy clients still get initialize and plain results", async () => {
  const init = await ask({ id: 8, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "wow-seer");
  const future = await ask({ id: 9, method: "initialize", params: { protocolVersion: "2030-01-01" } });
  assert.equal(future.result.protocolVersion, "2025-11-25");
  const list = await ask({ id: 10, method: "tools/list" });
  assert.equal(list.result.resultType, undefined);
  assert.ok(list.result.tools.length > 10);
  assert.deepEqual((await ask({ id: 11, method: "ping" })).result, {});
  assert.equal((await ask({ id: 12, method: "nope" })).error.code, -32601);
});

test("notifications get no reply and cancelled requests stay silent", async () => {
  assert.equal(await ask({ method: "notifications/initialized" }), null);
  const state = new State();
  const lines: string[] = [];
  const server = new McpServer(state, (line) => lines.push(line));
  const call = server.handle({ jsonrpc: "2.0", id: 13, method: "tools/call",
    params: { _meta: MODERN, name: "refresh", arguments: { timeout_seconds: 0.3 } } });
  await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 13 } });
  await call;
  assert.deepEqual(lines, []);
});

test("seer_status warns when the addon version differs", async () => {
  const status = async (state: State) => {
    const r = await ask({ id: 20, method: "tools/call", params: { _meta: MODERN, name: "seer_status", arguments: {} } }, state);
    return JSON.parse(r.result.content[0].text);
  };
  const idle = await status(new State());
  assert.equal(idle.addon_version, null);
  assert.doesNotMatch(idle.warning ?? "", /update/);

  const write = process.stderr.write;
  const logged: string[] = [];
  process.stderr.write = ((line: string) => logged.push(line)) as any;
  const state = new State();
  try {
    state.apply({ msg: 1, t: Date.now() / 1000 });
    state.apply({ msg: 2, t: Date.now() / 1000 });
  } finally {
    process.stderr.write = write;
  }
  assert.equal(logged.length, 1);
  const old = await status(state);
  assert.equal(old.addon_version, "unknown");
  assert.match(old.warning, /wow-seer install/);
  assert.equal(logged[0], `wow-seer: ${old.warning}\n`);

  state.apply({ msg: 3, t: Date.now() / 1000, version: "99.0.0" });
  const newer = await status(state);
  assert.equal(newer.addon_version, "99.0.0");
  assert.match(newer.warning, /update the MCP server/);

  state.apply({ msg: 4, t: Date.now() / 1000, version: newer.server_version });
  assert.equal((await status(state)).warning, undefined);

  const [major, minor] = newer.server_version.split(".");
  state.apply({ msg: 5, t: Date.now() / 1000, version: `${major}.${minor}.999` });
  assert.equal((await status(state)).warning, undefined);
  state.apply({ msg: 6, t: Date.now() / 1000, version: `${major}.${Number(minor) + 1}.0` });
  assert.match((await status(state)).warning, /update the MCP server/);
});

test("missing data says why", async () => {
  const call = async (state: State, name: string) => {
    const r = await ask({ id: 30, method: "tools/call", params: { _meta: MODERN, name, arguments: { timeout_seconds: 0.1, item_id: 1 } } }, state);
    return JSON.parse(r.result.content[0].text);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seer-hint-"));
  const addons = path.join(tmp, "Interface", "AddOns");
  fs.mkdirSync(addons, { recursive: true });
  process.env.WOW_DIR = tmp;
  try {
    const state = new State();
    assert.match((await call(state, "get_bags")).hint, /not installed.*wow-seer install/);
    fs.mkdirSync(path.join(addons, "Seer"));
    fs.writeFileSync(path.join(addons, "Seer", "Seer.toc"), "");
    assert.match((await call(state, "get_bags")).hint, /request slots are missing/);
    fs.mkdirSync(path.join(addons, "Seer_S0001"));
    const bags = await call(state, "get_bags");
    assert.match(bags.hint, /has not heard from the game/);
    assert.match((await call(state, "get_item")).hint, /has not heard/);
    assert.match((await call(state, "seer_status")).warning, /has not heard/);
    state.apply({ msg: 1, t: Date.now() / 1000, version: "0.0.0-test", sections: { bags: [] } });
    const guide = await call(state, "get_guide");
    assert.equal(guide.hint, undefined);
    assert.match(guide.not_seen_yet.guide, /Polestar/);
    assert.match((await call(state, "get_trainer")).not_seen_yet.trainer, /open a trainer/);
    state.addon.last_message = Date.now() / 1000 - 600;
    assert.match((await call(state, "get_item")).hint, /Last heard from the game 6\d\d s ago/);
    assert.equal((await call(state, "get_guide")).hint, undefined);
  } finally {
    delete process.env.WOW_DIR;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});
