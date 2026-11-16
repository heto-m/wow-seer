export const SOULBOUND = new Set(["Soulbound", "Ligado", "Lié", "Seelengebunden", "Vincolato", "Vinculado"]);
const SET_HEADER = /^(.+) \((\p{Nd}+\/\p{Nd}+)\)$/u;
const DURABILITY = /^\P{Nd}+ (\p{Nd}+) \/ (\p{Nd}+)$/u;
const SIMPLE_STAT = /^\+?(-?\p{Nd}+) ([^\p{Nd}\t:]+)$/u;
const PLURAL = /\|4([^:;]*):([^;]*);/g;

export const LOC_SLOTS: Record<string, string[]> = {
  INVTYPE_HEAD: ["head"], INVTYPE_NECK: ["neck"], INVTYPE_SHOULDER: ["shoulder"],
  INVTYPE_BODY: ["shirt"], INVTYPE_CHEST: ["chest"], INVTYPE_ROBE: ["chest"],
  INVTYPE_WAIST: ["waist"], INVTYPE_LEGS: ["legs"], INVTYPE_FEET: ["feet"], INVTYPE_WRIST: ["wrist"],
  INVTYPE_HAND: ["hands"], INVTYPE_FINGER: ["finger1", "finger2"],
  INVTYPE_TRINKET: ["trinket1", "trinket2"], INVTYPE_CLOAK: ["back"],
  INVTYPE_WEAPON: ["mainhand", "offhand"], INVTYPE_2HWEAPON: ["mainhand", "offhand"],
  INVTYPE_WEAPONMAINHAND: ["mainhand"], INVTYPE_WEAPONOFFHAND: ["offhand"],
  INVTYPE_SHIELD: ["offhand"], INVTYPE_HOLDABLE: ["offhand"], INVTYPE_RANGED: ["ranged"],
  INVTYPE_RANGEDRIGHT: ["ranged"], INVTYPE_THROWN: ["ranged"], INVTYPE_RELIC: ["ranged"],
  INVTYPE_TABARD: ["tabard"],
};
export const SLOTS = ["head", "neck", "shoulder", "shirt", "chest", "waist", "legs", "feet", "wrist", "hands",
  "finger1", "finger2", "trinket1", "trinket2", "back", "mainhand", "offhand", "ranged", "tabard"];

function truthy(v: any): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function or(v: any, fallback: any): any {
  return truthy(v) ? v : fallback;
}

function get(obj: any, key: string): any {
  const v = obj == null ? undefined : obj[key];
  return v === undefined ? null : v;
}

function pyStr(v: any): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

function lookup(map: Record<string, any>, key: any): any {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function pyRound1(x: number): number {
  const t = x * 10;
  if (Number.isInteger(x * 20) && Math.abs(t - Math.trunc(t)) === 0.5) {
    const lo = Math.floor(t);
    return (lo % 2 === 0 ? lo : lo + 1) / 10;
  }
  return Number(x.toFixed(1));
}

function digitValue(ch: string): number {
  let cp = ch.codePointAt(0)!;
  let start = cp;
  while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

export function fold(text: any): string {
  return pyStr(text).toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

export function matches(query: any, ...texts: any[]): boolean {
  const q = fold(query);
  return texts.some((t) => truthy(t) && fold(t).includes(q));
}

export function table(items: any[], cols: string[]): { cols: string[]; rows: any[][] } {
  const used = cols.filter((c) => items.some((i) => {
    const v = get(i, c);
    return v !== null && v !== false && v !== "";
  }));
  return { cols: used, rows: items.map((i) => used.map((c) => get(i, c))) };
}

export function tidyTooltip(lines: any, name: any = null): { lines: string[]; setInfo: any; durability: string | null } {
  let all: string[] = (or(lines, []) as string[]).map((l) => l.replace(PLURAL, "$2"));
  if (all.length && all[0] === name) all = all.slice(1);
  const out: string[] = [];
  let setInfo: any = null;
  let durability: string | null = null;
  let i = 0;
  while (i < all.length) {
    const line = all[i];
    const header = SET_HEADER.exec(line);
    if (header && i + 1 < all.length && all[i + 1].startsWith("  ")) {
      const pieces: string[] = [];
      const bonuses: string[] = [];
      i += 1;
      while (i < all.length && all[i].startsWith("  ")) {
        pieces.push(all[i].trim());
        i += 1;
      }
      while (i < all.length && !all[i].trim()) i += 1;
      while (i < all.length && all[i].trim() && !DURABILITY.test(all[i])) {
        bonuses.push(all[i]);
        i += 1;
      }
      setInfo = { name: header[1], have: header[2], pieces, bonuses };
      continue;
    }
    i += 1;
    const dur = DURABILITY.exec(line);
    if (dur) {
      if (Number(dur[1]) < Number(dur[2])) durability = `${dur[1]}/${dur[2]}`;
      continue;
    }
    if (line.trim() && !SOULBOUND.has(line)) out.push(line);
  }
  return { lines: out, setInfo, durability };
}

export function itemView(item: any, keys: string[] = ["slot", "id", "name", "quality"],
  sets: Record<string, any> | null = null, tooltip = true): any {
  const out: any = {};
  for (const k of keys) if (get(item, k) !== null) out[k] = item[k];
  const { lines, setInfo, durability } = tidyTooltip(get(item, "tooltip"), get(item, "name"));
  if (tooltip) out.tooltip = lines;
  if (durability) out.durability = durability;
  if (setInfo) {
    if (sets === null || sets === undefined) {
      out.set = setInfo;
    } else {
      out.set = setInfo.name;
      if (!Object.prototype.hasOwnProperty.call(sets, setInfo.name)) {
        const { name: _name, ...rest } = setInfo;
        sets[setInfo.name] = rest;
      }
    }
  }
  return out;
}

const DPS = /^\((\p{Nd}+(?:[.,]\p{Nd}+)?) [^()]+\)$/u;
const SPELL_POWER: Array<[RegExp, (m: RegExpExecArray) => Record<string, number>]> = [
  [/hasta (\d+) p\. el daño infligido y la sanación realizada/, (m) => ({ "spell damage": +m[1], healing: +m[1] })],
  [/hasta (\d+) p\. la sanación realizada/, (m) => ({ healing: +m[1] })],
  [/hasta (\d+) p\. el daño infligido con hechizos y efectos de (\p{L}+)/u, (m) => ({ [`spell damage (${m[2]})`]: +m[1] })],
  [/hasta (\d+) p\. el daño infligido con (?:todos los )?hechizos y efectos(?! de)/, (m) => ({ "spell damage": +m[1] })],
  [/damage and healing done by magical spells and effects by up to (\d+)/i, (m) => ({ "spell damage": +m[1], healing: +m[1] })],
  [/healing done by (?:spells and effects by )?up to (\d+)/i, (m) => ({ healing: +m[1] })],
  [/damage done by up to (\d+) for all magical/i, (m) => ({ "spell damage": +m[1] })],
  [/damage done by (\p{L}+) spells and effects by up to (\d+)/iu, (m) => ({ [`spell damage (${m[1]})`]: +m[2] })],
];

export function simpleStats(lines: string[]): Record<string, number> {
  const stats: Record<string, number> = {};
  const add = (key: string, n: number) => (stats[key] = (stats[key] ?? 0) + n);
  for (const raw of lines) {
    const line = raw.trim();
    const m = SIMPLE_STAT.exec(line);
    if (m) add(m[2].trim(), parseInt(m[1], 10));
    const dps = DPS.exec(line);
    if (dps) add("dps", parseFloat(dps[1].replace(",", ".")));
    for (const [re, read] of SPELL_POWER) {
      const sp = re.exec(line);
      if (sp) for (const [k, n] of Object.entries(read(sp))) add(k, n);
    }
  }
  return stats;
}

function statsText(lines: any): string | null {
  if (!Array.isArray(lines)) return null;
  const parts = Object.entries(simpleStats(lines))
    .filter(([k]) => k !== "dps")
    .map(([k, n]) => `${n > 0 ? "+" : ""}${n} ${k}`);
  return parts.length ? parts.join(", ") : null;
}

export function statDiff(newLines: string[], oldLines: string[]): Record<string, number> {
  const a = simpleStats(newLines);
  const b = simpleStats(oldLines);
  const out: Record<string, number> = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const d = Math.round(((a[k] ?? 0) - (b[k] ?? 0)) * 10) / 10;
    if (d !== 0) out[k] = d;
  }
  return out;
}

export function player(p: any): any {
  if (!truthy(p)) return null;
  const out: any = {
    name: get(p, "name"), realm: get(p, "realm"), level: get(p, "level"),
    class: `${pyStr(get(p, "classLocal"))} (${pyStr(get(p, "class"))})`,
    race: `${pyStr(get(p, "raceLocal"))} (${pyStr(get(p, "race"))})`, money: get(p, "money"),
    zone: [get(p, "zone"), get(p, "subzone")].filter(truthy).join(" - "),
    health: get(p, "healthMax"), armor: get(p, "armor"),
  };
  if (truthy(get(p, "xpMax"))) out.xp = `${pyStr(get(p, "xp"))}/${pyStr(get(p, "xpMax"))}`;
  if (truthy(get(p, "restedXp"))) out.rested_xp = p.restedXp;
  if (truthy(get(p, "powerType"))) out[pyStr(p.powerType).toLowerCase()] = get(p, "powerMax");
  const stats: any = {};
  for (const [k, v] of Object.entries(or(get(p, "stats"), {}))) {
    if (v !== null && v !== undefined) stats[k] = typeof v === "number" && !Number.isInteger(v) ? pyRound1(v) : v;
  }
  out.stats = stats;
  const clean: any = {};
  for (const [k, v] of Object.entries(out)) if (v !== null && v !== undefined) clean[k] = v;
  return clean;
}

export function equipment(items: any, slots: string[] | null = null, detail = "full"): any {
  const list = (or(items, []) as any[]).filter((i) => !truthy(slots) || slots!.includes(get(i, "slot")));
  if (detail === "summary") {
    const rows = list.map((i) => itemView(i, undefined, null, false));
    for (const r of rows) delete r.set;
    return table(rows, ["slot", "id", "name", "quality", "durability"]);
  }
  const sets: Record<string, any> = {};
  const out: any = { items: list.map((i) => itemView(i, undefined, sets)) };
  if (truthy(sets)) out.sets = sets;
  return out;
}

function talentLine(n: any): string {
  return `${pyStr(get(n, "name"))} ${pyStr(or(get(n, "rank"), 0))}/${pyStr(get(n, "max"))}`;
}

export function talents(t: any, everything = false): any {
  if (!truthy(t)) return null;
  const out: any = {};
  for (const k of ["spec", "unspent"]) if (get(t, k) !== null) out[k] = t[k];
  if ("talents" in t) {
    const nodes = [...t.talents].sort((a, b) =>
      (or(get(a, "y"), 0) - or(get(b, "y"), 0)) || (or(get(a, "x"), 0) - or(get(b, "x"), 0)));
    out.spent = nodes.reduce((s, n) => s + or(get(n, "rank"), 0), 0);
    out[everything ? "talents" : "taken"] = nodes
      .filter((n) => everything || or(get(n, "rank"), 0) > 0).map(talentLine);
    return out;
  }
  out.tabs = [];
  for (const tab of or(get(t, "tabs"), [])) {
    const names = (or(get(tab, "info"), []) as any[]).filter((n) => typeof n === "string");
    const taken = (or(get(tab, "talents"), []) as any[])
      .filter((n) => everything || or(get(n, "rank"), 0) > 0).map(talentLine);
    out.tabs.push({ name: names.length ? names[0] : null, talents: taken });
  }
  return out;
}

export function skills(s: any): string[] | null {
  if (s === null || s === undefined) return null;
  return (s as any[]).map((k) => `${pyStr(get(k, "name"))} ${pyStr(get(k, "rank"))}/${pyStr(get(k, "max"))}` +
    (truthy(get(k, "bonus")) ? ` (+${pyStr(k.bonus)})` : ""));
}

function bagItems(sections: any, where: string): any[] {
  const out: any[] = [];
  const names = where === "bags" ? ["bags"] : where === "bank" ? ["bank"] : ["bags", "bank"];
  for (const name of names) {
    for (const bag of or(get(sections, name), [])) {
      for (const it of or(get(bag, "items"), [])) out.push({ ...it, bag: get(bag, "bag"), where: name });
    }
  }
  return out;
}

export function bags(sections: any, where = "bags", name: string | null = null, equippableOnly = false,
  detail = "summary"): any {
  let items = bagItems(sections, where);
  if (truthy(name)) items = items.filter((i) => matches(name, get(i, "name")));
  if (equippableOnly) items = items.filter((i) => truthy(get(i, "tooltip")) || truthy(get(i, "loc")));
  const merged = new Map<any, any>();
  for (const it of items) {
    const key = get(it, "id");
    const existing = merged.get(key);
    if (existing) {
      existing.count = or(get(existing, "count"), 1) + or(get(it, "count"), 1);
    } else {
      merged.set(key, { ...it });
    }
  }
  const rows = [...merged.values()];
  const out: any = { items: table(rows, ["id", "name", "count", "quality", "bound"]) };
  if (detail === "full") {
    const tips: any = {};
    for (const r of rows) {
      if (truthy(get(r, "tooltip"))) {
        const v = itemView(r, []);
        tips[pyStr(r.id)] = Object.keys(v).length === 1 ? get(v, "tooltip") : v;
      }
    }
    if (truthy(tips)) out.tooltips = tips;
  }
  const space: any = {};
  for (const section of where === "both" ? ["bags", "bank"] : [where]) {
    const containers: any[] = or(get(sections, section), []);
    if (truthy(containers)) {
      const total = containers.reduce((s, b) => s + or(get(b, "size"), 0), 0);
      const used = containers.reduce((s, b) => s + (or(get(b, "items"), []) as any[]).length, 0);
      space[section] = `${Math.trunc(total - used)}/${Math.trunc(total)} free`;
    }
  }
  if (truthy(space)) out.space = space;
  return out;
}

export function findItem(sections: any, query: any): any {
  const text = pyStr(query);
  const byId = /^\p{Nd}+$/u.test(text);
  const id = byId ? Number([...text].map(digitValue).join("")) : NaN;
  const hit = (it: any) => byId ? get(it, "id") === id : matches(query, get(it, "name"));
  const hits: any[] = [];
  for (const it of or(get(sections, "equipment"), [])) {
    if (hit(it)) hits.push({ where: "equipped", slot: get(it, "slot"), id: get(it, "id"), name: get(it, "name") });
  }
  for (const it of bagItems(sections, "both")) {
    if (hit(it)) {
      hits.push({ where: it.where, bag: get(it, "bag"), slot: get(it, "slot"), id: get(it, "id"),
        name: get(it, "name"), count: get(it, "count") });
    }
  }
  return table(hits, ["where", "bag", "slot", "id", "name", "count"]);
}

function objective(o: any): string {
  let text: string = or(get(o, "text"), "");
  const progress = `${pyStr(get(o, "have"))}/${pyStr(get(o, "need"))}`;
  if (truthy(get(o, "need")) && !text.includes(progress)) text = `${text} ${progress}`;
  return text + (truthy(get(o, "done")) ? " [done]" : "");
}

export function quests(qs: any, zone: string | null = null, unfinishedOnly = false): any {
  const zones: any = {};
  for (const q of or(qs, [])) {
    if (truthy(zone) && !matches(zone, get(q, "zone"), get(q, "title"))) continue;
    if (unfinishedOnly && truthy(get(q, "complete"))) continue;
    const entry: any = { id: get(q, "id"), title: get(q, "title"), level: get(q, "level") };
    if (truthy(get(q, "complete"))) entry.complete = true;
    if (truthy(get(q, "failed"))) entry.failed = true;
    entry.objectives = (or(get(q, "objectives"), []) as any[]).map(objective);
    const key = or(get(q, "zone"), "?");
    (zones[key] ??= []).push(entry);
  }
  return { zones };
}

function groupPrices(rows: any[], priceKey: string): any[] {
  const groups = new Map<string, any>();
  for (const r of rows) {
    const price = or(get(r, priceKey), null);
    const key = [price, truthy(get(r, priceKey)) ? null : get(r, "bid"), get(r, "name")];
    const id = JSON.stringify(key);
    let g = groups.get(id);
    if (!g) {
      g = { [priceKey]: key[0], bid: key[1], name: key[2], quantity: 0, auctions: 0 };
      groups.set(id, g);
    }
    g.quantity += or(get(r, "quantity"), 1);
    g.auctions += 1;
  }
  return [...groups.values()];
}

export interface AuctionFilter {
  name?: string | null; type?: string | null; slot?: string | null; minLevel?: number | null;
  maxLevel?: number | null; maxPrice?: number | null; minQuality?: number | null; limit?: number;
}

export function auction(a: any, opts: AuctionFilter = {}): any {
  if (!truthy(a)) return null;
  const { name, type, slot, minLevel, maxLevel, maxPrice, minQuality } = opts;
  const limit = opts.limit ?? 25;
  const out: any = {};
  const rows = get(a, "browse");
  if (rows !== null) {
    const keep = (r: any) => {
      if (truthy(name) && !matches(name, get(r, "name"))) return false;
      if (truthy(type) && !matches(type, get(r, "type"))) return false;
      if (truthy(slot) && !(lookup(LOC_SLOTS, get(r, "loc")) ?? []).includes(slot)) return false;
      const level = or(get(r, "level"), 0);
      if ((minLevel != null && level < minLevel) || (maxLevel != null && level > maxLevel)) return false;
      if (maxPrice != null && or(get(r, "minPrice"), 0) > maxPrice) return false;
      return minQuality == null || or(get(r, "quality"), 0) >= minQuality;
    };
    const found = (rows as any[]).filter(keep).map((r) => ({ ...r, stats: statsText(get(r, "tooltip")) }));
    out.browse = table(pySlice(found, limit),
      ["id", "name", "quality", "level", "type", "itemLevel", "minPrice", "quantity", "stats"]);
    if (found.length > limit) out.browse.more = found.length - limit;
  }
  const search = get(a, "search");
  if (truthy(search)) {
    const searchRows: any[] = or(get(search, "rows"), []);
    const priceKey = searchRows.some((r) => r && "unitPrice" in r) ? "unitPrice" : "buyout";
    const grouped = groupPrices(searchRows, priceKey);
    for (const g of grouped) if (g.name === get(search, "name")) g.name = null;
    out.search = { id: get(search, "id"), name: get(search, "name"),
      prices: table(pySlice(grouped, limit), [priceKey, "bid", "name", "quantity", "auctions"]) };
  }
  return out;
}

function pySlice<T>(list: T[], limit: number): T[] {
  return limit < 0 ? list.slice(0, Math.max(0, list.length + limit)) : list.slice(0, limit);
}

export function trainer(t: any, availableOnly = false, name: string | null = null): any {
  if (!truthy(t)) return null;
  const rows = (or(get(t, "services"), []) as any[]).filter((s) =>
    (!availableOnly || get(s, "status") === "available") && (!truthy(name) || matches(name, get(s, "name"))));
  return { npc: get(t, "npc"),
    services: table(rows, ["name", "rank", "status", "cost", "level", "skill", "skillRank"]) };
}

export function profession(p: any, name: string | null = null, craftableOnly = false): any {
  if (!truthy(p)) return null;
  const rows: any[] = [];
  for (const r of or(get(p, "recipes"), [])) {
    if (truthy(name) && !matches(name, get(r, "name"))) continue;
    if (craftableOnly && !truthy(get(r, "canMake"))) continue;
    const reagents = (or(get(r, "reagents"), []) as any[])
      .map((g) => `${pyStr(or(get(g, "name"), get(g, "id")))} x${pyStr(get(g, "count"))}`).join(", ");
    rows.push({ ...r, reagents });
  }
  return { name: get(p, "name"), level: `${pyStr(get(p, "level"))}/${pyStr(get(p, "max"))}`,
    recipes: table(rows, ["id", "name", "difficulty", "canMake", "reagents"]) };
}

export function merchant(m: any, name: string | null = null, usableOnly = false): any {
  if (!truthy(m)) return null;
  const rows: any[] = [];
  for (const it of or(get(m, "items"), [])) {
    if ((truthy(name) && !matches(name, get(it, "name"))) || (usableOnly && get(it, "usable") === false)) continue;
    rows.push({ ...it, available: get(it, "available") === -1 ? null : get(it, "available"),
      unusable: get(it, "usable") === false });
  }
  return { npc: get(m, "npc"), items: table(rows, ["id", "name", "price", "stack", "available", "unusable"]) };
}

export function candidate(sections: any, itemId: number): any {
  for (const it of [...or(get(sections, "items"), []), ...bagItems(sections, "both")]) {
    if (get(it, "id") === itemId && truthy(get(it, "tooltip"))) return it;
  }
  return null;
}

function slotTexts(equipped: any[]): Record<string, any[]> {
  const texts: Record<string, any[]> = {};
  for (const e of equipped) {
    const { lines } = tidyTooltip(get(e, "tooltip"), get(e, "name"));
    if (lines.length) (texts[lines[0].split("\t")[0]] ??= []).push(get(e, "slot"));
  }
  return texts;
}

export function compare(item: any, equippedItems: any): any {
  const equipped: any[] = or(equippedItems, []);
  let slots: any[] = lookup(LOC_SLOTS, get(item, "loc"));
  if (!truthy(slots)) {
    const { lines } = tidyTooltip(get(item, "tooltip"), get(item, "name"));
    const learned = slotTexts(equipped);
    const first = lines.find((l) => Object.prototype.hasOwnProperty.call(learned, l.split("\t")[0]));
    slots = first === undefined ? [] : learned[first.split("\t")[0]];
  }
  const fresh = itemView(item, ["id", "name", "quality"]);
  const out: any = { item: fresh, equipped: [] };
  for (const e of equipped) {
    if (slots.includes(get(e, "slot"))) {
      const old = itemView(e);
      old.diff = statDiff(or(get(fresh, "tooltip"), []), or(get(old, "tooltip"), []));
      out.equipped.push(old);
    }
  }
  if (!truthy(slots)) out.note = "could not tell which slot this item goes in";
  else if (!out.equipped.length) out.note = `nothing equipped in ${slots.join(", ")}`;
  return out;
}
