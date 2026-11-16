# Seer

In-game state reader for WoW: Forever. Any AI reads it through an MCP server (`wow-seer`): Claude Code, Claude Desktop or a local model.

The AI can see:

- your character, money and base stats
- your equipped gear with full tooltip text
- your bags and bank
- your quest log
- your talents and skills
- the last trainer, profession, vendor and auction house window you opened

Everything is read-only. Seer never presses keys or acts in the game.

## How it works

The game gives addons no live way to send data out, except one: an addon may take a screenshot.

1. When something changes, Seer collects the new state out of combat. It draws it as a small colour strip at the top-left corner and calls `Screenshot()`. The strip is visible for about 30-50 ms.
2. The `wow-seer` server watches the Screenshots folder. It decodes each Seer strip, deletes the image and keeps the latest state for the AI.
3. The server sends requests the other way, such as "resend bags" or "fetch the tooltip of item 4242". It writes them into request slots: small load-on-demand addons that Seer checks every 10 seconds. Each check uses up one slot. The default 1000 slots last about 2.8 hours of play, and `/reload` renews them.
4. On logout or `/reload`, Seer also saves the state to its SavedVariables. The server falls back to that when the game is closed.

Seer only sends data while the server is running. Without it, no screenshots pile up.

## Install

Needs Node.js 20 or newer. The server has no runtime dependencies.

```sh
# with the game closed
npx -y wow-seer install
```

Then add the server to your AI client. For Claude Code:

```sh
claude mcp add wow-seer -- npx -y wow-seer serve
```

For other clients, run `npx -y wow-seer serve` as a stdio MCP server. Set `WOW_DIR` if your `_forever_` folder is not in a default place.

The server speaks MCP 2026-07-28, which has no handshake, and still answers `initialize` from clients on older revisions (2024-11-05 to 2025-11-25).

In game, type `/seer` for the status, or `/seer test` to check what each collector reads.

## Tools

Answers are filtered on the server from the state the game already pushed, so a narrow question costs a narrow answer and no extra screenshots.

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

Lists come as `{cols, rows}`; money is in copper. Answers carry `age_seconds`, and `source` when they come from the state saved at the last logout or `/reload`.

## Tests

```sh
npm install
npm test
```

The end-to-end tests run the real addon in a mock WoW and the real server over stdio. They need `lua5.1`.

`spike/` holds the test that proved the screenshot channel on the real client. Its results are in `spike/RESULTS.md`.
