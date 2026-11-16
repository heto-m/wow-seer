import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ADDON_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Seer");
export const DEFAULT_SLOTS = 1000;
export const SECTIONS = ["player", "equipment", "bags", "bank", "quests", "talents", "skills",
  "trainer", "profession", "merchant", "auction", "items"];
const SLOT_RE = /^Seer_S\d{4}$/;
const DEFAULT_DIRS: Record<string, string[]> = {
  linux: [
    "~/Faugus/battle-net/drive_c/Program Files (x86)/World of Warcraft/_forever_",
    "~/Games/battlenet/drive_c/Program Files (x86)/World of Warcraft/_forever_",
    "~/.wine/drive_c/Program Files (x86)/World of Warcraft/_forever_",
  ],
  darwin: ["/Applications/World of Warcraft/_forever_"],
  win32: ["C:\\Program Files (x86)\\World of Warcraft\\_forever_"],
};

export class GameError extends Error {}

export function slotName(n: number): string {
  return "Seer_S" + String(n).padStart(4, "0");
}

function expandUser(p: string): string {
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function wowDir(): string {
  const env = process.env.WOW_DIR;
  const candidates = env ? [env] : DEFAULT_DIRS[process.platform] ?? [];
  for (const candidate of candidates) {
    const p = expandUser(candidate);
    if (isDir(path.join(p, "Interface"))) return p;
  }
  throw new GameError("WoW: Forever folder not found. Set WOW_DIR to the _forever_ folder.");
}

export function addonsDir(): string {
  return path.join(wowDir(), "Interface", "AddOns");
}

export function screenshotsDir(): string {
  return path.join(wowDir(), "Screenshots");
}

export function gameRunning(): boolean {
  if (process.platform === "win32") return false;
  const pattern = process.platform === "darwin" ? "^World of Warcraft$" : "^wow.exe$";
  const r = spawnSync("pgrep", ["-i", pattern], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

export function writeAtomic(file: string, text: string): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

export function slotDirs(): string[] {
  const root = addonsDir();
  return fs.readdirSync(root).filter((d) => SLOT_RE.test(d) && isDir(path.join(root, d))).sort();
}

export function install(slots = DEFAULT_SLOTS): string {
  const root = addonsDir();
  const dest = path.join(root, "Seer");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(ADDON_SRC, dest, { recursive: true });
  for (const name of slotDirs()) {
    if (Number(name.slice(6)) > slots) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  for (let n = 1; n <= slots; n++) {
    const folder = path.join(root, slotName(n));
    fs.mkdirSync(folder, { recursive: true });
    const toc = `## Interface: 16001\n## Title: Seer slot ${String(n).padStart(4, "0")}\n## Notes: Request slot for Seer.\n`
      + "## Group: Seer\n## LoadOnDemand: 1\n\nbody.lua\n";
    writeAtomic(path.join(folder, slotName(n) + ".toc"), toc);
    const body = path.join(folder, "body.lua");
    if (!fs.existsSync(body)) writeAtomic(body, "SeerInbox = nil\n");
  }
  return root;
}

export function remove(): string {
  const root = addonsDir();
  for (const name of ["Seer", ...slotDirs()]) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  return root;
}

function pyFloat(v: number): string {
  const [mantissa, expPart] = v.toExponential().split("e");
  const exp = Number(expPart);
  const neg = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  let s: string;
  if (exp >= -4 && exp < 16) {
    if (exp < 0) {
      s = "0." + "0".repeat(-exp - 1) + digits;
    } else if (digits.length > exp + 1) {
      s = digits.slice(0, exp + 1) + "." + digits.slice(exp + 1);
    } else {
      s = digits + "0".repeat(exp + 1 - digits.length) + ".0";
    }
  } else {
    const m = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    s = m + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }
  return (neg ? "-" : "") + s;
}

const PLAIN = /^[A-Za-z0-9 _\-.:]$/;

export function luaValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === "string") {
    let out = '"';
    for (const b of Buffer.from(v, "utf8")) {
      const c = String.fromCharCode(b);
      out += b < 128 && PLAIN.test(c) ? c : "\\" + String(b).padStart(3, "0");
    }
    return out + '"';
  }
  if (Array.isArray(v)) return "{" + v.map(luaValue).join(",") + "}";
  if (v !== null && typeof v === "object") {
    return "{" + Object.entries(v).map(([k, x]) => `[${luaValue(k)}]=${luaValue(x)}`).join(",") + "}";
  }
  return "nil";
}

export function writeSlots(first: number, last: number, inbox: unknown): void {
  const root = addonsDir();
  const body = `SeerInbox = ${luaValue(inbox)}\n`;
  for (let n = Math.max(1, first); n <= last; n++) {
    const folder = path.join(root, slotName(n));
    if (isDir(folder)) writeAtomic(path.join(folder, "body.lua"), body);
  }
}

const LUA_ESCAPES: Record<string, string> = {
  n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n",
};

function luaUnescape(s: string): string {
  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c !== 92) {
      out.push(c);
      i++;
      continue;
    }
    const next = s.charAt(i + 1);
    if (next >= "0" && next <= "9") {
      let j = i + 1;
      while (j < s.length && j < i + 4 && s[j] >= "0" && s[j] <= "9") j++;
      out.push(Number(s.slice(i + 1, j)) & 255);
      i = j;
    } else {
      const rep = LUA_ESCAPES[next] ?? next;
      for (let k = 0; k < rep.length; k++) out.push(rep.charCodeAt(k) & 255);
      i += 2;
    }
  }
  return Buffer.from(out).toString("utf8");
}

export function savedState(): { sections: Record<string, any>; savedAt: number | null } {
  const accounts = path.join(wowDir(), "WTF", "Account");
  let names: string[] = [];
  try {
    names = fs.readdirSync(accounts).filter((n) => !n.startsWith("."));
  } catch {
    names = [];
  }
  const files = names.map((n) => path.join(accounts, n, "SavedVariables", "Seer.lua")).filter((f) => fs.existsSync(f));
  if (files.length === 0) return { sections: {}, savedAt: null };
  const mtime = (f: string) => fs.statSync(f).mtimeMs / 1000;
  const file = files.reduce((a, b) => (mtime(b) > mtime(a) ? b : a));
  const text = fs.readFileSync(file).toString("latin1");
  const sections: Record<string, any> = {};
  for (const m of text.matchAll(/\["(\w+)"\]\s*=\s*"((?:[^"\\]|\\.)*)"/gs)) {
    if (!SECTIONS.includes(m[1])) continue;
    try {
      sections[m[1]] = JSON.parse(luaUnescape(m[2]));
    } catch {}
  }
  const at = /\["savedAt"\]\s*=\s*(\d+)/.exec(text);
  return { sections, savedAt: at ? Number(at[1]) : mtime(file) };
}
