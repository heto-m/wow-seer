import { test } from "node:test";
import assert from "node:assert/strict";
import * as views from "../src/views.js";

const SET = [" ", "Vestiduras (2/5)", "  Atuendo", "  Fajín", " ", "Conjunto: +10 p. de intelecto.", " "];
const CHEST = {
  slot: "chest", id: 1, name: "Atuendo", quality: 3, durability: [30, 75],
  tooltip: ["Atuendo", "Ligado", "Pecho\tTela", "41 armadura", "+10 intelecto", ...SET,
    "Durabilidad 30 / 75", "Necesitas ser de nivel 18"],
};
const WAIST = {
  slot: "waist", id: 2, name: "Fajín", quality: 3,
  tooltip: ["Fajín", "Ligado", "Cintura\tTela", "+6 intelecto", ...SET, "Durabilidad 20 / 20"],
};
const RING = {
  slot: "finger1", id: 3, name: "Sortija", quality: 2,
  tooltip: ["Sortija", "Ligado", "Dedo", "+4 fuerza", "+2 aguante", "Encantado: +2 de aguante"],
};

test("tidyTooltip", () => {
  const { lines, setInfo, durability } = views.tidyTooltip(CHEST.tooltip, "Atuendo");
  assert.deepEqual(lines, ["Pecho\tTela", "41 armadura", "+10 intelecto", "Necesitas ser de nivel 18"]);
  assert.deepEqual(setInfo, { name: "Vestiduras", have: "2/5", pieces: ["Atuendo", "Fajín"],
    bonuses: ["Conjunto: +10 p. de intelecto."] });
  assert.equal(durability, "30/75");
  assert.deepEqual(views.tidyTooltip(["Usar: 10 |4min:mins; cd"]).lines, ["Usar: 10 mins cd"]);
});

test("equipment lists a set once", () => {
  const out = views.equipment([CHEST, WAIST]);
  assert.deepEqual(out.items.map((i: any) => i.set), ["Vestiduras", "Vestiduras"]);
  assert.deepEqual(Object.keys(out.sets), ["Vestiduras"]);
  const summary = views.equipment([CHEST, WAIST], ["waist"], "summary");
  assert.deepEqual(summary, { cols: ["slot", "id", "name", "quality"], rows: [["waist", 2, "Fajín", 3]] });
});

test("table keeps zero", () => {
  assert.deepEqual(views.table([{ a: 0, b: null, c: false }], ["a", "b", "c"]), { cols: ["a"], rows: [[0]] });
});

test("talents taken", () => {
  const t = { unspent: 1, talents: [{ name: "B", rank: 0, max: 5, x: 1, y: 2 },
    { name: "A", rank: 2, max: 2, x: 1, y: 1 }] };
  assert.deepEqual(views.talents(t), { unspent: 1, spent: 2, taken: ["A 2/2"] });
  assert.deepEqual(views.talents(t, true).talents, ["A 2/2", "B 0/5"]);
});

test("bags merge and find", () => {
  const sections = { bags: [{ bag: 0, size: 16, items: [
    { slot: 1, id: 9, name: "Poción de maná", count: 5 },
    { slot: 2, id: 9, name: "Poción de maná", count: 3 },
    { slot: 3, id: 7, name: "Anillo", count: 1, loc: "INVTYPE_FINGER", tooltip: ["Anillo", "Dedo", "+3 intelecto"] },
  ] }] };
  const out = views.bags(sections, "bags", "POCION");
  assert.deepEqual(out.items.rows, [[9, "Poción de maná", 8]]);
  assert.deepEqual(out.space, { bags: "13/16 free" });
  assert.deepEqual(views.bags(sections, "bags", null, true, "full").tooltips, { 7: ["Dedo", "+3 intelecto"] });
  assert.deepEqual(views.findItem(sections, "7").rows, [["bags", 0, 3, 7, "Anillo", 1]]);
});

test("compare", () => {
  const ring = { id: 7, name: "Anillo", loc: "INVTYPE_FINGER", tooltip: ["Anillo", "Dedo", "+3 intelecto"] };
  let out = views.compare(ring, [CHEST, RING]);
  assert.deepEqual(out.equipped.map((e: any) => e.slot), ["finger1"]);
  assert.deepEqual(out.equipped[0].diff, { aguante: -2, fuerza: -4, intelecto: 3 });
  out = views.compare({ ...ring, loc: null }, [RING]);
  assert.equal(out.equipped[0].slot, "finger1");
});

test("compare reads spell power and weapon dps", () => {
  const trogg = { id: 272996, name: "Cetro trogg", loc: "INVTYPE_WEAPONMAINHAND", tooltip: [
    "Cetro trogg", "Mano principal\tMaza", "13 - 26 Daño\tVelocidad 2,40", "(8,1 daño por segundo)", "+4 espíritu",
    "Equipar: Aumenta hasta 33 p. la sanación realizada y hasta 11 p. el daño infligido con todos los hechizos y efectos mágicos.",
  ] };
  const scepter = { slot: "mainhand", id: 271216, name: "Cetro de los abandonados", tooltip: [
    "Cetro de los abandonados", "Mano principal\tMaza", "17 - 33 Daño\tVelocidad 2,60", "(9,6 daño por segundo)",
    "+5 resistencia a Sombras",
    "Equipar: Aumenta hasta 24 p. el daño infligido y la sanación realizada con hechizos y efectos mágicos.",
  ] };
  assert.deepEqual(views.compare(trogg, [scepter]).equipped[0].diff, {
    dps: -1.5, espíritu: 4, healing: 9, "resistencia a Sombras": -5, "spell damage": -13,
  });
  assert.deepEqual(
    views.simpleStats(["Equipar: Aumenta hasta 4 p. el daño infligido con hechizos y efectos de Fuego."]),
    { "spell damage (Fuego)": 4 },
  );
  assert.deepEqual(
    views.simpleStats([
      "Equip: Increases healing done by up to 33 and damage done by up to 11 for all magical spells and effects.",
      "Equip: Increases damage done by Fire spells and effects by up to 4.",
    ]),
    { healing: 33, "spell damage": 11, "spell damage (Fire)": 4 },
  );
});

test("auction filters and groups", () => {
  const a = {
    browse: [
      { id: 1, name: "Varita funesta", type: "Varitas", level: 21, minPrice: 2248, quality: 2, loc: "INVTYPE_RANGEDRIGHT" },
      { id: 2, name: "Varita alta", type: "Varitas", level: 30, minPrice: 5000, quality: 2 },
      { id: 3, name: "Espada", type: "Espadas", level: 20, minPrice: 100, quality: 2 },
    ],
    search: { id: 1, name: "Varita funesta", rows: [
      { buyout: 2248, quantity: 1, name: "Varita funesta" },
      { buyout: 2248, quantity: 1, name: "Varita funesta" },
      { buyout: 3000, quantity: 1, name: "Varita funesta" },
    ] },
  };
  const out = views.auction(a, { type: "varita", maxLevel: 24 });
  assert.deepEqual(out.browse.rows.map((r: any[]) => r[0]), [1]);
  assert.equal(views.auction(a, { slot: "ranged" }).browse.rows[0][0], 1);
  assert.deepEqual(out.search.prices, { cols: ["buyout", "quantity", "auctions"], rows: [[2248, 2, 2], [3000, 1, 1]] });
});

test("auction search shows each random-suffix tier's stats", () => {
  const belt = "item:9799::::::::27:1487::1:1:12730::::::";
  const weak = "item:9799::::::::27:1487::1:1:13204::::::";
  const a = { search: { id: 9799, name: "Fajín de paño de hiedra de espíritu", rows: [
    { buyout: 1188, quantity: 1, name: "Fajín de paño de hiedra de espíritu", item: belt },
    { buyout: 1188, quantity: 1, name: "Fajín de paño de hiedra de espíritu", item: belt },
    { buyout: 1188, quantity: 1, name: "Fajín de paño de hiedra de espíritu", item: weak },
  ], tooltips: {
    [belt]: ["Fajín de paño de hiedra de espíritu", "Cintura\tTela", "22 armadura", "+7 espíritu"],
    [weak]: ["Fajín de paño de hiedra de espíritu", "Cintura\tTela", "22 armadura", "+3 espíritu"],
  } } };
  assert.deepEqual(views.auction(a).search.prices, { cols: ["buyout", "stats", "quantity", "auctions"], rows: [
    [1188, "+22 armadura, +7 espíritu", 2, 2], [1188, "+22 armadura, +3 espíritu", 1, 1],
  ] });
});

test("auction browse rows can arrive as columns", () => {
  const a = { browse: {
    cols: ["id", "itemLevel", "name", "quality", "level", "type", "minPrice", "quantity", "loc"],
    rows: [
      [9796, 27, "Manto de paño de hiedra del búho", 2, 22, "Tela", 3000, 1, "INVTYPE_SHOULDER"],
      [4317, 25, "Pantalones Fénix", 2, 20, "Tela", 4289, 41, "INVTYPE_LEGS"],
    ],
  } };
  const out = views.auction(a, { minLevel: 21 });
  assert.deepEqual(out.browse.cols, ["id", "name", "quality", "level", "type", "itemLevel", "minPrice", "quantity"]);
  assert.deepEqual(out.browse.rows, [[9796, "Manto de paño de hiedra del búho", 2, 22, "Tela", 27, 3000, 1]]);
});

test("missing data", () => {
  for (const fn of [views.player, views.talents, views.trainer, views.profession, views.merchant]) {
    assert.equal((fn as any)(null), null);
  }
  assert.equal(views.auction(null), null);
  assert.equal(views.skills(null), null);
  assert.deepEqual(views.quests(null), { zones: {} });
  assert.deepEqual(views.equipment(null, null, "summary"), { cols: [], rows: [] });
});

test("prices", () => {
  const p = { auctionator: true, items: [
    { id: 2292, name: "Togas de necrología", count: 1, price: 98000, age: 2, vendor: 1830 },
    { id: 1823, name: "Cayada de cachiporrazo", count: 1, vendor: 120 },
  ] };
  assert.deepEqual(views.prices(p), { items: { cols: ["id", "name", "count", "price", "age_days", "vendor"], rows: [
    [2292, "Togas de necrología", 1, 98000, 2, 1830], [1823, "Cayada de cachiporrazo", 1, null, null, 120],
  ] } });
  assert.match(views.prices({ auctionator: false, items: [] }).note, /Auctionator/);
});

test("BiS gain, dungeon lockout and alts", () => {
  const p = views.player({ name: "Palla", bisWeights: { spec: "Shadow", stats: { INT: 1 }, source: "Wowhead", fromLevel: 1, toLevel: 30 },
    dungeonLockout: { lastHour: 5, limit: 5, last24h: 7, freeIn: 601 } });
  assert.deepEqual(p.bis_weights, { spec: "Shadow", stats: { INT: 1 }, source: "Wowhead", levels: "1-30" });
  assert.deepEqual(p.dungeon_lockout, { last_hour: "5/5", last_24h: 7, next_free_in_minutes: 11 });
  const bags = views.bags({ bags: [{ size: 4, items: [{ id: 1, name: "A", bis: 2.5 }, { id: 2, name: "B" }] }] });
  assert.deepEqual(bags.items.cols, ["id", "name", "bis"]);
  assert.deepEqual(bags.items.rows.map((r: any[]) => r[2]), [2.5, null]);
  assert.equal(views.bags({ bags: [{ size: 4, items: [{ id: 2, name: "B" }] }] }).items.cols.includes("bis"), false);
  assert.equal(views.itemView({ id: 1, bis: -3 }, ["id"]).bis_gain, -3);
  const a = views.alts([{ name: "Bank", level: 5, class: "WARRIOR", zone: "Entrañas", subzone: "Barrio", mails: 2, mailExpiresDays: 3.2 }]);
  assert.deepEqual(a.characters.cols, ["name", "level", "class", "zone", "mails", "mailExpiresDays"]);
  assert.deepEqual(a.characters.rows, [["Bank", 5, "WARRIOR", "Entrañas - Barrio", 2, 3.2]]);
  assert.equal(views.alts([{ name: "Bank" }], "palla").characters.rows.length, 0);
});

test("guide numbers steps like Polestar's window", () => {
  const g = views.guide({ guide: "x", step: 38, steps: 72, done: 40, doneOf: 59, goals: [] });
  assert.equal(g.step, "38/72");
  assert.equal(g.steps_done, "40/59");
});
