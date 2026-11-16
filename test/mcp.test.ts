import assert from "node:assert/strict";
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
