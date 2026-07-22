// ============================================================
// EMBERFALL ONLINE — systems.js : combat, skills, xp, loot,
// inventory, quests, save/load, audio
// ============================================================
'use strict';

// ---------------- Audio (tiny WebAudio synth) ----------------
function initAudio() {
  if (G.audio) return;
  try { G.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.audio = null; }
}

// ---------------- Settings ----------------
const SETTINGS_KEY = 'emberfall_settings_v1';
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(G.settings, JSON.parse(raw));
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) {}
}
function toggleMute() {
  const anyOn = G.settings.music || G.settings.sfx;
  G.settings.music = G.settings.sfx = !anyOn;
  saveSettings();
  chat('sys', anyOn ? '🔇 Audio muted (N to unmute)' : '🔊 Audio on');
}

// ---------------- Ambient music ----------------
// slow pad chords: Am – F – C – G, dropped to darker voicings at night
let _musicTimer = null, _musicStep = 0;
const MUSIC_CHORDS = [
  [220.0, 261.6, 329.6],   // Am
  [174.6, 220.0, 261.6],   // F
  [196.0, 261.6, 329.6],   // C/G
  [196.0, 246.9, 293.7],   // G
];
function startMusic() {
  if (_musicTimer) return;
  _musicTimer = setInterval(() => {
    const ac = G.audio;
    if (!ac || !G.settings.music || G.state === 'title') return;
    const t = ac.currentTime;
    const night = darknessLevel() > 0.3;
    const chord = MUSIC_CHORDS[_musicStep++ % MUSIC_CHORDS.length];
    chord.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
      o.type = 'triangle';
      o.frequency.value = f * (i === 0 ? 0.5 : 1) * (night ? 0.5 : 1);
      fl.type = 'lowpass'; fl.frequency.value = night ? 500 : 850;
      o.connect(fl); fl.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(night ? 0.014 : 0.02, t + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t + 4.4);
      o.start(t); o.stop(t + 4.5);
    });
  }, 4500);
}
function sfx(kind) {
  const ac = G.audio;
  if (!ac || !G.settings.sfx) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  const env = (v, dur) => { g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.start(t); o.stop(t + dur); };
  switch (kind) {
    case 'swing': o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.09); env(0.08, 0.1); break;
    case 'hit': o.type = 'square'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12); env(0.10, 0.13); break;
    case 'crit': o.type = 'sawtooth'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.18); env(0.12, 0.2); break;
    case 'hurt': o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.2); env(0.12, 0.22); break;
    case 'cast': o.type = 'sine'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.12); env(0.07, 0.14); break;
    case 'levelup': {
      [523, 659, 784, 1047].forEach((f, i) => {
        const o2 = ac.createOscillator(), g2 = ac.createGain();
        o2.connect(g2); g2.connect(ac.destination);
        o2.type = 'sine'; o2.frequency.value = f;
        g2.gain.setValueAtTime(0.10, t + i * 0.09);
        g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.35);
        o2.start(t + i * 0.09); o2.stop(t + i * 0.09 + 0.36);
      });
      return;
    }
    case 'quest': {
      [660, 880].forEach((f, i) => {
        const o2 = ac.createOscillator(), g2 = ac.createGain();
        o2.connect(g2); g2.connect(ac.destination);
        o2.type = 'triangle'; o2.frequency.value = f;
        g2.gain.setValueAtTime(0.09, t + i * 0.12);
        g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.3);
        o2.start(t + i * 0.12); o2.stop(t + i * 0.12 + 0.31);
      });
      return;
    }
    case 'coin': o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.setValueAtTime(1300, t + 0.06); env(0.06, 0.14); break;
    case 'potion': o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.2); env(0.08, 0.22); break;
    case 'gather': o.type = 'triangle'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(1100, t + 0.15); env(0.06, 0.16); break;
  }
}

// ---------------- Damage ----------------
function playerDamageRoll(mult) {
  const st = pStat(G.player);
  let dmg = st.atk * mult * (0.85 + Math.random() * 0.3);
  const crit = Math.random() * 100 < st.crit;
  if (crit) dmg *= 1.8;
  return { dmg: Math.round(dmg), crit };
}

function dealToEnemy(e, mult, opts) {
  if (e.dead) return;
  const { dmg, crit } = playerDamageRoll(mult);
  e.hurtT = 0.25;
  if (e.state === 'idle' || e.state === 'wander') e.state = 'chase';
  if (opts && opts.stun) e.stun = Math.max(e.stun, opts.stun);
  if (opts && opts.slow) e.slow = Math.max(e.slow, opts.slow);
  if (G.settings.dmgNums) floater(e.x, e.y - 20, dmg, crit ? '#ffe14a' : '#ffffff', crit);
  spawnParticles(e.x, e.y - 8, crit ? 10 : 5, crit ? '#ffd44a' : '#e86a5a', 90, 0.35);
  sfx(crit ? 'crit' : 'hit');
  G.player.combatT = 4;
  if (Net.connected) {
    Net.send({ t: 'pdmg', i: G.enemies.indexOf(e), dmg });
    if (Net.isAuth()) applyEnemyDamage(e, dmg, Net.id);
    else e.hp -= dmg;   // optimistic; the authority's snapshots and ekill confirm
  } else {
    e.hp -= dmg;
    if (e.hp <= 0) killEnemy(e);
  }
}

// authority-side: apply damage to the shared HP pool, announce deaths
function applyEnemyDamage(e, dmg, killerId) {
  if (e.dead) return;
  e.hp -= dmg;
  e.hurtT = 0.25;
  if (e.state === 'idle' || e.state === 'wander') e.state = 'chase';
  if (e.hp <= 0) {
    e.dead = true; e.respawnT = e.boss ? 1e9 : 14; e.dashHit = false;
    Net.send({ t: 'ekill', i: G.enemies.indexOf(e), killer: killerId });
    deathFx(e);
    // your kill → your loot; boss kills reward the whole party
    if (killerId === Net.id || e.boss) killRewards(e);
  }
}

function deathFx(e) {
  spawnParticles(e.x, e.y - 8, 16, '#8a8a9a', 130, 0.5);
  if (e.boss) {
    chat('sys', `☠ ${e.name} has been slain!`);
    G.shake = 0.7;
  }
}

function killRewards(e) {
  const p = G.player;
  // xp with level-difference falloff
  let xp = e.xp;
  const diff = p.level - e.lv;
  if (diff > 3) xp = Math.max(2, Math.round(xp * 0.25));
  gainXp(xp);
  const gold = e.gold[0] + Math.floor(Math.random() * (e.gold[1] - e.gold[0] + 1));
  p.gold += gold;
  floater(e.x, e.y - 36, '+' + gold + 'g', '#ffd700');
  sfx('coin');
  // items fall to the ground with rarity glow — walk over them to collect
  for (const [id, chance] of e.drops) {
    if (Math.random() < chance) spawnGroundItem(e.x, e.y, resolveReward(id));
  }
  p.kills[e.type] = (p.kills[e.type] || 0) + 1;
  unlockAch('first_blood');
  if (e.elite) { p.counters.elites++; if (p.counters.elites >= 10) unlockAch('elite10'); }
  if (p.gold >= 500) unlockAch('rich');
  questEvent('kill', e.type);
  if (e.type === 'warden') { unlockAch('warden'); onWardenDeath(); }
}

// offline (and authority local) kill
function killEnemy(e) {
  e.dead = true;
  e.respawnT = e.boss ? 1e9 : 14;
  e.dashHit = false;
  deathFx(e);
  killRewards(e);
}

function damagePlayer(rawDmg, srcName) {
  const p = G.player;
  if (p.dead || p.dashT > 0 || p.rollT > 0) return;
  const st = pStat(p);
  const dmg = Math.max(1, Math.round(rawDmg * (0.9 + Math.random() * 0.2) - st.def));
  p.hp -= dmg;
  p.hurtT = 0.3; p.combatT = 4;
  dismount();   // knocked from the saddle
  if (G.settings.dmgNums) floater(p.x, p.y - 26, '-' + dmg, '#ff6a5a');
  spawnParticles(p.x, p.y - 10, 6, '#e04a3a', 90, 0.3);
  G.shake = Math.max(G.shake, 0.18);
  sfx('hurt');
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnT = 4;
    chat('combat', `You were slain by ${srcName}.`);
    showDeath();
  }
}

function respawnPlayer() {
  const p = G.player;
  const st = pStat(p);
  p.dead = false;
  p.hp = st.maxHp * 0.6; p.mp = st.maxMp * 0.6;
  p.x = 70 * TILE; p.y = 116 * TILE;
  hideBigOverlay();
  chat('sys', 'You awaken at Havenbrook, aching but alive.');
}

// ---------------- Skills ----------------
function toggleMount() {
  const p = G.player;
  if (p.dead || G.state !== 'play') return;
  if (!p.mount) { chat('sys', 'You have no mount — Bram sells the Chestnut Courser.'); return; }
  p.mounted = !p.mounted;
  spawnParticles(p.x, p.y + 8, 10, '#c9b088', 80, 0.4);
  sfx('gather');
}
function dismount() {
  if (G.player.mounted) {
    G.player.mounted = false;
    spawnParticles(G.player.x, G.player.y + 8, 8, '#c9b088', 70, 0.35);
  }
}

function useSkill(slot) {
  const p = G.player;
  if (p.dead || G.state !== 'play') return;
  dismount();   // fighting happens on your own two feet
  const idx = p.skillOrder[slot];               // hotbar slot -> class skill (drag to reorder)
  const skillId = CLASSES[p.cls].skills[idx];
  const sk = SKILLS[skillId];
  if (p.level < sk.unlock) { floater(p.x, p.y - 30, 'Locked (Lv ' + sk.unlock + ')', '#aaa'); return; }
  if (p.cds[idx] > 0) return;
  if (p.mp < sk.mp) { floater(p.x, p.y - 30, 'No mana', '#6a9aff'); return; }
  p.mp -= sk.mp;
  p.cds[idx] = sk.cd;
  p.attackAnim = 1;
  const aim = p.facing;
  if (sk.type === 'melee') {
    sfx('swing');
    spawnParticles(p.x + Math.cos(aim) * 30, p.y + Math.sin(aim) * 30, 6, '#fff2c0', 100, 0.2);
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > sk.range + (e.scale - 1) * 16) continue;
      let da = Math.atan2(e.y - p.y, e.x - p.x) - aim;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < sk.arc / 2) dealToEnemy(e, sk.mult);
    }
    Duel.tryMelee(sk, aim);
    Net.sendFx({ kind: 'swing' });
  } else if (sk.type === 'proj') {
    sfx('cast');
    const pr = { x: p.x, y: p.y - 10, vx: Math.cos(aim) * sk.speed, vy: Math.sin(aim) * sk.speed, mult: sk.mult, from: 'player', ttl: (sk.range || 300) / sk.speed, kind: p.cls === 'mage' ? 'bolt' : 'arrow' };
    G.projectiles.push(pr);
    Net.sendFx({ kind: 'proj', x: Math.round(pr.x), y: Math.round(pr.y), vx: Math.round(pr.vx), vy: Math.round(pr.vy), pkind: pr.kind, ttl: pr.ttl });
  } else if (sk.type === 'multiproj') {
    sfx('cast');
    for (let i = 0; i < sk.count; i++) {
      const a = aim + (i - (sk.count - 1) / 2) * (sk.spread / (sk.count - 1) * 2);
      const pr = { x: p.x, y: p.y - 10, vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed, mult: sk.mult, from: 'player', ttl: (sk.range || 250) / sk.speed, kind: 'arrow' };
      G.projectiles.push(pr);
      Net.sendFx({ kind: 'proj', x: Math.round(pr.x), y: Math.round(pr.y), vx: Math.round(pr.vx), vy: Math.round(pr.vy), pkind: 'arrow', ttl: pr.ttl });
    }
  } else if (sk.type === 'pierce') {
    sfx('cast');
    const pr = { x: p.x, y: p.y - 10, vx: Math.cos(aim) * sk.speed, vy: Math.sin(aim) * sk.speed, mult: sk.mult, from: 'player', ttl: (sk.range || 420) / sk.speed, kind: 'pierce', pierce: true, hitSet: new Set() };
    G.projectiles.push(pr);
    Net.sendFx({ kind: 'proj', x: Math.round(pr.x), y: Math.round(pr.y), vx: Math.round(pr.vx), vy: Math.round(pr.vy), pkind: 'pierce', ttl: pr.ttl });
  } else if (sk.type === 'nova') {
    sfx('cast');
    G.shake = Math.max(G.shake, 0.3);
    const col = p.cls === 'warrior' ? '#ffb44a' : skillId === 'm_nova' ? '#8ad4ff' : '#c98aff';
    spawnParticles(p.x, p.y, 40, col, 260, 0.55);
    ringEffect(p.x, p.y, sk.range, col);
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (dist(p.x, p.y, e.x, e.y) < sk.range + (e.scale - 1) * 20)
        dealToEnemy(e, sk.mult, { stun: sk.stun, slow: sk.slow });
    }
    Duel.tryNova(sk);
    Net.sendFx({ kind: 'nova', r: sk.range, col });
  } else if (sk.type === 'targetaoe') {
    sfx('cast');
    const wm = { x: G.mouse.x + G.camera.x, y: G.mouse.y + G.camera.y };
    let tx = wm.x, ty = wm.y;
    const d = dist(p.x, p.y, tx, ty);
    if (d > sk.maxDist) { tx = p.x + (tx - p.x) / d * sk.maxDist; ty = p.y + (ty - p.y) / d * sk.maxDist; }
    // delayed strike
    G.pendingAoes = G.pendingAoes || [];
    G.pendingAoes.push({ x: tx, y: ty, r: sk.range, mult: sk.mult, t: 0.55, kind: skillId });
    Net.sendFx({ kind: 'aoe', x: Math.round(tx), y: Math.round(ty), r: sk.range, pkind: skillId });
  } else if (sk.type === 'dash') {
    sfx('swing');
    p.dashT = 0.22; p.dashAng = aim;
    for (const e of G.enemies) e.dashHit = false;
  }
  updateHotbar();
}

function ringEffect(x, y, r, color) {
  G.particles.push({ ring: true, x, y, r: 10, maxR: r, life: 0.35, maxLife: 0.35, color });
}

function updatePendingAoes(dt) {
  if (!G.pendingAoes) return;
  for (let i = G.pendingAoes.length - 1; i >= 0; i--) {
    const a = G.pendingAoes[i];
    a.t -= dt;
    if (Math.random() < 0.4) spawnParticles(a.x + (Math.random() - 0.5) * a.r * 1.6, a.y + (Math.random() - 0.5) * a.r * 1.6, 1, '#c9a2ff', 30, 0.3);
    if (a.t <= 0) {
      G.pendingAoes.splice(i, 1);
      G.shake = Math.max(G.shake, 0.4);
      const col = a.kind === 'm_meteor' ? '#ff9a4a' : '#b0ff9a';
      spawnParticles(a.x, a.y, 46, col, 280, 0.6);
      ringEffect(a.x, a.y, a.r, col);
      sfx('crit');
      if (!a.cosmetic) {
        for (const e of G.enemies) {
          if (!e.dead && dist(a.x, a.y, e.x, e.y) < a.r + (e.scale - 1) * 20) dealToEnemy(e, a.mult);
        }
        const dr = Duel.peer();
        if (dr && dist(a.x, a.y, dr.x, dr.y) < a.r + 14) Duel.hitPeer(a.mult);
      }
    }
  }
}

function updateProjectiles(dt) {
  const p = G.player;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i];
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    pr.ttl -= dt;
    let kill = pr.ttl <= 0;
    if (World.blocked(pr.x, pr.y) && !pr.pierce) kill = true;
    if (pr.from === 'fx') {
      // another player's attack — purely visual, damage arrives via its own message
    } else if (pr.from === 'player') {
      const dr = Duel.peer();
      if (dr && !pr.duelHit && dist(pr.x, pr.y, dr.x, dr.y) < 17) {
        pr.duelHit = true;
        Duel.hitPeer(pr.mult);
        if (!pr.pierce) {
          spawnParticles(pr.x, pr.y, 4, '#ff9a7a', 60, 0.25);
          G.projectiles.splice(i, 1);
          continue;
        }
      }
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist(pr.x, pr.y, e.x, e.y) < 16 + (e.scale - 1) * 18) {
          if (pr.pierce) {
            if (!pr.hitSet.has(e)) { pr.hitSet.add(e); dealToEnemy(e, pr.mult); }
          } else {
            dealToEnemy(e, pr.mult);
            kill = true;
            break;
          }
        }
      }
    } else {
      if (!p.dead && dist(pr.x, pr.y, p.x, p.y - 8) < 14) {
        damagePlayer(pr.dmg, 'dark magic');
        kill = true;
      }
    }
    if (kill) {
      spawnParticles(pr.x, pr.y, 4, pr.kind === 'bolt' ? '#8ab0ff' : pr.kind === 'blight' || pr.kind === 'shadow' ? '#b06aff' : '#d0c0a0', 60, 0.25);
      G.projectiles.splice(i, 1);
    }
  }
}

// ---------------- XP / leveling ----------------
function gainXp(amount) {
  const p = G.player;
  if (p.level >= MAX_LEVEL) return;
  p.xp += amount;
  floater(p.x, p.y - 40, '+' + amount + ' XP', '#c9a2ff');
  while (p.level < MAX_LEVEL && p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level);
    p.level++;
    const st = pStat(p);
    p.hp = st.maxHp; p.mp = st.maxMp;
    sfx('levelup');
    G.shake = 0.3;
    spawnParticles(p.x, p.y, 50, '#ffe14a', 220, 0.9, -50);
    flashLevel(p.level);
    if (p.level >= 5) unlockAch('level5');
    if (p.level >= 10) unlockAch('level10');
    chat('sys', `✦ ${p.name} has reached level ${p.level}!`);
    // announce unlocks
    CLASSES[p.cls].skills.forEach((sid) => {
      if (SKILLS[sid].unlock === p.level) chat('sys', `✦ New skill unlocked: ${SKILLS[sid].name}!`);
    });
    if (p.level >= MAX_LEVEL) { p.xp = 0; chat('sys', '✦ You have reached the maximum level. The Warden awaits.'); }
  }
  updateHotbar();
}

// ---------------- Inventory (20 fixed slots; null = empty) ----------------
function invList() { return G.player.inv.filter(Boolean); }
function invFreeSlots() { return G.player.inv.filter(s => !s).length; }

function addItem(id, qty) {
  qty = qty || 1;
  const p = G.player;
  const def = ITEMS[id];
  const stackable = def.slot === 'use' || def.slot === 'quest' || def.slot === 'junk';
  if (stackable) {
    const ex = p.inv.find(s => s && s.id === id);
    if (ex) { ex.qty += qty; questEvent('collect', id); refreshPanels(); return true; }
  }
  const i = p.inv.findIndex(s => !s);
  if (i < 0) { chat('sys', 'Your bag is full!'); return false; }
  p.inv[i] = { id, qty };
  questEvent('collect', id);
  refreshPanels();
  return true;
}
function removeItem(id, qty) {
  const p = G.player;
  const i = p.inv.findIndex(s => s && s.id === id);
  if (i < 0) return false;
  p.inv[i].qty -= qty;
  if (p.inv[i].qty <= 0) p.inv[i] = null;
  refreshPanels();
  return true;
}
function countItem(id) {
  return G.player.inv.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
}
// drag & drop: move/swap bag slots, merging same-item stacks
function moveInvItem(from, to) {
  const inv = G.player.inv;
  if (from === to || from < 0 || to < 0 || from >= 20 || to >= 20 || !inv[from]) return;
  const a = inv[from], b = inv[to];
  const stackable = ['use', 'quest', 'junk'].includes(ITEMS[a.id].slot);
  if (b && b.id === a.id && stackable) { b.qty += a.qty; inv[from] = null; }
  else { inv[to] = a; inv[from] = b || null; }
  refreshPanels();
}
function itemLabel(id) {
  const it = ITEMS[id];
  return `[${it.name}]`;
}
// weapon rewards resolve to the player's class variant of the same tier
function resolveReward(id) {
  const it = ITEMS[id];
  if (it && it.slot === 'weapon' && it.wclass && G.player && it.wclass !== G.player.cls)
    return WEAPON_BY_CLASS[G.player.cls][it.tier];
  return id;
}
function useItem(id) {
  const p = G.player, it = ITEMS[id];
  const st = pStat(p);
  if (it.slot === 'use') {
    if (it.heal) {
      if (p.hp >= st.maxHp) { chat('sys', 'Already at full health.'); return; }
      p.hp = Math.min(st.maxHp, p.hp + it.heal);
      floater(p.x, p.y - 30, '+' + it.heal, '#6aff8a');
      spawnParticles(p.x, p.y - 10, 10, '#6aff8a', 70, 0.5, -40);
    }
    if (it.mana) {
      p.mp = Math.min(st.maxMp, p.mp + it.mana);
      floater(p.x, p.y - 30, '+' + it.mana + ' MP', '#6a9aff');
    }
    sfx('potion');
    removeItem(id, 1);
  } else if (it.slot === 'mount') {
    p.mount = id;
    sfx('quest');
    chat('sys', `🐎 ${itemLabel(id)} stabled — press Z to ride!`);
  } else if (EQUIP_SLOTS.includes(it.slot)) {
    if (it.wclass && it.wclass !== p.cls) {
      chat('sys', `Only a ${CLASSES[it.wclass].name} can wield ${itemLabel(id)}. (Bram will buy it.)`);
      return;
    }
    const prev = p.equip[it.slot];
    p.equip[it.slot] = id;
    removeItem(id, 1);
    if (prev) addItem(prev, 1);   // the freed slot guarantees room
    sfx('quest');
    chat('sys', `Equipped ${itemLabel(id)}.`);
    refreshPanels();
  }
}

function unequipItem(slot) {
  const p = G.player;
  const id = p.equip[slot];
  if (!id) return;
  if (invFreeSlots() === 0) { chat('sys', 'Your bag is full.'); return; }
  p.equip[slot] = null;
  addItem(id, 1);
  refreshPanels();
}

function dropItem(id) {
  if (ITEMS[id].slot === 'quest') { chat('sys', 'You cannot drop a quest item.'); return; }
  if (removeItem(id, 1)) {
    chat('sys', `Discarded ${itemLabel(id)}.`);
    floater(G.player.x, G.player.y - 28, '🗑️', '#c9c0a8');
  }
}

// ---------------- Quests ----------------
function qState(id) { return G.quests[id] || { state: 'locked', progress: 0 }; }

function questAvailableFrom(npcId) {
  return QUESTS.find(q => {
    const s = qState(q.id);
    if (q.giver !== npcId) return false;
    if (s.state === 'active' || s.state === 'turned') return false;
    if (q.prereq && qState(q.prereq).state !== 'turned') return false;
    return s.state !== 'turned';
  });
}
function questCompletableAt(npcId) {
  return QUESTS.find(q => {
    const s = qState(q.id);
    if (s.state !== 'active') return false;
    // talk quests complete at their target npc; others turn in at giver
    const turnNpc = q.type === 'talk' ? q.target : q.giver;
    if (turnNpc !== npcId) return false;
    // talk quests: arriving at the target npc IS the completion
    return q.type === 'talk' || questProgress(q) >= q.count;
  });
}
function questProgress(q) {
  const s = qState(q.id);
  if (q.type === 'collect') return Math.min(q.count, countItem(q.target));
  return s.progress || 0;
}

function acceptQuest(q) {
  G.quests[q.id] = { state: 'active', progress: 0 };
  // bosses never respawn — credit a boss already slain before the quest was taken
  if (q.type === 'kill' && ENEMY_TYPES[q.target] && ENEMY_TYPES[q.target].boss && (G.player.kills[q.target] || 0) > 0)
    G.quests[q.id].progress = q.count;
  // talk quests to a *different* npc: progress fills when talking to target
  chat('sys', `Quest accepted: ${q.title}`);
  sfx('quest');
  refreshTracker(); refreshPanels();
}
function questEvent(kind, target) {
  for (const q of QUESTS) {
    const s = qState(q.id);
    if (s.state !== 'active') continue;
    if (q.type === 'kill' && kind === 'kill' && q.target === target) {
      s.progress = Math.min(q.count, (s.progress || 0) + 1);
      const label = ENEMY_TYPES[q.target].name;
      chat('sys', `${q.title}: ${s.progress}/${q.count} ${label}${q.count > 1 ? 's' : ''}`);
      if (s.progress >= q.count) { chat('sys', `✔ ${q.title} — objective complete! Return to turn it in.`); sfx('quest'); }
    }
    if (q.type === 'collect' && kind === 'collect' && q.target === target) {
      const n = questProgress(q);
      chat('sys', `${q.title}: ${n}/${q.count}`);
      if (n >= q.count) { chat('sys', `✔ ${q.title} — objective complete! Return to turn it in.`); sfx('quest'); }
    }
    if (q.type === 'talk' && kind === 'talk' && q.target === target) {
      s.progress = q.count;
    }
  }
  refreshTracker();
}
function completeQuest(q) {
  const s = qState(q.id);
  if (s.state === 'turned') return;
  s.state = 'turned';
  if (q.type === 'collect') removeItem(q.target, q.count);
  gainXp(q.xp);
  if (q.gold) { G.player.gold += q.gold; }
  if (q.item) { const rid = resolveReward(q.item); addItem(rid, 1); chat('sys', `Reward: ${itemLabel(rid)}`); }
  if (q.id === 'q8') { addItem('warden_key', 1); chat('sys', 'Reward: [Warden\'s Key] — the Ashen Ruins are open to you.'); }
  chat('sys', `✔ Quest complete: ${q.title}  (+${q.xp} XP${q.gold ? ', +' + q.gold + 'g' : ''})`);
  questBanner(`✔ ${q.title}`);
  sfx('levelup');
  refreshTracker(); refreshPanels();
}

// ---------------- Interaction (E) ----------------
function nearestInteractable() {
  const p = G.player;
  let best = null, bd = 56;
  for (const n of G.npcs) {
    const d = dist(p.x, p.y, n.x, n.y);
    if (d < bd) { bd = d; best = { kind: 'npc', npc: n }; }
  }
  for (const g of G.gatherNodes) {
    if (g.taken > 0) continue;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d < bd) { bd = d; best = { kind: 'node', node: g }; }
  }
  for (const c of G.chests) {
    if (c.open) continue;
    const d = dist(p.x, p.y, c.x, c.y);
    if (d < bd) { bd = d; best = { kind: 'chest', chest: c }; }
  }
  for (const pt of G.portals) {
    const d = dist(p.x, p.y, pt.x, pt.y);
    if (d < bd) { bd = d; best = { kind: 'portal', portal: pt }; }
  }
  if (G.vaultPos) {
    const d = dist(p.x, p.y, G.vaultPos.x, G.vaultPos.y);
    if (d < bd) { bd = d; best = { kind: 'vault' }; }
  }
  return best;
}

function usePortal(pt) {
  const p = G.player;
  if (p.level < pt.minLevel) {
    chat('sys', `⚠ You need level ${pt.minLevel} to survive what waits below.`);
    floater(p.x, p.y - 30, 'Level ' + pt.minLevel + ' required!', '#e15b5b');
    sfx('hurt');
    return;
  }
  spawnParticles(p.x, p.y, 22, '#7ac8d8', 130, 0.6);
  p.x = pt.tx; p.y = pt.ty;
  G.target = null;
  spawnParticles(p.x, p.y, 22, '#7ac8d8', 130, 0.6);
  sfx('cast');
}

function gatherNode(g) {
  g.taken = 60; // respawn timer
  addItem(g.item, 1);
  sfx('gather');
  spawnParticles(g.x, g.y - 6, 12, g.item === 'sunberry' ? '#ffb060' : '#d8b8ff', 80, 0.5, -30);
  chat('sys', `You gather a ${ITEMS[g.item].name}.`);
}

function interact() {
  if (G.fishing) { reelFish(); return; }
  const t = nearestInteractable();
  if (!t) { if (canFish()) startFishing(); return; }
  if (t.kind === 'node') { gatherNode(t.node); return; }
  if (t.kind === 'chest') { openChest(t.chest); return; }
  if (t.kind === 'portal') { usePortal(t.portal); return; }
  if (t.kind === 'vault') { openBank(); return; }
  openDialogue(t.npc);
}

// move an item between two fixed-slot arrays (bag/vault), merging like stacks
function bankTransfer(fromArr, fromIdx, toArr, toIdx) {
  const a = fromArr[fromIdx];
  if (!a) return;
  const stackable = ['use', 'quest', 'junk'].includes(ITEMS[a.id].slot);
  if (toIdx === null || toIdx === undefined) {
    if (stackable) {
      const ex = toArr.find(s => s && s.id === a.id);
      if (ex) { ex.qty += a.qty; fromArr[fromIdx] = null; refreshBank(); refreshPanels(); return; }
    }
    const e = toArr.findIndex(s => !s);
    if (e < 0) { chat('sys', 'No room over there.'); return; }
    toArr[e] = a; fromArr[fromIdx] = null;
  } else {
    const b = toArr[toIdx];
    if (b && b.id === a.id && stackable) { b.qty += a.qty; fromArr[fromIdx] = null; }
    else { toArr[toIdx] = a; fromArr[fromIdx] = b || null; }
  }
  refreshBank(); refreshPanels();
}

// ---------------- Mouse targeting ----------------
const CLICK_RANGE = 95;

// what's under (or near) the cursor? (screen coords)
// exact hit-boxes first; otherwise snap to the nearest entity within a
// forgiving radius so slightly-off clicks on small characters still land
function entityAtScreen(sx, sy) {
  const wx = sx + G.camera.x, wy = sy + G.camera.y;
  let best = null, bd = 34;   // fallback snap radius (px)
  const consider = (hit, cx, cy, exact) => {
    if (exact) { best = hit; bd = -1; return; }
    if (bd < 0) return;                        // already have an exact hit
    const d = dist(wx, wy, cx, cy);
    if (d < bd) { bd = d; best = hit; }
  };
  for (const n of G.npcs)
    consider({ kind: 'npc', npc: n, x: n.x, y: n.y }, n.x, n.y - 16,
      Math.abs(wx - n.x) < 18 && wy > n.y - 46 && wy < n.y + 18);
  for (const id in Net.remotes) {
    const r = Net.remotes[id];
    if (bd < 0) break;
    consider({ kind: 'remote', remote: r, x: r.x, y: r.y }, r.x, r.y - 16,
      Math.abs(wx - r.x) < 18 && wy > r.y - 46 && wy < r.y + 18);
  }
  for (const b of G.bots) {
    if (bd < 0) break;
    consider({ kind: 'bot', bot: b, x: b.x, y: b.y }, b.x, b.y - 16,
      Math.abs(wx - b.x) < 18 && wy > b.y - 46 && wy < b.y + 18);
  }
  for (const e of G.enemies) {
    if (e.dead || bd < 0) continue;
    const rr = 20 * e.scale;
    consider({ kind: 'enemy', enemy: e, x: e.x, y: e.y }, e.x, e.y - 8 * e.scale,
      Math.abs(wx - e.x) < rr + 4 && wy > e.y - 34 * e.scale - 12 && wy < e.y + 16 * e.scale);
  }
  for (const c of G.chests) {
    if (c.open || bd < 0) continue;
    consider({ kind: 'chest', chest: c, x: c.x, y: c.y }, c.x, c.y,
      Math.abs(wx - c.x) < 16 && Math.abs(wy - c.y) < 20);
  }
  for (const g of G.gatherNodes) {
    if (g.taken > 0 || bd < 0) continue;
    consider({ kind: 'node', node: g, x: g.x, y: g.y }, g.x, g.y,
      Math.abs(wx - g.x) < 14 && Math.abs(wy - g.y) < 18);
  }
  for (const pt of G.portals) {
    if (bd < 0) break;
    consider({ kind: 'portal', portal: pt, x: pt.x, y: pt.y }, pt.x, pt.y,
      Math.abs(wx - pt.x) < 20 && Math.abs(wy - pt.y) < 18);
  }
  if (G.vaultPos && bd >= 0) {
    consider({ kind: 'vault', x: G.vaultPos.x, y: G.vaultPos.y }, G.vaultPos.x, G.vaultPos.y,
      Math.abs(wx - G.vaultPos.x) < 20 && Math.abs(wy - G.vaultPos.y) < 20);
  }
  return best;
}

function tooFar() { floater(G.player.x, G.player.y - 30, 'Too far away!', '#c9c0a8'); }

// left-click on something friendly/interactable: act on it (true = handled, don't attack)
function tryClickInteract(hit, cx, cy) {
  const d = dist(G.player.x, G.player.y, hit.x, hit.y);
  if (hit.kind === 'npc') { d < CLICK_RANGE ? openDialogue(hit.npc) : tooFar(); return true; }
  if (hit.kind === 'chest') { d < CLICK_RANGE ? openChest(hit.chest) : tooFar(); return true; }
  if (hit.kind === 'node') { d < CLICK_RANGE ? gatherNode(hit.node) : tooFar(); return true; }
  if (hit.kind === 'portal') { d < CLICK_RANGE ? usePortal(hit.portal) : tooFar(); return true; }
  if (hit.kind === 'vault') { d < CLICK_RANGE ? openBank() : tooFar(); return true; }
  // people (players/villagers): left-click passes through — use RIGHT-click for their menu
  return false;
}

function updateGatherNodes(dt) {
  for (const g of G.gatherNodes) if (g.taken > 0) g.taken -= dt;
}

// ---------------- Achievements ----------------
function unlockAch(id) {
  const p = G.player;
  if (!p || p.ach[id]) return;
  p.ach[id] = true;
  const a = ACHIEVEMENTS[id];
  achToast(`${a.icon} ${a.name}`);
  chat('sys', `🏆 Achievement unlocked: ${a.name} — ${a.desc}`);
  sfx('quest');
}

// ---------------- Fishing ----------------
function canFish() {
  const p = G.player;
  if (World.regionAt(p.x, p.y) === 'cave') return false;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if (World.t(tx + dx, ty + dy) === 2) return true;
  return false;
}
function startFishing() {
  G.fishing = { t: 0, biteAt: 1.5 + Math.random() * 2.5, bit: false, bitT: 0 };
  chat('sys', 'You cast your line... (stand still, [E] when it bites!)');
  sfx('gather');
}
function updateFishing(dt) {
  const f = G.fishing;
  if (!f) return;
  const p = G.player;
  if (p.moving || p.dead) { G.fishing = null; chat('sys', 'You reel in early.'); return; }
  f.t += dt;
  if (!f.bit && f.t >= f.biteAt) {
    f.bit = true; f.bitT = 0.7;
    floater(p.x, p.y - 34, '❗', '#8fd4ff', true);
    sfx('quest');
  }
  if (f.bit) {
    f.bitT -= dt;
    if (f.bitT <= 0) { G.fishing = null; chat('sys', 'The fish got away...'); }
  }
}
function reelFish() {
  const f = G.fishing;
  if (!f) return;
  if (!f.bit) { G.fishing = null; chat('sys', 'You reel in early.'); return; }
  const roll = Math.random();
  const id = roll < 0.60 ? 'minnow' : roll < 0.92 ? 'trout' : 'koi';
  addItem(id, 1);
  const p = G.player;
  p.counters.fish++;
  chat('sys', `You caught a ${ITEMS[id].name}! ${ITEMS[id].icon}`);
  floater(p.x, p.y - 30, ITEMS[id].icon, '#8fd4ff', true);
  spawnParticles(p.x, p.y - 8, 10, '#8fd4ff', 90, 0.5, -40);
  sfx('coin');
  if (p.counters.fish >= 5) unlockAch('fish5');
  G.fishing = null;
}

// ---------------- Warden death / victory ----------------
function onWardenDeath() {
  G.bossDead = true;
  // remove summoned adds
  for (const e of G.enemies) if (e.summoned) { e.dead = true; e.respawnT = 1e9; }
  setTimeout(() => { showVictory(); }, 1600);
}

// ---------------- Ranked score ----------------
function computeScore(p) {
  const quests = QUESTS.filter(q => qState(q.id).state === 'turned').length;
  const kills = Object.values(p.kills).reduce((a, b) => a + b, 0);
  const achs = Object.keys(p.ach).length;
  return p.level * 1000 + quests * 150 + kills * 5 + achs * 250 + (p.counters.duelWins || 0) * 80 + (G.bossDead ? 1000 : 0);
}

// local leaderboard (offline / solo): your characters, ranked
const BOARD_KEY = 'emberfall_board_v1';
function upsertLocalBoard() {
  const p = G.player;
  if (!p) return;
  let board = [];
  try { board = JSON.parse(localStorage.getItem(BOARD_KEY)) || []; } catch (e) {}
  const entry = { name: p.name, cls: p.cls, level: p.level, score: computeScore(p), ts: Date.now() };
  const i = board.findIndex(b => b.name === p.name);
  if (i >= 0) board[i] = entry; else board.push(entry);
  board.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(board.slice(0, 20))); } catch (e) {}
}
function getBoard() {
  if (Net.connected && G.netBoard && G.netBoard.length) return { rows: G.netBoard, live: true };
  let board = [];
  try { board = JSON.parse(localStorage.getItem(BOARD_KEY)) || []; } catch (e) {}
  return { rows: board.slice(0, 10), live: false };
}

// ---------------- Save / Load ----------------
const SAVE_KEY = 'emberfall_save_v1';
function saveGame() {
  if (!G.player || G.state === 'title') return;
  const p = G.player;
  const data = {
    cls: p.cls, name: p.name, x: p.x, y: p.y,
    level: p.level, xp: p.xp, gold: p.gold, hp: p.hp, mp: p.mp,
    inv: p.inv, equip: p.equip, kills: p.kills, playTime: p.playTime,
    ach: p.ach, counters: p.counters,
    skillOrder: p.skillOrder, potionBinds: p.potionBinds, mount: p.mount,
    vault: p.vault, bankGold: p.bankGold,
    quests: G.quests, bossDead: G.bossDead, dayTime: G.dayTime,
    gatherTaken: G.gatherNodes.map(g => g.taken > 0),
    chestsOpen: G.chests.map(c => c.open),
  };
  // guests save to this device; account heroes also sync to the realm server
  if (!Auth.loggedIn()) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  Auth.onSaved(data);
  upsertLocalBoard();
  return data;
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function applySave(data) {
  const p = makePlayer(data.cls, data.name);
  // migrate older dense bag arrays into the fixed 20-slot layout
  const rawInv = Array.isArray(data.inv) ? data.inv : [];
  let inv;
  if (rawInv.length === 20) inv = rawInv.map(s => (s && ITEMS[s.id]) ? s : null);
  else {
    inv = Array(20).fill(null);
    rawInv.filter(s => s && ITEMS[s.id]).slice(0, 20).forEach((s, i) => { inv[i] = s; });
  }
  // weapons from before class-locking: convert to this class's variant of the same tier
  const toClassWeapon = id => {
    const it = ITEMS[id];
    return (it && it.slot === 'weapon' && it.wclass && it.wclass !== data.cls)
      ? WEAPON_BY_CLASS[data.cls][it.tier] : id;
  };
  for (const s of inv) if (s) s.id = toClassWeapon(s.id);
  if (data.equip && data.equip.weapon) data.equip.weapon = toClassWeapon(data.equip.weapon);
  Object.assign(p, {
    x: data.x, y: data.y, level: data.level, xp: data.xp, gold: data.gold,
    hp: data.hp, mp: data.mp, inv,
    equip: Object.assign({ weapon: null, armor: null, helm: null, boots: null, trinket: null }, data.equip),
    kills: data.kills || {}, playTime: data.playTime || 0,
    ach: data.ach || {}, counters: Object.assign({ elites: 0, fish: 0, duelWins: 0 }, data.counters),
    skillOrder: Array.isArray(data.skillOrder) && data.skillOrder.length === 4 ? data.skillOrder : [0, 1, 2, 3],
    potionBinds: Array.isArray(data.potionBinds) && data.potionBinds.length === 2 ? data.potionBinds : ['hp_potion', 'mp_potion'],
    mount: data.mount && ITEMS[data.mount] ? data.mount : null,
    vault: (() => {
      const v = Array(30).fill(null);
      if (Array.isArray(data.vault)) data.vault.forEach((s, i) => { if (i < 30 && s && ITEMS[s.id]) v[i] = s; });
      return v;
    })(),
    bankGold: data.bankGold | 0,
  });
  G.player = p;
  G.quests = data.quests || {};
  G.bossDead = !!data.bossDead;
  G.dayTime = data.dayTime || 0.3;
  if (data.gatherTaken) data.gatherTaken.forEach((t, i) => { if (G.gatherNodes[i] && t) G.gatherNodes[i].taken = 30; });
  if (data.chestsOpen) data.chestsOpen.forEach((o, i) => { if (G.chests[i]) G.chests[i].open = o; });
}
