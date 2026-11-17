import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDropRates, parseLoot } from "../src/loot.js";
import * as views from "../src/views.js";

const DATA = `
data["ShadowfangKeep"] = {
	name = C_Map.GetAreaInfo(209) .. LTNX,
	LevelRange = GetForVersion({ 11, 22, 30 }, { 14, 18, 21 }),
	items = {
		{ -- SFKRethilgore
			name = AL["Rethilgore"],
			npcID = 3914,
			[NORMAL_DIFF] = {
				{ 1, 5254 }, -- Rugged Spaulders
				{ 16,  "INV_Box_01", nil, AL["Forever"],  nil },
				{ 18, 273457 }, -- {FOREVER} Sorcerer Collar
			},
		},
		{ -- SFKFelSteed
			name = AL["Fel Steed / Shadow Charger"],
			npcID = { 3865, 3864 },
			[NORMAL_DIFF] = {
				{ 1, 6341 }, -- Eerie Stable Lantern
			},
		},
	},
}
`;
const RATES = `
local DropRateData = {
	[3914] = {
		[5254] = 89.55
	},
	[3864] = {
		[6341] = 6.24,
	},
}
`;

test("AtlasLoot data: bosses, items and drop rates", () => {
  const [sfk] = parseLoot(DATA);
  assert.equal(sfk.name, "Shadowfang Keep");
  assert.deepEqual(sfk.levels, [11, 22, 30]);
  assert.deepEqual(sfk.bosses.map((b) => [b.name, b.npcs, b.items.map((i) => [i.id, i.note])]), [
    ["Rethilgore", [3914], [[5254, "Rugged Spaulders"], [273457, "Sorcerer Collar"]]],
    ["Fel Steed / Shadow Charger", [3865, 3864], [[6341, "Eerie Stable Lantern"]]],
  ]);
  const data = { instances: [sfk], dropRates: parseDropRates(RATES) };
  assert.deepEqual(views.loot(data, [6341, 99], null, null), {
    sources: { cols: ["id", "note", "dungeon", "levels", "boss", "drop"],
      rows: [[6341, "Eerie Stable Lantern", "Shadowfang Keep", "22-30 (enter 11)", "Fel Steed / Shadow Charger", 6.24]] },
    not_in_atlasloot: [99],
  });
  assert.equal(views.loot(data, null, "shadow", null).dungeons[0].bosses[0].items.rows[0][2], 89.55);
});
