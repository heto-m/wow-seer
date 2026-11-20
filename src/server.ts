import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { type Capturer, loadCapturer } from "./capture.js";
import { Assembler, BadFrame, decode, type Header, NotSeer, Raw } from "./frame.js";
import * as game from "./game.js";
import { LeaderLock, readJson, sharedDir, writeJson } from "./shared.js";
import { compareVersions, VERSION, versionWarning } from "./version.js";

const SCAN_EVERY = 300;
const YIELD_COOLDOWN = 10_000;
const DEFLATED = 0x5a;

export function messageText(buf: Buffer): string {
  return (buf[0] === DEFLATED ? zlib.inflateRawSync(buf.subarray(1)) : buf).toString("utf8");
}

const SYNC_EVERY = 500;
const HEARTBEAT_EVERY = 30;
const FAILS_BEFORE_BIGGER_CELLS = 2;
const CAPTURE_EVERY = 250;
const CAPTURE_MISSES = 3;
const CAPTURE_RETRY = 10 * 60_000;
const RECENT_FRAMES = 64;
const SHARED_KEYS = ["sections", "pending", "acked", "addon", "meta", "cell", "got"] as const;

export interface Section {
  data: any;
  game_time: number;
  received: number;
}

export function now(): number {
  return Date.now() / 1000;
}

export function log(...args: unknown[]): void {
  process.stderr.write(["wow-seer:", ...args.map(String)].join(" ") + "\n");
}

export class State extends EventEmitter {
  sections: Record<string, Section> = {};
  meta = {
    frames: 0, bad_frames: 0, last_frame: null as number | null, last_error: null as string | null,
    capture: null as string | null,
  };
  addon: any = {};
  pending: any[] = [];
  acked: number[] = [];
  // Forever's Lua integers are 32-bit; larger ids raise "integer overflow".
  nextId = (Math.floor(now()) % 10_000_000) * 100 + (process.pid % 10);
  assembler = new Assembler();
  seen = new Set<string>();
  recentFrames = new Set<string>();
  undeleted = new Set<string>();
  cell = 1;
  got: number[] = [];
  role: "leader" | "follower" | null = null;
  folder: string | null = null;
  version = 0;
  warned = new Set<string>();

  changed(): void {
    this.version += 1;
    this.emit("change");
  }

  request(kind: string, fields: Record<string, unknown> = {}): number {
    this.nextId += 10;
    const req = { ...fields, id: this.nextId, kind };
    if (this.role === "follower" && this.folder) {
      writeJson(path.join(this.folder, "requests", `${req.id}.json`), req);
    } else {
      this.pending.push(req);
    }
    this.changed();
    return req.id;
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of SHARED_KEYS) out[k] = this[k];
    return out;
  }

  load(data: any): void {
    for (const k of SHARED_KEYS) if (k in data) (this as any)[k] = data[k];
    this.emit("change");
  }

  apply(msg: any): void {
    const t = now();
    this.meta.last_error = null;
    const sent = msg.t || t;
    for (const [name, data] of Object.entries(msg.sections || {})) {
      const old = this.sections[name];
      if (old && old.game_time > sent) continue;
      this.sections[name] = { data, game_time: sent, received: t };
    }
    if (msg.msg !== undefined && msg.msg !== null) this.got = [...this.got, msg.msg].slice(-20);
    const acks = new Set<number>(msg.acks || []);
    this.pending = this.pending.filter((r) => !acks.has(r.id));
    this.acked = [...this.acked, ...[...acks].sort((a, b) => a - b)].slice(-200);
    this.addon = {
      slot: msg.slot, slots: msg.slots, build: msg.build, version: msg.version, last_message: t,
      capture: msg.capture === true,
    };
    const warning = versionWarning(msg.version);
    if (warning && !this.warned.has(warning)) {
      this.warned.add(warning);
      log(warning);
    }
    const update = `update ${msg.version}`;
    if (typeof msg.version === "string" && compareVersions(VERSION, msg.version) === 1 && !this.warned.has(update)) {
      this.warned.add(update);
      this.request("update", { version: VERSION });
    }
    this.changed();
    this.emit("message", msg);
  }

  answered(id: number): boolean {
    return this.acked.includes(id);
  }

  wait(predicate: () => boolean, timeoutSeconds: number): Promise<boolean> {
    if (predicate()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = () => {
        if (!predicate()) return;
        done(true);
      };
      const timer = setTimeout(() => done(false), timeoutSeconds * 1000);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        this.off("change", check);
        resolve(ok);
      };
      this.on("change", check);
    });
  }
}

export function processFile(state: State, file: string): boolean | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return null;
  }
  let header, payload;
  try {
    ({ header, payload } = decode(bytes));
  } catch (e) {
    if (e instanceof NotSeer) return false;
    if (!(e instanceof Error)) throw e;
    state.meta.bad_frames += 1;
    state.meta.last_error = `${path.basename(file)}: ${(e as Error).message}`;
    log("bad frame", state.meta.last_error);
    if (state.meta.bad_frames >= FAILS_BEFORE_BIGGER_CELLS && state.cell < 4) {
      state.cell += 1;
      state.meta.bad_frames = 0;
      state.request("config", { cell: state.cell });
    }
    discard(state, file);
    return true;
  }
  discard(state, file);
  accept(state, header, payload, "screenshot");
  return true;
}

// The addon holds a strip up long enough for several captures, so the same frame arrives more than once.
function accept(state: State, header: Header, payload: Buffer, via: "screenshot" | "capture"): void {
  const key = `${header.msg}/${header.part}/${header.parts}/${header.adler}`;
  if (state.recentFrames.has(key)) return;
  state.recentFrames.add(key);
  if (state.recentFrames.size > RECENT_FRAMES) state.recentFrames.delete(state.recentFrames.values().next().value as string);
  state.meta.frames += 1;
  state.meta.last_frame = now();
  const text = state.assembler.add(header, payload);
  if (text !== null) {
    let msg;
    try {
      msg = JSON.parse(messageText(text));
    } catch (e) {
      state.meta.last_error = `message ${header.msg}: ${(e as Error).message}`;
      log("bad message", state.meta.last_error);
    }
    if (msg) {
      state.apply(msg);
      state.emit("received", msg, via);
    }
  }
  state.changed();
}

export function processImage(state: State, img: Raw): boolean {
  let header, payload;
  try {
    ({ header, payload } = decode(img));
  } catch (e) {
    if (e instanceof NotSeer) return false;
    if (!(e instanceof BadFrame)) throw e;
    log("captured a broken strip:", e.message);
    return false;
  }
  if (process.env.WOW_SEER_DEBUG) log(`captured msg ${header.msg} part ${header.part}/${header.parts}`);
  accept(state, header, payload, "capture");
  return true;
}

// Reading the strip from the game window spares the game the Screenshot() freeze; the addon falls back to
// Screenshot() when the server says it can't, and the server stops asking when captures keep missing.
export function startCapture(state: State, load: () => Promise<Capturer | string> = loadCapturer): () => void {
  let cap: Capturer | null = null;
  let stopped = false, busy = false, misses = 0, offAt = -Infinity;
  let loaded: Capturer | null = null;
  const tell = (on: boolean) => {
    if (state.pending.some((r) => r.kind === "capture" && r.on === on)) return;
    state.pending = state.pending.filter((r) => r.kind !== "capture");
    state.request("capture", { on });
  };
  const setCapture = (c: Capturer | null, why: string) => {
    cap = c;
    state.meta.capture = why;
    log("capture:", why);
    tell(c !== null);
  };
  const onReceived = (msg: any, via: string) => {
    if (typeof msg.capture !== "boolean") return;
    if (process.env.WOW_SEER_DEBUG) log(`msg ${msg.msg} by ${via}`);
    if (via === "capture") misses = 0;
    if (cap && via === "screenshot" && msg.capture === true && ++misses >= CAPTURE_MISSES) {
      offAt = Date.now();
      setCapture(null, "off: the game window did not show the strip, so the addon fell back to screenshots");
      return;
    }
    if (!cap && loaded && Date.now() - offAt > CAPTURE_RETRY) {
      misses = 0;
      setCapture(loaded, "on");
      return;
    }
    if ((msg.capture === true) !== (cap !== null)) tell(cap !== null);
  };
  state.on("received", onReceived);
  void load().then((c) => {
    if (stopped) return;
    if (typeof c === "string") {
      setCapture(null, `off: ${c}`);
    } else {
      loaded = c;
      setCapture(c, "on");
    }
  });
  const timer = setInterval(async () => {
    if (!cap || busy || stopped) return;
    busy = true;
    try {
      const img = await cap.grab();
      if (img && !stopped) processImage(state, img);
    } catch (e) {
      log("capture failed:", (e as Error).message);
    } finally {
      busy = false;
    }
  }, CAPTURE_EVERY);
  return () => {
    stopped = true;
    clearInterval(timer);
    state.off("received", onReceived);
  };
}

function remove(file: string): boolean {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

// On Windows the game may still hold a screenshot open, so unlink fails until it lets go.
function discard(state: State, file: string): void {
  if (!remove(file)) state.undeleted.add(file);
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function startWatch(state: State): () => void {
  const sizes = new Map<string, number>();
  const timer = setInterval(() => {
    let folder: string;
    let names: string[];
    try {
      folder = game.screenshotsDir();
      names = fs.readdirSync(folder);
    } catch {
      return;
    }
    for (const file of state.undeleted) if (remove(file)) state.undeleted.delete(file);
    names.sort((a, b) => mtime(path.join(folder, a)) - mtime(path.join(folder, b)));
    for (const name of names) {
      if (state.seen.has(name) || !name.toLowerCase().endsWith(".png")) continue;
      const file = path.join(folder, name);
      let size: number;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      if (sizes.get(name) !== size || size === 0) {
        sizes.set(name, size);
        continue;
      }
      sizes.delete(name);
      if (processFile(state, file) !== null) state.seen.add(name);
    }
  }, SCAN_EVERY);
  return () => clearInterval(timer);
}

function startHeartbeat(state: State): () => void {
  let lastWritten = 0;
  let lastKey: string | null = null;
  let slots = 0;
  let queued = false;
  const beat = () => {
    queued = false;
    if (!slots) {
      try {
        slots = game.slotDirs().length;
      } catch {
        slots = 0;
      }
    }
    const key = JSON.stringify([state.pending, state.got]);
    if (now() - lastWritten < HEARTBEAT_EVERY && key === lastKey) return;
    try {
      // All slots, not just from the addon's last index: /reload starts it at slot 1 again.
      game.writeSlots(1, slots, { t: Math.floor(now()), reqs: state.pending, got: state.got });
      lastWritten = now();
      lastKey = key;
    } catch (e) {
      log("cannot write slots:", (e as Error).message);
    }
  };
  const onChange = () => {
    if (!queued) {
      queued = true;
      setImmediate(beat);
    }
  };
  state.on("change", onChange);
  const timer = setInterval(beat, 2000);
  beat();
  return () => {
    clearInterval(timer);
    state.off("change", onChange);
  };
}

function takeRequests(state: State, folder: string): boolean {
  let changed = false;
  const dir = path.join(folder, "requests");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  for (const name of names) {
    const file = path.join(dir, name);
    const req = readJson(file);
    remove(file);
    if (req && typeof req === "object" && Number.isInteger(req.id) && state.pending.every((r) => r.id !== req.id)) {
      state.pending.push(req);
      changed = true;
    }
  }
  return changed;
}

export function startBackground(state: State): () => void {
  const folder = sharedDir();
  state.folder = folder;
  const stateFile = path.join(folder, "state.json");
  const lock = new LeaderLock(folder, VERSION);
  const stops: Array<() => void> = [];
  let askedToYield = false;
  let yieldedAt = -Infinity;
  lock.onYield = () => {
    for (const stop of stops.splice(0)) stop();
    state.role = "follower";
    yieldedAt = Date.now();
    seenMtime = null;
    state.emit("change");
    log("a newer wow-seer server took over reading screenshots");
  };
  let published = -1;
  let seenMtime: number | null = null;
  let busy = false;
  let stopped = false;

  const takeLead = async () => {
    if (await lock.acquire()) return true;
    if (askedToYield) return false;
    askedToYield = true;
    return (await lock.askToYield()) && (await waitForLock());
  };
  const waitForLock = async () => {
    for (let i = 0; i < 10; i++) {
      if (await lock.acquire()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (state.role !== "leader" && Date.now() - yieldedAt > YIELD_COOLDOWN && (await takeLead())) {
        if (stopped) return;
        const previous = readJson(stateFile);
        if (previous) state.load(previous);
        state.role = "leader";
        state.emit("change");
        log("leading: reading screenshots");
        stops.push(startWatch(state), startHeartbeat(state), startCapture(state));
      } else if (state.role === null) {
        state.role = "follower";
        state.emit("change");
        log("following the wow-seer server that is already running");
      }
      if (state.role === "leader") {
        if (takeRequests(state, folder)) state.changed();
        if (state.version !== published) {
          writeJson(stateFile, state.snapshot());
          published = state.version;
        }
      } else {
        const m = mtime(stateFile);
        if (m !== seenMtime) {
          seenMtime = m;
          const data = readJson(stateFile);
          if (data) state.load(data);
        }
      }
    } catch (e) {
      log("sync failed:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, SYNC_EVERY);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const stop of stops) stop();
    lock.release();
  };
}
