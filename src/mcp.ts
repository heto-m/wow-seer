import readline from "node:readline";

import { State } from "./server.js";
import { callTool, INSTRUCTIONS, toolList, UnknownTool } from "./tools.js";
import { VERSION } from "./version.js";

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const META = "io.modelcontextprotocol/";
const SERVER_INFO = { name: "wow-seer", version: VERSION };
const TOOLS_TTL_MS = 3_600_000;

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
const UNSUPPORTED_VERSION = -32022;

class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
  }
}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

export class McpServer {
  private cancelled = new Set<string | number>();

  constructor(private state: State, private write: (line: string) => void) {}

  async handle(msg: Message): Promise<void> {
    const { id, method } = msg;
    if (id === undefined || id === null) {
      if (method === "notifications/cancelled" && msg.params?.requestId !== undefined) {
        this.cancelled.add(msg.params.requestId);
      }
      return;
    }
    let reply: Record<string, unknown>;
    try {
      reply = { result: await this.dispatch(method, msg.params || {}) };
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(INTERNAL_ERROR, (e as Error).message);
      reply = { error: { code: err.code, message: err.message, ...(err.data === undefined ? {} : { data: err.data }) } };
    }
    if (this.cancelled.delete(id)) return;
    this.send({ jsonrpc: "2.0", id, ...reply });
  }

  private async dispatch(method: string | undefined, params: any): Promise<Record<string, unknown>> {
    const meta = params._meta || {};
    const modern = typeof meta[META + "protocolVersion"] === "string";
    if (modern) this.checkModern(meta);
    else if (method === "server/discover") {
      throw new RpcError(INVALID_PARAMS, "missing _meta " + META + "protocolVersion");
    }
    const result = await this.execute(method, params, modern);
    return modern ? { ...result, resultType: "complete", _meta: { [META + "serverInfo"]: SERVER_INFO } } : result;
  }

  private checkModern(meta: Record<string, unknown>): void {
    const version = meta[META + "protocolVersion"] as string;
    if (!MODERN_VERSIONS.includes(version)) {
      throw new RpcError(UNSUPPORTED_VERSION, "Unsupported protocol version", {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        requested: version,
      });
    }
    const caps = meta[META + "clientCapabilities"];
    if (caps === null || typeof caps !== "object" || Array.isArray(caps)) {
      throw new RpcError(INVALID_PARAMS, "missing _meta " + META + "clientCapabilities");
    }
  }

  private async execute(method: string | undefined, params: any, modern: boolean): Promise<Record<string, unknown>> {
    switch (method) {
      case "server/discover":
        return {
          supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
          ttlMs: TOOLS_TTL_MS,
          cacheScope: "public",
        };
      case "initialize": {
        const asked = params.protocolVersion;
        return {
          protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return modern ? { tools: toolList(), ttlMs: TOOLS_TTL_MS, cacheScope: "public" } : { tools: toolList() };
      case "tools/call":
        return this.callTool(params);
      default:
        throw new RpcError(METHOD_NOT_FOUND, "method not found");
    }
  }

  private async callTool(params: any): Promise<Record<string, unknown>> {
    try {
      const data = await callTool(this.state, params.name, params.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (e) {
      const text = e instanceof UnknownTool ? "unknown tool" : `error: ${(e as Error).message}`;
      return { content: [{ type: "text", text }], isError: true };
    }
  }

  private send(obj: unknown): void {
    this.write(JSON.stringify(obj) + "\n");
  }

  run(input: NodeJS.ReadableStream = process.stdin): Promise<void> {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      let msg: Message;
      try {
        msg = JSON.parse(line);
      } catch {
        this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      void this.handle(msg);
    });
    return new Promise((resolve) => rl.on("close", () => resolve()));
  }
}
