import * as game from "./game.js";
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
};

export const INSTRUCTIONS =
  "Read-only access to the player's live WoW: Forever state, pushed by the Seer addon when it changes. " +
  "age_seconds says how old the data is. Money and prices are in copper (10000 = 1 gold). " +
  "quality: 0 poor, 1 common, 2 uncommon, 3 rare, 4 epic. Lists come as {cols, rows}. " +
  "Text is in the game client's language. Prefer the narrowest tool and filters that answer the question.";

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
    description: "Level, class, money, xp, zone, stats, equipped gear, talents taken, profession levels.",
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
    description: "Bag (or bank) contents, stacks merged, free space.",
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
    description: "Quest log grouped by zone, with objective progress.",
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
  if (missing.length) meta.not_seen_yet = Object.fromEntries(missing.map((n) => [n, SECTION_HELP[n]]));
  return { data, meta };
}

async function fetchItem(state: State, itemId: number, timeout: number): Promise<boolean> {
  const req = state.request("item", { item: itemId });
  return state.wait(() => state.answered(req), timeout);
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
      if (!(await fetchItem(state, itemId, timeout))) return { error: "timed out waiting for the game" };
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
  if (name === "refresh") {
    const names = ((args.sections as string[]) || ["player", "equipment", "bags", "quests"]).filter((s) => s in SECTION_HELP);
    const req = state.request("refresh", { sections: names });
    const ok = await state.wait(() => state.answered(req), timeout);
    const t = now();
    const ages = Object.fromEntries(
      names.map((n) => [n, state.sections[n] ? Math.floor(t - state.sections[n].game_time) : null]),
    );
    const out: Data = { age_seconds: ages };
    if (!ok) out.warning = "timed out; is the game running with Seer enabled and out of combat?";
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
    const warning = last ? versionWarning(state.addon.version) : null;
    if (warning) status.warning = warning;
    if (state.addon.slots) status.request_slots_left = Math.max(0, state.addon.slots - state.addon.slot + 1);
    return status;
  }
  throw new UnknownTool(name);
}
