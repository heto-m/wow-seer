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

`get_character`, `get_equipment`, `get_talents`, `get_bags`, `find_item`, `get_quests`, `search_auction`, `get_trainer`, `get_profession`, `get_merchant`, `compare_item`, `get_item`, `refresh`, `seer_status`. Most take filters, so narrow questions get small answers. Money is in copper.

## Tests

```sh
npm install && npm test   # the end-to-end tests need lua5.1
```
