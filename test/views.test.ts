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

test("missing data", () => {
  for (const fn of [views.player, views.talents, views.trainer, views.profession, views.merchant]) {
    assert.equal((fn as any)(null), null);
  }
  assert.equal(views.auction(null), null);
  assert.equal(views.skills(null), null);
  assert.deepEqual(views.quests(null), { zones: {} });
  assert.deepEqual(views.equipment(null, null, "summary"), { cols: [], rows: [] });
});
