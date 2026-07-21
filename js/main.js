// ============================================================
// EMBERFALL ONLINE — main.js : loop, input, render, lighting,
// title screen
// ============================================================
'use strict';

let lightC = null, lightX = null;

function init() {
  G.canvas = $('game');
  G.ctx = G.canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  loadSettings();
  World.gen();
  spawnChests();
  spawnNpcs();
  spawnBots();
  initWeather();
  setupTitle();
  setupInput();
  wirePauseMenu();
  wireTradePanel();
  requestAnimationFrame(loop);
  setInterval(saveGame, 15000);
  window.addEventListener('beforeunload', () => {
    if (!G.player || G.state === 'title') return;
    const data = saveGame();
    if (data) Auth.beaconSave(data);   // reliable last-moment sync to the realm
  });
}

function resize() {
  G.W = G.canvas.width = window.innerWidth;
  G.H = G.canvas.height = window.innerHeight;
  lightC = document.createElement('canvas');
  lightC.width = G.W; lightC.height = G.H;
  lightX = lightC.getContext('2d');
}

// ---------------- Title screen ----------------
let selClass = 'warrior';
function setupTitle() {
  const row = $('classRow');
  row.innerHTML = '';
  for (const [key, c] of Object.entries(CLASSES)) {
    const d = document.createElement('div');
    d.className = 'classCard' + (key === selClass ? ' sel' : '');
    d.innerHTML = `<div class="cicon">${c.icon}</div><h4>${c.name}</h4><p>${c.desc}</p>`;
    d.onclick = () => {
      selClass = key;
      document.querySelectorAll('.classCard').forEach(el => el.classList.remove('sel'));
      d.classList.add('sel');
    };
    row.appendChild(d);
  }
  $('playBtn').onclick = () => {
    const name = $('nameInput').value.trim() || 'Shardbearer';
    Auth.forgeHero(selClass, name);
  };
  Auth.init();
}

function enterWorld(fromSave) {
  if (fromSave) spawnAllEnemies();
  $('titleScreen').classList.add('hidden');
  G.state = 'play';
  startMusic();
  Net.connect();
  buildHotbar();
  refreshTracker(); refreshPanels();
  chat('sys', `Welcome to Emberfall, ${G.player.name}!`);
  chat('sys', 'WASD to move · mouse to aim · click or [1] to attack · [E] to interact.');
  if (!fromSave) {
    chat('sys', '⚜ Elder Maren wishes to speak with you (gold dot on the minimap).');
    // auto-start the intro quest so the tracker guides the player
    acceptQuest(QUESTS[0]);
  }
  setTimeout(() => chat('player', 'oh hey, a new shardbearer just logged in. welcome!', 'Mooncall'), 4000);
}

// ---------------- Input ----------------
function setupInput() {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (G.state === 'title') return;
    // chat input capture: while typing, game keys are ignored
    const ci = $('chatInput');
    if (document.activeElement === ci) {
      if (k === 'enter') {
        const txt = ci.value.trim();
        if (txt) {
          chat('player', txt, G.player.name);
          if (Net.connected) Net.sendChat(txt);
        }
        ci.value = ''; ci.classList.add('hidden'); ci.blur();
      } else if (k === 'escape') {
        ci.value = ''; ci.classList.add('hidden'); ci.blur();
      }
      return;
    }
    if (k === 'enter') {
      const ae = document.activeElement;
      if (ae && ae.tagName === 'INPUT' && ae !== ci) { ae.blur(); return; }   // commit e.g. trade gold field
      if (G.state === 'play' && !G.paused && !anyPanelOpen()) {
        e.preventDefault();
        ci.classList.remove('hidden'); ci.focus();
      }
      return;
    }
    if (k === 'escape') {
      if ($('ctxMenu')) { closeCtxMenu(); return; }
      if (Trade.active) { Trade.cancel(); return; }
      if (!$('pauseMenu').classList.contains('hidden')) closePause();
      else if (anyPanelOpen()) { ['inventory', 'charsheet', 'questlog'].forEach(p => $(p).classList.add('hidden')); closeDialogue(); }
      else openPause();
      return;
    }
    // typing in any input (trade gold etc.) — don't run game keybinds
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.id !== 'nameInput') return;
    if (G.paused) { if (k === 'n') toggleMute(); return; }
    G.keys[k] = true;
    if (k >= '1' && k <= '4') useSkill(+k - 1);
    if (k === '5' || k === '6') {
      const bind = G.player.potionBinds[k === '5' ? 0 : 1];
      if (bind && countItem(bind)) useItem(bind);
      else chat('sys', bind ? `No ${ITEMS[bind].name}s left! Bram sells supplies.` : 'Nothing bound — drag a potion from your bag onto that slot.');
    }
    if (k === ' ') { e.preventDefault(); doRoll(); }
    if (k === 'm') togglePanel('worldMap');
    if (k === 'n') toggleMute();
    if (k === 'e') interact();
    if (k === 'i') togglePanel('inventory');
    if (k === 'c') togglePanel('charsheet');
    if (k === 'l') togglePanel('questlog');
    if (k === 'p') togglePanel('board');
  });
  window.addEventListener('keyup', e => { G.keys[e.key.toLowerCase()] = false; });
  G.canvas.addEventListener('mousemove', e => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
  G.canvas.addEventListener('mousedown', e => {
    if (G.state !== 'play' || G.paused || e.button !== 0) return;
    const hit = entityAtScreen(e.clientX, e.clientY);
    if (hit && tryClickInteract(hit, e.clientX, e.clientY)) return;   // clicked a person/chest/flower — no swing
    if (hit && hit.kind === 'enemy') G.target = hit.enemy;
    G.mouse.down = true;
    useSkill(0);
  });
  G.canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (G.state !== 'play' || G.paused) return;
    const hit = entityAtScreen(e.clientX, e.clientY);
    if (hit) openCtxMenu(hit, e.clientX, e.clientY);
    else closeCtxMenu();
  });
  // any press outside the menu dismisses it — capture phase, so it runs BEFORE
  // the canvas handler that may open a new menu on this same click
  window.addEventListener('mousedown', e => {
    if (!e.target.closest || !e.target.closest('#ctxMenu')) closeCtxMenu();
  }, true);
  // drag an item out of the bag onto the world → drop it on the ground
  G.canvas.addEventListener('dragover', e => e.preventDefault());
  G.canvas.addEventListener('drop', e => {
    e.preventDefault();
    if (G._drag && G._drag.type === 'bag') {
      const s = G.player.inv[G._drag.idx];
      if (s) {
        if (ITEMS[s.id].slot === 'quest') chat('sys', 'You cannot drop a quest item.');
        else {
          const id = s.id;
          s.qty -= 1;
          if (s.qty <= 0) G.player.inv[G._drag.idx] = null;
          // toss it a step ahead, with a grace period so it isn't re-magnetized instantly
          const px = G.player;
          spawnGroundItem(px.x + Math.cos(px.facing) * 55, px.y + Math.sin(px.facing) * 55 + 10, id, 1, 4);
          chat('sys', `Dropped ${itemLabel(id)} on the ground.`);
          sfx('gather');
          refreshPanels();
        }
      }
    }
    G._drag = null;
  });
  window.addEventListener('mouseup', () => { G.mouse.down = false; });
  document.querySelectorAll('.closeX').forEach(x => x.onclick = () => $(x.dataset.close).classList.add('hidden'));
}

// ---------------- Main loop ----------------
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  G.time += dt;

  if (G.state === 'play' || G.state === 'victory') {
    if (!G.paused) update(dt);
    render();
  } else if (G.state === 'title') {
    renderTitleBG();
    Auth.tickDolls();
  }
}

function update(dt) {
  G.dayTime = (G.dayTime + dt / G.DAY_LENGTH) % 1;
  updatePlayer(dt);
  if (G.player.dead && G.player.respawnT <= 0) { /* wait for button */ }
  const simAuth = Net.isAuth();
  for (const e of G.enemies) simAuth ? updateEnemy(e, dt) : netLerpEnemy(e, dt);
  updateNpcs(dt);
  updateBots(dt);
  updateProjectiles(dt);
  updatePendingAoes(dt);
  updateFx(dt);
  updateGroundItems(dt);
  updateGatherNodes(dt);
  updateAmbientChat(dt);
  updateFishing(dt);
  updateWeather(dt);
  Net.tick(dt);
  Duel.tick(dt);
  // hold-to-attack
  if (G.mouse.down && !anyPanelOpen()) useSkill(0);
  // camera
  const p = G.player;
  G.camera.x = clamp(p.x - G.W / 2, 0, MAP_W * TILE - G.W);
  G.camera.y = clamp(p.y - G.H / 2, 0, MAP_H * TILE - G.H);
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 2);
    if (G.settings.shake) {
      G.camera.x += (Math.random() - 0.5) * G.shake * 18;
      G.camera.y += (Math.random() - 0.5) * G.shake * 18;
    }
  }
  checkZone();
  updateHUD();
  updateHotbar();
  updateHint();
  updateTargetFrame();
  updatePartyFrames();
  if (!$('inventory').classList.contains('hidden')) drawDoll();
  if (!$('worldMap').classList.contains('hidden')) renderWorldMap();
  if (Trade.active) drawTradeDolls();
  // cursor feedback: pointer over friendlies/loot, crosshair over monsters
  const hover = entityAtScreen(G.mouse.x, G.mouse.y);
  G.canvas.style.cursor = !hover ? 'default' : hover.kind === 'enemy' ? 'crosshair' : 'pointer';
  // ambient particles: fireflies at night in forest, embers in caves/ruins
  const region = World.regionAt(p.x, p.y);
  const isNight = G.dayTime > 0.55 || G.dayTime < 0.12;
  if (isNight && region === 'forest' && Math.random() < dt * 6) {
    G.particles.push({ x: G.camera.x + Math.random() * G.W, y: G.camera.y + Math.random() * G.H, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 2.5, maxLife: 2.5, color: '#d8ff8a', size: 1.8, firefly: true });
  }
  if ((region === 'cave' || region === 'ruins' || region === 'crypt') && Math.random() < dt * 4) {
    G.particles.push({ x: G.camera.x + Math.random() * G.W, y: G.camera.y + G.H, vx: (Math.random() - 0.5) * 12, vy: -30 - Math.random() * 30, life: 3, maxLife: 3, color: region === 'cave' ? '#ff9a4a' : region === 'crypt' ? '#8ad4e8' : '#c98aff', size: 1.6 });
  }
}

// ---------------- Render ----------------
function render() {
  const ctx = G.ctx, cam = G.camera;
  ctx.clearRect(0, 0, G.W, G.H);
  World.draw(ctx, cam);
  drawPortals(ctx, cam);
  drawGatherNodes(ctx, cam);
  drawChests(ctx, cam);
  drawGroundItems(ctx, cam);

  // y-sorted entities
  const drawList = [];
  for (const n of G.npcs) drawList.push({ y: n.y, f: () => drawNpc(ctx, n, cam) });
  for (const b of G.bots) drawList.push({ y: b.y, f: () => drawBot(ctx, b, cam) });
  for (const id in Net.remotes) { const r = Net.remotes[id]; drawList.push({ y: r.y, f: () => drawRemote(ctx, r, cam) }); }
  for (const e of G.enemies) if (!e.dead) drawList.push({ y: e.y, f: () => drawEnemy(ctx, e, cam) });
  const p = G.player;
  if (!p.dead) drawList.push({ y: p.y, f: () => drawPlayerChar(ctx, cam) });
  drawList.sort((a, b) => a.y - b.y);
  for (const d of drawList) d.f();

  // quest markers above NPCs
  for (const n of G.npcs) drawQuestMarker(ctx, n, cam);

  // projectiles
  for (const pr of G.projectiles) drawProjectile(ctx, pr, cam);
  // pending AOE target circles
  if (G.pendingAoes) for (const a of G.pendingAoes) {
    ctx.strokeStyle = 'rgba(255,120,80,.7)';
    ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(a.x - cam.x, a.y - cam.y, a.r, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
  }

  World.drawCanopies(ctx, cam);
  drawParticles(ctx, cam);
  drawWeather(ctx, cam);
  drawLighting(ctx, cam);
  drawFloaters(ctx, cam);
  // dawn/dusk warm color grading
  const t = G.dayTime;
  let warm = 0;
  if (t > 0.10 && t < 0.24) warm = 1 - Math.abs(t - 0.17) / 0.07;   // sunrise
  else if (t > 0.44 && t < 0.60) warm = 1 - Math.abs(t - 0.52) / 0.08;  // sunset
  if (warm > 0 && World.regionAt(G.player.x, G.player.y) !== 'cave') {
    ctx.fillStyle = `rgba(255,140,60,${warm * 0.07})`;
    ctx.fillRect(0, 0, G.W, G.H);
  }
  // vignette
  const vg = ctx.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.45, G.W / 2, G.H / 2, G.H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, G.W, G.H);
  // low-health warning: pulsing red edges under 30% HP
  const p2 = G.player;
  const frac = p2.hp / pStat(p2).maxHp;
  if (!p2.dead && frac < 0.3) {
    const pulse = 0.55 + Math.sin(G.time * 5.5) * 0.45;
    const a = clamp((0.3 - frac) / 0.3, 0, 1) * (0.22 + pulse * 0.16);
    const rg = ctx.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.34, G.W / 2, G.H / 2, G.H * 0.8);
    rg.addColorStop(0, 'rgba(160,20,20,0)');
    rg.addColorStop(1, `rgba(160,20,20,${a})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, G.W, G.H);
  }
  drawMinimap();
}

function drawPlayerChar(ctx, cam) {
  const p = G.player;
  const c = CLASSES[p.cls];
  drawHumanoid(ctx, p.x - cam.x, p.y - cam.y, {
    color: c.color, hair: c.hair, facing: Math.cos(p.facing) < 0 ? -1 : 1,
    walkT: p.walkT, moving: p.moving, name: p.name, nameColor: '#8fffb0',
    weapon: p.cls === 'warrior' ? 'sword' : p.cls === 'mage' ? 'staff' : 'bow',
    wtier: playerWeaponTier(p),
    gear: gearVis(p.equip),
    attackAnim: p.attackAnim, aim: p.facing, hurt: p.hurtT, level: p.level,
  });
}
function drawNpc(ctx, n, cam) {
  const x = n.x - cam.x, y = n.y - cam.y;
  if (x < -60 || y < -60 || x > G.W + 60 || y > G.H + 60) return;
  drawHumanoid(ctx, x, y, { color: n.color, hair: n.hair, facing: n.facing, walkT: n.walkT, moving: false, name: n.name, nameColor: '#ffd77a' });
  if (n.bubble) {
    ctx.font = 'italic 10px Georgia';
    ctx.textAlign = 'center';
    const w = ctx.measureText(n.bubble).width;
    ctx.fillStyle = 'rgba(20,22,34,.85)';
    ctx.beginPath(); ctx.roundRect(x - w / 2 - 7, y - 72, w + 14, 18, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(201,162,39,.4)'; ctx.stroke();
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText(n.bubble, x, y - 59);
  }
}
function drawBot(ctx, b, cam) {
  const x = b.x - cam.x, y = b.y - cam.y;
  if (x < -60 || y < -60 || x > G.W + 60 || y > G.H + 60) return;
  const c = CLASSES[b.cls];
  drawHumanoid(ctx, x, y, {
    color: c.color, hair: c.hair, facing: b.facing, walkT: b.walkT, moving: b.moving,
    name: b.name, nameColor: '#8fb3ff', level: b.level,
    weapon: b.cls === 'warrior' ? 'sword' : b.cls === 'mage' ? 'staff' : 'bow',
    wtier: Math.min(3, Math.floor(b.level / 3)),
    gear: b.level >= 3 ? { a: Math.min(4, Math.floor(b.level / 2)), h: b.level >= 5 ? Math.min(4, Math.floor(b.level / 2)) : null, b: 1 } : {},
  });
}

function drawQuestMarker(ctx, n, cam) {
  const x = n.x - cam.x, y = n.y - cam.y;
  if (x < -40 || y < -40 || x > G.W + 40 || y > G.H + 40) return;
  const done = questCompletableAt(n.id);
  const avail = questAvailableFrom(n.id);
  if (!done && !avail) return;
  const bob = Math.sin(G.time * 3) * 3;
  ctx.font = 'bold 22px Georgia';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillText(done ? '?' : '!', x + 1, y - 50 + bob + 1);
  ctx.fillStyle = done ? '#8fffb0' : '#ffd700';
  ctx.fillText(done ? '?' : '!', x, y - 50 + bob);
}

function drawProjectile(ctx, pr, cam) {
  const x = pr.x - cam.x, y = pr.y - cam.y;
  const ang = Math.atan2(pr.vy, pr.vx);
  ctx.save();
  ctx.translate(x, y);
  if (pr.kind === 'bolt') {
    ctx.fillStyle = 'rgba(140,170,255,.35)';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#aac6ff';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, 7); ctx.fill();
    if (Math.random() < 0.5) spawnParticles(pr.x, pr.y, 1, '#8ab0ff', 20, 0.25);
  } else if (pr.kind === 'pierce') {
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,240,120,.5)';
    ctx.fillRect(-16, -2.5, 26, 5);
    ctx.fillStyle = '#fff8c0';
    ctx.fillRect(-10, -1.2, 22, 2.4);
  } else if (pr.kind === 'shadow' || pr.kind === 'blight') {
    ctx.fillStyle = 'rgba(150,80,255,.35)';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#b06aff';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill();
  } else { // arrow
    ctx.rotate(ang);
    ctx.strokeStyle = '#c9b88a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
    ctx.fillStyle = '#e8e8f0';
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawParticles(ctx, cam) {
  for (const p of G.particles) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    if (p.ring) {
      const r = lerp(p.maxR, 10, a);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = a * 0.8;
      ctx.lineWidth = 3 + a * 3;
      ctx.beginPath(); ctx.arc(p.x - cam.x, p.y - cam.y, r, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
      p.life -= 0.016;
      continue;
    }
    ctx.globalAlpha = p.firefly ? a * (0.5 + Math.sin(G.time * 8 + p.x) * 0.5) : a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x - cam.x, p.y - cam.y, p.size * (0.5 + a * 0.5), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx, cam) {
  for (const f of G.floaters) {
    ctx.globalAlpha = clamp(f.t, 0, 1);
    ctx.font = (f.big ? 'bold 18px' : 'bold 13px') + ' Verdana';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.x - cam.x, f.y - cam.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x - cam.x, f.y - cam.y);
  }
  ctx.globalAlpha = 1;
}

// ---------------- Weather ----------------
function initWeather() {
  const R = mulberry32(555);
  G.weather = {
    clouds: Array.from({ length: 6 }, (_, i) => ({
      x: R() * MAP_W * TILE, y: R() * MAP_H * TILE,
      r: 120 + R() * 160, vx: 6 + R() * 10, vy: 2 + R() * 4,
    })),
    rainT: 50 + Math.random() * 90, raining: false, rainLeft: 0,
  };
}

function updateWeather(dt) {
  const w = G.weather;
  for (const c of w.clouds) {
    c.x += c.vx * dt; c.y += c.vy * dt;
    if (c.x - c.r > MAP_W * TILE) c.x = -c.r;
    if (c.y - c.r > MAP_H * TILE) c.y = -c.r;
  }
  if (w.raining) {
    w.rainLeft -= dt;
    if (w.rainLeft <= 0) {
      w.raining = false;
      w.rainT = 100 + Math.random() * 160;
      chat('sys', '🌤 The rain passes.');
    }
  } else {
    w.rainT -= dt;
    if (w.rainT <= 0) {
      w.raining = true;
      w.rainLeft = 25 + Math.random() * 35;
      chat('sys', '🌧 Rain begins to fall over Emberfall...');
    }
  }
}

function drawWeather(ctx, cam) {
  const w = G.weather;
  if (!w) return;
  const region = World.regionAt(G.player.x, G.player.y);
  if (region === 'cave' || region === 'crypt') return;
  // drifting cloud shadows (fade out at night — the lighting overlay owns darkness then)
  const cloudA = 0.09 * (1 - darknessLevel() / 0.78);
  if (cloudA > 0.01) {
    ctx.fillStyle = `rgba(10,18,12,${cloudA})`;
    for (const c of w.clouds) {
      const x = c.x - cam.x, y = c.y - cam.y;
      if (x < -c.r * 2 || y < -c.r * 2 || x > G.W + c.r * 2 || y > G.H + c.r * 2) continue;
      ctx.beginPath(); ctx.ellipse(x, y, c.r, c.r * 0.55, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + c.r * 0.5, y + c.r * 0.2, c.r * 0.6, c.r * 0.35, 0, 0, 7); ctx.fill();
    }
  }
  // rain
  if (w.raining) {
    ctx.fillStyle = 'rgba(30,45,70,.10)';
    ctx.fillRect(0, 0, G.W, G.H);
    ctx.strokeStyle = 'rgba(180,205,235,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const t = G.time * 900;
    for (let i = 0; i < 70; i++) {
      const x = ((i * 131.7 + t * (0.9 + (i % 5) * 0.05)) % (G.W + 60)) - 30;
      const y = ((i * 89.3 + t * 1.6 + i * i * 7) % (G.H + 40)) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 13);
    }
    ctx.stroke();
    // splash rings on the ground
    if (Math.random() < 0.5) {
      const sx = Math.random() * G.W, sy = Math.random() * G.H;
      ctx.strokeStyle = 'rgba(190,215,240,.22)';
      ctx.beginPath(); ctx.ellipse(sx, sy, 3 + Math.random() * 3, 1.5, 0, 0, 7); ctx.stroke();
    }
  }
}

// ---------------- Lighting / day-night ----------------
function darknessLevel() {
  const t = G.dayTime;
  // 0.0-0.12 night fading to dawn, 0.12-0.2 dawn, 0.2-0.48 day, 0.48-0.6 dusk, 0.6-1 night
  let d;
  if (t < 0.12) d = lerp(0.78, 0.3, t / 0.12);
  else if (t < 0.2) d = lerp(0.3, 0, (t - 0.12) / 0.08);
  else if (t < 0.48) d = 0;
  else if (t < 0.6) d = lerp(0, 0.78, (t - 0.48) / 0.12);
  else d = 0.78;
  return d;
}

function drawLighting(ctx, cam) {
  const p = G.player;
  const region = World.regionAt(p.x, p.y);
  let dark = darknessLevel();
  if (region === 'cave') dark = Math.max(dark, 0.62);
  if (region === 'crypt') dark = Math.max(dark, 0.68);
  if (region === 'ruins') dark = Math.max(dark * 0.9, 0.25);
  if (dark < 0.03) {
    // subtle warm tint at dawn/dusk even when not dark
    return;
  }
  lightX.clearRect(0, 0, G.W, G.H);
  const nightCol = region === 'ruins' ? `rgba(40,10,40,${dark})`
    : region === 'crypt' ? `rgba(4,22,30,${dark})`
    : `rgba(8,10,34,${dark})`;
  lightX.fillStyle = nightCol;
  lightX.fillRect(0, 0, G.W, G.H);
  lightX.globalCompositeOperation = 'destination-out';
  const light = (x, y, r, str) => {
    const g = lightX.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${str})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lightX.fillStyle = g;
    lightX.beginPath(); lightX.arc(x, y, r, 0, 7); lightX.fill();
  };
  // player aura
  if (!p.dead) light(p.x - cam.x, p.y - cam.y, 190, 0.92);
  // torches
  for (const [tx, ty] of World.torches) {
    const x = tx * TILE + 16 - cam.x, y = ty * TILE - 10 - cam.y;
    if (x < -300 || y < -300 || x > G.W + 300 || y > G.H + 300) continue;
    const fl = Math.sin(G.time * 9 + tx * 5) * 12;
    light(x, y, 150 + fl, 0.85);
  }
  // house windows
  for (const hs of World.houses) {
    const x = hs.tx * TILE + hs.w * TILE / 2 - cam.x, y = hs.ty * TILE + hs.h * TILE / 2 - cam.y;
    if (x < -300 || y < -300 || x > G.W + 300 || y > G.H + 300) continue;
    light(x, y, 110, 0.5);
  }
  // glowing things
  for (const g of G.gatherNodes) if (g.taken <= 0) light(g.x - cam.x, g.y - cam.y, 60, 0.6);
  for (const c of G.chests) if (!c.open) light(c.x - cam.x, c.y - cam.y, 46, 0.5);
  for (const g of G.groundItems) if (ITEMS[g.id].rar >= 1) light(g.x - cam.x, g.y - cam.y, 44, 0.55);
  for (const pt of G.portals) light(pt.x - cam.x, pt.y - cam.y, 95, 0.7);
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.kind === 'maw' || e.kind === 'hollow') light(e.x - cam.x, e.y - cam.y, 155, 0.5);
    else if (e.kind === 'drowned' || e.kind === 'golem') light(e.x - cam.x, e.y - cam.y, 60, 0.5);
  }
  for (const pr of G.projectiles) light(pr.x - cam.x, pr.y - cam.y, 55, 0.7);
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.kind === 'sprite' || e.kind === 'slime' || e.kind === 'warden') light(e.x - cam.x, e.y - cam.y, e.kind === 'warden' ? 160 : 70, 0.55);
  }
  lightX.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightC, 0, 0);
}

// ---------------- Title background ----------------
function renderTitleBG() {
  const ctx = G.ctx;
  ctx.fillStyle = '#0a0c14';
  ctx.fillRect(0, 0, G.W, G.H);
  // drifting embers
  ctx.save();
  for (let i = 0; i < 40; i++) {
    const t = (G.time * (8 + (i % 7) * 4) + i * 137) % (G.H + 60);
    const x = (i * 97.3) % G.W + Math.sin(G.time + i) * 30;
    const y = G.H + 30 - t;
    const a = Math.sin(t / (G.H + 60) * Math.PI);
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = i % 3 === 0 ? '#ffb44a' : '#c9a227';
    ctx.beginPath(); ctx.arc(x, y, 1.5 + (i % 3), 0, 7); ctx.fill();
  }
  ctx.restore();
}

window.addEventListener('DOMContentLoaded', init);
