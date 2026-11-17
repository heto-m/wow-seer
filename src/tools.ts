import fs from "node:fs";
import path from "node:path";

import * as game from "./game.js";
import { loadLoot } from "./loot.js";
import { now, State } from "./server.js";
import { VERSION, versionWarning } from "./version.js";
import * as views from "./views.js";

export const SECTION_HELP: Record<string, string> = {
  player: "level, class, race, money, xp, zone, base stats",
  equipment: "equipped items with tooltip text",
  bags: "bag contents",
  bank: "bank contents (updated while the bank is open)",
  quests: "quest log with objectives",
  talents: "talents and unspent points",
  skills: "profession levels",
  trainer: "last trainer window",
  profession: "last profession window",
  merchant: "last vendor window",
  auction: "last auction house browse/search results",
  items: "tooltips fetched with get_item",
  prices: "Auctionator and vendor prices fetched with get_prices",
  guide: "the Polestar guide step (needs the Polestar addon)",
  fight: "the last fight from the game's damage meter",
  training: "spells to learn, from the What's Training addon",
  crafting: "profession leveling plans, from the SkillUp Forever addon",
  alts: "the player's other characters, from the DataStore addon",
};

const WHEN_MISSING: Record<string, string> = {
  bank: "open the bank in game",
  trainer: "open a trainer in game",
  profession: "open a profession window in game",
  merchant: "talk to a vendor in game",
  auction: "open the auction house and browse or search",
  items: "use get_item",
  prices: "use get_prices",
  guide: "needs the Polestar addon with a guide loaded",
  fight: "arrives after a fight ends",
  training: "needs the What's Training addon",
  crafting: "needs the SkillUp Forever addon",
  alts: "needs the DataStore and DataStore_Characters addons; each character appears after logging in once",
};

const STALE_GAME = 120;

export function diagnose(state: State, waited = false): string | null {
  const last = state.addon.last_message;
  if (last) {
    const quiet = Math.floor(now() - last);
    if (!waited || quiet <= STALE_GAME) return null;
    return `Last heard from the game ${quiet} s ago: is it still running, logged in and out of loading screens? ` +
      "Seer also waits while the player is in combat.";
  }
  let addons: string;
  try {
    addons = game.addonsDir();
  } catch (e) {
    return (e as Error).message;
  }
  if (!fs.existsSync(path.join(addons, "Seer", "Seer.toc"))) {
    return "The Seer addon is not installed. Close the game, run `npx -y wow-seer install`, then start the game.";
  }
  if (!game.slotDirs().length) {
    return "Seer's request slots are missing (an addon manager installs only the addon). Close the game, " +
      "run `npx -y wow-seer install`, then start the game.";
  }
  return "Seer has not heard from the game since this server started. Start WoW: Forever with the Seer addon " +
    "enabled and log in; in game, /seer status shows whether it is sending (it needs screenshots saved as PNG).";
}

export const INSTRUCTIONS =
  "Read-only access to the player's live WoW: Forever state, pushed by the Seer addon when it changes. " +
  "age_seconds says how old the data is. Money and prices are in copper (10000 = 1 gold). " +
  "quality: 0 poor, 1 common, 2 uncommon, 3 rare, 4 epic. Lists come as {cols, rows}. " +
  "Text is in the game client's language: name items, zones and NPCs as the client does. " +
  "Seer cannot act in the game or search the auction house: trainer, vendor, profession, bank and auction data " +
  "is what the player last opened, so ask them to open the window when it is missing or old. " +
  "Random-suffix names (\"de espíritu\") cover several stat tiers: compare tooltip stats, not names. " +
  "Prefer the narrowest tool and filters that answer the question.";

type Args = Record<string, any>;
type Data = Record<string, any>;

const STR = { type: "string" };
const INT = { type: "integer" };
const BOOL = { type: "boolean" };
const DETAIL = { type: "string", enum: ["summary", "full"] };
const TIMEOUT = { type: "number", default: 30 };
const SLOT = { type: "string", enum: views.SLOTS };

function schema(props: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { type: "object", properties: props };
  if (required.length) out.required = required;
  return out;
}

interface SectionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sections: string[] | ((args: Args) => string[]);
  view: (data: Data, args: Args) => any;
}

function bagSections(args: Args): string[] {
  const where = args.where || "bags";
  return where === "both" ? ["bags", "bank"] : [where];
}

const TOOLS: SectionTool[] = [
  {
    name: "get_character",
    description:
      "Level, class, money, xp, zone and map position (x, y from 0 to 100), stats, equipped gear, talents taken, " +
      "profession levels. With Forever Leveling BiS: the stat weights it uses for the spec and level. " +
      "With Nova Instance Tracker: dungeons entered in the last hour against Forever's hourly limit, and when the next slot frees.",
    inputSchema: schema({ detail: { ...DETAIL, description: "summary (default): gear names only; full: gear tooltips" } }),
    sections: ["player", "equipment", "talents", "skills"],
    view: (d, a) => ({
      player: views.player(d.player),
      equipment: views.equipment(d.equipment, null, a.detail || "summary"),
      talents: views.talents(d.talents),
      skills: views.skills(d.skills),
    }),
  },
  {
    name: "get_equipment",
    description: "Equipped items with tooltip stats; set bonuses listed once.",
    inputSchema: schema({
      slots: { type: "array", items: SLOT, description: "only these slots" },
      detail: { ...DETAIL, description: "full (default): tooltips; summary: names only" },
    }),
    sections: ["equipment"],
    view: (d, a) => views.equipment(d.equipment, a.slots, a.detail || "full"),
  },
  {
    name: "get_talents",
    description: "Talents with points in them, unspent points, spec.",
    inputSchema: schema({ all: { ...BOOL, description: "include talents with no points, in tree order" } }),
    sections: ["talents"],
    view: (d, a) => views.talents(d.talents, Boolean(a.all)),
  },
  {
    name: "get_bags",
    description: "Bag (or bank) contents, stacks merged, free space. With the Pawn addon, gear also shows Pawn's value and upgrade % under the player's active Pawn scale (Pawn ignores set bonuses), and with Forever Leveling BiS a bis column: its score gain over what is worn (negative is worse). Both are stat scores: they ignore set bonuses and follow the spec chosen in each addon (Pawn scale; bis_weights.spec in get_character), which may not be the role being advised.",
    inputSchema: schema({
      where: { type: "string", enum: ["bags", "bank", "both"] },
      name: { ...STR, description: "part of the item name" },
      equippable_only: BOOL,
      detail: { ...DETAIL, description: "full adds tooltips of equippable items" },
    }),
    sections: bagSections,
    view: (d, a) => views.bags(d, a.where || "bags", a.name, Boolean(a.equippable_only), a.detail || "summary"),
  },
  {
    name: "find_item",
    description: "Where an item is: equipped slot, bag and slot, or bank.",
    inputSchema: schema({ query: { ...STR, description: "item ID or part of its name" } }, ["query"]),
    sections: ["equipment", "bags", "bank"],
    view: (d, a) => views.findItem(d, a.query),
  },
  {
    name: "get_quests",
    description: "Quest log grouped by zone, with objective progress. With Questie installed, each quest also has where to turn it in and where its objectives are (zone, x, y from 0 to 100).",
    inputSchema: schema({ zone: { ...STR, description: "part of the zone or quest title" }, unfinished_only: BOOL }),
    sections: ["quests"],
    view: (d, a) => views.quests(d.quests, a.zone, Boolean(a.unfinished_only)),
  },
  {
    name: "search_auction",
    description: "Filter the auction house results the player last saw (browse list and the last item search). Browse rows of a random-suffix item (\"del profeta\") carry no stats because one row can mix stat tiers; the item search shows each auction's stats.",
    inputSchema: schema({
      name: { ...STR, description: "part of the item name" },
      type: { ...STR, description: "part of the item subtype, e.g. Varitas" },
      slot: SLOT,
      min_level: { ...INT, description: "required level" },
      max_level: INT,
      max_price: { ...INT, description: "copper" },
      min_quality: INT,
      limit: { type: "integer", default: 25 },
    }),
    sections: ["auction"],
    view: (d, a) =>
      views.auction(d.auction, {
        name: a.name, type: a.type, slot: a.slot, minLevel: a.min_level, maxLevel: a.max_level,
        maxPrice: a.max_price, minQuality: a.min_quality, limit: Number(a.limit) || 25,
      }),
  },
  {
    name: "get_trainer",
    description: "The last trainer window the player opened: services, cost, required level.",
    inputSchema: schema({ available_only: BOOL, name: STR }),
    sections: ["trainer"],
    view: (d, a) => views.trainer(d.trainer, Boolean(a.available_only), a.name),
  },
  {
    name: "get_profession",
    description: "The last profession window the player opened: known recipes and reagents.",
    inputSchema: schema({ name: { ...STR, description: "part of the recipe name" }, craftable_only: BOOL }),
    sections: ["profession"],
    view: (d, a) => views.profession(d.profession, a.name, Boolean(a.craftable_only)),
  },
  {
    name: "get_guide",
    description: "The step the player's Polestar leveling guide is on: what to do, quests, NPCs and map coordinates.",
    inputSchema: schema(),
    sections: ["guide"],
    view: (d) => views.guide(d.guide),
  },
  {
    name: "get_last_fight",
    description: "The last fight from the game's built-in damage meter (what Details shows on Forever): damage, healing and damage taken per group member, with per-second rates, and deaths.",
    inputSchema: schema(),
    sections: ["fight"],
    view: (d) => views.fight(d.fight),
  },
  {
    name: "get_training",
    description: "Class spells to learn now and in the next levels, with trainer cost (from the What's Training addon).",
    inputSchema: schema({ available_only: BOOL }),
    sections: ["training"],
    view: (d, a) => views.training(d.training, Boolean(a.available_only)),
  },
  {
    name: "get_crafting",
    description:
      "Profession leveling plans from the SkillUp Forever addon: the next steps (craft, buy, train, gather) with " +
      "counts and costs, the recipes planned and the reagents the route still needs.",
    inputSchema: schema({ profession: { ...STR, description: "part of the profession name" } }),
    sections: ["crafting"],
    view: (d, a) => views.crafting(d.crafting, a.profession),
  },
  {
    name: "get_alts",
    description:
      "The player's other characters as last seen by the DataStore addon: level, class, money, where they logged out, " +
      "rested xp, and mail waiting with days until the soonest one expires.",
    inputSchema: schema({ name: STR }),
    sections: ["alts"],
    view: (d, a) => views.alts(d.alts, a.name),
  },
  {
    name: "get_merchant",
    description: "The last vendor window the player opened: items and prices.",
    inputSchema: schema({ name: STR, usable_only: BOOL }),
    sections: ["merchant"],
    view: (d, a) => views.merchant(d.merchant, a.name, Boolean(a.usable_only)),
  },
];

const EXTRA_TOOLS = [
  {
    name: "compare_item",
    description: "An item's tooltip next to what is equipped in its slot, with the difference in stats, spell damage, healing and weapon DPS.",
    inputSchema: schema({ item_id: INT, timeout_seconds: TIMEOUT }, ["item_id"]),
  },
  {
    name: "get_item",
    description: "The in-game tooltip of any item by ID (the game client must know the item).",
    inputSchema: schema({ item_id: INT, timeout_seconds: TIMEOUT }, ["item_id"]),
  },
  {
    name: "get_prices",
    description:
      "Auction prices from the player's Auctionator addon (lowest buyout it last saw, and how many days ago) " +
      "plus the vendor sell price and, for gear, Auctionator's disenchant value, for item IDs and/or everything in the bags. Works with the auction house closed. " +
      "Random-suffix gear is priced per exact item when it comes from the bags.",
    inputSchema: schema({
      item_ids: { type: "array", items: INT, description: "up to 200" },
      bags: { ...BOOL, description: "price every item in the bags" },
      timeout_seconds: TIMEOUT,
    }),
  },
  {
    name: "get_loot",
    description:
      "Dungeon and raid loot from the AtlasLoot addon's data on disk: where items drop (instance, boss, drop %), " +
      "or every boss's loot in a dungeon. Boss, dungeon and item notes are in English; match items by ID " +
      "(names in the game's language come from get_item).",
    inputSchema: schema({
      item_ids: { type: "array", items: INT, description: "where these items drop" },
      dungeon: { ...STR, description: "part of a dungeon or raid name (English), lists its bosses and loot" },
      name: { ...STR, description: "part of an item's English name" },
    }),
  },
  {
    name: "refresh",
    description:
      "Ask the game to resend sections now (up to ~15 s; data is already pushed on change). " +
      "Read them afterwards with the matching tool.",
    inputSchema: schema({
      sections: { type: "array", items: { type: "string", enum: Object.keys(SECTION_HELP) } },
      timeout_seconds: TIMEOUT,
    }),
  },
  {
    name: "seer_status",
    description: "Connection status: when the game last sent data, request slots left, decode errors.",
    inputSchema: schema(),
  },
];

export function toolList(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return [
    ...TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    ...EXTRA_TOOLS,
  ];
}

export class UnknownTool extends Error {}

function gather(state: State, names: string[]): { data: Data; meta: Data } {
  const t = now();
  const data: Data = {};
  const ages: number[] = [];
  let missing: string[] = [];
  let saved: Record<string, any> | null = null;
  let savedAt: number | null = null;
  let usedSaved = false;
  for (const name of names) {
    const entry = state.sections[name];
    if (entry) {
      data[name] = entry.data;
      ages.push(Math.max(0, Math.floor(t - entry.game_time)));
      continue;
    }
    if (saved === null) {
      try {
        ({ sections: saved, savedAt } = game.savedState());
      } catch {
        saved = {};
      }
    }
    if (saved && name in saved) {
      data[name] = saved[name];
      usedSaved = true;
      if (savedAt) ages.push(Math.floor(t - savedAt));
    } else {
      data[name] = null;
      missing.push(name);
    }
  }
  const meta: Data = {};
  if (ages.length) meta.age_seconds = Math.max(...ages);
  if (usedSaved) meta.source = "saved at last logout or /reload";
  if (names.length !== 1 || names[0] !== "bank") missing = missing.filter((n) => n !== "bank");
  if (missing.length) {
    meta.not_seen_yet = Object.fromEntries(missing.map((n) => [n, WHEN_MISSING[n] ?? SECTION_HELP[n]]));
    const hint = diagnose(state);
    if (hint) meta.hint = hint;
  }
  return { data, meta };
}

async function fetchItem(state: State, itemId: number, timeout: number): Promise<boolean> {
  const req = state.request("item", { item: itemId });
  return state.wait(() => state.answered(req), timeout);
}

function timedOut(state: State): Data {
  const hint = diagnose(state, true);
  return hint ? { error: "timed out waiting for the game", hint } : { error: "timed out waiting for the game" };
}

function safe(fn: () => string): string {
  try {
    return fn();
  } catch (e) {
    return (e as Error).message;
  }
}

export async function callTool(state: State, name: string, args: Args): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool) {
    const sections = typeof tool.sections === "function" ? tool.sections(args) : tool.sections;
    const { data, meta } = gather(state, sections);
    return { ...(tool.view(data, args) || {}), ...meta };
  }
  const timeout = Number(args.timeout_seconds ?? 30);
  if (name === "get_item" || name === "compare_item") {
    const itemId = Math.trunc(Number(args.item_id));
    const names = ["items", "bags", "bank", ...(name === "compare_item" ? ["equipment"] : [])];
    let { data, meta } = gather(state, names);
    let item = views.candidate(data, itemId);
    if (item === null) {
      if (!(await fetchItem(state, itemId, timeout))) return timedOut(state);
      ({ data, meta } = gather(state, names));
      item = views.candidate(data, itemId);
      if (item === null) return { error: `the game does not know item ${itemId} yet; try again in a few seconds` };
    }
    if (name === "get_item") {
      const out = views.itemView(item, ["id", "name", "quality"]);
      if (views.LOC_SLOTS[item.loc]) out.slots = views.LOC_SLOTS[item.loc];
      return out;
    }
    return { ...views.compare(item, data.equipment), ...gather(state, ["equipment"]).meta };
  }
  if (name === "get_prices") {
    const ids = ((args.item_ids as unknown[]) || []).map((v) => Math.trunc(Number(v))).filter((v) => v > 0).slice(0, 200);
    const bags = Boolean(args.bags);
    if (!ids.length && !bags) return { error: "give item_ids, bags: true, or both" };
    const req = state.request("prices", { items: ids, bags });
    if (!(await state.wait(() => state.answered(req), timeout))) return timedOut(state);
    const { data, meta } = gather(state, ["prices"]);
    return { ...views.prices(data.prices), ...meta };
  }
  if (name === "get_loot") {
    const data = loadLoot();
    if (!data) return { error: "AtlasLoot (AtlasLootClassic_DungeonsAndRaids) is not installed" };
    return views.loot(data, args.item_ids, args.dungeon, args.name);
  }
  if (name === "refresh") {
    const names = ((args.sections as string[]) || ["player", "equipment", "bags", "quests"]).filter((s) => s in SECTION_HELP);
    const req = state.request("refresh", { sections: names });
    const ok = await state.wait(() => state.answered(req), timeout);
    const t = now();
    const ages = Object.fromEntries(
      names.map((n) => [n, state.sections[n] ? Math.floor(t - state.sections[n].game_time) : null]),
    );
    const out: Data = { age_seconds: ages };
    if (!ok) out.warning = `timed out. ${diagnose(state, true) ?? "Seer waits while the player is in combat or on a loading screen."}`;
    return out;
  }
  if (name === "seer_status") {
    const t = now();
    const last = state.addon.last_message;
    const status: Data = {
      wow_dir: safe(game.wowDir),
      frames_decoded: state.meta.frames,
      last_frame_seconds_ago: state.meta.last_frame ? Math.floor(t - state.meta.last_frame) : null,
      last_message_seconds_ago: last ? Math.floor(t - last) : null,
      pending_requests: state.pending.length,
      last_error: state.meta.last_error,
      cell_px: state.cell,
      client_build: state.addon.build ?? null,
      server_version: VERSION,
      addon_version: last ? state.addon.version || "unknown" : null,
      role: state.role,
    };
    const warning = (last ? versionWarning(state.addon.version) : null) ?? diagnose(state);
    if (warning) status.warning = warning;
    if (state.addon.slots) status.request_slots_left = Math.max(0, state.addon.slots - state.addon.slot + 1);
    return status;
  }
  throw new UnknownTool(name);
}
