import fs from "node:fs";
import path from "node:path";

import { addonsDir } from "./game.js";

export interface LootItem {
  id: number;
  note: string | null;
}

export interface Boss {
  name: string;
  npcs: number[];
  items: LootItem[];
}

export interface Instance {
  key: string;
  name: string;
  levels: number[] | null;
  bosses: Boss[];
}

export interface LootData {
  instances: Instance[];
  dropRates: Map<number, Map<number, number>>;
}

const DATA_DIR = "AtlasLootClassic_DungeonsAndRaids";
const DATA_FILES = ["data.lua"];

const INSTANCE = /^data\["([^"]+)"\]\s*=\s*\{/;
const NAME = /^\s*name\s*=\s*(?:AL\["([^"]+)"\]|"([^"]+)")/;
const NPC = /^\s*npcID\s*=\s*(?:(\d+)|\{([\d,\s]+)\})/;
const LEVELS = /^\s*LevelRange\s*=\s*(?:GetForVersion\(\s*)?\{\s*([\d,\s]+)\}/;
const ITEMS = /^\s*items\s*=\s*\{/;
const ITEM = /^\s*\{\s*\d+\s*,\s*(\d+)\s*\}\s*,?\s*(?:--\s*(.*))?$/;

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function numbers(text: string): number[] {
  return text.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

export function parseLoot(text: string, into: Instance[] = []): Instance[] {
  let inst: Instance | null = null;
  let inItems = false;
  let boss: Boss | null = null;
  for (const line of text.split(/\r?\n/)) {
    const start = INSTANCE.exec(line);
    if (start) {
      inst = { key: start[1], name: humanize(start[1]), levels: null, bosses: [] };
      into.push(inst);
      inItems = false;
      boss = null;
      continue;
    }
    if (!inst) continue;
    if (!inItems) {
      const n = NAME.exec(line);
      if (n && n[2]) inst.name = n[2];
      const lv = LEVELS.exec(line);
      if (lv) inst.levels = numbers(lv[1]);
      if (ITEMS.test(line)) inItems = true;
      continue;
    }
    const n = NAME.exec(line);
    if (n) {
      boss = { name: n[1] ?? n[2], npcs: [], items: [] };
      inst.bosses.push(boss);
      continue;
    }
    if (!boss) continue;
    const npc = NPC.exec(line);
    if (npc) {
      boss.npcs = npc[1] ? [Number(npc[1])] : numbers(npc[2]);
      continue;
    }
    const item = ITEM.exec(line);
    if (item) boss.items.push({ id: Number(item[1]), note: item[2]?.replace(/^\{FOREVER\}\s*/, "").trim() || null });
  }
  return into;
}

export function parseDropRates(text: string): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  let npc: Map<number, number> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const open = /^\s*\[(\d+)\]\s*=\s*\{/.exec(line);
    if (open) {
      npc = new Map();
      out.set(Number(open[1]), npc);
      continue;
    }
    const rate = /^\s*\[(\d+)\]\s*=\s*([\d.]+)/.exec(line);
    if (rate && npc) npc.set(Number(rate[1]), Number(rate[2]));
  }
  return out;
}

let cache: { stamp: string; data: LootData | null } | null = null;

export function loadLoot(dir: string = path.join(addonsDir(), DATA_DIR)): LootData | null {
  const files = DATA_FILES.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (!files.length) return null;
  const rates = path.join(dir, "droprate.lua");
  const stamp = [...files, rates].map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)).join(",");
  if (cache && cache.stamp === stamp) return cache.data;
  const instances: Instance[] = [];
  for (const f of files) parseLoot(fs.readFileSync(f, "utf8"), instances);
  const dropRates = fs.existsSync(rates) ? parseDropRates(fs.readFileSync(rates, "utf8")) : new Map();
  const data = { instances: instances.filter((i) => i.bosses.length), dropRates };
  cache = { stamp, data };
  return data;
}

export function dropRate(data: LootData, boss: Boss, itemId: number): number | null {
  for (const npc of boss.npcs) {
    const rate = data.dropRates.get(npc)?.get(itemId);
    if (rate !== undefined) return rate;
  }
  return null;
}
