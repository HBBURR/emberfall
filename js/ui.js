// ============================================================
// EMBERFALL ONLINE — ui.js : HUD, panels, dialogue, chat, minimap
// ============================================================
'use strict';

const $ = id => document.getElementById(id);

// ---------------- HUD ----------------
function updateHUD() {
  const p = G.player;
  if (!p) return;
  const st = pStat(p);
  $('hpFill').style.transform = `scaleX(${clamp(p.hp / st.maxHp, 0, 1)})`;
  $('mpFill').style.transform = `scaleX(${clamp(p.mp / st.maxMp, 0, 1)})`;
  $('hpText').textContent = `${Math.ceil(p.hp)} / ${st.maxHp}`;
  $('mpText').textContent = `${Math.ceil(p.mp)} / ${st.maxMp}`;
  const need = xpNeed(p.level);
  $('xpFill').style.transform = `scaleX(${p.level >= MAX_LEVEL ? 1 : clamp(p.xp / need, 0, 1)})`;
  $('playerName').textContent = p.name;
  $('playerLevel').textContent = `Level ${p.level} ${CLASSES[p.cls].name}` + (p.level >= MAX_LEVEL ? ' ★MAX' : '');
  $('portraitIcon').textContent = CLASSES[p.cls].icon;
  // clock
  const t = G.dayTime;
  const phase = t < 0.08 ? '🌙 Deep Night' : t < 0.20 ? '🌅 Dawn' : t < 0.48 ? '☀️ Day' : t < 0.58 ? '🌇 Dusk' : '🌙 Night';
  $('clock').textContent = phase;
}

// ---------------- Hotbar ----------------
// slots 1-4 = skills (drag between them to reorder), Space = dodge,
// 5/6 = potion binds (drag a consumable from the bag onto them)
function skillTipHtml(slot) {
  const p = G.player;
  const sk = SKILLS[CLASSES[p.cls].skills[p.skillOrder[slot]]];
  return `<b style="color:#f4e9c8">${sk.name}</b> <span style="color:#8a8a76">[key ${slot + 1}]</span><br>` +
    `${sk.desc || ''}<br>` +
    `<span style="color:#8fb3ff">${sk.mp ? sk.mp + ' mana' : 'No cost'}</span> · ` +
    `<span style="color:#e8a84a">${sk.cd}s cooldown</span>` +
    (G.player.level < sk.unlock ? `<br><span style="color:#e15b5b">Unlocks at level ${sk.unlock}</span>` : '') +
    `<br><span style="color:#7d7358">Drag onto another skill slot to swap keys.</span>`;
}
function potionTipHtml(bi) {
  const id = G.player.potionBinds[bi];
  const it = id && ITEMS[id];
  return (it
    ? `<b class="rar${it.rar}">${it.name}</b> <span style="color:#8a8a76">[key ${bi + 5}]</span><br>${it.desc || ''}<br>You have <b>${countItem(id)}</b>.`
    : `<b>Empty slot</b> <span style="color:#8a8a76">[key ${bi + 5}]</span>`) +
    `<br><span style="color:#7d7358">Drag any potion or food from your bag here to bind it.</span>`;
}

function buildHotbar() {
  const hb = $('hotbar');
  hb.innerHTML = '';
  const p = G.player;
  for (let slot = 0; slot < 4; slot++) {
    const sk = SKILLS[CLASSES[p.cls].skills[p.skillOrder[slot]]];
    const d = document.createElement('div');
    d.className = 'slot';
    d.id = 'hb' + slot;
    d.innerHTML = `<span class="key">${slot + 1}</span><span class="icon">${sk.icon}</span>` +
      (sk.mp ? `<span class="cost">${sk.mp}</span>` : '') +
      `<div class="cd hidden"></div><div class="lockLv hidden">Lv ${sk.unlock}</div>`;
    d.draggable = true;
    d.onclick = () => useSkill(slot);
    d.addEventListener('dragstart', () => { G._drag = { type: 'skill', slot }; });
    d.addEventListener('dragover', e => e.preventDefault());
    d.addEventListener('drop', e => {
      e.preventDefault();
      if (G._drag && G._drag.type === 'skill' && G._drag.slot !== slot) {
        const o = p.skillOrder;
        [o[G._drag.slot], o[slot]] = [o[slot], o[G._drag.slot]];
        sfx('gather');
        buildHotbar();
      }
      G._drag = null;
    });
    attachTip(d, () => skillTipHtml(slot));
    hb.appendChild(d);
  }
  // dodge roll indicator
  const roll = document.createElement('div');
  roll.className = 'slot';
  roll.id = 'hbRoll';
  roll.innerHTML = `<span class="key">␣</span><span class="icon">🌀</span><div class="cd hidden"></div>`;
  roll.onclick = () => doRoll();
  attachTip(roll, () => `<b style="color:#f4e9c8">Dodge Roll</b> <span style="color:#8a8a76">[Space]</span><br>` +
    `A quick roll in your movement direction. You cannot be hit while rolling.<br><span style="color:#e8a84a">2s cooldown</span>`);
  hb.appendChild(roll);
  // potion bind slots
  for (let bi = 0; bi < 2; bi++) {
    const id = p.potionBinds[bi];
    const it = id && ITEMS[id];
    const d = document.createElement('div');
    d.className = 'slot';
    d.id = 'hbPot' + bi;
    d.innerHTML = `<span class="key">${bi + 5}</span><span class="icon">${it ? it.icon : '·'}</span>` +
      `<span class="cost" style="color:#fff" id="qtyPot${bi}"></span>`;
    d.onclick = () => {
      const bind = p.potionBinds[bi];
      if (bind && countItem(bind)) useItem(bind);
      else chat('sys', bind ? `No ${ITEMS[bind].name}s left!` : 'Nothing bound — drag a potion from your bag here.');
    };
    d.addEventListener('dragover', e => e.preventDefault());
    d.addEventListener('drop', e => {
      e.preventDefault();
      if (G._drag && G._drag.type === 'bag') {
        const s = p.inv[G._drag.idx];
        if (s && ITEMS[s.id].slot === 'use') {
          p.potionBinds[bi] = s.id;
          sfx('gather');
          chat('sys', `${itemLabel(s.id)} bound to key ${bi + 5}.`);
          buildHotbar();
        } else chat('sys', 'Only potions and food can go there.');
      }
      G._drag = null;
    });
    attachTip(d, () => potionTipHtml(bi));
    hb.appendChild(d);
  }
  updateHotbar();
}

function updateHotbar() {
  const p = G.player;
  if (!p) return;
  for (let slot = 0; slot < 4; slot++) {
    const idx = p.skillOrder[slot];
    const sk = SKILLS[CLASSES[p.cls].skills[idx]];
    const el = $('hb' + slot);
    if (!el) return;
    const locked = p.level < sk.unlock;
    el.classList.toggle('locked', locked);
    el.querySelector('.lockLv').classList.toggle('hidden', !locked);
    const cd = el.querySelector('.cd');
    if (p.cds[idx] > 0.05 && !locked) {
      cd.classList.remove('hidden');
      cd.textContent = p.cds[idx].toFixed(1);
    } else cd.classList.add('hidden');
  }
  for (let bi = 0; bi < 2; bi++) {
    const q = $('qtyPot' + bi);
    if (q) q.textContent = p.potionBinds[bi] ? 'x' + countItem(p.potionBinds[bi]) : '';
  }
  const rollEl = $('hbRoll');
  if (rollEl) {
    const cd = rollEl.querySelector('.cd');
    if (p.rollCd > 0.05) { cd.classList.remove('hidden'); cd.textContent = p.rollCd.toFixed(1); }
    else cd.classList.add('hidden');
  }
}

// ---------------- Party frames ----------------
function refreshPartyFrames() {
  const wrap = $('partyFrames');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const id of Party.members) {
    const r = Net.remotes[id];
    if (!r) continue;
    const row = document.createElement('div');
    row.className = 'pfRow';
    row.id = 'pf' + id;
    row.innerHTML =
      `<div class="pfName"><span>${CLASSES[r.cls] ? CLASSES[r.cls].icon : ''} ${String(r.name).replace(/</g, '&lt;')}</span><span class="pfLv">Lv ${r.level}</span></div>` +
      `<div class="pfBar"><div class="fill"></div></div>`;
    wrap.appendChild(row);
  }
}
function updatePartyFrames() {
  for (const id of Party.members) {
    const r = Net.remotes[id];
    const row = $('pf' + id);
    if (!r || !row) continue;
    row.querySelector('.pfLv').textContent = 'Lv ' + r.level;
    row.querySelector('.fill').style.transform = `scaleX(${clamp((r.hpf === undefined ? 100 : r.hpf) / 100, 0, 1)})`;
  }
}

// ---------------- Zone banner ----------------
function checkZone() {
  const r = World.regionAt(G.player.x, G.player.y);
  if (r !== G.zoneShown) {
    G.zoneShown = r;
    const el = $('zoneLabel');
    el.textContent = World.regionName(r);
    el.style.opacity = 1;
    clearTimeout(G._zoneTO);
    G._zoneTO = setTimeout(() => { el.style.opacity = 0; }, 2600);
    chat('sys', `Entering ${World.regionName(r)}`);
  }
}

// ---------------- Chat ----------------
function chat(kind, text, pname, isDev) {
  const box = $('chatBox');
  const d = document.createElement('div');
  if (kind === 'sys') { d.className = 'sys'; d.textContent = text; }
  else if (kind === 'combat') { d.className = 'combat'; d.textContent = text; }
  else {
    const style = isDev ? ' style="color:#ff5a5a"' : '';
    d.innerHTML = `<span class="pname"${style}>[${isDev ? '⚙ ' : ''}${pname}]</span> ${text.replace(/</g, '&lt;')}`;
  }
  box.appendChild(d);
  while (box.children.length > 9) box.removeChild(box.firstChild);
}

let chatTimer = 8;
function updateAmbientChat(dt) {
  chatTimer -= dt;
  if (chatTimer <= 0) {
    chatTimer = 14 + Math.random() * 22;
    const [who, line] = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
    chat('player', line, who);
  }
  // online counter: real players when connected, ambient flavor otherwise
  if (Net.connected) {
    $('online').textContent = `● ${Net.count()} adventurer${Net.count() > 1 ? 's' : ''} online (live)`;
  } else if (Math.random() < dt * 0.02) {
    const n = 6 + Math.floor(Math.random() * 5);
    $('online').textContent = `● ${n} players online`;
  }
}

// ---------------- Quest tracker ----------------
function refreshTracker() {
  const el = $('tracker');
  el.innerHTML = '';
  let any = false;
  for (const q of QUESTS) if (qState(q.id).state === 'active') { any = true; break; }
  if (any) {
    const h = document.createElement('div');
    h.id = 'trackerHead';
    h.textContent = '— QUESTS —';
    el.appendChild(h);
  }
  for (const q of QUESTS) {
    const s = qState(q.id);
    if (s.state !== 'active') continue;
    const prog = questProgress(q);
    const done = prog >= q.count;
    const targName = q.type === 'kill' ? ENEMY_TYPES[q.target].name + 's slain'
      : q.type === 'collect' ? ITEMS[q.target].name + 's'
      : 'Speak with ' + (NPC_DEFS.find(n => n.id === q.target) || {}).name;
    const d = document.createElement('div');
    d.className = 'trkQuest';
    d.innerHTML = `<div class="trkTitle">⚜ ${q.title}</div>` +
      (q.type === 'talk'
        ? `<div class="trkObj ${done ? 'done' : ''}">${targName}</div>`
        : `<div class="trkObj ${done ? 'done' : ''}">${targName}: ${prog}/${q.count}</div>`) +
      (done ? `<div class="trkObj done">Return to ${(NPC_DEFS.find(n => n.id === (q.type === 'talk' ? q.target : q.giver)) || {}).name}</div>` : '');
    el.appendChild(d);
  }
}

// ---------------- Panels ----------------
function togglePanel(id) {
  const el = $(id);
  const wasHidden = el.classList.contains('hidden');
  ['inventory', 'charsheet', 'questlog', 'board', 'worldMap'].forEach(p => $(p).classList.add('hidden'));
  if (wasHidden) {
    el.classList.remove('hidden');
    refreshPanels();
    if (id === 'board') renderBoard();
    if (id === 'worldMap') renderWorldMap();
  }
}
function anyPanelOpen() {
  return ['inventory', 'charsheet', 'questlog', 'board', 'worldMap', 'tradePanel'].some(p => !$(p).classList.contains('hidden')) || !$('dialogue').classList.contains('hidden');
}

// ---------------- Leaderboard ----------------
function renderBoard() {
  const p = G.player;
  const { rows, live } = getBoard();
  $('boardMode').textContent = live
    ? '🌐 Live realm rankings — every adventurer who has entered this server.'
    : '💾 Local rankings — your characters on this device. Connect to a realm for live rankings.';
  const list = $('boardList');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div style="color:#a89a76;font-size:12.5px;padding:10px;">No champions yet — go make history.</div>';
  }
  const medals = ['🥇', '🥈', '🥉'];
  rows.slice(0, 10).forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'boardRow r' + (i + 1) + (p && r.name === p.name ? ' me' : '');
    d.innerHTML =
      `<span class="rank">${medals[i] || '#' + (i + 1)}</span>` +
      `<span>${CLASSES[r.cls] ? CLASSES[r.cls].icon : '❔'}</span>` +
      `<span class="bname">${String(r.name).replace(/</g, '&lt;')}</span>` +
      `<span class="blv">Lv ${r.level}</span>` +
      `<span class="bscore">${r.score.toLocaleString()}</span>`;
    list.appendChild(d);
  });
  if (p) {
    const myScore = computeScore(p);
    const myRank = rows.findIndex(r => r.name === p.name);
    $('boardMe').textContent = `You: ${p.name} · Lv ${p.level} · ${myScore.toLocaleString()} pts` +
      (myRank >= 0 ? ` · rank #${myRank + 1}` : ' · unranked (keep playing!)');
  }
}

function refreshPanels() {
  const p = G.player;
  if (!p) return;
  updateHotbar();
  // character & bag screen
  if (!$('inventory').classList.contains('hidden')) {
    const EQUIP_UI = { L: [['helm', '⛑️'], ['armor', '🛡️'], ['boots', '🥾']], R: [['weapon', '🗡️'], ['trinket', '💍']] };
    for (const side of ['L', 'R']) {
      const col = $('eqCol' + side);
      col.innerHTML = '';
      for (const [slot, emptyIcon] of EQUIP_UI[side]) {
        const id = p.equip[slot];
        const d = document.createElement('div');
        d.className = 'eqSlot';
        if (id) {
          const it = ITEMS[id];
          d.classList.add('filled', 'rb' + it.rar);
          d.innerHTML = `<span class="etype">${slot}</span>${it.icon}<span class="iname rar${it.rar}">${it.name}</span>`;
          d.onclick = () => unequipItem(slot);
          d.oncontextmenu = e => {
            e.preventDefault(); e.stopPropagation();
            buildItemMenu(ITEMS[id].name, [['⬇️ Unequip', () => unequipItem(slot)]], e.clientX, e.clientY);
          };
          attachTooltip(d, id, true);
        } else {
          d.innerHTML = `<span class="etype">${slot}</span><span style="opacity:.3">${emptyIcon}</span>`;
        }
        col.appendChild(d);
      }
    }
    drawDoll();
    const grid = $('invGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const d = document.createElement('div');
      d.className = 'invSlot';
      const s = p.inv[i];
      if (s) {
        const it = ITEMS[s.id];
        if (it.rar > 0) d.classList.add('rb' + it.rar);
        d.innerHTML = `${it.icon}<span class="iname rar${it.rar}">${it.name}</span>` + (s.qty > 1 ? `<span class="qty">x${s.qty}</span>` : '');
        d.onclick = () => useItem(s.id);
        d.oncontextmenu = e => {
          e.preventDefault(); e.stopPropagation();
          const acts = [];
          if (EQUIP_SLOTS.includes(it.slot)) acts.push(['⚔️ Equip', () => useItem(s.id)]);
          else if (it.slot === 'use') acts.push(['🧪 Use', () => useItem(s.id)]);
          if (it.slot !== 'quest') acts.push(['🗑️ Drop', () => dropItem(s.id)]);
          buildItemMenu(it.name, acts, e.clientX, e.clientY);
        };
        attachTooltip(d, s.id);
        d.draggable = true;
        d.addEventListener('dragstart', () => { G._drag = { type: 'bag', idx: i }; });
      }
      // every cell (empty included) accepts drops so items can move anywhere
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('dragOver'); });
      d.addEventListener('dragleave', () => d.classList.remove('dragOver'));
      d.addEventListener('drop', e => {
        e.preventDefault();
        d.classList.remove('dragOver');
        if (G._drag && G._drag.type === 'bag') moveInvItem(G._drag.idx, i);
        G._drag = null;
      });
      grid.appendChild(d);
    }
    $('goldLine').textContent = `🪙 ${p.gold} gold  ·  ${invList().length}/20 slots  ·  drag to rearrange`;
  }
  // character sheet
  if (!$('charsheet').classList.contains('hidden')) {
    const st = pStat(p);
    const mins = Math.floor(p.playTime / 60);
    const totKills = Object.values(p.kills).reduce((a, b) => a + b, 0);
    $('charStats').innerHTML =
      `<div><b>${p.name}</b> — Level ${p.level} ${CLASSES[p.cls].name}</div>` +
      `<div>Health: <b>${Math.ceil(p.hp)} / ${st.maxHp}</b> &nbsp; Mana: <b>${Math.ceil(p.mp)} / ${st.maxMp}</b></div>` +
      `<div>Attack: <b>${st.atk}</b> &nbsp; Defense: <b>${st.def}</b> &nbsp; Crit: <b>${st.crit}%</b> &nbsp; Speed: <b>${st.speed}</b></div>` +
      (st.sets.ember >= 2 ? `<div style="color:#e8a84a">🔥 Ember set (${st.sets.ember} pc): +4 Attack, +4 Defense</div>` : '') +
      (st.sets.dawn >= 2 ? `<div style="color:#ffe14a">☀️ Dawn set (${st.sets.dawn} pc): +8 Attack, +8 Defense, +8% Crit</div>` : '') +
      `<div>Experience: <b>${p.level >= MAX_LEVEL ? 'MAX' : p.xp + ' / ' + xpNeed(p.level)}</b></div>` +
      `<div>Gold: <b style="color:#ffd700">${p.gold}</b></div>` +
      `<div style="border-top:1px solid #3a3421;margin-top:8px;padding-top:8px">Monsters slain: <b>${totKills}</b> &nbsp; Elites: <b>${p.counters.elites}</b> &nbsp; Duel wins: <b>${p.counters.duelWins || 0}</b> &nbsp; Fish: <b>${p.counters.fish}</b> &nbsp; Time: <b>${mins}m</b></div>` +
      `<div>Quests completed: <b>${QUESTS.filter(q => qState(q.id).state === 'turned').length} / ${QUESTS.length}</b></div>` +
      `<div style="border-top:1px solid #3a3421;margin-top:8px;padding-top:8px">Achievements (${Object.keys(p.ach).length}/${Object.keys(ACHIEVEMENTS).length}):</div>` +
      `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">` +
      Object.entries(ACHIEVEMENTS).map(([id, a]) =>
        `<span title="${a.name} — ${a.desc}" style="font-size:20px;${p.ach[id] ? '' : 'filter:grayscale(1) brightness(.4);'}">${a.icon}</span>`).join('') +
      `</div>`;
  }
  // quest log
  if (!$('questlog').classList.contains('hidden')) {
    const list = $('qlList');
    list.innerHTML = '';
    let shown = 0;
    for (const q of QUESTS) {
      const s = qState(q.id);
      if (s.state !== 'active' && s.state !== 'turned') continue;
      shown++;
      const d = document.createElement('div');
      d.className = 'qlQuest';
      if (s.state === 'turned') {
        d.innerHTML = `<div class="qlTitle" style="opacity:.55">✔ ${q.title} <span class="qlDone">(complete)</span></div>`;
      } else {
        const prog = questProgress(q);
        d.innerHTML = `<div class="qlTitle">⚜ ${q.title}</div><div class="qlDesc">${q.desc}</div>` +
          `<div class="qlObj ${prog >= q.count ? 'done' : ''}">Progress: ${prog}/${q.count}${prog >= q.count ? ' — ready to turn in!' : ''}</div>`;
      }
      list.appendChild(d);
    }
    if (!shown) list.innerHTML = '<div class="qlDesc">No quests yet. Speak with the villagers of Havenbrook.</div>';
  }
}

// animated paper-doll preview of the hero with current class colors
function drawDoll() {
  const c = $('dollCanvas');
  if (!c || !G.player) return;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  const p = G.player, cls = CLASSES[p.cls];
  x.save();
  x.translate(c.width / 2, 116);
  x.scale(2.6, 2.6);
  drawHumanoid(x, 0, 0, {
    color: cls.color, hair: cls.hair, facing: 1, walkT: 0, moving: false,
    weapon: p.cls === 'warrior' ? 'sword' : p.cls === 'mage' ? 'staff' : 'bow',
    wtier: playerWeaponTier(p),
    gear: gearVis(p.equip),
    attackAnim: 0, aim: -0.4, hurt: 0,
  });
  x.restore();
  x.font = 'bold 11px Georgia';
  x.textAlign = 'center';
  x.fillStyle = '#c9a227';
  x.fillText(`Lv ${p.level} ${cls.name}`, c.width / 2, 168);
}

// generic small context menu for items (shares #ctxMenu styling)
function buildItemMenu(head, actions, cx, cy) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.id = 'ctxMenu';
  const h = document.createElement('div');
  h.className = 'ctxHead';
  h.textContent = head;
  m.appendChild(h);
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onmousedown = ev => { ev.stopPropagation(); closeCtxMenu(); fn(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  m.style.left = Math.min(G.W - m.offsetWidth - 8, cx) + 'px';
  m.style.top = Math.min(G.H - m.offsetHeight - 8, cy) + 'px';
}

// ---------------- Trade UI ----------------
function renderTradePanel(a) {
  if (!a) return;
  const mine = $('tradeMine');
  mine.innerHTML = '';
  a.mine.forEach((s, i) => {
    const it = ITEMS[s.id];
    const d = document.createElement('div');
    d.className = 'invSlot';
    d.innerHTML = `${it.icon}<span class="iname rar${it.rar}">${it.name}</span>`;
    d.onclick = () => Trade.removeOffer(i);
    mine.appendChild(d);
  });
  if (a.mine.length < 6) {
    const add = document.createElement('div');
    add.className = 'invSlot';
    add.innerHTML = '<span style="font-size:24px;color:#7d7358">+</span><span class="iname" style="color:#7d7358">add item</span>';
    add.onclick = e => openTradeAddMenu(e.clientX, e.clientY);
    mine.appendChild(add);
  }
  const theirs = $('tradeTheirs');
  theirs.innerHTML = '';
  for (const s of a.theirs) {
    const it = ITEMS[s.id];
    if (!it) continue;
    const d = document.createElement('div');
    d.className = 'invSlot';
    d.style.cursor = 'default';
    d.innerHTML = `${it.icon}<span class="iname rar${it.rar}">${it.name}</span>`;
    theirs.appendChild(d);
  }
  $('tradeGoldTheirs').textContent = `🪙 ${a.theirGold} gold`;
  $('tradeStatus').innerHTML =
    (a.myOk ? '<span style="color:#7fd18a">You accepted ✓</span>' : 'You: choosing...') +
    ' &nbsp;·&nbsp; ' +
    (a.theirOk ? `<span style="color:#7fd18a">${a.peerName} accepted ✓</span>` : `${a.peerName}: choosing...`);
  $('tradeAccept').textContent = a.myOk ? '⌛ Waiting for them...' : '✅ Accept Trade';
}

// both characters face each other over the table, live-animated
function drawTradeDolls() {
  const a = Trade.active;
  if (!a) return;
  const p = G.player;
  const draw = (canvasId, cls, wtier, gear, faceRight) => {
    const c = $(canvasId);
    if (!c) return;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const cd = CLASSES[cls];
    x.save();
    x.translate(c.width / 2, 78);
    x.scale(2.0, 2.0);
    drawHumanoid(x, 0, 0, {
      color: cd.color, hair: cd.hair, facing: faceRight ? 1 : -1, walkT: 0, moving: false,
      weapon: cls === 'warrior' ? 'sword' : cls === 'mage' ? 'staff' : 'bow',
      wtier, gear: gear || {}, aim: faceRight ? -0.35 : Math.PI + 0.35, hurt: 0,
    });
    x.restore();
  };
  draw('tradeDollMine', p.cls, playerWeaponTier(p), gearVis(p.equip), true);
  draw('tradeDollTheirs', a.peerCls, a.peerWt, a.peerGear, false);
}

function openTradeAddMenu(cx, cy) {
  const a = Trade.active; if (!a) return;
  const seen = new Set();
  const options = [];
  for (const s of invList()) {
    if (ITEMS[s.id].slot === 'quest' || seen.has(s.id)) continue;
    seen.add(s.id);
    const avail = countItem(s.id) - a.mine.filter(x => x.id === s.id).length;
    if (avail <= 0) continue;
    options.push([`${ITEMS[s.id].icon} ${ITEMS[s.id].name}${avail > 1 ? ' x' + avail : ''}`, () => Trade.addOffer(s.id)]);
  }
  if (!options.length) { chat('sys', 'Nothing left in your bag to offer.'); return; }
  buildItemMenu('Add to trade', options.slice(0, 12), cx, cy);
}

function wireTradePanel() {
  $('tradeAccept').onclick = () => Trade.accept();
  $('tradeCancelBtn').onclick = () => Trade.cancel();
  $('tradeGoldMine').onchange = e => Trade.setGold(+e.target.value);
}

let _tradeAskTO = null;
function showAsk(html, onYes, onNo) {
  const el = $('tradeAsk');
  $('tradeAskText').innerHTML = html;
  el.classList.remove('hidden');
  const done = fn => () => { el.classList.add('hidden'); clearTimeout(_tradeAskTO); fn(); };
  $('tradeAskYes').onclick = done(onYes);
  $('tradeAskNo').onclick = done(onNo);
  clearTimeout(_tradeAskTO);
  _tradeAskTO = setTimeout(done(onNo), 20000);   // auto-decline after 20s
}
function showTradeAsk(name, onYes, onNo) {
  showAsk(`💱 <b style="color:#ffb84a">${name}</b> wants to trade with you.`, onYes, onNo);
}

// big center-screen duel countdown
function flashDuel(text) {
  const el = $('levelFlash');
  el.textContent = text;
  el.style.color = '#ff8a6a';
  el.style.opacity = 1;
  clearTimeout(G._lvTO);
  G._lvTO = setTimeout(() => { el.style.opacity = 0; el.style.color = ''; }, 900);
}

// give something to one of the townsfolk — they remember their manners
function openBotGiftMenu(b) {
  const giftable = invList().filter(s => ITEMS[s.id].slot !== 'quest');
  if (!giftable.length) { chat('sys', 'Nothing in your bag to give.'); return; }
  buildItemMenu('🎁 Give to ' + b.name, giftable.slice(0, 12).map(s => [
    `${ITEMS[s.id].icon} ${ITEMS[s.id].name}${s.qty > 1 ? ' x' + s.qty : ''}`,
    () => {
      removeItem(s.id, 1);
      chat('sys', `🎁 You give ${itemLabel(s.id)} to ${b.name}.`);
      sfx('quest');
      const thanks = ['aw thanks!!', 'for me?? ty ty', 'you are too kind, shardbearer', 'oh nice, I needed one of these!', '<3'];
      setTimeout(() => chat('player', thanks[Math.floor(Math.random() * thanks.length)], b.name), 900 + Math.random() * 800);
      if (Math.random() < 0.45) {
        setTimeout(() => {
          const coins = 5 + Math.floor(Math.random() * 21);
          G.player.gold += coins;
          chat('player', `here, take these ${coins} coins for your trouble`, b.name);
          floater(G.player.x, G.player.y - 28, '+' + coins + 'g', '#ffd700');
          sfx('coin');
        }, 2400 + Math.random() * 1200);
      }
    },
  ]), G.W / 2 - 90, G.H / 2 - 120);
}

// pick an item from your bag to send to a friend
function openGiftMenu(r) {
  const giftable = invList().filter(s => ITEMS[s.id].slot !== 'quest');
  if (!giftable.length) { chat('sys', 'Nothing in your bag to give.'); return; }
  buildItemMenu('🎁 Give to ' + r.name, giftable.slice(0, 12).map(s => [
    `${ITEMS[s.id].icon} ${ITEMS[s.id].name}${s.qty > 1 ? ' x' + s.qty : ''}`,
    () => {
      removeItem(s.id, 1);
      Net.send({ t: 'gift', to: r.id, item: s.id });
      chat('sys', `🎁 Sent ${itemLabel(s.id)} to ${r.name}.`);
      sfx('quest');
    },
  ]), G.W / 2 - 90, G.H / 2 - 120);
}

// tooltip with stat lines + comparison against the equipped piece
const STAT_FIELDS = [['atk', 'Attack'], ['def', 'Defense'], ['hp', 'Health'], ['crit', 'Crit %'], ['spd', 'Speed'], ['heal', 'Restores HP'], ['mana', 'Restores MP']];
function tooltipHtml(itemId, isEquipped) {
  const it = ITEMS[itemId];
  const rarName = ['Common', 'Uncommon', 'Rare', 'Epic'][it.rar];
  let html = `<b class="rar${it.rar}">${it.name}</b><br>` +
    `<span style="color:#8a8a76">${rarName} ${it.slot === 'use' ? 'Consumable' : it.slot === 'quest' ? 'Quest item' : it.slot === 'junk' ? 'Loot — sell to Bram' : it.slot}${isEquipped ? ' · equipped' : ''}</span>`;
  for (const [f, label] of STAT_FIELDS)
    if (it[f]) html += `<br><span style="color:#bdd8a8">+${it[f]} ${label}</span>`;
  if (it.set) html += `<br><span style="color:#e8a84a">${it.set === 'ember' ? 'Ember set (2+: +4 Atk, +4 Def)' : 'Dawn set (2+: +8 Atk, +8 Def, +8% Crit)'}</span>`;
  if (it.desc) html += `<br><i style="color:#a89a76">${it.desc}</i>`;
  // comparison vs currently equipped gear in the same slot
  if (!isEquipped && EQUIP_SLOTS.includes(it.slot)) {
    const eqId = G.player.equip[it.slot];
    if (eqId && eqId !== itemId) {
      const eq = ITEMS[eqId];
      html += `<br><span style="color:#8a8a76">— vs ${eq.name} —</span>`;
      for (const [f, label] of STAT_FIELDS.slice(0, 5)) {
        const d = (it[f] || 0) - (eq[f] || 0);
        if (d !== 0) html += `<br><span style="color:${d > 0 ? '#7fd18a' : '#e15b5b'}">${d > 0 ? '+' : ''}${d} ${label}</span>`;
      }
    } else if (!eqId) {
      html += `<br><span style="color:#7fd18a">(empty slot — pure upgrade)</span>`;
    }
  }
  return html;
}
// generic hover tooltip: htmlFn is evaluated on hover so content stays fresh
function attachTip(el, htmlFn) {
  el.addEventListener('mouseenter', () => {
    const tt = $('tooltip');
    tt.innerHTML = htmlFn();
    tt.classList.remove('hidden');
  });
  el.addEventListener('mousemove', e => {
    const tt = $('tooltip');
    tt.style.left = Math.min(G.W - 240, e.clientX + 14) + 'px';
    tt.style.top = Math.max(8, Math.min(G.H - tt.offsetHeight - 10, e.clientY + 10)) + 'px';
  });
  el.addEventListener('mouseleave', () => $('tooltip').classList.add('hidden'));
  el.addEventListener('dragstart', () => $('tooltip').classList.add('hidden'));
}
function attachTooltip(el, itemId, isEquipped) {
  attachTip(el, () => tooltipHtml(itemId, isEquipped));
}

// ---------------- Target frame ----------------
function updateTargetFrame() {
  const t = G.target;
  const el = $('targetFrame');
  if (!t || t.dead || dist(G.player.x, G.player.y, t.x, t.y) > 700) {
    G.target = null;
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const nm = $('tfName');
  nm.textContent = `${t.elite ? '👑 ' : t.boss ? '☠ ' : ''}${t.name} · Lv ${t.lv}`;
  nm.style.color = t.boss ? '#d8a8ff' : t.elite ? '#ffd24a' : '#f4d0c0';
  $('tfFill').style.transform = `scaleX(${clamp(t.hp / t.maxHp, 0, 1)})`;
  $('tfText').textContent = `${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}`;
}

// ---------------- Dialogue ----------------
function openDialogue(npc) {
  const dlg = $('dialogue');
  dlg.classList.remove('hidden');
  $('dlgName').textContent = `${npc.name} — ${npc.role}`;
  const opts = $('dlgOpts');
  opts.innerHTML = '';
  questEvent('talk', npc.id);

  const completable = questCompletableAt(npc.id);
  const avail = questAvailableFrom(npc.id);

  if (completable) {
    $('dlgText').textContent = completable.done || completable.text;
    addDlgBtn(`⚜ Complete: ${completable.title}`, () => {
      completeQuest(completable);
      openDialogue(npc); // re-render synchronously: offers the next quest or idle chatter
    });
  } else if (avail) {
    $('dlgText').textContent = avail.text;
    addDlgBtn(`⚜ Accept: ${avail.title}`, () => { acceptQuest(avail); closeDialogue(); });
    addDlgBtn('Not now.', closeDialogue);
  } else {
    // active quest reminder or idle line
    const active = QUESTS.find(q => qState(q.id).state === 'active' && (q.giver === npc.id || q.target === npc.id));
    $('dlgText').textContent = active
      ? `"${active.title}" — ${active.desc}`
      : npc.idle[Math.floor(Math.random() * npc.idle.length)];
  }
  if (npc.shop) addDlgBtn('🪙 Browse wares', () => openShop(npc));
  if (!completable && !avail) addDlgBtn('Farewell.', closeDialogue);
}

function openShop(npc) {
  const p = G.player;
  $('dlgText').textContent = `Finest steel and brews in Havenbrook. Gold up front. (You have ${p.gold}g)`;
  const opts = $('dlgOpts');
  opts.innerHTML = '';
  for (const stockId of SHOP_STOCK) {
    const id = resolveReward(stockId);   // Bram stocks the weapon your class can use
    const it = ITEMS[id];
    addDlgBtn(`${it.icon} ${it.name} — ${it.price}g${it.desc ? '  ·  ' + it.desc : ''}`, () => {
      if (p.gold < it.price) { chat('sys', 'Not enough gold.'); return; }
      p.gold -= it.price;
      addItem(id, 1);
      sfx('coin');
      chat('sys', `Purchased ${itemLabel(id)} for ${it.price}g.`);
      openShop(npc); // refresh
    });
  }
  // sell anything that isn't a quest item, at 40% value
  const sellable = invList().filter(s => ITEMS[s.id].slot !== 'quest' && ITEMS[s.id].price);
  if (sellable.length) {
    const hdr = document.createElement('div');
    hdr.style.cssText = 'color:#a89a76;font-size:11px;margin-top:6px;border-top:1px solid #3a3421;padding-top:6px;';
    hdr.textContent = '— Sell to Bram (40% value) —';
    opts.appendChild(hdr);
    for (const s of sellable) {
      const it = ITEMS[s.id];
      const val = Math.max(1, Math.floor(it.price * 0.4));
      addDlgBtn(`${it.icon} Sell ${it.name}${s.qty > 1 ? ' x' + s.qty : ''} — +${val}g`, () => {
        removeItem(s.id, 1);
        p.gold += val;
        sfx('coin');
        chat('sys', `Sold ${itemLabel(s.id)} for ${val}g.`);
        openShop(npc);
      });
    }
  }
  addDlgBtn('Done browsing.', closeDialogue);
}

function addDlgBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'dlgBtn';
  b.textContent = label;
  b.onclick = fn;
  $('dlgOpts').appendChild(b);
}
function closeDialogue() { $('dialogue').classList.add('hidden'); }

// ---------------- Hint ----------------
function updateHint() {
  const el = $('hint');
  if (G.state !== 'play' || anyPanelOpen() || G.paused) { el.classList.add('hidden'); return; }
  if (G.fishing) {
    el.classList.remove('hidden');
    el.textContent = G.fishing.bit ? '❗ [E] REEL IT IN!' : '🎣 Fishing... wait for the bite';
    return;
  }
  const t = nearestInteractable();
  if (t) {
    el.classList.remove('hidden');
    el.textContent = t.kind === 'node' ? `[E] Gather ${ITEMS[t.node.item].name}`
      : t.kind === 'chest' ? '[E] Open Treasure Chest'
      : t.kind === 'portal' ? `[E] ${t.portal.label}${G.player.level < t.portal.minLevel ? ' (Lv ' + t.portal.minLevel + '+)' : ''}`
      : `[E] Talk to ${t.npc.name}`;
  } else if (canFish()) {
    el.classList.remove('hidden');
    el.textContent = '🎣 [E] Fish';
  } else el.classList.add('hidden');
}

// ---------------- Minimap (zoomed local view) ----------------
function drawMinimap() {
  const c = $('minimap');
  const x = c.getContext('2d');
  x.clearRect(0, 0, 170, 170);
  if (!World.minimapC) return;
  const p = G.player;
  const VIEW = 64;   // tiles across — a readable local radar, not the whole world
  const cx0 = clamp(p.x / TILE - VIEW / 2, 0, MAP_W - VIEW);
  const cy0 = clamp(p.y / TILE - VIEW / 2, 0, MAP_H - VIEW);
  x.imageSmoothingEnabled = false;
  x.drawImage(World.minimapC, cx0, cy0, VIEW, VIEW, 0, 0, 170, 170);
  const sc = 170 / VIEW;
  const dot = (wx, wy, color, r2) => {
    const dx = wx / TILE - cx0, dy = wy / TILE - cy0;
    if (dx < 1 || dy < 1 || dx > VIEW - 1 || dy > VIEW - 1) return;
    x.fillStyle = color;
    x.beginPath(); x.arc(dx * sc, dy * sc, r2 || 2.5, 0, 7); x.fill();
  };
  for (const n of G.npcs) dot(n.x, n.y, '#ffd700', 3);
  for (const pt of G.portals) dot(pt.x, pt.y, '#7ad8e8', 3);
  for (const e of G.enemies) if (e.boss && !e.dead) dot(e.x, e.y, '#b04aff', 3.5);
  for (const id in Net.remotes) {
    const r = Net.remotes[id];
    dot(r.x, r.y, Party.has(+id) ? '#7fd18a' : '#ffb84a', 3);
  }
  dot(p.x, p.y, '#fff', 3.2);
  x.strokeStyle = '#c9a227'; x.lineWidth = 1.2;
  x.beginPath(); x.arc((p.x / TILE - cx0) * sc, (p.y / TILE - cy0) * sc, 5, 0, 7); x.stroke();
  // compass
  x.fillStyle = 'rgba(0,0,0,.55)';
  x.beginPath(); x.arc(85, 9, 8, 0, 7); x.fill();
  x.font = 'bold 10px Verdana'; x.textAlign = 'center';
  x.fillStyle = '#f4e9c8'; x.fillText('N', 85, 12.5);
}

// ---------------- World map (M) ----------------
const MAP_LABELS = [
  ['The Ashen Ruins', 70, 20], ['The Whisperwood', 50, 62], ['The Ember Caves', 117, 64],
  ['Havenbrook', 70, 106], ['Southmeadow', 110, 122], ['The Sunken Crypt', 24, 214],
  ['The Scorched Steppe', 192, 60], ['Frostpeak Highlands', 52, 190],
  ['The Duskmire', 132, 192], ['The Shattered Spire', 200, 178],
];
function renderWorldMap() {
  const c = $('worldMapCanvas');
  if (!c || !World.minimapC) return;
  const x = c.getContext('2d');
  const S = c.width / MAP_W;
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(World.minimapC, 0, 0, c.width, c.height);
  // soft vignette so labels read
  x.fillStyle = 'rgba(10,12,20,.18)';
  x.fillRect(0, 0, c.width, c.height);
  const dot = (wx, wy, color, r2) => {
    x.fillStyle = color;
    x.beginPath(); x.arc(wx / TILE * S, wy / TILE * S, r2, 0, 7); x.fill();
  };
  for (const pt of G.portals) dot(pt.x, pt.y, '#7ad8e8', 4);
  for (const n of G.npcs) dot(n.x, n.y, '#ffd700', 4);
  for (const e of G.enemies) if (e.boss && !e.dead) dot(e.x, e.y, '#b04aff', 5);
  for (const id in Net.remotes) {
    const r = Net.remotes[id];
    dot(r.x, r.y, Party.has(+id) ? '#7fd18a' : '#ffb84a', 4.5);
  }
  // zone names
  x.font = 'bold 12px Georgia';
  x.textAlign = 'center';
  for (const [name, tx, ty] of MAP_LABELS) {
    x.fillStyle = 'rgba(0,0,0,.65)';
    x.fillText(name, tx * S + 1, ty * S + 1);
    x.fillStyle = '#e8dcc0';
    x.fillText(name, tx * S, ty * S);
  }
  // you are here
  const p = G.player;
  const pulse = Math.sin(G.time * 4) * 0.5 + 0.5;
  dot(p.x, p.y, '#fff', 4);
  x.strokeStyle = `rgba(201,162,39,${0.5 + pulse * 0.5})`;
  x.lineWidth = 2;
  x.beginPath(); x.arc(p.x / TILE * S, p.y / TILE * S, 7 + pulse * 3, 0, 7); x.stroke();
  x.font = 'bold 10px Verdana';
  x.fillStyle = '#ffe98a';
  x.fillText('YOU', p.x / TILE * S, p.y / TILE * S - 12);
}

// ---------------- Overlays ----------------
function flashLevel(lv) {
  const el = $('levelFlash');
  el.textContent = `⚜ LEVEL ${lv} ⚜`;
  el.style.opacity = 1;
  clearTimeout(G._lvTO);
  G._lvTO = setTimeout(() => { el.style.opacity = 0; }, 1800);
}

// ---------------- Pause menu / settings ----------------
const SETTING_DEFS = [
  ['music', '🎵 Music'],
  ['sfx', '🔊 Sound Effects'],
  ['shake', '📳 Screen Shake'],
  ['dmgNums', '💥 Damage Numbers'],
];

function openPause() {
  if (G.state === 'title') return;
  G.paused = true;
  $('pmButtons').classList.remove('hidden');
  $('pmSettingsPane').classList.add('hidden');
  $('pmControlsPane').classList.add('hidden');
  $('pauseMenu').classList.remove('hidden');
}
function closePause() {
  G.paused = false;
  $('pauseMenu').classList.add('hidden');
}
function openSettingsPane() {
  $('pmButtons').classList.add('hidden');
  $('pmControlsPane').classList.add('hidden');
  const pane = $('pmSettingsPane');
  pane.classList.remove('hidden');
  pane.innerHTML = '';
  for (const [key, label] of SETTING_DEFS) {
    const row = document.createElement('div');
    row.className = 'setRow';
    const lab = document.createElement('span');
    lab.textContent = label;
    const btn = document.createElement('button');
    const paint = () => {
      btn.className = 'setToggle ' + (G.settings[key] ? 'on' : 'off');
      btn.textContent = G.settings[key] ? 'ON' : 'OFF';
    };
    paint();
    btn.onclick = () => { G.settings[key] = !G.settings[key]; saveSettings(); paint(); sfx('gather'); };
    row.appendChild(lab); row.appendChild(btn);
    pane.appendChild(row);
  }
  const back = document.createElement('button');
  back.className = 'menuBtn';
  back.textContent = 'Back';
  back.onclick = () => { pane.classList.add('hidden'); $('pmButtons').classList.remove('hidden'); };
  pane.appendChild(back);
}
const CONTROLS_LIST = [
  ['Move', 'W A S D / Arrows'],
  ['Aim', 'Mouse'],
  ['Attack', 'Left Click / 1'],
  ['Skills', '1 – 4  (drag slots to reorder)'],
  ['Dodge roll (invincible)', 'Space'],
  ['Talk · gather · open · fish', 'E  or  Left Click'],
  ['Options menu (trade, inspect...)', 'Right Click'],
  ['Bound potions', '5 / 6  (drag from bag to rebind)'],
  ['Chat', 'Enter'],
  ['Character & Bag', 'I'],
  ['Character sheet & achievements', 'C'],
  ['Quest log', 'L'],
  ['World map', 'M'],
  ['Ranked leaderboard', 'P'],
  ['Party invite / leave', 'Right-click a player'],
  ['Mute audio', 'N'],
  ['Menu · close windows', 'Esc'],
];
function openControlsPane() {
  $('pmButtons').classList.add('hidden');
  const pane = $('pmControlsPane');
  pane.classList.remove('hidden');
  pane.innerHTML = '';
  for (const [what, key] of CONTROLS_LIST) {
    const row = document.createElement('div');
    row.className = 'ctlRow';
    row.innerHTML = `<span>${what}</span><span class="ctlKey">${key}</span>`;
    pane.appendChild(row);
  }
  const back = document.createElement('button');
  back.className = 'menuBtn';
  back.textContent = 'Back';
  back.onclick = () => { pane.classList.add('hidden'); $('pmButtons').classList.remove('hidden'); };
  pane.appendChild(back);
}

function wirePauseMenu() {
  $('pmResume').onclick = closePause;
  $('pmSettings').onclick = openSettingsPane;
  $('pmControls').onclick = openControlsPane;
  $('pmSave').onclick = () => { saveGame(); chat('sys', '💾 Game saved.'); closePause(); };
  $('pmQuit').onclick = () => { saveGame(); location.reload(); };
}

// ---------------- Right-click context menu ----------------
function closeCtxMenu() {
  const m = $('ctxMenu');
  if (m) m.remove();
}

function openCtxMenu(hit, cx, cy) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.id = 'ctxMenu';
  const p = G.player;
  const d = dist(p.x, p.y, hit.x, hit.y);
  const inRange = d < CLICK_RANGE;
  const add = (label, fn, dim) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (dim) b.classList.add('dim');
    b.onmousedown = ev => { ev.stopPropagation(); closeCtxMenu(); fn(); };
    m.appendChild(b);
  };
  const head = document.createElement('div');
  head.className = 'ctxHead';

  if (hit.kind === 'npc') {
    const n = hit.npc;
    head.textContent = n.name;
    m.appendChild(head);
    add('💬 Talk', () => inRange ? openDialogue(n) : tooFar(), !inRange);
    if (n.shop) add('🪙 Browse wares', () => { if (inRange) { openDialogue(n); openShop(n); } else tooFar(); }, !inRange);
    add('ℹ️ Inspect', () => chat('sys', `${n.name} — ${n.role} of Havenbrook.`));
  } else if (hit.kind === 'enemy') {
    const e = hit.enemy;
    head.textContent = `${e.name} · Lv ${e.lv}${e.elite ? ' 👑' : ''}${e.boss ? ' ☠' : ''}`;
    m.appendChild(head);
    add('⚔️ Attack', () => { G.target = e; useSkill(0); });
    add('🎯 Target', () => { G.target = e; });
    add('ℹ️ Inspect', () => chat('sys', `${e.name} — Level ${e.lv}${e.elite ? ' ELITE' : ''}${e.boss ? ' · BOSS' : ''} · ${Math.ceil(e.hp)}/${e.maxHp} HP.`));
  } else if (hit.kind === 'remote') {
    const r = hit.remote;
    head.textContent = `${r.name} · Lv ${r.level} (live)`;
    m.appendChild(head);
    add('👋 Wave', () => {
      chat('player', `👋 waves at ${r.name}!`, p.name);
      Net.sendChat(`👋 waves at ${r.name}!`);
    });
    if (Party.has(r.id)) add('🚪 Leave Party', () => Party.leaveParty());
    else add('🤝 Invite to Party', () => Party.invite(r));
    add('⚔️ Duel', () => Duel.request(r));
    add('💱 Trade', () => Trade.request(r));
    add('🎁 Give item', () => openGiftMenu(r));
    add('ℹ️ Inspect', () => chat('sys', `${r.name} — Level ${r.level} ${CLASSES[r.cls].name} · a living adventurer.`));
  } else if (hit.kind === 'bot') {
    const b = hit.bot;
    head.textContent = `${b.name} · Lv ${b.level}`;
    m.appendChild(head);
    add('💱 Trade', () => Trade.openBot(b));
    add('👋 Wave', () => {
      chat('player', `👋 waves at ${b.name}!`, p.name);
      setTimeout(() => chat('player', 'o/', b.name), 1200 + Math.random() * 1800);
    });
    add('🎁 Give item', () => openBotGiftMenu(b));
    add('ℹ️ Inspect', () => chat('sys', `${b.name} — Level ${b.level} ${CLASSES[b.cls].name}.`));
  } else if (hit.kind === 'chest') {
    head.textContent = 'Treasure Chest';
    m.appendChild(head);
    add('🗝️ Open', () => inRange ? openChest(hit.chest) : tooFar(), !inRange);
  } else if (hit.kind === 'node') {
    head.textContent = 'Moonpetal';
    m.appendChild(head);
    add('🌸 Gather', () => inRange ? gatherNode(hit.node) : tooFar(), !inRange);
  }

  document.body.appendChild(m);
  m.style.left = Math.min(G.W - m.offsetWidth - 8, cx) + 'px';
  m.style.top = Math.min(G.H - m.offsetHeight - 8, cy) + 'px';
}

// ---------------- Achievement toast ----------------
function achToast(text) {
  const el = $('achToast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(G._achTO);
  G._achTO = setTimeout(() => el.classList.remove('show'), 3200);
}

function questBanner(text) {
  const el = $('questBanner');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(G._qbTO);
  G._qbTO = setTimeout(() => { el.style.opacity = 0; }, 2400);
}

function showDeath() {
  const o = $('bigOverlay');
  o.classList.remove('hidden');
  $('boTitle').textContent = 'YOU HAVE FALLEN';
  $('boText').textContent = 'The Blight claims another light... but the Shard of the Dawn does not die so easily. It pulls your spirit back toward Havenbrook.';
  const b = $('boBtn');
  b.textContent = 'Rise Again';
  b.onclick = () => respawnPlayer();
}
function showVictory() {
  G.state = 'victory';
  const o = $('bigOverlay');
  o.classList.remove('hidden');
  $('boTitle').textContent = '⚜ THE DAWN RETURNS ⚜';
  $('boText').innerHTML =
    'The Warden splinters like rotten timber, and from its shattered heart the stolen light of a thousand years pours back into the sky. ' +
    'The ash of the Ruins glows gold. The Whisperwood exhales. In Havenbrook, the bells ring for the first time in living memory.<br><br>' +
    `<b style="color:#f4e9c8">${G.player.name}, Shardbearer of Emberfall</b>, your name enters legend.<br><br>` +
    '<span style="color:#8a8a76">— EMBERFALL: SHARDS OF THE DAWN — Campaign complete. The world remains yours to roam.</span>';
  const b = $('boBtn');
  b.textContent = 'Continue Exploring';
  b.onclick = () => { hideBigOverlay(); G.state = 'play'; };
  saveGame();
}
function hideBigOverlay() { $('bigOverlay').classList.add('hidden'); }
