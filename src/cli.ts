#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "node:util";

import { BadFrame, decode, NotSeer } from "./frame.js";
import * as game from "./game.js";
import { McpServer } from "./mcp.js";
import { startBackground, State } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `wow-seer ${VERSION}: install the Seer addon and run the MCP server.

Usage: wow-seer <command>
  install [--slots N]   install the Seer addon and request slots (game closed)
  remove                remove the addon and its slots
  serve                 run the MCP server on stdio
  status                show what is installed
  watch [--dump FILE]   run without an AI client and print what arrives
  decode FILE...        decode Seer screenshots (debugging)`;

function install(slots: number): number {
  if (game.gameRunning()) {
    console.log("WoW is running. Close it first: new addons only load after a full restart.");
    return 1;
  }
  const { root, kept } = game.install(slots);
  if (kept) {
    console.log(`Kept the installed Seer ${kept}: it is newer than the one in wow-seer ${VERSION}.`);
    console.log(`Installed ${slots} request slots in ${root}`);
  } else {
    console.log(`Installed Seer and ${slots} request slots in ${root}`);
  }
  console.log("Next: start the game, then add the MCP server to your AI client, for example:");
  console.log("  claude mcp add wow-seer -- npx -y wow-seer serve");
  return 0;
}

function remove(): number {
  if (game.gameRunning()) {
    console.log("WoW is running. Close it first.");
    return 1;
  }
  console.log(`Removed Seer and its slots from ${game.remove()}`);
  return 0;
}

async function serve(): Promise<number> {
  const state = new State();
  try {
    game.wowDir();
  } catch (e) {
    process.stderr.write(`wow-seer: ${(e as Error).message}\n`);
  }
  const stop = startBackground(state);
  await new McpServer(state, (line) => process.stdout.write(line)).run();
  stop();
  return 0;
}

function watch(dump: string | undefined): Promise<number> {
  const state = new State();
  state.on("message", (msg: any) => {
    const sizes = Object.entries(msg.sections || {})
      .map(([k, v]) => `${k} ${Buffer.byteLength(JSON.stringify(v))} B`)
      .join(", ");
    const time = new Date().toTimeString().slice(0, 8);
    console.log(`${time} message ${msg.msg}: ${sizes || "no sections"}${msg.acks?.length ? ` acks ${msg.acks}` : ""}`);
    if (dump) fs.writeFileSync(dump, JSON.stringify(state.sections, null, 1));
  });
  startBackground(state);
  console.log("Watching; Seer sends once it sees this server (within about 60 s). Ctrl+C to stop.");
  return new Promise(() => {});
}

function decodeFiles(files: string[], chars: number): number {
  for (const file of files) {
    try {
      const { header, payload } = decode(fs.readFileSync(file));
      const [sx, sy] = header.scale || [1, 1];
      console.log(`${file}: message ${header.msg} part ${header.part}/${header.parts}, ${payload.length} bytes, ` +
        `cell ${header.cell}, scale ${sx.toFixed(3)} x ${sy.toFixed(3)}`);
      if (header.parts === 1) console.log(JSON.stringify(JSON.parse(payload.toString("utf8")), null, 1).slice(0, chars));
    } catch (e) {
      if (e instanceof NotSeer) console.log(`${file}: no Seer strip`);
      else if (e instanceof BadFrame) console.log(`${file}: bad frame: ${e.message}`);
      else throw e;
    }
  }
  return 0;
}

function status(): number {
  console.log(`wow-seer ${VERSION}`);
  try {
    console.log(`game folder: ${game.wowDir()}`);
    console.log(`addon installed: ${fs.existsSync(`${game.addonsDir()}/Seer`)}`);
    console.log(`request slots: ${game.slotDirs().length}`);
    const { sections } = game.savedState();
    console.log(`saved sections: ${Object.keys(sections).sort().join(", ") || "none"}`);
  } catch (e) {
    console.log((e as Error).message);
    return 1;
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      slots: { type: "string" },
      dump: { type: "string" },
      chars: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [cmd, ...rest] = positionals;
  switch (values.help ? undefined : cmd) {
    case "install":
      return install(values.slots ? Number(values.slots) : game.DEFAULT_SLOTS);
    case "remove":
      return remove();
    case "serve":
      return serve();
    case "status":
      return status();
    case "watch":
      return watch(values.dump);
    case "decode":
      return decodeFiles(rest, values.chars ? Number(values.chars) : 2000);
    default:
      console.log(USAGE);
      return cmd && !values.help ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`wow-seer: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
