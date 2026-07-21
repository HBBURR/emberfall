// ============================================================
// EMBERFALL ONLINE — data.js : constants, classes, items,
// enemies, quests, NPCs, chat lines
// ============================================================
'use strict';

const TILE = 32;
const MAP_W = 140, MAP_H = 140;
const MAX_LEVEL = 10;

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
  gatherNodes: [], chests: [], groundItems: [],
  bossDead: false,
  audio: null,
  paused: false,
  settings: { music: true, sfx: true, shake: true, dmgNums: true },
  weather: null, fishing: null,
  target: null,
};

function xpNeed(level) { return Math.floor(55 * level + 22 * (level - 1) * (level - 1)); }

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
  // armor (def, hp)
  cloth_vest:  { name: 'Traveler\'s Garb',icon: '👕', slot: 'armor', rar: 0, def: 1, hp: 10,  price: 25, desc: '+1 Defense, +10 Health.' },
  leather_vest:{ name: 'Leather Jerkin',  icon: '🦺', slot: 'armor', rar: 1, def: 3, hp: 25,  price: 80, desc: '+3 Defense, +25 Health.' },
  ember_mail:  { name: 'Embersteel Mail', icon: '🛡️', slot: 'armor', rar: 2, def: 6, hp: 55,  set: 'ember', price: 210, desc: '+6 Defense, +55 Health.' },
  dawn_plate:  { name: 'Dawnplate',       icon: '💠', slot: 'armor', rar: 3, def: 10, hp: 100, set: 'dawn', price: 999, desc: '+10 Defense, +100 Health. Worn by heroes of legend.' },
  // helms (def, hp)
  leather_cap: { name: 'Leather Cap',     icon: '🧢', slot: 'helm', rar: 0, def: 1, hp: 8,   price: 25, desc: '+1 Defense, +8 Health.' },
  iron_helm:   { name: 'Iron Helm',       icon: '⛑️', slot: 'helm', rar: 1, def: 2, hp: 20,  price: 75, desc: '+2 Defense, +20 Health.' },
  ember_helm:  { name: 'Emberguard Helm', icon: '🪖', slot: 'helm', rar: 2, def: 4, hp: 40,  set: 'ember', price: 190, desc: '+4 Defense, +40 Health.' },
  dawn_crown:  { name: 'Crown of Dawn',   icon: '👑', slot: 'helm', rar: 3, def: 6, hp: 70,  set: 'dawn', price: 999, desc: '+6 Defense, +70 Health. It hums with old light.' },
  // boots (spd, def)
  worn_boots:  { name: 'Worn Boots',      icon: '👞', slot: 'boots', rar: 0, spd: 6,          price: 25, desc: '+6 Move speed.' },
  scout_boots: { name: 'Scout\'s Boots',  icon: '🥾', slot: 'boots', rar: 1, spd: 12, def: 1, price: 80, desc: '+12 Move speed, +1 Defense.' },
  ember_treads:{ name: 'Embersteel Treads',icon:'🦿', slot: 'boots', rar: 2, spd: 16, def: 2, set: 'ember', price: 200, desc: '+16 Move speed, +2 Defense.' },
  dawn_striders:{name: 'Dawnstriders',    icon: '👢', slot: 'boots', rar: 3, spd: 22, def: 4, set: 'dawn', price: 999, desc: '+22 Move speed, +4 Defense. The ground barely notices you.' },
  // trinkets
  wolf_charm:  { name: 'Wolf-Fang Charm', icon: '🦷', slot: 'trinket', rar: 1, crit: 6,  price: 70, desc: '+6% Critical chance.' },
  gloom_eye:   { name: 'Eye of Gloomfang',icon: '👁️', slot: 'trinket', rar: 2, crit: 10, spd: 10, price: 260, desc: '+10% Crit, +10 Move speed.' },
  shard_dawn:  { name: 'Shard of the Dawn',icon:'🌟', slot: 'trinket', rar: 3, crit: 15, spd: 18, set: 'dawn', price: 999, desc: '+15% Crit, +18 Move speed. It is warm to the touch.' },
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
];

const EQUIP_SLOTS = ['weapon', 'armor', 'helm', 'boots', 'trinket'];
const WEAPON_BY_CLASS = {
  warrior: ['rusty_sword', 'soldier_wpn', 'ember_wpn', 'wardenbane'],
  mage: ['cracked_staff', 'adept_staff', 'ember_staff', 'dawncaller'],
  ranger: ['bent_bow', 'hunter_bow', 'ember_bow', 'dawnwing'],
};
const SHOP_STOCK = ['hp_potion', 'mp_potion', 'hp_potion2', 'rusty_sword', 'cloth_vest', 'leather_cap', 'worn_boots', 'wolf_charm'];

// ---------------- Achievements ----------------
const ACHIEVEMENTS = {
  first_blood: { name: 'First Blood',           icon: '🗡️', desc: 'Slay your first monster.' },
  level5:      { name: 'Seasoned',              icon: '⭐', desc: 'Reach level 5.' },
  level10:     { name: 'Shardbearer Ascendant', icon: '🌟', desc: 'Reach level 10.' },
  elite10:     { name: 'Elite Hunter',          icon: '👑', desc: 'Slay 10 elite monsters.' },
  chest_all:   { name: 'Treasure Hunter',       icon: '🗝️', desc: 'Open all 8 treasure chests.' },
  fish5:       { name: 'Gone Fishing',          icon: '🎣', desc: 'Catch 5 fish.' },
  rich:        { name: 'Gold Hoarder',          icon: '🪙', desc: 'Hold 500 gold at once.' },
  warden:      { name: 'Dawnbringer',           icon: '⚜️', desc: 'Defeat the Blightroot Warden.' },
};

// treasure chests: [tileX, tileY, tier] — loot scales with tier
const CHEST_SPOTS = [
  [90, 100, 1], [98, 98, 1],            // Southmeadow / near the pond
  [52, 50, 2], [85, 78, 2],             // Whisperwood
  [106, 45, 3], [128, 85, 3],           // Ember Caves
  [38, 12, 4], [100, 10, 4],            // Ashen Ruins
];
const CHEST_LOOT = {
  1: ['hp_potion', 'mp_potion', 'leather_cap', 'worn_boots'],
  2: ['hp_potion2', 'mp_potion', 'wolf_charm', 'iron_helm', 'scout_boots'],
  3: ['hp_potion2', 'soldier_wpn', 'leather_vest', 'ember_helm'],
  4: ['hp_potion2', 'ember_wpn', 'ember_mail', 'ember_treads', 'dawn_crown', 'dawn_striders'],
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
