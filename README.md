# Seer

Lets any AI (Claude Code, Claude Desktop, a local model) read your WoW: Forever state through an MCP server: character, gear with tooltips, bags, bank, quests, talents, the last trainer, profession, vendor or auction house window you opened, and data from addons such as Auctionator, Questie, Pawn and Polestar. Read-only: it never acts in the game.

## How it works

The addon draws the state as a small colour strip and takes a screenshot (visible for ~40 ms). The server decodes the strip and deletes the image. Requests go the other way through small load-on-demand addons ("slots") that the addon checks every 10 s; `/reload` renews them.

## Install

Needs Node.js 20+.

```sh
npx -y wow-seer install                           # with the game closed
claude mcp add wow-seer -- npx -y wow-seer serve  # or run `npx -y wow-seer serve` as a stdio server in any client
```

Set `WOW_DIR` if your `_forever_` folder isn't in a default place. Seer needs screenshots saved as PNG and asks to switch if they are not (`/seer png` does it too). In game, `/seer` shows the status.

## Tools

| Tool | Returns |
|---|---|
| `get_character` | level, money, map position, stats, gear names, talents taken, professions, BiS stat weights, dungeons entered this hour; `detail=full` adds gear tooltips |
| `get_equipment` | equipped items with tooltip stats, optionally only some `slots`; set bonuses listed once |
| `get_talents` | talents with points in them; `all=true` lists the whole tree |
| `get_bags` | bag or bank contents with stacks merged; filter by `name`, `equippable_only`; Pawn values and BiS gain for gear |
| `find_item` | where an item is (equipped, bag and slot, bank) by ID or name |
| `get_quests` | quest log grouped by zone; filter by `zone`, `unfinished_only`; with Questie, where to turn in and where the objectives are |
| `search_auction` | the last auction house results you saw, filtered by name, type, slot, level, price, quality |
| `get_trainer`, `get_profession`, `get_merchant` | the last window of that kind you opened, with filters |
| `compare_item` | an item's tooltip next to what you wear in its slot, with the stat difference |
| `get_item` | the tooltip of any item by ID |
| `get_prices` | Auctionator's last seen price, its age, vendor and disenchant value, for item IDs or the whole bags |
| `get_guide` | the step your Polestar guide is on, with quests, NPCs and coordinates |
| `get_last_fight` | damage, healing and damage taken per group member in the last fight, from the game's damage meter |
| `get_training` | spells to learn now and in the next levels, with cost (What's Training) |
| `get_crafting` | profession leveling plan: next steps, recipes and reagents still needed (SkillUp Forever) |
| `get_loot` | where items drop (dungeon, boss, drop %), or a dungeon's whole loot table (AtlasLoot) |
| `get_alts` | your other characters: level, class, money, where they logged out, rested xp, mail expiry (DataStore) |
| `refresh` | asks the game to resend sections now (up to about 15 s) |
| `seer_status` | connection state, slots left, decode errors |

Money is in copper.

Some tools read other addons when they are installed: Auctionator (`get_prices`), Questie (quest locations), Pawn (gear values), Polestar (`get_guide`), What's Training (`get_training`), SkillUp Forever (`get_crafting`), AtlasLoot (`get_loot`, read from its files), Forever Leveling BiS (gear gain and stat weights), Nova Instance Tracker (hourly dungeon limit) and DataStore (`get_alts`). Without them those parts are just left out.

The addon includes [LibDeflate](https://github.com/SafeteeWoW/LibDeflate) (zlib licence, `addon/Seer/LibDeflate-LICENSE.txt`) to compress what it sends.

## Tests

```sh
npm install && npm test   # the end-to-end tests need lua5.1
```
