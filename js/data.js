// ============================================================
// EMBERFALL ONLINE — data.js : constants, classes, items,
// enemies, quests, NPCs, chat lines
// ============================================================
'use strict';

const TILE = 32;
const MAP_W = 240, MAP_H = 240;
const MAX_LEVEL = 50;

// Global game state container
const G = {
  canvas: null, ctx: null,
  W: 0, H: 0,
  keys: {}, mouse: { x: 0, y: 0, down: false },
  time: 0, dayTime: 0.30,        // 0..1, 0.30 = morning
  DAY_LENGTH: 300,               // seconds per full cycle
  state: 'title',                // title | play | dead | victory
  player: null,
  enemies: [], npcs: [], bots: [],
  projectiles: [], particles: [], floaters: [],
  camera: { x: 0, y: 0 },
  quests: {},                    // id -> {state:'avail'|'active'|'done'|'turned', progress}
  shake: 0,
  zoneShown: '',
  gatherNodes: [], chests: [], groundItems: [], portals: [], vaultPos: null,
  bossDead: false,
  audio: null,
  paused: false,
  settings: { music: true, sfx: true, shake: true, dmgNums: true },
  weather: null, fishing: null,
  target: null,
};

// long-form MMO curve: gentle to 10, a real journey to 50
function xpNeed(level) { return Math.floor(50 * level + 7 * (level - 1) * (level - 1)); }

// ---------------- Classes ----------------
const CLASSES = {
  warrior: {
    name: 'Warrior', icon: '⚔️',
    desc: 'A stalwart blade of Emberfall. Heavy strikes, high health, thrives in the thick of battle.',
    color: '#b03a3a', hair: '#4a2f1d',
    baseHp: 130, hpPerLv: 24, baseMp: 40, mpPerLv: 5, baseDmg: 10, speed: 165,
    skills: ['w_slash', 'w_cleave', 'w_charge', 'w_titan'],
  },
  mage: {
    name: 'Mage', icon: '🔮',
    desc: 'A scholar of the Ember Arts. Fragile, but rains arcane devastation from afar.',
    color: '#4a5ac9', hair: '#d8d8e8',
    baseHp: 90, hpPerLv: 14, baseMp: 80, mpPerLv: 12, baseDmg: 12, speed: 160,
    skills: ['m_bolt', 'm_nova', 'm_meteor', 'm_storm'],
  },
  ranger: {
    name: 'Ranger', icon: '🏹',
    desc: 'A shadow of the Whisperwood. Swift feet and swifter arrows that never miss twice.',
    color: '#3a7a44', hair: '#7a5a2f',
    baseHp: 105, hpPerLv: 18, baseMp: 60, mpPerLv: 8, baseDmg: 11, speed: 185,
    skills: ['r_shot', 'r_multi', 'r_pierce', 'r_rain'],
  },
};

// skill types: melee (arc), proj, nova (ring around player), targetaoe (at mouse), dash, multiproj, pierce
const SKILLS = {
  w_slash:  { name: 'Slash',        icon: '🗡️', unlock: 1, mp: 0,  cd: 0.45, type: 'melee',    mult: 1.0, range: 52, arc: 1.9,  desc: 'A quick blade arc at whatever you\'re aiming at.' },
  w_cleave: { name: 'Cleave',       icon: '🪓', unlock: 2, mp: 12, cd: 3.5,  type: 'melee',    mult: 1.9, range: 66, arc: 3.0,  desc: 'A heavy sweeping blow that hits every foe in a wide arc.' },
  w_charge: { name: 'Charge',       icon: '💨', unlock: 5, mp: 15, cd: 6,    type: 'dash',     mult: 1.4, dist: 190,            desc: 'Dash forward, damaging everything in your path.' },
  w_titan:  { name: 'Titan Smash',  icon: '🌋', unlock: 8, mp: 30, cd: 10,   type: 'nova',     mult: 3.2, range: 120, stun: 1.4, desc: 'A colossal slam — massive damage all around you, and stuns.' },
  m_bolt:   { name: 'Ember Bolt',   icon: '✨', unlock: 1, mp: 0,  cd: 0.5,  type: 'proj',     mult: 1.0, speed: 430, range: 280, desc: 'Hurl a bolt of ember-fire where you aim. Medium range.' },
  m_nova:   { name: 'Frost Nova',   icon: '❄️', unlock: 2, mp: 16, cd: 5,    type: 'nova',     mult: 1.5, range: 110, slow: 2.2, desc: 'A ring of frost — damages and slows everything nearby.' },
  m_meteor: { name: 'Meteor',       icon: '☄️', unlock: 5, mp: 25, cd: 7,    type: 'targetaoe',mult: 2.6, range: 90, maxDist: 260, desc: 'Call a meteor down on your cursor after a short delay.' },
  m_storm:  { name: 'Arcane Storm', icon: '🌀', unlock: 8, mp: 35, cd: 11,   type: 'nova',     mult: 3.4, range: 150,            desc: 'Unleash an arcane tempest around you. Devastating.' },
  r_shot:   { name: 'Quick Shot',   icon: '➶',  unlock: 1, mp: 0,  cd: 0.38, type: 'proj',     mult: 0.9, speed: 520, range: 310, desc: 'A swift arrow. Fires fast, medium range.' },
  r_multi:  { name: 'Multishot',    icon: '🎯', unlock: 2, mp: 14, cd: 4.5,  type: 'multiproj',mult: 0.85, speed: 500, range: 250, count: 5, spread: 0.55, desc: 'Loose a fan of five arrows at once. Short range.' },
  r_pierce: { name: 'Piercing Bolt',icon: '⚡', unlock: 5, mp: 18, cd: 6,    type: 'pierce',   mult: 2.2, speed: 640, range: 420, desc: 'A charged bolt that pierces every foe in a long line.' },
  r_rain:   { name: 'Arrow Storm',  icon: '🌧️', unlock: 8, mp: 32, cd: 10,   type: 'targetaoe',mult: 2.9, range: 100, maxDist: 280, desc: 'Blanket the area under your cursor with arrows.' },
};

// ---------------- Items ----------------
// slot: weapon | armor | trinket | use
const ITEMS = {
  // consumables
  hp_potion:   { name: 'Health Potion',   icon: '🧪', slot: 'use', rar: 0, heal: 45,  price: 20, desc: 'Restores 45 health.' },
  hp_potion2:  { name: 'Greater Healing', icon: '⚗️', slot: 'use', rar: 1, heal: 110, price: 55, desc: 'Restores 110 health.' },
  mp_potion:   { name: 'Mana Potion',     icon: '💧', slot: 'use', rar: 0, mana: 40,  price: 20, desc: 'Restores 40 mana.' },
  moonpetal:   { name: 'Moonpetal',       icon: '🌸', slot: 'quest', rar: 1, desc: 'A luminous flower that blooms only in the Whisperwood.' },
  sunberry:    { name: 'Sunberry',        icon: '🍒', slot: 'use', rar: 0, heal: 10, price: 8, desc: 'Sweet meadow fruit. +10 HP.' },
  // junk loot — exists to be sold to Bram
  wolf_pelt:   { name: 'Wolf Pelt',       icon: '🐾', slot: 'junk', rar: 0, price: 8,  desc: 'A thick grey pelt. Bram pays coin for these.' },
  boar_tusk:   { name: 'Boar Tusk',       icon: '🦴', slot: 'junk', rar: 0, price: 10, desc: 'Curved and sharp. Sellable.' },
  blight_dust: { name: 'Blight Dust',     icon: '🌫️', slot: 'junk', rar: 1, price: 14, desc: 'Residue of corrupted magic. Worth good coin.' },
  ember_shard: { name: 'Ember Shard',     icon: '🔶', slot: 'junk', rar: 1, price: 20, desc: 'A warm crystal from the deep caves.' },
  // fish (catch at any shoreline with E)
  minnow:      { name: 'Silver Minnow',   icon: '🐟', slot: 'use', rar: 0, heal: 12, price: 20, desc: 'A light snack, or a few coins at Bram\'s. +12 HP.' },
  trout:       { name: 'Ember Trout',     icon: '🐠', slot: 'use', rar: 1, heal: 35, price: 50, desc: 'Its scales shimmer like coals. +35 HP.' },
  koi:         { name: 'Moonlit Koi',     icon: '🎏', slot: 'use', rar: 2, heal: 80, price: 150, desc: 'A legend among fishermen. +80 HP.' },
  warden_key:  { name: 'Warden\'s Key',   icon: '🗝️', slot: 'quest', rar: 3, desc: 'An obsidian key humming with corrupted power. It opens the Ashen Ruins.' },
  // weapons (atk) — tier drives the in-hand appearance; wclass locks them to a class.
  // Rewards resolve to your class's variant automatically.
  rusty_sword: { name: 'Rusty Blade',     icon: '🗡️', slot: 'weapon', rar: 0, atk: 3,  tier: 0, wclass: 'warrior', price: 30, desc: '+3 Attack. It has seen better centuries. (Warrior)' },
  soldier_wpn: { name: 'Soldier\'s Blade',icon: '⚔️', slot: 'weapon', rar: 1, atk: 7,  tier: 1, wclass: 'warrior', price: 90, desc: '+7 Attack. Standard issue of the Emberguard. (Warrior)' },
  ember_wpn:   { name: 'Emberforged Edge',icon: '🔥', slot: 'weapon', rar: 2, atk: 13, tier: 2, wclass: 'warrior', set: 'ember', price: 220, desc: '+13 Attack. Forged in Bram\'s deepest fires. (Warrior)' },
  wardenbane:  { name: 'Wardenbane',      icon: '☀️', slot: 'weapon', rar: 3, atk: 22, tier: 3, wclass: 'warrior', set: 'dawn', price: 999, desc: '+22 Attack. Light itself, given an edge. (Warrior)' },
  cracked_staff:{name: 'Splintered Staff',icon: '🪄', slot: 'weapon', rar: 0, atk: 3,  tier: 0, wclass: 'mage', price: 30, desc: '+3 Attack. Still hums, faintly. (Mage)' },
  adept_staff: { name: 'Adept\'s Staff',  icon: '🪄', slot: 'weapon', rar: 1, atk: 7,  tier: 1, wclass: 'mage', price: 90, desc: '+7 Attack. A proper focus for the Ember Arts. (Mage)' },
  ember_staff: { name: 'Emberflow Staff', icon: '🔥', slot: 'weapon', rar: 2, atk: 13, tier: 2, wclass: 'mage', set: 'ember', price: 220, desc: '+13 Attack. The orb burns with living flame. (Mage)' },
  dawncaller:  { name: 'Dawncaller',      icon: '☀️', slot: 'weapon', rar: 3, atk: 22, tier: 3, wclass: 'mage', set: 'dawn', price: 999, desc: '+22 Attack. It channels the buried light. (Mage)' },
  bent_bow:    { name: 'Bent Shortbow',   icon: '🏹', slot: 'weapon', rar: 0, atk: 3,  tier: 0, wclass: 'ranger', price: 30, desc: '+3 Attack. Shoots mostly straight. (Ranger)' },
  hunter_bow:  { name: 'Hunter\'s Bow',   icon: '🏹', slot: 'weapon', rar: 1, atk: 7,  tier: 1, wclass: 'ranger', price: 90, desc: '+7 Attack. Whisperwood yew, well strung. (Ranger)' },
  ember_bow:   { name: 'Emberstring Bow', icon: '🔥', slot: 'weapon', rar: 2, atk: 13, tier: 2, wclass: 'ranger', set: 'ember', price: 220, desc: '+13 Attack. The string glows like a forge line. (Ranger)' },
  dawnwing:    { name: 'Dawnwing',        icon: '☀️', slot: 'weapon', rar: 3, atk: 22, tier: 3, wclass: 'ranger', set: 'dawn', price: 999, desc: '+22 Attack. Every arrow flies with the sunrise. (Ranger)' },
  // tier 4 — Frostpeak (lv ~25)
  frost_blade: { name: 'Frostbrand',      icon: '🧊', slot: 'weapon', rar: 3, atk: 42, tier: 4, wclass: 'warrior', set: 'frost', price: 2400, desc: '+42 Attack. Cold enough to burn. (Warrior)' },
  frost_staff: { name: 'Glacier Rod',     icon: '🧊', slot: 'weapon', rar: 3, atk: 42, tier: 4, wclass: 'mage', set: 'frost', price: 2400, desc: '+42 Attack. Winter, distilled. (Mage)' },
  frost_bow:   { name: 'Whitewind Bow',   icon: '🧊', slot: 'weapon', rar: 3, atk: 42, tier: 4, wclass: 'ranger', set: 'frost', price: 2400, desc: '+42 Attack. Its arrows never land warm. (Ranger)' },
  // tier 5 — the Shattered Spire (lv ~45)
  hollow_blade:{ name: 'Kingsgrief',      icon: '🌑', slot: 'weapon', rar: 3, atk: 78, tier: 5, wclass: 'warrior', set: 'hollow', price: 9999, desc: '+78 Attack. It drinks the light around it. (Warrior)' },
  hollow_staff:{ name: 'Nullheart Scepter',icon:'🌑', slot: 'weapon', rar: 3, atk: 78, tier: 5, wclass: 'mage', set: 'hollow', price: 9999, desc: '+78 Attack. Silence, weaponized. (Mage)' },
  hollow_bow:  { name: 'Eventide Bow',    icon: '🌑', slot: 'weapon', rar: 3, atk: 78, tier: 5, wclass: 'ranger', set: 'hollow', price: 9999, desc: '+78 Attack. Loosed from the space between stars. (Ranger)' },
  // armor (def, hp) — vt = visual tier drawn on the character (0 cloth..6 hollow)
  cloth_vest:  { name: 'Traveler\'s Garb',icon: '👕', slot: 'armor', rar: 0, def: 1, hp: 10,  vt: 0, price: 25, desc: '+1 Defense, +10 Health.' },
  leather_vest:{ name: 'Leather Jerkin',  icon: '🦺', slot: 'armor', rar: 1, def: 3, hp: 25,  vt: 1, price: 80, desc: '+3 Defense, +25 Health.' },
  ember_mail:  { name: 'Embersteel Mail', icon: '🛡️', slot: 'armor', rar: 2, def: 6, hp: 55,  vt: 3, set: 'ember', price: 210, desc: '+6 Defense, +55 Health.' },
  dawn_plate:  { name: 'Dawnplate',       icon: '💠', slot: 'armor', rar: 3, def: 10, hp: 100, vt: 4, set: 'dawn', price: 999, desc: '+10 Defense, +100 Health. Worn by heroes of legend.' },
  frost_mail:  { name: 'Glacier Mail',    icon: '❄️', slot: 'armor', rar: 3, def: 16, hp: 240, vt: 5, set: 'frost', price: 2400, desc: '+16 Defense, +240 Health. Cold-forged in Frostpeak.' },
  hollow_plate:{ name: 'Plate of the Hollow King', icon: '🖤', slot: 'armor', rar: 3, def: 26, hp: 520, vt: 6, set: 'hollow', price: 9999, desc: '+26 Defense, +520 Health. It weighs nothing at all.' },
  // helms (def, hp)
  leather_cap: { name: 'Leather Cap',     icon: '🧢', slot: 'helm', rar: 0, def: 1, hp: 8,   vt: 1, price: 25, desc: '+1 Defense, +8 Health.' },
  iron_helm:   { name: 'Iron Helm',       icon: '⛑️', slot: 'helm', rar: 1, def: 2, hp: 20,  vt: 2, price: 75, desc: '+2 Defense, +20 Health.' },
  ember_helm:  { name: 'Emberguard Helm', icon: '🪖', slot: 'helm', rar: 2, def: 4, hp: 40,  vt: 3, set: 'ember', price: 190, desc: '+4 Defense, +40 Health.' },
  dawn_crown:  { name: 'Crown of Dawn',   icon: '👑', slot: 'helm', rar: 3, def: 6, hp: 70,  vt: 4, set: 'dawn', price: 999, desc: '+6 Defense, +70 Health. It hums with old light.' },
  frost_helm:  { name: 'Rimehorn Helm',   icon: '🦌', slot: 'helm', rar: 3, def: 10, hp: 160, vt: 5, set: 'frost', price: 2400, desc: '+10 Defense, +160 Health.' },
  hollow_helm: { name: 'Hollow Visage',   icon: '🎭', slot: 'helm', rar: 3, def: 17, hp: 340, vt: 6, set: 'hollow', price: 9999, desc: '+17 Defense, +340 Health. It has no eye holes. It does not need them.' },
  // boots (spd, def)
  worn_boots:  { name: 'Worn Boots',      icon: '👞', slot: 'boots', rar: 0, spd: 6,          vt: 0, price: 25, desc: '+6 Move speed.' },
  scout_boots: { name: 'Scout\'s Boots',  icon: '🥾', slot: 'boots', rar: 1, spd: 12, def: 1, vt: 1, price: 80, desc: '+12 Move speed, +1 Defense.' },
  ember_treads:{ name: 'Embersteel Treads',icon:'🦿', slot: 'boots', rar: 2, spd: 16, def: 2, vt: 3, set: 'ember', price: 200, desc: '+16 Move speed, +2 Defense.' },
  dawn_striders:{name: 'Dawnstriders',    icon: '👢', slot: 'boots', rar: 3, spd: 22, def: 4, vt: 4, set: 'dawn', price: 999, desc: '+22 Move speed, +4 Defense. The ground barely notices you.' },
  frost_treads:{ name: 'Glacier Treads',  icon: '⛸️', slot: 'boots', rar: 3, spd: 26, def: 8, vt: 5, set: 'frost', price: 2400, desc: '+26 Move speed, +8 Defense.' },
  hollow_striders:{name:'Voidstep Boots', icon: '🌫️', slot: 'boots', rar: 3, spd: 32, def: 12, vt: 6, set: 'hollow', price: 9999, desc: '+32 Move speed, +12 Defense. Your footsteps make no sound.' },
  // trinkets
  wolf_charm:  { name: 'Wolf-Fang Charm', icon: '🦷', slot: 'trinket', rar: 1, crit: 6,  price: 70, desc: '+6% Critical chance.' },
  gloom_eye:   { name: 'Eye of Gloomfang',icon: '👁️', slot: 'trinket', rar: 2, crit: 10, spd: 10, price: 260, desc: '+10% Crit, +10 Move speed.' },
  shard_dawn:  { name: 'Shard of the Dawn',icon:'🌟', slot: 'trinket', rar: 3, crit: 15, spd: 18, set: 'dawn', price: 999, desc: '+15% Crit, +18 Move speed. It is warm to the touch.' },
  depth_pearl: { name: 'Pearl of the Depths', icon: '🫧', slot: 'trinket', rar: 3, crit: 12, hp: 60, spd: 8, price: 999, desc: '+12% Crit, +60 Health, +8 Speed. It remembers the dark below the pond.' },
  hollow_crown:{ name: 'The Hollow Crown', icon: '👁️‍🗨️', slot: 'trinket', rar: 3, crit: 20, spd: 20, hp: 200, set: 'hollow', price: 9999, desc: '+20% Crit, +20 Speed, +200 Health. Heavy is the head.' },
  // mounts — use once to stable it, then press Z to ride
  horse_whistle:{ name: 'Chestnut Courser', icon: '🐎', slot: 'mount', rar: 1, mvt: 0, price: 250, desc: 'A loyal riding horse. Use to stable, press Z to ride. +70% speed.' },
  elk_whistle: { name: 'Frostpeak Elk',    icon: '🦌', slot: 'mount', rar: 2, mvt: 1, price: 2000, desc: 'A pale elk of the high snow. Use to stable, press Z to ride. +70% speed.' },
  void_charger:{ name: 'Void Charger',     icon: '🐴', slot: 'mount', rar: 3, mvt: 2, price: 9999, desc: 'The Hollow King\'s own steed, mane of violet flame. Use to stable, press Z to ride. +70% speed.' },
  // expansion gather + junk
  cinder_bloom:{ name: 'Cinderbloom',     icon: '🌺', slot: 'quest', rar: 1, desc: 'A flower that blooms only in scorched earth.' },
  frost_lily:  { name: 'Frost Lily',      icon: '💮', slot: 'quest', rar: 1, desc: 'It blooms at the edge of the ice.' },
  gloomcap:    { name: 'Gloomcap',        icon: '🍄', slot: 'quest', rar: 1, desc: 'A mushroom that drinks the mire\'s dark.' },
  ash_fang:    { name: 'Ash-Hound Fang',  icon: '🔥', slot: 'junk', rar: 1, price: 35, desc: 'Still warm. Sellable.' },
  ice_core:    { name: 'Glacial Core',    icon: '💎', slot: 'junk', rar: 1, price: 60, desc: 'A shard of living winter. Valuable.' },
  mire_pearl:  { name: 'Bog Pearl',       icon: '⚪', slot: 'junk', rar: 2, price: 110, desc: 'Beauty from the muck. Very sellable.' },
  void_sliver: { name: 'Void Sliver',     icon: '🕳️', slot: 'junk', rar: 2, price: 180, desc: 'A splinter of nothing. Worth a great deal of something.' },
};

// ---------------- Enemies ----------------
const ENEMY_TYPES = {
  wolf:     { name: 'Grey Wolf',        lv: 1,  hp: 32,   dmg: 6,  xp: 24,  speed: 92,  gold: [2, 6],   aggroR: 150, kind: 'wolf',    scale: 1.0, drops: [['wolf_pelt', .45], ['hp_potion', .10], ['wolf_charm', .04]] },
  boar:     { name: 'Wild Boar',        lv: 2,  hp: 48,   dmg: 8,  xp: 30,  speed: 105, gold: [3, 7],   aggroR: 130, kind: 'boar',    scale: 1.0, drops: [['boar_tusk', .50], ['sunberry', .15], ['hp_potion', .08]] },
  sprite:   { name: 'Blight Sprite',    lv: 3,  hp: 50,   dmg: 9,  xp: 36,  speed: 78,  gold: [4, 9],   aggroR: 160, kind: 'sprite',  scale: 1.0, drops: [['blight_dust', .40], ['mp_potion', .10], ['wolf_charm', .04]] },
  bat:      { name: 'Cave Shrieker',    lv: 4,  hp: 62,   dmg: 11, xp: 46,  speed: 118, gold: [5, 11],  aggroR: 175, kind: 'bat',     scale: 1.0, drops: [['ember_shard', .28], ['hp_potion', .10], ['scout_boots', .04]] },
  slime:    { name: 'Ember Slime',      lv: 5,  hp: 95,   dmg: 14, xp: 60,  speed: 52,  gold: [7, 14],  aggroR: 140, kind: 'slime',   scale: 1.0, drops: [['ember_shard', .35], ['hp_potion2', .09], ['iron_helm', .04]] },
  cultist:  { name: 'Blightroot Cultist',lv: 7, hp: 130,  dmg: 17, xp: 88,  speed: 82,  gold: [10, 20], aggroR: 210, kind: 'cultist', scale: 1.0, ranged: true, drops: [['blight_dust', .45], ['hp_potion2', .12], ['ember_helm', .05], ['gloom_eye', .02]] },
  gloomfang:{ name: 'Gloomfang',        lv: 6,  hp: 480,  dmg: 21, xp: 380, speed: 122, gold: [60, 90], aggroR: 240, kind: 'wolf',    scale: 1.8, boss: true, drops: [['gloom_eye', 1]] },
  drowned:  { name: 'The Drowned',      lv: 9,  hp: 230,  dmg: 22, xp: 120, speed: 74,  gold: [15, 28], aggroR: 170, kind: 'drowned', scale: 1.0, drops: [['blight_dust', .35], ['hp_potion2', .15], ['dawn_crown', .015]] },
  maw:      { name: 'Maw of the Deep',  lv: 12, hp: 2600, dmg: 34, xp: 999, speed: 70,  gold: [300, 450], aggroR: 280, kind: 'maw',  scale: 2.6, boss: true, ranged: true, drops: [['depth_pearl', 1]] },
  // ---- Scorched Steppe (lv 12-20) ----
  ashhound: { name: 'Ash Hound',        lv: 13, hp: 340,  dmg: 30, xp: 150, speed: 108, gold: [18, 34],  aggroR: 170, kind: 'wolf',   scale: 1.05, fur: '#7a3a28', eye: '#ff9a3a', drops: [['ash_fang', .4], ['hp_potion2', .12]] },
  emberwisp:{ name: 'Ember Wisp',       lv: 15, hp: 280,  dmg: 34, xp: 180, speed: 88,  gold: [20, 38],  aggroR: 180, kind: 'sprite', scale: 1.1, tint: '255,160,70', drops: [['ember_shard', .4], ['mp_potion', .15]] },
  cindergolem:{name: 'Cinder Golem',    lv: 18, hp: 700,  dmg: 46, xp: 300, speed: 48,  gold: [35, 60],  aggroR: 150, kind: 'golem',  scale: 1.2, rock: '#4a3a34', glow: '255,120,40', drops: [['ember_shard', .5], ['frost_helm', .01]] },
  // ---- Frostpeak Highlands (lv 20-32) ----
  frostwolf:{ name: 'Frostmane Wolf',   lv: 23, hp: 800,  dmg: 60, xp: 420, speed: 118, gold: [40, 70],  aggroR: 180, kind: 'wolf',   scale: 1.15, fur: '#b8d4e4', eye: '#5ad4ff', drops: [['ice_core', .35], ['hp_potion2', .15]] },
  iceshade: { name: 'Ice Shade',        lv: 27, hp: 950,  dmg: 72, xp: 560, speed: 84,  gold: [50, 85],  aggroR: 220, kind: 'cultist',scale: 1.05, robe: '#3a5a74', rune: '#8ae8ff', ranged: true, drops: [['ice_core', .4], ['frost_treads', .012]] },
  frostgiant:{name: 'Frost Giant',      lv: 30, hp: 1900, dmg: 92, xp: 850, speed: 55,  gold: [80, 130], aggroR: 170, kind: 'golem',  scale: 1.7, rock: '#7a9ab0', glow: '140,220,255', drops: [['ice_core', .6], ['frost_mail', .02], ['elk_whistle', .03]] },
  // ---- The Duskmire (lv 30-42) ----
  bogfiend: { name: 'Bog Fiend',        lv: 34, hp: 1500, dmg: 100, xp: 950, speed: 76, gold: [70, 120], aggroR: 180, kind: 'drowned',scale: 1.15, tint: '#5a6a3a', drops: [['mire_pearl', .3], ['hp_potion2', .2]] },
  duskwisp: { name: 'Dusk Wisp',        lv: 37, hp: 1200, dmg: 112, xp: 1050, speed: 92, gold: [80, 130], aggroR: 200, kind: 'sprite', scale: 1.2, tint: '190,240,140', drops: [['mire_pearl', .35], ['mp_potion', .25]] },
  mirehulk: { name: 'Mire Hulk',        lv: 39, hp: 2600, dmg: 125, xp: 1350, speed: 46, gold: [110, 170], aggroR: 160, kind: 'slime', scale: 1.5, tint1: '150,180,90', tint2: '70,100,40', drops: [['mire_pearl', .5], ['hollow_helm', .008]] },
  // ---- The Shattered Spire (lv 40-50) ----
  voidknight:{name: 'Void Knight',      lv: 44, hp: 3400, dmg: 155, xp: 1900, speed: 88, gold: [150, 240], aggroR: 220, kind: 'cultist', scale: 1.15, robe: '#241a34', rune: '#b06aff', drops: [['void_sliver', .45], ['hollow_striders', .01]] },
  hollowking:{name: 'The Hollow King',  lv: 50, hp: 32000, dmg: 210, xp: 12000, speed: 66, gold: [2500, 4000], aggroR: 320, kind: 'hollow', scale: 2.8, boss: true, ranged: true, drops: [['hollow_crown', 1], ['hollow_plate', 1], ['void_charger', .5]] },
  warden:   { name: 'The Blightroot Warden', lv: 10, hp: 1500, dmg: 26, xp: 900, speed: 62, gold: [200, 300], aggroR: 300, kind: 'warden', scale: 2.4, boss: true, ranged: true, drops: [['shard_dawn', 1], ['dawn_plate', 1]] },
};

// ---------------- Quests ----------------
// type: talk | kill | collect | boss   target: npcId | enemyType | itemId
const QUESTS = [
  { id: 'q1', title: 'A Rude Awakening', giver: 'maren', type: 'talk', target: 'maren', count: 1,
    desc: 'You washed ashore south of Havenbrook with nothing but a strange warmth in your chest. Elder Maren wishes to speak with you.',
    text: 'So. The sea gives us a stranger on the very night the Blightroot stirs... That is no coincidence, child. The warmth you feel? You carry a Shard of the Dawn — the old light our ancestors buried. Rest, then prove your arm. Emberfall will need it.',
    xp: 40, gold: 10, item: 'rusty_sword', prereq: null },
  { id: 'q2', title: 'Wolves at the Gate', giver: 'maren', type: 'kill', target: 'wolf', count: 5,
    desc: 'The wolves of the southern meadow have grown fearless — and strangely dark of eye. Cull five of them.',
    text: 'The wolves no longer fear our torches. Something in the north twists them. Thin the pack in the meadow south and east of the village, and bring me word.',
    done: 'Five pelts, and each one veined with black... The Blight reaches further than I feared. You have a soldier\'s heart. Take this.',
    xp: 110, gold: 25, item: 'leather_vest', prereq: 'q1' },
  { id: 'q2b', title: 'Berries for the Road', giver: 'lyra', type: 'collect', target: 'sunberry', count: 4,
    desc: 'Gather 4 Sunberries from the low bushes of Southmeadow for Lyra\'s traveling rations.',
    text: 'Before you go chasing wolves and worse — food. Sunberries grow on the low bushes across the meadow, east and west of the road. Four handfuls, please. Eat the spares; they\'re good for you.',
    done: 'Sweet as summer itself. Here — a potion for the road, with my thanks.',
    xp: 70, gold: 12, item: 'hp_potion', prereq: 'q2' },
  { id: 'q2c', title: 'Boars in the Barley', giver: 'bram', type: 'kill', target: 'boar', count: 6,
    desc: 'Wild boars are tearing up the meadow crops. Bram wants six of them driven off — permanently.',
    text: 'Hear that grunting out there? Boars. Tearing the barley rows to mud. Put down six of them, friend — and keep the tusks, I\'ll buy every one.',
    done: 'That\'s the sound of a quiet field. Solid work. Take these — you\'ll walk faster for it.',
    xp: 110, gold: 25, item: 'worn_boots', prereq: 'q2b' },
  { id: 'q3', title: 'Moonpetals for Lyra', giver: 'lyra', type: 'collect', target: 'moonpetal', count: 3,
    desc: 'Healer Lyra needs three Moonpetals from the Whisperwood to brew wards against the Blight.',
    text: 'The sick grow sicker, and my stores are dust. Moonpetals — the glowing blossoms in the Whisperwood north of here. Three will do. Mind the sprites; they guard the flowers jealously.',
    done: 'Oh, they\'re beautiful... and still warm with moonlight. These will save lives, Shardbearer. Take these potions — you\'ll need them more than I.',
    xp: 100, gold: 15, item: 'hp_potion2', prereq: 'q2c' },
  { id: 'q4', title: 'The Northern Watch', giver: 'maren', type: 'talk', target: 'kael', count: 1,
    desc: 'Scout Kael watches the road at the northern edge of the village. Maren wants you to report to him.',
    text: 'Kael has held the north road alone for a fortnight. He sends back fewer reports each week, and darker ones. Find him at the forest\'s edge — he will know where your Shard must go next.',
    xp: 60, gold: 10, prereq: 'q3' },
  { id: 'q5', title: 'Lights in the Wood', giver: 'kael', type: 'kill', target: 'sprite', count: 8,
    desc: 'Blight Sprites swarm the Whisperwood. Kael asks you to destroy eight of them to clear the road.',
    text: 'See those lights between the trees? Not fireflies. Sprites — bits of the Blight given wing. They took two travelers last week. Burn out eight of them and the road might live again.',
    done: 'Eight, and the wood already breathes easier. You fight like the old stories, Shardbearer. Here — took this off a dead merchant\'s wagon. Better in your hands.',
    xp: 170, gold: 35, item: 'soldier_wpn', prereq: 'q4' },
  { id: 'q6', title: 'Whispers Below', giver: 'kael', type: 'kill', target: 'bat', count: 6,
    desc: 'A shrieking rises from the Ember Caves east of the wood. Silence six of the Cave Shriekers.',
    text: 'East of here the ground opens into the Ember Caves. The shrieking started a moon ago — it carries on the wind at night. Whatever roosts there serves the Blight. Silence six of them.',
    done: 'The nights are quieter already. But you went deep, didn\'t you? I can see it in your eyes. There\'s worse below — I\'d stake my bow on it. Here, take my old helm — you\'ll need it more than I.',
    xp: 190, gold: 40, item: 'iron_helm', prereq: 'q5' },
  { id: 'q7', title: 'Slime and Punishment', giver: 'bram', type: 'kill', target: 'slime', count: 5,
    desc: 'Ember Slimes are dissolving Bram\'s ore veins in the deep caves. Smash five of them.',
    text: 'Ha! The Shardbearer, in my smithy! Listen — those caves feed my forge, and now they\'re crawling with slimes that EAT the ore. Eat it! Crack five of them open and I\'ll hammer you something special.',
    done: 'HA! Look at you, dripping slime and glory! A deal\'s a deal — Embersteel, quenched in the last true fire. Wear it well.',
    xp: 210, gold: 50, item: 'ember_mail', prereq: 'q6' },
  { id: 'q8', title: 'The Beast of the Deep', giver: 'kael', type: 'kill', target: 'gloomfang', count: 1,
    desc: 'Gloomfang, the great blighted wolf, guards the key to the Ashen Ruins in its cave lair. Slay it.',
    text: 'I found the source of the wolves\' madness. A beast dens in the deepest chamber of the caves — Gloomfang, first of the corrupted. Around its neck hangs an obsidian key... the key to the Ashen Ruins. You know what must be done.',
    done: 'You... actually killed it. Gods. Then the key is yours, and the Ruins are open. Speak to Maren — she has waited her whole life to say what she must say to you.',
    xp: 320, gold: 70, item: 'ember_wpn', prereq: 'q7' },
  { id: 'q9', title: 'The Ashen Road', giver: 'maren', type: 'kill', target: 'cultist', count: 6,
    desc: 'Cultists of the Blightroot swarm the Ashen Ruins, feeding the Warden. Cut down six of them.',
    text: 'The Ruins were our capital once, before the first Blight. Now its children — the cultists — feed the Warden with stolen light. Take the north road through the wood. Cut through six of them, and the Warden stands alone.',
    done: 'The Warden\'s servants fall and its heart weakens. It is time, Shardbearer. Take these treads of Embersteel — run swift, and finish this.',
    xp: 380, gold: 90, item: 'ember_treads', prereq: 'q8' },
  { id: 'q10', title: 'The Blightroot Warden', giver: 'maren', type: 'kill', target: 'warden', count: 1,
    desc: 'Face the Blightroot Warden in the heart of the Ashen Ruins. End the Blight. Fulfill the prophecy of the Dawn.',
    text: 'A thousand years ago we buried the Dawn to starve the Blight — and it cost us everything. You carry the last Shard. Drive it into the Warden\'s heart, and the long night ends. Go, Shardbearer. Emberfall marches with you.',
    done: 'The light... I can feel it from here. It is done. IT IS DONE! You have given Emberfall its dawn, Shardbearer. Songs will carry your name for a thousand years.',
    xp: 700, gold: 250, item: 'wardenbane', prereq: 'q9' },
  { id: 'q11', title: 'Echoes Below', giver: 'maren', type: 'kill', target: 'maw', count: 1,
    desc: 'Something vast stirs in the Sunken Crypt beneath the meadow pond. Descend the drowned stair (level 8+) and end it.',
    text: 'The Warden is ash, yet the water still whispers. Divers speak of a drowned crypt beneath the pond — and a hunger older than the Blight itself. A stair opened in the shallows the night the Dawn returned. You are the only blade I trust in the dark, Shardbearer.',
    done: 'The pond lies still at last. You have out-fought legend itself. Emberfall has no greater honor left to give — only its gratitude, and this.',
    xp: 800, gold: 500, prereq: 'q10' },

  // ================= ACT 3 — THE HOLLOW CROWN (lv 12-50) =================
  { id: 'q12', title: 'The East Road', giver: 'maren', type: 'talk', target: 'sarra', count: 1,
    desc: 'Captain Sarra of the Emberguard holds an outpost where the meadow burns into the Scorched Steppe, far to the east. Report to her.',
    text: 'The Dawn returned — and something on the eastern horizon noticed. The steppe has been burning for a fortnight with no flame to blame. Captain Sarra holds the east road. She asked for the Shardbearer by name.',
    xp: 600, gold: 100, prereq: 'q11' },
  { id: 'q13', title: 'Hounds of Cinder', giver: 'sarra', type: 'kill', target: 'ashhound', count: 8,
    desc: 'Ash Hounds hunt the Scorched Steppe in burning packs. Cull eight for Captain Sarra.',
    text: 'So you\'re the one. Good — we need legends out here. The hounds came with the burning: wolves of ash and coal, and they hunt my scouts by their heartbeats. Eight of them, Shardbearer.',
    done: 'Eight hounds cold. My scouts might sleep tonight. You\'ve earned Emberguard steel — and Emberguard trust.',
    xp: 1400, gold: 220, prereq: 'q12' },
  { id: 'q14', title: 'The Walking Furnace', giver: 'sarra', type: 'kill', target: 'cindergolem', count: 4,
    desc: 'Cinder Golems — walking furnaces of rock and flame — are razing the steppe. Break four of them.',
    text: 'Something is building soldiers out of the steppe itself. Rock, ash, and a burning heart. My blades chip on their hides. Yours won\'t. Break four and bring me their silence.',
    done: 'Four furnaces gone dark. Whatever forged them will feel that. The trail of ash leads south, to the snow... which should be impossible.',
    xp: 2200, gold: 350, prereq: 'q13' },
  { id: 'q15', title: 'Cold Tidings', giver: 'sarra', type: 'talk', target: 'oskar', count: 1,
    desc: 'Oskar the giant-hunter camps at the foot of the Frostpeak Highlands, in the far southwest. He knows what walks the snow.',
    text: 'Ash that marches into snow and doesn\'t melt — that\'s a message, and I can\'t read it. Oskar can. Giant-hunter, half-mad, camps under Frostpeak. Tell him Sarra still owes him a drink.',
    xp: 900, gold: 150, prereq: 'q14' },
  { id: 'q16', title: 'The White Hunt', giver: 'oskar', type: 'kill', target: 'frostwolf', count: 10,
    desc: 'Frostmane wolves have grown fearless and strange-eyed. Oskar wants ten culled before the pass closes.',
    text: 'Sarra sent you? HA! Then you can fight. The frostmanes stopped fearing my spear a moon ago — their eyes gone blue as deep ice. Ten pelts, southlander. Then we talk about what changed them.',
    done: 'Ten! Not bad for someone with thin blood. Here — took this from a glacier\'s heart. It\'ll bite for you now.',
    xp: 3600, gold: 600, item: 'frost_blade', prereq: 'q15' },
  { id: 'q17', title: 'Shades on the Ice', giver: 'oskar', type: 'kill', target: 'iceshade', count: 6,
    desc: 'Robed shades walk the high glacier, singing to the ice. Destroy six of them.',
    text: 'Now the truth of it: there are shades on the glacier. Robes of frost, voices like cracking ice. They sing, and the wolves listen, and the ash marches. Six of them, hunter. Sing them to sleep.',
    done: 'The glacier\'s quiet... too quiet, like held breath. Take my winter mail — you\'re climbing higher than I ever dared. The shades\' song came FROM somewhere. The mire, southeast. Morwen will know.',
    xp: 4800, gold: 800, item: 'frost_mail', prereq: 'q16' },
  { id: 'q18', title: 'Into the Mire', giver: 'oskar', type: 'talk', target: 'morwen', count: 1,
    desc: 'The witch Morwen keeps a hut in the Duskmire. She has watched the dark longer than anyone living.',
    text: 'Morwen the mire-witch. Don\'t eat anything she offers, don\'t answer questions she asks twice, and don\'t — DON\'T — laugh at the hat. She\'s the only one who remembers what the Spire was.',
    xp: 1400, gold: 250, prereq: 'q17' },
  { id: 'q19', title: 'What the Bog Keeps', giver: 'morwen', type: 'kill', target: 'bogfiend', count: 8,
    desc: 'The mire\'s dead are rising wrong. Put eight Bog Fiends back down.',
    text: 'The Shardbearer, in my bog. I dreamed you\'d come — taller, though. The mire keeps every drowned thing that ever wandered in, and something is winding them up like toys. Eight of them, back in the muck. Then I\'ll tell you who\'s winding.',
    done: 'Back to sleep, poor things. Now listen: the winder sits the broken throne in the Shattered Spire. The Hollow King. The Blight was his FIRST try, dear. You killed his gardener.',
    xp: 6200, gold: 1000, prereq: 'q18' },
  { id: 'q20', title: 'Hulks in the Dark', giver: 'morwen', type: 'kill', target: 'mirehulk', count: 5,
    desc: 'Mire Hulks — mountains of living bog — block every path to the Spire. Clear five.',
    text: 'He knows you\'re coming — he\'s dammed the mire with hulks of moss and hunger. Five stand between you and the Spire road. Bring me a pearl or two if you find them; a witch has expenses.',
    done: 'The road is open, and so is his door. He wanted it that way, of course. Kings are dramatic. Take these boots — you\'ll want to be quick in there.',
    xp: 8000, gold: 1400, item: 'frost_treads', prereq: 'q19' },
  { id: 'q21', title: 'The Shattered Vanguard', giver: 'morwen', type: 'kill', target: 'voidknight', count: 6,
    desc: 'The Hollow King\'s Void Knights patrol the Shattered Spire. Cut down six of his vanguard.',
    text: 'His knights are hollow armor filled with the space where soldiers used to be. They cannot be reasoned with, because there is no one inside to reason. Six, dear. Make the throne room lonely.',
    done: 'Lonely at last. He is waiting at the peak of the Spire — he has been waiting a thousand years. Go make it a disappointment.',
    xp: 11000, gold: 2000, prereq: 'q20' },
  { id: 'q22', title: 'The Hollow Crown', giver: 'morwen', type: 'kill', target: 'hollowking', count: 1,
    desc: 'Climb the Shattered Spire and end the Hollow King. Finish what the Dawn began. (Bring friends.)',
    text: 'A thousand years ago he traded his heart for a crown that would never rust, and his kingdom paid the price — that is the ruin you know as the Spire. The Blight, the Warden, the shades — all of it, him, knocking at the door. Knock back, Shardbearer. Knock HARD.',
    done: 'The crown is dust and the mire is only a mire tonight. You have unmade a thousand years of hunger, dear. There is no song big enough — but they will spend a hundred years trying to write it.',
    xp: 30000, gold: 5000, item: 'hollow_blade', prereq: 'q21' },

  // ================= SIDE QUESTS =================
  { id: 's1', title: 'Blooms from the Burning', giver: 'sarra', type: 'collect', target: 'cinder_bloom', count: 5,
    desc: '(Side) Cinderblooms grow where the steppe burned hottest. Sarra\'s medics need five.',
    text: 'A side matter, if you\'re willing: cinderblooms. They only grow where the burning was worst, and my medics swear by them. Five, when your road allows.',
    done: 'The infirmary thanks you. Fewer scars all around.',
    xp: 1800, gold: 400, item: 'hp_potion2', prereq: 'q13' },
  { id: 's2', title: 'Lilies at the Edge', giver: 'oskar', type: 'collect', target: 'frost_lily', count: 4,
    desc: '(Side) Frost lilies bloom at the glacier\'s edge. Oskar wants four — he won\'t say why.',
    text: 'Frost lilies. Four. ...What? A hunter can\'t like flowers? Four, southlander, and no questions.',
    done: '...They were my daughter\'s favorite. No questions, I said. Take this and go be a hero somewhere.',
    xp: 3000, gold: 700, prereq: 'q16' },
  { id: 's3', title: 'A Witch\'s Grocery List', giver: 'morwen', type: 'collect', target: 'gloomcap', count: 5,
    desc: '(Side) Gloomcaps for Morwen\'s cauldron. Try not to think about what the cauldron is for.',
    text: 'Gloomcaps, five, unbruised. The fresh ones scream a little when picked. That\'s normal. Probably.',
    done: 'Lovely. Dinner — I mean, POTIONS — will be exquisite. Here, your share.',
    xp: 5000, gold: 900, item: 'hp_potion2', prereq: 'q19' },
  { id: 's4', title: 'Giant Trouble', giver: 'bram', type: 'kill', target: 'frostgiant', count: 3,
    desc: '(Side) Bram will pay handsomely for proof that Frost Giants can, in fact, be broken.',
    text: 'They say Frost Giants\' hides turn hammers. As a professional, I take that personally. Break three and bring me the cores — I\'ve got a forge experiment that\'ll either be legendary or explode.',
    done: 'HA! Look at the size of these cores! If the forge survives the week, I\'ll name the blade after you.',
    xp: 4500, gold: 1200, item: 'frost_helm', prereq: 'q15' },
  { id: 's5', title: 'A Taste of the Deep', giver: 'lyra', type: 'collect', target: 'trout', count: 2,
    desc: '(Side) Lyra has a theory that Ember Trout broth restores mana. She needs two fish and one brave cook.',
    text: 'A little bird — fine, it was Bram — says you\'ve taken up fishing. Bring me two Ember Trout? I have a theory about their broth, and theories need soup.',
    done: 'The broth GLOWS. That\'s either wonderful or a war crime — either way, potions for you!',
    xp: 900, gold: 200, item: 'mp_potion', prereq: 'q11' },
];

// ---------------- NPCs ----------------
const NPC_DEFS = [
  { id: 'maren', name: 'Elder Maren', tx: 70, ty: 108, color: '#8a6da8', hair: '#d8d8d8', role: 'Village Elder',
    idle: ['The braziers burn low tonight...', 'The Dawn watches over you, child.', 'Even ash remembers being fire.'] },
  { id: 'lyra', name: 'Healer Lyra', tx: 63, ty: 111, color: '#5a9a6a', hair: '#c9a227', role: 'Healer',
    idle: ['Drink water. Sleep. Stab the Blight. In that order.', 'Every scar is a story the skin tells.', 'Need potions? Bram sells my brews.'] },
  { id: 'bram', name: 'Blacksmith Bram', tx: 77, ty: 111, color: '#a8763a', hair: '#3a2a1a', role: 'Blacksmith', shop: true,
    idle: ['Steel doesn\'t lie, friend.', 'Buy something or stop blocking my light!', 'That Warden ever seen Embersteel? Didn\'t think so.'] },
  { id: 'kael', name: 'Scout Kael', tx: 70, ty: 91, color: '#4a6a4a', hair: '#2a2a2a', role: 'Scout',
    idle: ['Eyes north. Always north.', 'The wood whispers. I\'ve stopped answering.', 'Quiet feet keep loud hearts alive.'] },
  { id: 'sarra', name: 'Captain Sarra', tx: 152, ty: 101, color: '#8a5a2a', hair: '#6a3a1a', role: 'Emberguard Captain',
    idle: ['The steppe burns without fire. Explain that.', 'Hold the line. There is always a line.', 'My scouts don\'t come back from the east lately.'] },
  { id: 'oskar', name: 'Oskar the Hunter', tx: 16, ty: 168, color: '#5a7a9a', hair: '#c8c8c8', role: 'Giant-Hunter',
    idle: ['Cold keeps you honest.', 'I\'ve killed nine giants. The tenth killed my pride.', 'Don\'t laugh at the hat.'] },
  { id: 'morwen', name: 'Witch Morwen', tx: 105, ty: 168, color: '#4a3a5a', hair: '#8a8a9a', role: 'Mire-Witch',
    idle: ['The bog remembers everything it eats.', 'I dreamed of you. You were shorter.', 'The Spire hums at midnight. Listen.'] },
];

const EQUIP_SLOTS = ['weapon', 'armor', 'helm', 'boots', 'trinket'];
const WEAPON_BY_CLASS = {
  warrior: ['rusty_sword', 'soldier_wpn', 'ember_wpn', 'wardenbane', 'frost_blade', 'hollow_blade'],
  mage: ['cracked_staff', 'adept_staff', 'ember_staff', 'dawncaller', 'frost_staff', 'hollow_staff'],
  ranger: ['bent_bow', 'hunter_bow', 'ember_bow', 'dawnwing', 'frost_bow', 'hollow_bow'],
};
const SHOP_STOCK = ['hp_potion', 'mp_potion', 'hp_potion2', 'rusty_sword', 'cloth_vest', 'leather_cap', 'worn_boots', 'wolf_charm', 'horse_whistle'];

// ---------------- Achievements ----------------
const ACHIEVEMENTS = {
  first_blood: { name: 'First Blood',           icon: '🗡️', desc: 'Slay your first monster.' },
  level5:      { name: 'Seasoned',              icon: '⭐', desc: 'Reach level 5.' },
  level10:     { name: 'Shardbearer Ascendant', icon: '🌟', desc: 'Reach level 10.' },
  elite10:     { name: 'Elite Hunter',          icon: '👑', desc: 'Slay 10 elite monsters.' },
  chest_all:   { name: 'Treasure Hunter',       icon: '🗝️', desc: 'Open every treasure chest in the world.' },
  fish5:       { name: 'Gone Fishing',          icon: '🎣', desc: 'Catch 5 fish.' },
  rich:        { name: 'Gold Hoarder',          icon: '🪙', desc: 'Hold 500 gold at once.' },
  duelist:     { name: 'Duelist',               icon: '🤺', desc: 'Win 3 duels against other players.' },
  warden:      { name: 'Dawnbringer',           icon: '⚜️', desc: 'Defeat the Blightroot Warden.' },
};

// treasure chests: [tileX, tileY, tier] — loot scales with tier
const CHEST_SPOTS = [
  [90, 100, 1], [98, 98, 1],            // Southmeadow / near the pond
  [52, 50, 2], [85, 78, 2],             // Whisperwood
  [106, 45, 3], [128, 85, 3],           // Ember Caves
  [38, 12, 4], [100, 10, 4],            // Ashen Ruins
  [16, 205, 5], [36, 226, 5],           // Sunken Crypt (epic tier)
  [170, 30, 6], [210, 80, 6],           // Scorched Steppe
  [30, 170, 7], [70, 200, 7],           // Frostpeak
  [115, 200, 8], [150, 170, 8],         // Duskmire
  [190, 212, 9], [222, 172, 9],         // Shattered Spire
];
const CHEST_LOOT = {
  1: ['hp_potion', 'mp_potion', 'leather_cap', 'worn_boots'],
  2: ['hp_potion2', 'mp_potion', 'wolf_charm', 'iron_helm', 'scout_boots'],
  3: ['hp_potion2', 'soldier_wpn', 'leather_vest', 'ember_helm'],
  4: ['hp_potion2', 'ember_wpn', 'ember_mail', 'ember_treads', 'dawn_crown', 'dawn_striders'],
  5: ['dawn_crown', 'dawn_striders', 'dawn_plate', 'ember_wpn', 'hp_potion2'],
  6: ['hp_potion2', 'ash_fang', 'ember_shard', 'dawn_crown', 'frost_helm'],
  7: ['hp_potion2', 'ice_core', 'frost_blade', 'frost_treads', 'frost_mail'],
  8: ['hp_potion2', 'mire_pearl', 'frost_mail', 'hollow_helm'],
  9: ['void_sliver', 'hollow_helm', 'hollow_striders', 'hollow_blade'],
};

// ---------------- Fake MMO flavor ----------------
const BOT_NAMES = ['Sylvarra', 'DrekTheBold', 'Mooncall', 'xXShadowfellXx', 'Petra_Swift', 'Ironquill', 'Vex', 'Tumbleroot'];
const BOT_CLASSES = ['warrior', 'mage', 'ranger'];
const CHAT_LINES = [
  ['Sylvarra', 'anyone selling moonpetals? paying well'],
  ['DrekTheBold', 'LFG gloomfang, need 2 more'],
  ['Mooncall', 'the sunset over havenbrook never gets old'],
  ['xXShadowfellXx', 'just dinged 8!! titan smash goes HARD'],
  ['Petra_Swift', 'wolves respawn too fast lol'],
  ['Ironquill', 'reminder: bram buys nothing. he only sells. capitalism.'],
  ['Vex', 'who keeps kiting slimes into the village'],
  ['Tumbleroot', 'got lost in the caves again send help'],
  ['DrekTheBold', 'warden dropped shard of the dawn for our tank, grats'],
  ['Sylvarra', 'pro tip: frost nova then meteor. thank me later'],
  ['Mooncall', 'is it just me or are the nights getting longer'],
  ['xXShadowfellXx', 'duel me. anyone. im bored'],
  ['Petra_Swift', 'kael is standing in the same spot again. scouts these days'],
  ['Vex', 'cultists hit like a cart of bricks, bring potions'],
  ['Tumbleroot', 'found a really pretty pond east of the meadow'],
  ['DrekTheBold', 'do NOT go down the pond stairs under level 8. trust me'],
  ['Sylvarra', 'the maw ate our whole party. 10/10 would descend again'],
  ['Ironquill', 'the steppe has been on fire for a WEEK, someone check on Sarra'],
  ['Petra_Swift', 'frost giants drop glacial cores, Bram pays 60g each!!'],
  ['Vex', 'saw the Spire from the mire road. it was looking back'],
  ['Mooncall', 'LF party for Hollow King, lv 45+, bring everything you own'],
];

// utility RNG (seeded)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const NB4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
function lerp(a, b, t) { return a + (b - a) * t; }
