# Changelog

## 0.6.0

- The server now reads Seer's data from the game window, so the addon no longer takes a screenshot on every send. It still falls back to a screenshot when the game is in the background or a message was missed.
- Each send is spread over several frames, to avoid one long frame.
- Bag item tooltips are cached for 2 minutes, and cleared when your gear, level or talents change.
- `/seer status` shows how long the last send took.
- Fixed two Seer servers both acting as the leader after a restart.
- Step-by-step install instructions for Windows and Claude Desktop.

After updating, close the game and run `npx -y wow-seer install` once.

## 0.5.4

- Tools that return several sections say how old each one is.
- XP changes and gear durability are sent when they change.
- `get_guide` numbers steps like Polestar's window and says how many are done.

## 0.5.3

- Fixed `get_trainer` showing the wrong rank and status for each spell.

## 0.5.2

- Update notice: like Questie, Seer tells your guild and group its version and says in chat when a newer one exists.

## 0.5.1

- New integrations: AtlasLoot (where items drop), SkillUp Forever (profession leveling plans), Forever Leveling BiS (gear upgrades), Nova Instance Tracker (hourly dungeon limit) and DataStore (your other characters).
- Clearer hints in game and from the server when something isn't set up.

## 0.5.0

- New integrations: Auctionator (prices), Questie (quest locations), Polestar (guide step), Pawn (gear values) and What's Training (spells to learn).
- New: the last fight from the game's damage meter, and your map position.
- Sends are compressed.
