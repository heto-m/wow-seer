# Seer

Lets any AI (Claude Code, Claude Desktop, a local model) read your WoW: Forever state through an MCP server: character, gear with tooltips, bags, bank, quests, talents, and the last trainer, profession, vendor or auction house window you opened. Read-only: it never acts in the game.

## How it works

The addon draws the state as a small colour strip and takes a screenshot (visible for ~40 ms). The server decodes the strip and deletes the image. Requests go the other way through small load-on-demand addons ("slots") that the addon checks every 10 s; `/reload` renews them.

## Install

Needs Node.js 20+.

```sh
npx -y wow-seer install                           # with the game closed
claude mcp add wow-seer -- npx -y wow-seer serve  # or run `npx -y wow-seer serve` as a stdio server in any client
```

Set `WOW_DIR` if your `_forever_` folder isn't in a default place. In game, `/seer` shows the status.

## Tools

| Tool | Returns |
|---|---|
| `get_character` | level, money, stats, gear names, talents taken, professions; `detail=full` adds gear tooltips |
| `get_equipment` | equipped items with tooltip stats, optionally only some `slots`; set bonuses listed once |
| `get_talents` | talents with points in them; `all=true` lists the whole tree |
| `get_bags` | bag or bank contents with stacks merged; filter by `name`, `equippable_only` |
| `find_item` | where an item is (equipped, bag and slot, bank) by ID or name |
| `get_quests` | quest log grouped by zone; filter by `zone`, `unfinished_only` |
| `search_auction` | the last auction house results you saw, filtered by name, type, slot, level, price, quality |
| `get_trainer`, `get_profession`, `get_merchant` | the last window of that kind you opened, with filters |
| `compare_item` | an item's tooltip next to what you wear in its slot, with the stat difference |
| `get_item` | the tooltip of any item by ID |
| `refresh` | asks the game to resend sections now (up to about 15 s) |
| `seer_status` | connection state, slots left, decode errors |

Money is in copper.

## Tests

```sh
npm install && npm test   # the end-to-end tests need lua5.1
```
