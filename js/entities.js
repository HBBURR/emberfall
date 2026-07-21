// ============================================================
// EMBERFALL ONLINE — entities.js : player, enemies, NPCs, bots,
// particles, and procedural character rendering
// ============================================================
'use strict';

// ---------------- Player ----------------
function makePlayer(cls, name) {
  const c = CLASSES[cls];
  return {
    cls, name,
    x: 70 * TILE, y: 118 * TILE,
    vx: 0, vy: 0, facing: 0, moving: false, walkT: 0,
    level: 1, xp: 0, gold: 15,
    hp: c.baseHp, mp: c.baseMp,
    inv: (() => { const a = Array(20).fill(null); a[0] = { id: 'hp_potion', qty: 2 }; return a; })(),
    equip: { weapon: null, armor: null, helm: null, boots: null, trinket: null },
    skillOrder: [0, 1, 2, 3],                       // hotbar slot -> class skill index
    potionBinds: ['hp_potion', 'mp_potion'],        // keys 5 / 6
    cds: [0, 0, 0, 0],
    attackAnim: 0, hurtT: 0, dashT: 0, dashAng: 0,
    rollT: 0, rollAng: 0, rollCd: 0,
    combatT: 0, dead: false, respawnT: 0,
    kills: {}, playTime: 0,
    ach: {}, counters: { elites: 0, fish: 0, duelWins: 0 },
  };
}

function pStat(p) {
  const c = CLASSES[p.cls];
  let atk = c.baseDmg + 2 * (p.level - 1), def = 0, crit = 8, spd = c.speed;
  let hp = c.baseHp + c.hpPerLv * (p.level - 1);
  let ember = 0, dawn = 0;
  for (const slot of EQUIP_SLOTS) {
    const id = p.equip[slot];
    if (!id) continue;
    const it = ITEMS[id];
    atk += it.atk || 0; def += it.def || 0; hp += it.hp || 0;
    crit += it.crit || 0; spd += it.spd || 0;
    if (it.set === 'ember') ember++;
    if (it.set === 'dawn') dawn++;
  }
  // matched-set bonuses
  if (ember >= 2) { atk += 4; def += 4; }
  if (dawn >= 2) { atk += 8; def += 8; crit += 8; }
  return { maxHp: hp, maxMp: c.baseMp + c.mpPerLv * (p.level - 1), atk, def, crit, speed: spd, sets: { ember, dawn } };
}

function playerWeaponTier(p) { return p.equip.weapon ? (ITEMS[p.equip.weapon].tier || 0) : -1; }

function updatePlayer(dt) {
  const p = G.player;
  if (p.dead) {
    p.respawnT -= dt;
    return;
  }
  p.playTime += dt;
  const st = pStat(p);
  // movement
  let mx = 0, my = 0;
  if (G.keys['w'] || G.keys['arrowup']) my -= 1;
  if (G.keys['s'] || G.keys['arrowdown']) my += 1;
  if (G.keys['a'] || G.keys['arrowleft']) mx -= 1;
  if (G.keys['d'] || G.keys['arrowright']) mx += 1;
  let spd = st.speed;
  p.rollCd = Math.max(0, p.rollCd - dt);
  if (p.rollT > 0) {
    p.rollT -= dt; mx = Math.cos(p.rollAng); my = Math.sin(p.rollAng); spd = 540;
    spawnParticles(p.x, p.y + 8, 1, '#cfc8b0', 40, 0.3);
  } else if (p.dashT > 0) { p.dashT -= dt; mx = Math.cos(p.dashAng); my = Math.sin(p.dashAng); spd = 620; }
  const len = Math.hypot(mx, my);
  p.moving = len > 0;
  if (len > 0) {
    mx /= len; my /= len;
    tryMove(p, mx * spd * dt, my * spd * dt, 10);
    p.walkT += dt * 9;
    if (p.dashT <= 0) p.facing = Math.atan2(my, mx);
  }
  // face mouse when aiming
  const wm = { x: G.mouse.x + G.camera.x, y: G.mouse.y + G.camera.y };
  p.facing = Math.atan2(wm.y - p.y, wm.x - p.x);
  // cooldowns / regen
  for (let i = 0; i < 4; i++) p.cds[i] = Math.max(0, p.cds[i] - dt);
  p.combatT = Math.max(0, p.combatT - dt);
  p.attackAnim = Math.max(0, p.attackAnim - dt * 4);
  p.hurtT = Math.max(0, p.hurtT - dt);
  if (p.combatT <= 0) p.hp = Math.min(st.maxHp, p.hp + 3.5 * dt);
  p.mp = Math.min(st.maxMp, p.mp + 3 * dt);
  // dash damage trail
  if (p.dashT > 0) {
    spawnParticles(p.x, p.y, 2, '#e8c86a', 60, 0.3);
    for (const e of G.enemies) {
      if (!e.dead && !e.dashHit && dist(p.x, p.y, e.x, e.y) < 40) {
        e.dashHit = true;
        dealToEnemy(e, SKILLS[CLASSES[p.cls].skills[2]].mult);
      }
    }
  }
}

function tryMove(ent, dx, dy, r) {
  // axis-separated collision so you slide along walls
  if (!collides(ent.x + dx, ent.y, r)) ent.x += dx;
  if (!collides(ent.x, ent.y + dy, r)) ent.y += dy;
  ent.x = clamp(ent.x, TILE * 2, (MAP_W - 2) * TILE);
  ent.y = clamp(ent.y, TILE * 2, (MAP_H - 2) * TILE);
}
function collides(x, y, r) {
  return World.blocked(x - r, y) || World.blocked(x + r, y) || World.blocked(x, y - r) || World.blocked(x, y + r * 0.6);
}

// ---------------- Enemies ----------------
function spawnEnemy(type, tx, ty, eliteRoll) {
  const d = ENEMY_TYPES[type];
  const e = {
    type, ...JSON.parse(JSON.stringify(d)),
    x: tx * TILE + 16, y: ty * TILE + 16,
    homeX: tx * TILE + 16, homeY: ty * TILE + 16,
    maxHp: d.hp,
    state: 'idle', stateT: Math.random() * 2, wanderAng: 0,
    facing: 1, walkT: Math.random() * 7, attackT: 0, windup: 0,
    hurtT: 0, dead: false, respawnT: 0, stun: 0, slow: 0,
    phase: 0, dashHit: false,
  };
  // deterministic elite roll (seeded) so all connected clients agree
  if (eliteRoll !== undefined && !d.boss && eliteRoll < 0.12) {
    e.elite = true;
    e.name = 'Elite ' + e.name;
    e.maxHp = e.hp = Math.round(e.hp * 2.2);
    e.dmg = Math.round(e.dmg * 1.4);
    e.xp = Math.round(e.xp * 2.5);
    e.scale *= 1.25;
    e.gold = [e.gold[0] * 3, e.gold[1] * 3];
  }
  return e;
}

function spawnAllEnemies() {
  G.enemies = [];
  const R = mulberry32(777);
  const put = (type, n, x0, x1, y0, y1, avoid) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < 400) {
      const tx = Math.floor(x0 + R() * (x1 - x0)), ty = Math.floor(y0 + R() * (y1 - y0));
      if (World.blockedTile(tx, ty)) continue;
      if (World.t(tx, ty) === 1) continue;
      if (dist(tx, ty, 70, 111) < 20) continue;
      if (avoid && dist(tx, ty, avoid[0], avoid[1]) < avoid[2]) continue;
      G.enemies.push(spawnEnemy(type, tx, ty, R()));
      placed++;
    }
  };
  put('wolf', 13, 45, 96, 90, 106);
  put('boar', 10, 40, 95, 92, 106);
  put('sprite', 14, 14, 96, 40, 86);
  put('bat', 11, 102, 120, 40, 90, [124, 50, 9]);
  put('slime', 9, 112, 130, 56, 90, [124, 50, 9]);
  put('cultist', 11, 36, 104, 8, 32, [70, 15, 11]);
  put('drowned', 8, 12, 37, 108, 126, [24, 127, 7]);
  G.enemies.push(spawnEnemy('gloomfang', 124, 50));
  G.enemies.push(spawnEnemy('maw', 24, 127));
  if (!G.bossDead) G.enemies.push(spawnEnemy('warden', 70, 14));
}

// nearest attackable player: the local hero or any connected friend
function nearestVictim(e) {
  const p = G.player;
  let best = null, bd = 1e9;
  if (!p.dead) { bd = dist(e.x, e.y, p.x, p.y); best = { x: p.x, y: p.y, id: null, d: bd }; }
  for (const id in Net.remotes) {
    const r = Net.remotes[id];
    const d = dist(e.x, e.y, r.x, r.y);
    if (d < bd) { bd = d; best = { x: r.x, y: r.y, id: r.id, d }; }
  }
  return best;
}

function updateEnemy(e, dt) {
  if (e.dead) {
    e.respawnT -= dt;
    if (e.respawnT <= 0 && !e.boss) {
      e.dead = false; e.hp = e.maxHp; e.x = e.homeX; e.y = e.homeY; e.state = 'idle';
    }
    return;
  }
  e.walkT += dt * 8;
  e.hurtT = Math.max(0, e.hurtT - dt);
  e.attackT = Math.max(0, e.attackT - dt);
  e.stun = Math.max(0, e.stun - dt);
  e.slow = Math.max(0, e.slow - dt);
  if (e.stun > 0) return;
  const spd = e.speed * (e.slow > 0 ? 0.45 : 1);
  const v = nearestVictim(e);
  const dp = v ? v.d : 1e9;

  // boss phases: summon adds at 66% / 33%
  if ((e.type === 'warden' || e.type === 'maw') && v) {
    const addType = e.type === 'warden' ? 'cultist' : 'drowned';
    if (e.hp < e.maxHp * 0.66 && e.phase < 1) { e.phase = 1; bossSummon(e, addType); }
    if (e.hp < e.maxHp * 0.33 && e.phase < 2) { e.phase = 2; bossSummon(e, addType); }
  }

  if (e.state === 'idle') {
    e.stateT -= dt;
    if (e.stateT <= 0) { e.state = 'wander'; e.stateT = 1 + Math.random() * 2; e.wanderAng = Math.random() * 7; }
    if (dp < e.aggroR) { e.state = 'chase'; if (e.boss) chat('sys', `⚠ ${e.name} stirs!`); }
  } else if (e.state === 'wander') {
    e.stateT -= dt;
    tryMove(e, Math.cos(e.wanderAng) * spd * 0.4 * dt, Math.sin(e.wanderAng) * spd * 0.4 * dt, 10);
    e.facing = Math.cos(e.wanderAng) < 0 ? -1 : 1;
    if (dist(e.x, e.y, e.homeX, e.homeY) > 160) e.wanderAng = Math.atan2(e.homeY - e.y, e.homeX - e.x);
    if (e.stateT <= 0) { e.state = 'idle'; e.stateT = 1 + Math.random() * 2.5; }
    if (dp < e.aggroR) e.state = 'chase';
  } else if (e.state === 'chase') {
    if (dp > e.aggroR * 2.6 || !v) { e.state = 'return'; return; }
    const ang = Math.atan2(v.y - e.y, v.x - e.x);
    e.facing = Math.cos(ang) < 0 ? -1 : 1;
    const atkRange = e.ranged ? 200 : 34 + (e.scale - 1) * 18;
    if (dp > atkRange) {
      tryMove(e, Math.cos(ang) * spd * dt, Math.sin(ang) * spd * dt, 10);
    } else if (e.attackT <= 0) {
      e.windup = 0.38;
      e.attackT = e.ranged ? 1.7 : 1.15;
    }
    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) {
        const v2 = nearestVictim(e);
        if (!v2) { e.state = 'return'; return; }
        if (e.ranged) {
          const a2 = Math.atan2(v2.y - e.y, v2.x - e.x);
          const n = e.type === 'warden' ? (e.phase >= 2 ? 8 : e.phase >= 1 ? 5 : 3)
                  : e.type === 'maw' ? (e.phase >= 1 ? 6 : 4) : 1;
          const ttl = e.type === 'warden' ? 1.9 : 1.2;   // ~500px / ~310px reach
          for (let i = 0; i < n; i++) {
            const sp = a2 + (n > 1 ? (i - (n - 1) / 2) * 0.28 : 0);
            const pr = { x: e.x, y: e.y - 10, vx: Math.cos(sp) * 260, vy: Math.sin(sp) * 260, dmg: e.dmg, from: 'enemy', ttl, kind: e.type === 'warden' ? 'blight' : 'shadow' };
            G.projectiles.push(pr);
            if (Net.connected) Net.send({ t: 'eproj', x: pr.x, y: pr.y, vx: Math.round(pr.vx), vy: Math.round(pr.vy), dmg: pr.dmg, kind: pr.kind, ttl });
          }
        } else if (dist(e.x, e.y, v2.x, v2.y) < atkRange + 22) {
          if (v2.id === null) damagePlayer(e.dmg, e.name);
          else Net.send({ t: 'ehit', target: v2.id, dmg: e.dmg, name: e.name });
        }
      }
    }
  } else if (e.state === 'return') {
    const ang = Math.atan2(e.homeY - e.y, e.homeX - e.x);
    tryMove(e, Math.cos(ang) * spd * dt, Math.sin(ang) * spd * dt, 10);
    e.facing = Math.cos(ang) < 0 ? -1 : 1;
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25 * dt);
    if (dist(e.x, e.y, e.homeX, e.homeY) < 24) e.state = 'idle';
    if (dp < e.aggroR * 0.7) e.state = 'chase';
  }
}

// snapshot-driven movement for clients that are not the world authority
function netLerpEnemy(e, dt) {
  if (e.dead) return;
  e.walkT += dt * 8;
  e.hurtT = Math.max(0, e.hurtT - dt);
  if (e.netX !== undefined) {
    if (dist(e.x, e.y, e.netX, e.netY) > 300) { e.x = e.netX; e.y = e.netY; }
    else {
      const nx = lerp(e.x, e.netX, Math.min(1, dt * 10));
      if (Math.abs(nx - e.x) > 0.5) e.facing = nx < e.x ? -1 : 1;
      e.x = nx;
      e.y = lerp(e.y, e.netY, Math.min(1, dt * 10));
    }
  }
}

function bossSummonAt(cx, cy, pts, type) {
  type = type || 'cultist';
  for (const [x, y] of pts) {
    const s = spawnEnemy(type, 70, 15);
    s.x = x; s.y = y; s.homeX = x; s.homeY = y;
    s.state = 'chase'; s.summoned = true;
    G.enemies.push(s);
  }
  chat('sys', type === 'drowned' ? '🌊 The Maw calls the Drowned from the deep!' : '☠ The Warden calls its servants!');
  spawnParticles(cx, cy, 30, type === 'drowned' ? '#5ac8d8' : '#9a5aff', 160, 0.8);
  G.shake = 0.5;
}
function bossSummon(e, type) {
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * 7;
    pts.push([Math.round(e.x + Math.cos(a) * 90), Math.round(e.y + Math.sin(a) * 90)]);
  }
  bossSummonAt(e.x, e.y, pts, type);
  if (Net.connected) Net.send({ t: 'esummon', pts, stype: type });
}

// ---------------- NPCs & bots ----------------
function spawnNpcs() {
  G.npcs = NPC_DEFS.map(d => ({ ...d, x: d.tx * TILE + 16, y: d.ty * TILE + 16, walkT: Math.random() * 7, facing: 1, bubbleT: 3 + Math.random() * 8, bubble: null }));
}

function spawnBots() {
  G.bots = [];
  const R = mulberry32(4242);
  for (let i = 0; i < 6; i++) {
    G.bots.push({
      name: BOT_NAMES[i], cls: BOT_CLASSES[i % 3],
      x: (62 + R() * 16) * TILE, y: (104 + R() * 14) * TILE,
      tx: 0, ty: 0, px1: 0, py1: 0, waitT: R() * 4, walkT: R() * 7, facing: 1, moving: false,
      level: 2 + Math.floor(R() * 7),
    });
  }
}

function updateBots(dt) {
  for (const b of G.bots) {
    b.walkT += dt * 9;
    if (b.waitT > 0) { b.waitT -= dt; b.moving = false; continue; }
    if (!b.moving) {
      // pick a destination: mostly village/meadow, sometimes forest road
      const spots = [[64, 108], [76, 110], [70, 118], [70, 96], [85, 92], [58, 100], [70, 75], [92, 90], [70, 60]];
      const s = spots[Math.floor(Math.random() * spots.length)];
      b.tx = s[0] * TILE + Math.random() * 60 - 30; b.ty = s[1] * TILE + Math.random() * 60 - 30;
      b.moving = true;
    }
    const d = dist(b.x, b.y, b.tx, b.ty);
    if (d < 12) { b.moving = false; b.waitT = 2 + Math.random() * 7; continue; }
    const ang = Math.atan2(b.ty - b.y, b.tx - b.x);
    b.facing = Math.cos(ang) < 0 ? -1 : 1;
    tryMove(b, Math.cos(ang) * 130 * dt, Math.sin(ang) * 130 * dt, 10);
    if (Math.abs(b.px1 - b.x) < 0.1 && Math.abs(b.py1 - b.y) < 0.1) { b.moving = false; b.waitT = 1; } // stuck
    b.px1 = b.x; b.py1 = b.y;
  }
}

function updateNpcs(dt) {
  for (const n of G.npcs) {
    n.walkT += dt * 3;
    n.bubbleT -= dt;
    if (n.bubbleT <= 0) {
      if (n.bubble) { n.bubble = null; n.bubbleT = 6 + Math.random() * 14; }
      else { n.bubble = n.idle[Math.floor(Math.random() * n.idle.length)]; n.bubbleT = 4; }
    }
    if (!G.player.dead) n.facing = G.player.x < n.x ? -1 : 1;
  }
}

// ---------------- Particles / floaters ----------------
function spawnParticles(x, y, n, color, spd, life, grav) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 7, s = spd * (0.3 + Math.random() * 0.7);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), maxLife: life, color, size: 1.5 + Math.random() * 2.5, grav: grav || 0 });
  }
}
function floater(x, y, txt, color, big) {
  G.floaters.push({ x: x + Math.random() * 16 - 8, y, txt, color, t: 1.1, big });
}

function updateFx(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.grav || 0) * dt;
    p.vx *= 0.94; p.vy *= 0.94;
    p.life -= dt;
    if (p.life <= 0) G.particles.splice(i, 1);
  }
  for (let i = G.floaters.length - 1; i >= 0; i--) {
    const f = G.floaters[i];
    f.y -= 34 * dt; f.t -= dt;
    if (f.t <= 0) G.floaters.splice(i, 1);
  }
}

// ============================================================
// Rendering — procedural characters
// ============================================================
function drawShadow(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, r, r * 0.38, 0, 0, 7); ctx.fill();
}

// humanoid: used for player, npcs, bots
function drawHumanoid(ctx, x, y, opts) {
  const { color, hair, facing, walkT, moving, name, nameColor, weapon, attackAnim, aim, hurt, level } = opts;
  const bob = moving ? Math.abs(Math.sin(walkT)) * 3 : Math.sin(G.time * 2 + x) * 0.8;
  const legSwing = moving ? Math.sin(walkT) * 5 : 0;
  drawShadow(ctx, x, y + 14, 11);
  ctx.save();
  ctx.translate(x, y - bob);
  if (hurt > 0) { ctx.globalAlpha = 0.6 + Math.sin(G.time * 40) * 0.4; }
  // legs
  ctx.fillStyle = '#2e2a3a';
  ctx.fillRect(-6, 4 + Math.max(0, -legSwing) * 0.4, 5, 10 + legSwing * 0.5);
  ctx.fillRect(1, 4 + Math.max(0, legSwing) * 0.4, 5, 10 - legSwing * 0.5);
  // body
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-8, -10, 16, 16, 5); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.roundRect(-8, -2, 16, 8, 4); ctx.fill();
  // belt
  ctx.fillStyle = '#c9a227'; ctx.fillRect(-8, 1, 16, 2.5);
  // head
  ctx.fillStyle = '#e8c49a';
  ctx.beginPath(); ctx.arc(0, -17, 7.5, 0, 7); ctx.fill();
  // hair
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(0, -19.5, 7, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  ctx.fillRect(-7, -20, 14, 4);
  // eyes
  ctx.fillStyle = '#1a1a2a';
  const eyeOff = facing < 0 ? -2.4 : 2.4;
  ctx.fillRect(eyeOff - 2.5, -18, 2, 2.5); ctx.fillRect(eyeOff + 1, -18, 2, 2.5);
  // weapon — appearance scales with the equipped item's tier
  if (weapon) {
    const wt = clamp((opts.wtier === undefined ? 0 : opts.wtier) + 1, 0, 4); // 0=unarmed/wood .. 4=legendary
    const swing = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) * 1.6 : 0;
    const a = (aim !== undefined ? aim : (facing < 0 ? Math.PI : 0));
    const gl = Math.sin(G.time * 5) * 0.5 + 0.5;
    ctx.save();
    ctx.rotate(a + swing - 0.5);
    if (weapon === 'sword') {
      const T = [
        { c: '#8a6a42', e: '#a89468', len: 12 },                                  // wooden practice sword
        { c: '#8e8a76', e: '#a8a48e', len: 14 },                                  // rusty
        { c: '#cfd4dd', e: '#e8ecf2', len: 17 },                                  // soldier steel
        { c: '#ff9a4a', e: '#ffd9a8', len: 19, glow: 'rgba(255,140,60,' },        // emberforged
        { c: '#ffe14a', e: '#fff6c8', len: 22, glow: 'rgba(255,225,100,' },       // wardenbane
      ][wt];
      if (T.glow) {
        ctx.fillStyle = T.glow + (0.20 + gl * 0.18) + ')';
        ctx.beginPath(); ctx.arc(14 + T.len / 2, 0, T.len * 0.75, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#8a4a2a'; ctx.fillRect(8, -1.5, 6, 3);
      ctx.fillStyle = wt >= 4 ? '#c9a227' : '#6a5a3a'; ctx.fillRect(13, -3.5, 2, 7);  // crossguard
      ctx.fillStyle = T.c; ctx.beginPath();
      ctx.moveTo(15, -2.5); ctx.lineTo(15 + T.len, 0); ctx.lineTo(15, 2.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.e; ctx.fillRect(15, -0.7, T.len - 2, 1.4);
    } else if (weapon === 'staff') {
      const T = [
        { orb: null },
        { orb: '120,150,255', r: 3.5 },
        { orb: '150,175,255', r: 4.2 },
        { orb: '255,150,70',  r: 5.0 },
        { orb: '255,225,100', r: 5.8 },
      ][wt];
      ctx.strokeStyle = wt >= 3 ? '#7a4a2a' : '#6a4a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(26, 0); ctx.stroke();
      if (T.orb) {
        ctx.fillStyle = `rgba(${T.orb},${0.16 + gl * 0.14})`;
        ctx.beginPath(); ctx.arc(28, 0, T.r * 2.1, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(${T.orb},${0.7 + gl * 0.3})`;
        ctx.beginPath(); ctx.arc(28, 0, T.r + gl, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(28, 0, 1.8, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = '#8a6a42'; ctx.beginPath(); ctx.arc(27, 0, 2.5, 0, 7); ctx.fill(); // plain knot
      }
    } else if (weapon === 'bow') {
      const T = [
        { c: '#8a6a42', str: '#bbb', r: 8 },
        { c: '#7a5a2f', str: '#ddd', r: 9 },
        { c: '#5a4a3f', str: '#eee', r: 9.5, tips: '#cfd4dd' },
        { c: '#a85a2a', str: '#ffd9a8', r: 10, tips: '#ff9a4a', glow: 'rgba(255,140,60,' },
        { c: '#c9a227', str: '#fff6c8', r: 11, tips: '#ffe14a', glow: 'rgba(255,225,100,' },
      ][wt];
      if (T.glow) {
        ctx.fillStyle = T.glow + (0.15 + gl * 0.12) + ')';
        ctx.beginPath(); ctx.arc(16, 0, T.r + 6, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = T.c; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(16, 0, T.r, -1.2, 1.2); ctx.stroke();
      if (T.tips) {
        ctx.fillStyle = T.tips;
        ctx.beginPath(); ctx.arc(16 + Math.cos(-1.2) * T.r, Math.sin(-1.2) * T.r, 1.8, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(16 + Math.cos(1.2) * T.r, Math.sin(1.2) * T.r, 1.8, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = T.str; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(16 + Math.cos(-1.2) * T.r, Math.sin(-1.2) * T.r);
      ctx.lineTo(12, 0); ctx.lineTo(16 + Math.cos(1.2) * T.r, Math.sin(1.2) * T.r); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  // nameplate (level intentionally not shown here — right-click a character to inspect it)
  if (name) {
    ctx.font = 'bold 10px Verdana';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    const w = ctx.measureText(name).width;
    ctx.fillRect(x - w / 2 - 4, y - 44, w + 8, 13);
    ctx.fillStyle = nameColor || '#fff';
    ctx.fillText(name, x, y - 34);
  }
}

function drawEnemy(ctx, e, cam) {
  const x = e.x - cam.x, y = e.y - cam.y;
  if (x < -80 || y < -80 || x > G.W + 80 || y > G.H + 80) return;
  if (e.dead) return;
  const s = e.scale;
  const bob = Math.sin(e.walkT) * 2;
  if (e.elite) {
    const gl = Math.sin(G.time * 4) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(255,210,80,${0.35 + gl * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 12 * s, 15 * s + gl * 2, 6 * s, 0, 0, 7); ctx.stroke();
  }
  ctx.save();
  if (e.hurtT > 0) ctx.globalAlpha = 0.55 + Math.sin(G.time * 40) * 0.35;
  if (e.kind === 'wolf') {
    drawShadow(ctx, x, y + 10 * s, 14 * s);
    ctx.translate(x, y - Math.abs(bob));
    ctx.scale(e.facing * s, s);
    const dark = e.type === 'gloomfang';
    ctx.fillStyle = dark ? '#2a2a38' : '#6a6a72';
    // body
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 8, 0, 0, 7); ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(13, -4, 7, 0, 7); ctx.fill();
    // snout + ear
    ctx.beginPath(); ctx.moveTo(17, -5); ctx.lineTo(24, -2); ctx.lineTo(17, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(9, -9); ctx.lineTo(11, -15); ctx.lineTo(14, -9); ctx.closePath(); ctx.fill();
    // legs
    ctx.fillRect(-11, 5, 3.5, 8 + bob * 0.5); ctx.fillRect(-4, 5, 3.5, 8 - bob * 0.5);
    ctx.fillRect(4, 5, 3.5, 8 - bob * 0.4); ctx.fillRect(10, 5, 3.5, 8 + bob * 0.4);
    // tail
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.quadraticCurveTo(-22, -8 + bob, -19, -12 + bob); ctx.quadraticCurveTo(-16, -6, -13, -4); ctx.fill();
    // eye
    ctx.fillStyle = dark ? '#a55aff' : '#c93a3a';
    ctx.beginPath(); ctx.arc(14, -5, 1.8, 0, 7); ctx.fill();
    if (dark) { // gloomfang aura
      ctx.fillStyle = 'rgba(150,80,255,.14)';
      ctx.beginPath(); ctx.arc(0, -2, 24, 0, 7); ctx.fill();
    }
  } else if (e.kind === 'boar') {
    drawShadow(ctx, x, y + 10 * s, 14 * s);
    ctx.translate(x, y - Math.abs(bob));
    ctx.scale(e.facing * s, s);
    // body with bristly back
    ctx.fillStyle = '#6b4a30';
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a3320';
    ctx.beginPath(); ctx.moveTo(-13, -5); ctx.quadraticCurveTo(0, -12, 12, -5); ctx.quadraticCurveTo(0, -7, -13, -5); ctx.fill();
    // head + snout
    ctx.fillStyle = '#6b4a30';
    ctx.beginPath(); ctx.arc(13, -1, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a6a4a';
    ctx.beginPath(); ctx.ellipse(19, 1, 4, 3, 0, 0, 7); ctx.fill();
    // tusks
    ctx.strokeStyle = '#f0e8d8'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(17, 3); ctx.quadraticCurveTo(20, 1, 20, -2); ctx.stroke();
    // legs + eye + tail
    ctx.fillStyle = '#4a3320';
    ctx.fillRect(-10, 6, 3.5, 8 + bob * 0.5); ctx.fillRect(-3, 6, 3.5, 8 - bob * 0.5);
    ctx.fillRect(5, 6, 3.5, 8 - bob * 0.4); ctx.fillRect(11, 6, 3.5, 8 + bob * 0.4);
    ctx.fillStyle = '#1a0f08';
    ctx.beginPath(); ctx.arc(14, -3, 1.6, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.quadraticCurveTo(-18, -4 + bob, -17, -8 + bob); ctx.stroke();
  } else if (e.kind === 'sprite') {
    const fl = Math.sin(G.time * 4 + e.x) * 4;
    drawShadow(ctx, x, y + 14, 8);
    ctx.translate(x, y + fl - 8);
    const gl = Math.sin(G.time * 6 + e.y) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(120,220,140,${0.25 + gl * 0.2})`;
    ctx.beginPath(); ctx.arc(0, 0, 14 + gl * 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#8ae89a';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#eaffea';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill();
    // wisps
    for (let i = 0; i < 3; i++) {
      const wa = G.time * 3 + i * 2.1;
      ctx.fillStyle = `rgba(140,240,160,${0.5 - i * 0.12})`;
      ctx.beginPath(); ctx.arc(Math.cos(wa) * 11, Math.sin(wa) * 6, 2.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#1a3a1a';
    ctx.fillRect(-3, -2, 2, 3); ctx.fillRect(1.5, -2, 2, 3);
  } else if (e.kind === 'bat') {
    const fl = Math.sin(G.time * 7 + e.x) * 5;
    drawShadow(ctx, x, y + 16, 8);
    ctx.translate(x, y + fl - 14);
    ctx.scale(e.facing, 1);
    const flap = Math.sin(e.walkT * 2.4) * 0.8;
    ctx.fillStyle = '#4a3a5a';
    // wings
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.quadraticCurveTo(-14, -8 - flap * 6, -20, 2 - flap * 8); ctx.quadraticCurveTo(-12, 4, -3, 3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(3, 0); ctx.quadraticCurveTo(14, -8 - flap * 6, 20, 2 - flap * 8); ctx.quadraticCurveTo(12, 4, 3, 3); ctx.fill();
    // body
    ctx.fillStyle = '#5a4a6a';
    ctx.beginPath(); ctx.ellipse(0, 0, 6, 7.5, 0, 0, 7); ctx.fill();
    // ears
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-3, -11); ctx.lineTo(-1, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(3, -11); ctx.lineTo(1, -6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e85a5a';
    ctx.fillRect(-3, -3, 2, 2); ctx.fillRect(1, -3, 2, 2);
  } else if (e.kind === 'slime') {
    const sq = Math.sin(e.walkT * 0.8) * 0.15;
    drawShadow(ctx, x, y + 10, 13);
    ctx.translate(x, y);
    ctx.scale(1 + sq, 1 - sq);
    const grad = ctx.createRadialGradient(0, -4, 2, 0, 0, 16);
    grad.addColorStop(0, 'rgba(255,150,60,.95)');
    grad.addColorStop(1, 'rgba(200,70,20,.75)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(-14, 8);
    ctx.quadraticCurveTo(-16, -10, 0, -12);
    ctx.quadraticCurveTo(16, -10, 14, 8);
    ctx.quadraticCurveTo(0, 12, -14, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,150,.5)';
    ctx.beginPath(); ctx.arc(-5, -6, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#5a1a0a';
    ctx.fillRect(-6, -4, 3, 4); ctx.fillRect(3, -4, 3, 4);
    // embers rising
    if (Math.random() < 0.1) spawnParticles(e.x, e.y - 8, 1, '#ffaa4a', 20, 0.7, -60);
  } else if (e.kind === 'cultist') {
    drawShadow(ctx, x, y + 14, 10);
    ctx.translate(x, y - Math.abs(bob) * 0.5);
    ctx.scale(e.facing, 1);
    // robe
    ctx.fillStyle = '#3a2a4a';
    ctx.beginPath(); ctx.moveTo(-9, 14); ctx.quadraticCurveTo(-10, -12, 0, -14); ctx.quadraticCurveTo(10, -12, 9, 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a1a3a';
    ctx.beginPath(); ctx.moveTo(-9, 14); ctx.quadraticCurveTo(-4, 8, 0, 14); ctx.closePath(); ctx.fill();
    // hood
    ctx.fillStyle = '#4a3a5f';
    ctx.beginPath(); ctx.arc(0, -16, 8, Math.PI * 0.8, Math.PI * 2.2); ctx.fill();
    ctx.fillStyle = '#0a0a12';
    ctx.beginPath(); ctx.arc(1, -15, 5, 0, 7); ctx.fill();
    // glowing eyes
    const gl = Math.sin(G.time * 3) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(160,90,255,${gl})`;
    ctx.fillRect(-1, -17, 2, 2); ctx.fillRect(3, -17, 2, 2);
    // rune sash
    ctx.fillStyle = '#9a5aff'; ctx.fillRect(-9, -2, 18, 2);
    if (e.windup > 0) {
      ctx.fillStyle = `rgba(160,90,255,${0.6})`;
      ctx.beginPath(); ctx.arc(10, -8, 4 + Math.sin(G.time * 20) * 2, 0, 7); ctx.fill();
    }
  } else if (e.kind === 'drowned') {
    drawShadow(ctx, x, y + 14, 10);
    ctx.translate(x, y - Math.abs(bob) * 0.4);
    ctx.scale(e.facing, 1);
    // waterlogged body, arms out
    ctx.fillStyle = '#4a7a72';
    ctx.beginPath(); ctx.roundRect(-8, -12, 16, 22, 5); ctx.fill();
    ctx.fillStyle = '#3a5f5a';
    ctx.fillRect(-8, -2, 16, 4);
    // reaching arms
    ctx.strokeStyle = '#4a7a72'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const reach = Math.sin(e.walkT) * 2;
    ctx.beginPath(); ctx.moveTo(6, -8); ctx.lineTo(15, -6 + reach); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(14, 1 - reach); ctx.stroke();
    // head, tilted
    ctx.fillStyle = '#5a8a80';
    ctx.beginPath(); ctx.arc(2, -18, 7, 0, 7); ctx.fill();
    // kelp strands
    ctx.strokeStyle = '#2a4f3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-2, -24); ctx.quadraticCurveTo(-6, -18, -4, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -23); ctx.quadraticCurveTo(8, -16, 6, -11); ctx.stroke();
    // glowing eyes
    const gl2 = Math.sin(G.time * 3 + e.x) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(120,240,255,${gl2})`;
    ctx.fillRect(1, -20, 2.5, 2.5); ctx.fillRect(5.5, -20, 2.5, 2.5);
    // drips
    if (Math.random() < 0.04) spawnParticles(e.x, e.y, 1, '#7ac8d8', 15, 0.5, 60);
  } else if (e.kind === 'maw') {
    drawShadow(ctx, x, y + 26, 34);
    ctx.translate(x, y + Math.sin(e.walkT * 0.6) * 3);
    ctx.scale(e.facing, 1);
    const gl = Math.sin(G.time * 2.5) * 0.5 + 0.5;
    // abyssal aura
    ctx.fillStyle = `rgba(60,180,210,${0.08 + gl * 0.07})`;
    ctx.beginPath(); ctx.arc(0, -8, 52, 0, 7); ctx.fill();
    // tail
    ctx.fillStyle = '#1f4a52';
    ctx.beginPath(); ctx.moveTo(-24, -6); ctx.quadraticCurveTo(-40, -14 + Math.sin(e.walkT) * 4, -44, -2);
    ctx.quadraticCurveTo(-40, 4, -24, 2); ctx.fill();
    // body
    const bodyGrad = ctx.createLinearGradient(0, -32, 0, 14);
    bodyGrad.addColorStop(0, '#2a6a74'); bodyGrad.addColorStop(1, '#143038');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath(); ctx.ellipse(-4, -8, 28, 22, 0, 0, 7); ctx.fill();
    // dorsal spines
    ctx.strokeStyle = '#1a3a40'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(-16 + i * 7, -26);
      ctx.lineTo(-18 + i * 7, -36 - Math.sin(G.time * 2 + i) * 2); ctx.stroke();
    }
    // gaping jaw
    const openJaw = e.windup > 0 ? 14 : 8 + Math.sin(G.time * 1.5) * 2;
    ctx.fillStyle = '#0c1a20';
    ctx.beginPath(); ctx.moveTo(8, -18); ctx.quadraticCurveTo(30, -14, 32, -4);
    ctx.quadraticCurveTo(30, 6 + openJaw * 0.4, 8, 8 + openJaw * 0.3);
    ctx.quadraticCurveTo(16, -4, 8, -18); ctx.fill();
    // teeth
    ctx.fillStyle = '#d8e8e0';
    for (let i = 0; i < 5; i++) {
      const tx2 = 12 + i * 4.2;
      ctx.beginPath(); ctx.moveTo(tx2, -14 + i * 1.2); ctx.lineTo(tx2 + 1.6, -8 + i); ctx.lineTo(tx2 + 3.2, -13 + i * 1.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx2, 6 + openJaw * 0.25); ctx.lineTo(tx2 + 1.6, 0 + i * 0.5); ctx.lineTo(tx2 + 3.2, 6.5 + openJaw * 0.25); ctx.closePath(); ctx.fill();
    }
    // lure: stalk + glowing orb
    ctx.strokeStyle = '#2a6a74'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -28); ctx.quadraticCurveTo(18, -44, 30, -40 + Math.sin(G.time * 1.8) * 3); ctx.stroke();
    ctx.fillStyle = `rgba(150,240,255,${0.25 + gl * 0.2})`;
    ctx.beginPath(); ctx.arc(30, -40 + Math.sin(G.time * 1.8) * 3, 9 + gl * 3, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(200,250,255,${0.8 + gl * 0.2})`;
    ctx.beginPath(); ctx.arc(30, -40 + Math.sin(G.time * 1.8) * 3, 4, 0, 7); ctx.fill();
    // eye
    ctx.fillStyle = `rgba(180,250,255,${0.85})`;
    ctx.beginPath(); ctx.arc(2, -16, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#0c1a20';
    ctx.beginPath(); ctx.arc(3, -16, 1.6, 0, 7); ctx.fill();
    // fin
    ctx.fillStyle = '#1f4a52';
    ctx.beginPath(); ctx.moveTo(-6, 8); ctx.quadraticCurveTo(-2, 20, 8, 16); ctx.quadraticCurveTo(0, 10, -6, 8); ctx.fill();
    // bubbles
    if (Math.random() < 0.12) spawnParticles(e.x + (Math.random() - 0.5) * 40, e.y - 20, 1, '#a8e8f8', 18, 1.2, -40);
  } else if (e.kind === 'warden') {
    drawShadow(ctx, x, y + 30, 30);
    ctx.translate(x, y - Math.abs(Math.sin(e.walkT * 0.5)) * 3);
    const gl = Math.sin(G.time * 2) * 0.5 + 0.5;
    // root-aura
    ctx.fillStyle = `rgba(120,60,200,${0.10 + gl * 0.08})`;
    ctx.beginPath(); ctx.arc(0, -10, 55, 0, 7); ctx.fill();
    // roots/legs
    ctx.strokeStyle = '#2a1f30'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.5 + Math.sin(G.time * 1.5 + i) * 0.12;
      ctx.beginPath(); ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(Math.sin(a) * 22, 22, Math.sin(a) * 34, 32); ctx.stroke();
    }
    // trunk body
    const bodyGrad = ctx.createLinearGradient(0, -46, 0, 10);
    bodyGrad.addColorStop(0, '#4a3a5a'); bodyGrad.addColorStop(1, '#241a2e');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath(); ctx.moveTo(-20, 10);
    ctx.quadraticCurveTo(-26, -30, -10, -44);
    ctx.quadraticCurveTo(0, -50, 10, -44);
    ctx.quadraticCurveTo(26, -30, 20, 10);
    ctx.quadraticCurveTo(0, 16, -20, 10); ctx.fill();
    // bark cracks glowing
    ctx.strokeStyle = `rgba(170,90,255,${0.5 + gl * 0.5})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -38); ctx.lineTo(-4, -20); ctx.lineTo(-9, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -36); ctx.lineTo(5, -18); ctx.lineTo(10, -4); ctx.stroke();
    // heart
    ctx.fillStyle = `rgba(200,120,255,${0.7 + gl * 0.3})`;
    ctx.beginPath(); ctx.arc(0, -22, 6 + gl * 2, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, -22, 2.5, 0, 7); ctx.fill();
    // crown branches
    ctx.strokeStyle = '#3a2a4a'; ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((i - 1.5) * 8, -44);
      ctx.quadraticCurveTo((i - 1.5) * 14, -58, (i - 1.5) * 16 + Math.sin(G.time + i) * 3, -66); ctx.stroke();
    }
    // eyes
    ctx.fillStyle = `rgba(220,150,255,${0.8 + gl * 0.2})`;
    ctx.beginPath(); ctx.arc(-7, -34, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(7, -34, 3, 0, 7); ctx.fill();
  }
  ctx.restore();
  // health bar + nameplate
  const above = e.kind === 'warden' ? 78 : 26 * s + 8;
  if (e.hp < e.maxHp || e.state === 'chase' || e.boss) {
    const w = e.boss ? 60 : 30;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x - w / 2 - 1, y - above - 1, w + 2, 6);
    ctx.fillStyle = e.boss ? '#b04aff' : '#c93a3a';
    ctx.fillRect(x - w / 2, y - above, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  ctx.font = (e.boss ? 'bold 11px' : '9px') + ' Verdana';
  ctx.textAlign = 'center';
  ctx.fillStyle = e.boss ? '#d8a8ff' : e.elite ? '#ffd24a' : '#e8b0b0';
  ctx.fillText(`${e.name}  Lv${e.lv}`, x, y - above - 5);
}

// ---------------- Ground loot ----------------
const RAR_COLORS = ['#c9c9c9', '#7fd18a', '#8fb3ff', '#c98fff'];

function spawnGroundItem(x, y, id, qty, noPickup) {
  G.groundItems.push({
    x: x + (Math.random() - 0.5) * 28, y: y + (Math.random() - 0.5) * 20,
    id, qty: qty || 1, ttl: 90, bob: Math.random() * 7, noPickup: noPickup || 0.8,
  });
}

function canHold(id) {
  const def = ITEMS[id];
  const stackable = def.slot === 'use' || def.slot === 'quest' || def.slot === 'junk';
  if (stackable && G.player.inv.some(s => s && s.id === id)) return true;
  return invFreeSlots() > 0;
}

function updateGroundItems(dt) {
  const p = G.player;
  for (let i = G.groundItems.length - 1; i >= 0; i--) {
    const g = G.groundItems[i];
    g.ttl -= dt;
    if (g.ttl <= 0) { G.groundItems.splice(i, 1); continue; }
    if (g.noPickup > 0) { g.noPickup -= dt; continue; }
    if (p.dead) continue;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d < 52 && canHold(g.id)) {   // loot magnet
      g.x = lerp(g.x, p.x, Math.min(1, dt * 7));
      g.y = lerp(g.y, p.y, Math.min(1, dt * 7));
    }
    if (d < 20 && canHold(g.id)) {
      addItem(g.id, g.qty);
      const it = ITEMS[g.id];
      floater(p.x, p.y - 26, it.icon + ' ' + it.name + (g.qty > 1 ? ' x' + g.qty : ''), RAR_COLORS[it.rar]);
      if (it.rar >= 2) { chat('sys', `✨ Picked up ${itemLabel(g.id)}!`); sfx('quest'); }
      else sfx('gather');
      G.groundItems.splice(i, 1);
    }
  }
}

function drawGroundItems(ctx, cam) {
  for (const g of G.groundItems) {
    const x = g.x - cam.x, y = g.y - cam.y;
    if (x < -40 || y < -40 || x > G.W + 40 || y > G.H + 40) continue;
    const it = ITEMS[g.id];
    const bob = Math.sin(G.time * 3 + g.bob) * 2.5;
    const fade = g.ttl < 8 ? (Math.sin(G.time * 10) * 0.5 + 0.5) : 1;   // blink when expiring
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(x, y + 7, 8, 3, 0, 0, 7); ctx.fill();
    // rarity glow; rares get a light beam
    const gl = Math.sin(G.time * 4 + g.bob) * 0.5 + 0.5;
    if (it.rar >= 1) {
      ctx.fillStyle = RAR_COLORS[it.rar] + '';
      ctx.globalAlpha = fade * (0.10 + gl * 0.12);
      ctx.beginPath(); ctx.arc(x, y - 4 + bob, 13 + gl * 3, 0, 7); ctx.fill();
      if (it.rar >= 2) {
        const beam = ctx.createLinearGradient(0, y - 46, 0, y + 4);
        beam.addColorStop(0, 'rgba(255,255,255,0)');
        beam.addColorStop(1, RAR_COLORS[it.rar] + '');
        ctx.fillStyle = beam;
        ctx.globalAlpha = fade * (0.18 + gl * 0.12);
        ctx.fillRect(x - 4, y - 46, 8, 50);
      }
      ctx.globalAlpha = fade;
    }
    ctx.font = '15px serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(it.icon, x, y + 1 + bob);
    if (g.qty > 1) {
      ctx.font = 'bold 9px Verdana';
      ctx.fillStyle = '#fff';
      ctx.fillText('x' + g.qty, x + 10, y + 6 + bob);
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------- Dodge roll (Space) ----------------
function doRoll() {
  const p = G.player;
  if (p.dead || p.rollCd > 0 || p.rollT > 0 || G.state !== 'play') return;
  let mx = 0, my = 0;
  if (G.keys['w'] || G.keys['arrowup']) my -= 1;
  if (G.keys['s'] || G.keys['arrowdown']) my += 1;
  if (G.keys['a'] || G.keys['arrowleft']) mx -= 1;
  if (G.keys['d'] || G.keys['arrowright']) mx += 1;
  p.rollAng = (mx || my) ? Math.atan2(my, mx) : p.facing;
  p.rollT = 0.20;
  p.rollCd = 2.0;
  sfx('swing');
  spawnParticles(p.x, p.y + 8, 8, '#cfc8b0', 80, 0.35);
}

// ---------------- Treasure chests ----------------
function spawnChests() {
  G.chests = [];
  const R = mulberry32(9099);
  for (const [px, py, tier] of CHEST_SPOTS) {
    let x = px, y = py;
    for (let tries = 0; tries < 30 && World.blockedTile(x, y); tries++) {
      x = px + Math.floor(R() * 5) - 2; y = py + Math.floor(R() * 5) - 2;
    }
    if (!World.blockedTile(x, y)) G.chests.push({ x: x * TILE + 16, y: y * TILE + 16, tier, open: false });
  }
}

function openChest(c) {
  c.open = true;
  const gold = 15 * c.tier + Math.floor(Math.random() * 12 * c.tier);
  G.player.gold += gold;
  floater(c.x, c.y - 24, '+' + gold + 'g', '#ffd700');
  const pool = CHEST_LOOT[c.tier];
  const item = resolveReward(pool[Math.floor(Math.random() * pool.length)]);
  addItem(item, 1);
  chat('sys', `Treasure! +${gold}g and ${itemLabel(item)}.`);
  sfx('coin');
  spawnParticles(c.x, c.y - 8, 22, '#ffd24a', 130, 0.6, -60);
  if (G.chests.every(ch => ch.open)) unlockAch('chest_all');
  if (G.player.gold >= 500) unlockAch('rich');
}

function drawChests(ctx, cam) {
  for (const c of G.chests) {
    const x = c.x - cam.x, y = c.y - cam.y;
    if (x < -40 || y < -40 || x > G.W + 40 || y > G.H + 40) continue;
    drawShadow(ctx, x, y + 8, 11);
    // body
    ctx.fillStyle = '#6e4a26';
    ctx.beginPath(); ctx.roundRect(x - 10, y - 6, 20, 13, 2); ctx.fill();
    ctx.fillStyle = '#54371c';
    ctx.fillRect(x - 10, y - 6, 20, 3);
    // lid
    ctx.fillStyle = c.open ? '#3a2712' : '#7e5630';
    if (c.open) {
      ctx.fillRect(x - 10, y - 6, 20, 4);   // dark interior
      ctx.fillStyle = '#7e5630';
      ctx.beginPath(); ctx.roundRect(x - 11, y - 15, 22, 6, 2); ctx.fill(); // lid tipped back
    } else {
      ctx.beginPath(); ctx.roundRect(x - 11, y - 11, 22, 7, 3); ctx.fill();
    }
    // gold band + clasp
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(x - 2, y - (c.open ? 6 : 11), 4, c.open ? 12 : 17);
    if (!c.open) {
      const gl = Math.sin(G.time * 3 + c.x) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,225,120,${0.5 + gl * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y - 7, 2.2, 0, 7); ctx.fill();
      if (Math.random() < 0.02) spawnParticles(c.x + (Math.random() - 0.5) * 16, c.y - 10, 1, '#ffe98a', 24, 0.8, -40);
    }
  }
}

// ---------------- Portals (crypt stairs) ----------------
function drawPortals(ctx, cam) {
  for (const pt of G.portals) {
    const x = pt.x - cam.x, y = pt.y - cam.y;
    if (x < -50 || y < -50 || x > G.W + 50 || y > G.H + 50) continue;
    const gl = Math.sin(G.time * 2.2 + pt.x) * 0.5 + 0.5;
    // glow
    ctx.fillStyle = `rgba(90,200,220,${0.10 + gl * 0.12})`;
    ctx.beginPath(); ctx.ellipse(x, y, 26 + gl * 4, 16, 0, 0, 7); ctx.fill();
    // stone rim
    ctx.fillStyle = '#4a4a54';
    ctx.beginPath(); ctx.ellipse(x, y, 20, 12, 0, 0, 7); ctx.fill();
    // dark stairwell
    ctx.fillStyle = '#0a1418';
    ctx.beginPath(); ctx.ellipse(x, y, 15, 8.5, 0, 0, 7); ctx.fill();
    // steps
    ctx.strokeStyle = 'rgba(120,200,220,.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y + (pt.down ? i * 1.5 : -i * 1.5), 11 - i * 3.5, 6 - i * 2, 0, 0, 7);
      ctx.stroke();
    }
    // direction marker
    ctx.font = 'bold 12px Verdana';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(150,230,245,${0.6 + gl * 0.4})`;
    ctx.fillText(pt.down ? '▼' : '▲', x, y - 18);
    if (Math.random() < 0.03) spawnParticles(pt.x + (Math.random() - 0.5) * 24, pt.y, 1, '#8ad4e8', 20, 1, -35);
  }
}

function drawGatherNodes(ctx, cam) {
  for (const n of G.gatherNodes) {
    if (n.taken > 0) continue;
    const x = n.x - cam.x, y = n.y - cam.y;
    if (x < -40 || y < -40 || x > G.W + 40 || y > G.H + 40) continue;
    if (n.item === 'sunberry') {
      // low berry bush
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.ellipse(x, y + 8, 12, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d6b33';
      ctx.beginPath(); ctx.arc(x - 5, y + 2, 7, 0, 7); ctx.arc(x + 5, y + 2, 7, 0, 7); ctx.arc(x, y - 3, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8503a';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9 + n.x;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * 6, y - 1 + Math.sin(a) * 4, 2, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,200,120,.25)';
      ctx.beginPath(); ctx.arc(x - 2, y - 4, 2.5, 0, 7); ctx.fill();
      continue;
    }
    const gl = Math.sin(G.time * 3 + n.x) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(200,160,255,${0.18 + gl * 0.18})`;
    ctx.beginPath(); ctx.arc(x, y - 4, 12 + gl * 3, 0, 7); ctx.fill();
    // stem
    ctx.strokeStyle = '#3a6a3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.quadraticCurveTo(x + 2, y, x, y - 4); ctx.stroke();
    // petals
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + G.time * 0.4;
      ctx.fillStyle = '#d8b8ff';
      ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 5, y - 4 + Math.sin(a) * 5, 3.5, 2, a, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fff2b0';
    ctx.beginPath(); ctx.arc(x, y - 4, 2.5, 0, 7); ctx.fill();
  }
}
