# ⚜ Emberfall Online — Shards of the Dawn

A complete single-file-stack browser MMORPG: no dependencies, no build step, no assets to download.
Everything — world, characters, monsters, music — is generated procedurally in JavaScript.

## Play

**Multiplayer (recommended)** — start the realm server (plain Node, zero dependencies):

```
node emberfall/server.js
```

Then open `http://localhost:8377`. Anyone else who opens that address sees you in the world,
walks beside you, and talks in real chat (press **Enter** to type).

- **Same network:** friend opens `http://YOUR-LAN-IP:8377` (find it with `ipconfig`; allow Node through Windows Firewall when prompted).
- **Different locations:** expose the server with a tunnel — e.g. `cloudflared tunnel --url http://localhost:8377`
  (free, no account) and send the generated `https://…` link — or put both PCs on a Tailscale network,
  or forward TCP 8377 on your router. WebSockets work through all of these.
- **Always-on:** deploy this folder to any free Node host (Render, Railway, Fly). `server.js` has zero
  dependencies and respects the `PORT` env var — no build step needed.

**Solo** — just open `index.html` directly (double-click); the game plays fully offline.

> **Shared world:** monsters are fully synced — one shared HP pool, so you can gang up on the same
> wolf or boss. Monsters chase and attack whichever player is closest, friends' damage numbers appear
> in gold, and each kill rewards its killer (boss kills reward the whole party). The longest-connected
> player quietly "stewards" the monster simulation and hands off automatically if they leave.
> Loot rolls, quests, and saves stay per-player, so everyone keeps their own progression.

## Controls

| Key | Action |
|---|---|
| WASD / Arrows | Move |
| Mouse | Aim |
| Click / `1`–`4` | Attack & skills |
| Click a person/chest/flower | Talk / open / gather |
| Right-click | Context menu — Talk, Inspect, Wave, Attack |
| `Space` | Dodge roll (i-frames) |
| `E` | Talk / gather / open chests / fish at any shoreline |
| `Esc` | Pause menu — settings, save, exit |
| `I` / `C` / `L` | Inventory / Character / Quest log |
| `5` / `6` | Health / mana potion |
| `M` | Mute |
| `Esc` | Close panels |

## The game

- **3 classes** — Warrior, Mage, Ranger — each with 4 skills unlocking at levels 1/2/5/8.
- **10-quest campaign** to level 10: from wolf culls outside Havenbrook, through the Whisperwood
  and the Ember Caves, past the miniboss **Gloomfang**, to the multi-phase **Blightroot Warden**.
- **5 zones** on one seamless 140×140 map with day/night cycle and dynamic 2D lighting.
- **Loot & economy** — 4 rarity tiers, **5 equipment slots** (weapon, armor, helm, boots, trinket),
  potions, a shop that buys and sells, 8 hidden treasure chests, and gold-dropping elites.
- **Character & bag screen** (`I`) — animated paper-doll with equipment columns, 20-slot bag,
  click-to-equip, right-click item menus (Equip / Use / Drop), and tooltips that compare
  stats against what you're wearing with green/red deltas.
- **Class-locked weapons** — swords for Warriors, staves for Mages, bows for Rangers, four tiers
  each. Quest rewards, chest loot, and Bram's stock all resolve to your class's variant.
- **Visible weapon tiers** — your equipped weapon changes your character's in-hand model
  (wooden → rusty → steel → glowing Emberforged → radiant tier-3), for all three classes,
  visible to other players in multiplayer.
- **Set bonuses** — 2+ matched Ember pieces: +4 Atk/+4 Def; 2+ Dawn pieces: +8 Atk/+8 Def/+8% Crit.
  Shown on the character sheet and flagged in item tooltips.
- **PvP duels** — right-click a fellow player → ⚔️ Duel. A 3-2-1 countdown, then fight: dodge
  rolls grant i-frames, and the first player beaten below 10% HP yields (no death). Victories are
  announced realm-wide, count toward ranked score, and unlock the Duelist achievement at 3 wins.
- **Trading** — right-click a fellow player → 💱 Trade opens a two-way trade window showing
  **both characters face to face**: each side offers items and gold, any change resets acceptance,
  and the swap executes when both accept. **The townsfolk trade too** — they make an offer,
  accept fair deals, and haggle if you lowball them. 🎁 Give item still works for quick
  one-way gifts (villagers say thanks and sometimes tip you back).
- **Drag & drop everywhere** — rearrange your bag freely (stacks merge), drag skills between
  hotbar slots to remap keys 1-4, and drag any potion or food onto the 5/6 slots to rebind them.
- **Hotbar tooltips** — hover any slot for the skill's name, effect, mana cost, cooldown,
  and unlock level.
- **Target frame** — click a monster to lock it; its name, level, and live HP bar sit top-center
  (gold for elites, purple for bosses), clearing on death or when it leaves range.
- **Ground loot** — monsters drop items onto the field with rarity-colored glow (rares get a light
  beam); walk near to magnet them up. Junk loot (pelts, tusks, shards) exists to sell to Bram,
  and you can drag items out of your bag to toss them on the ground.
- **Ranked leaderboard** (`P`) — Top 10 by score (levels, quests, kills, achievements). Live and
  persistent on the realm server; a local board of your own characters when playing solo.
- **Fishing** — cast at any shoreline with `E`, reel on the bite; three fish of rising rarity.
- **8 achievements** with unlock toasts, tracked on the character sheet.
- **Weather** — drifting cloud shadows and passing rain fronts.
- **Pause menu** (`Esc`) with persisted settings: music, SFX, screen shake, damage numbers.
- **Simulated online world** — named players roaming, world chat, online counter.
- **Autosave** every 15 s to localStorage, with a Continue button on the title screen.

## Code map

| File | Contents |
|---|---|
| `js/data.js` | Classes, skills, items, enemies, quests, NPCs, chat lines |
| `js/world.js` | Map generation, tile rendering, minimap |
| `js/entities.js` | Player, enemy AI, NPCs, bots, chests, procedural character art |
| `js/systems.js` | Combat, XP, loot, inventory, quests, save/load, audio synth |
| `js/ui.js` | HUD, panels, dialogue, shop, chat, quest tracker |
| `js/main.js` | Game loop, input, render pipeline, lighting, title screen |
