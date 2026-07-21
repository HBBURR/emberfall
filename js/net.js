// ============================================================
// EMBERFALL ONLINE — net.js : realm client
// Connects to the realm server (server.js) when the game is
// served over HTTP. Falls back to offline play silently.
// Syncs: presence, position, level, chat.
// ============================================================
'use strict';

const Net = {
  ws: null, connected: false, id: null,
  remotes: {},          // id -> remote player
  sendT: 0, snapT: 0, scoreT: 2,
  authorityId: null,    // lowest-id client simulates the shared monsters

  isAuth() { return !this.connected || this.authorityId === null || this.authorityId === this.id; },

  _gen: 0,
  connect() {
    if (location.protocol === 'file:') return;
    // exactly one live socket: tear down any previous connection first and
    // make its late events inert via a generation counter
    if (this.ws) {
      const old = this.ws;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    this.remotes = {};
    const gen = ++this._gen;
    let ws;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    } catch (e) { return; }
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this._gen) return;
      this.connected = true;
      const p = G.player;
      this.send({ t: 'join', name: p.name, cls: p.cls, level: p.level, x: Math.round(p.x), y: Math.round(p.y) });
      chat('sys', '🌐 Connected to the realm — other adventurers can see you now.');
    };
    ws.onmessage = ev => {
      if (gen !== this._gen) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.onMsg(m);
    };
    ws.onclose = () => {
      if (gen !== this._gen) return;
      if (this.connected) chat('sys', '🌐 Lost connection to the realm.');
      this.connected = false; this.ws = null; this.remotes = {};
      if (Trade.active) Trade.close('Trade cancelled — connection lost.');
      // quiet retry in the background
      clearTimeout(this._retryTO);
      this._retryTO = setTimeout(() => { if (G.state !== 'title') this.connect(); }, 5000);
    };
    ws.onerror = () => {};
  },

  onMsg(m) {
    if (m.t === 'welcome') {
      this.id = m.id;
      this.authorityId = m.authId;
      this.remotes = {};   // fresh roster — drop anything stale from a previous connection
      for (const pl of m.players) this.addRemote(pl);
      if (m.board) G.netBoard = m.board;
      const n = m.players.length;
      if (n) chat('sys', `${n} other adventurer${n > 1 ? 's are' : ' is'} in the realm.`);
    } else if (m.t === 'board') {
      G.netBoard = m.top || [];
      if (!$('board').classList.contains('hidden')) renderBoard();
    } else if (m.t === 'auth') {
      const wasAuth = this.isAuth();
      this.authorityId = m.id;
      if (!wasAuth && this.isAuth()) chat('sys', '🌐 You now steward the realm\'s monsters.');
    } else if (m.t === 'pdmg') {
      const e = G.enemies[m.i];
      if (!e || e.dead) return;
      e.hurtT = 0.25;
      if (m.from !== this.id && G.settings.dmgNums) floater(e.x, e.y - 20, m.dmg, '#ffd9a0');
      if (this.isAuth()) applyEnemyDamage(e, m.dmg, m.from);
      else e.hp -= m.dmg;
    } else if (m.t === 'ekill') {
      const e = G.enemies[m.i];
      if (!e || e.dead) return;
      e.dead = true;
      deathFx(e);
      if (m.killer === this.id || e.boss) killRewards(e);
    } else if (m.t === 'ehit') {
      if (m.target === this.id) damagePlayer(m.dmg, m.name || 'a monster');
    } else if (m.t === 'eproj') {
      G.projectiles.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, dmg: m.dmg, from: 'enemy', ttl: m.ttl || 1.2, kind: m.kind || 'shadow' });
    } else if (m.t === 'esnap') {
      if (this.isAuth()) return;   // stale snapshot from a previous authority
      for (const [i, x, y, hp, dead] of m.e) {
        const e = G.enemies[i];
        if (!e) continue;
        e.netX = x; e.netY = y;
        if (dead && !e.dead) { e.dead = true; }
        else if (!dead && e.dead) { e.dead = false; e.hp = e.maxHp; e.x = x; e.y = y; }
        if (!dead) e.hp = Math.min(hp, e.maxHp);
      }
    } else if (m.t === 'esummon') {
      if (this.isAuth()) return;
      const w = G.enemies.find(en => en.type === 'warden');
      wardenSummonAt(w ? w.x : m.pts[0][0], w ? w.y : m.pts[0][1], m.pts);
    } else if (m.t === 'join') {
      this.addRemote(m);
      chat('sys', `⚔ ${m.name} has entered Emberfall!`);
    } else if (m.t === 'state') {
      const r = this.remotes[m.id];
      if (r) { r.tx = m.x; r.ty = m.y; r.facing = m.facing; r.moving = m.moving; r.level = m.level; r.wt = m.wt; }
    } else if (m.t && m.t.startsWith('trade')) {
      Trade.handle(m);
    } else if (m.t === 'gift') {
      if (m.to === this.id) {
        addItem(m.item, 1);
        const sender = this.remotes[m.from];
        chat('sys', `🎁 ${sender ? sender.name : 'A friend'} sent you ${itemLabel(m.item)}!`);
        sfx('quest');
      }
    } else if (m.t === 'chat') {
      chat('player', m.text, m.name);
    } else if (m.t === 'leave') {
      const r = this.remotes[m.id];
      if (r) { chat('sys', `${r.name} has left the realm.`); delete this.remotes[m.id]; }
      if (Trade.active && Trade.active.peerId === m.id) Trade.close('Trade cancelled — they left the realm.');
    }
  },

  addRemote(pl) {
    this.remotes[pl.id] = {
      id: pl.id, name: pl.name, cls: pl.cls || 'warrior', level: pl.level || 1,
      x: pl.x || 70 * TILE, y: pl.y || 118 * TILE, tx: pl.x || 70 * TILE, ty: pl.y || 118 * TILE,
      facing: 1, moving: false, walkT: Math.random() * 7,
    };
  },

  tick(dt) {
    if (!this.connected) return;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.1;   // 10 updates/s
      const p = G.player;
      this.send({ t: 'state', x: Math.round(p.x), y: Math.round(p.y), facing: Math.cos(p.facing) < 0 ? -1 : 1, moving: p.moving, level: p.level, wt: playerWeaponTier(p) });
    }
    // ranked score heartbeat (drives the realm leaderboard)
    this.scoreT -= dt;
    if (this.scoreT <= 0) {
      this.scoreT = 12;
      const p = G.player;
      this.send({ t: 'score', level: p.level, score: computeScore(p) });
    }
    // authority broadcasts the shared monster world at 5 Hz
    if (this.isAuth() && Object.keys(this.remotes).length) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 0.2;
        this.send({ t: 'esnap', e: G.enemies.map((e, i) => [i, e.x | 0, e.y | 0, Math.max(0, Math.ceil(e.hp)), e.dead ? 1 : 0]) });
      }
    }
    // smooth remote movement toward their last reported position
    for (const id in this.remotes) {
      const r = this.remotes[id];
      if (dist(r.x, r.y, r.tx, r.ty) > 300) { r.x = r.tx; r.y = r.ty; }   // teleport snap
      else { r.x = lerp(r.x, r.tx, Math.min(1, dt * 12)); r.y = lerp(r.y, r.ty, Math.min(1, dt * 12)); }
      if (r.moving) r.walkT += dt * 9;
    }
  },

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  sendChat(text) { this.send({ t: 'chat', text }); },
  count() { return (this.connected ? 1 : 0) + Object.keys(this.remotes).length; },
};

// ============================================================
// Trade — two-way exchange between live players.
// Both sides build an offer (items + gold); any change resets
// acceptance; when both have accepted, each client executes the
// swap locally from the synced offers.
// ============================================================
const Trade = {
  active: null,   // {peerId, peerName, mine:[{id}], myGold, theirs:[{id}], theirGold, myOk, theirOk}

  request(r) {
    if (this.active) { chat('sys', 'Finish your current trade first.'); return; }
    Net.send({ t: 'tradereq', to: r.id });
    chat('sys', `💱 Trade request sent to ${r.name}...`);
    clearTimeout(this._reqTO);
    this._reqTO = setTimeout(() => {
      if (!this.active) chat('sys', `${r.name} didn't respond to your trade request.`);
    }, 12000);
  },

  open(peerId, peerName) {
    clearTimeout(this._reqTO);
    const r = Net.remotes[peerId];
    this._openWindow({
      peerId, peerName,
      peerCls: r ? r.cls : 'warrior', peerLevel: r ? r.level : 1, peerWt: r && r.wt !== undefined ? r.wt : 0,
    });
  },

  // trade with one of the townsfolk: same window, simulated partner
  openBot(b) {
    if (this.active) { chat('sys', 'Finish your current trade first.'); return; }
    const greet = ['sure, let\'s trade!', 'ooh, whatcha got?', 'always happy to barter'];
    chat('player', greet[Math.floor(Math.random() * greet.length)], b.name);
    this._openWindow({
      peerId: 'bot:' + b.name, peerName: b.name, isBot: true,
      peerCls: b.cls, peerLevel: b.level, peerWt: Math.min(3, Math.floor(b.level / 3)),
    });
    clearTimeout(this._botTO);
    this._botTO = setTimeout(() => this._botOffer(), 1400);
  },

  _openWindow(fields) {
    this.active = Object.assign({ mine: [], myGold: 0, theirs: [], theirGold: 0, myOk: false, theirOk: false }, fields);
    $('tradeTitle').textContent = '💱 Trade';
    $('tradeNameMine').textContent = `${G.player.name} · Lv ${G.player.level}`;
    $('tradeNameTheirs').textContent = `${fields.peerName} · Lv ${fields.peerLevel}`;
    $('tradeGoldMine').value = 0;
    $('tradePanel').classList.remove('hidden');
    this.render();
  },

  _botOffer() {
    const a = this.active;
    if (!a || !a.isBot) return;
    const pool = ['hp_potion', 'mp_potion', 'minnow', 'trout', 'hp_potion2', 'wolf_charm', 'iron_helm', 'scout_boots'];
    a.theirs = [];
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) a.theirs.push({ id: pool[Math.floor(Math.random() * pool.length)] });
    a.theirGold = 5 + Math.floor(Math.random() * 26);
    a.myOk = false; a.theirOk = false;
    this.render();
    chat('player', 'here\'s what I can offer!', a.peerName);
  },

  _offerValue(items, gold) {
    return items.reduce((n, s) => n + ((ITEMS[s.id] && ITEMS[s.id].price) || 0), 0) + gold;
  },

  handle(m) {
    const a = this.active;
    if (m.t === 'tradereq') {
      if (m.to !== Net.id) return;
      if (a) { Net.send({ t: 'tradedec', to: m.from }); return; }   // busy
      const r = Net.remotes[m.from];
      const name = r ? r.name : 'An adventurer';
      showTradeAsk(name,
        () => { Net.send({ t: 'tradeacc', to: m.from }); this.open(m.from, name); },
        () => Net.send({ t: 'tradedec', to: m.from }));
    } else if (m.t === 'tradeacc') {
      if (m.to !== Net.id || a) return;
      const r = Net.remotes[m.from];
      this.open(m.from, r ? r.name : 'Adventurer');
      chat('sys', 'Trade accepted — the window is open.');
    } else if (m.t === 'tradedec') {
      if (m.to === Net.id) chat('sys', 'Trade declined.');
    } else if (!a || m.from !== a.peerId || m.to !== Net.id) {
      return;
    } else if (m.t === 'tradeoffer') {
      a.theirs = Array.isArray(m.items) ? m.items : [];
      a.theirGold = m.gold | 0;
      a.myOk = false; a.theirOk = false;   // any change re-arms both sides
      this.render();
    } else if (m.t === 'tradeok') {
      a.theirOk = true;
      this.render();
      this.tryExecute();
    } else if (m.t === 'tradecancel') {
      this.close(`Trade cancelled by ${a.peerName}.`);
    }
  },

  sync() {
    const a = this.active; if (!a) return;
    a.myOk = false; a.theirOk = false;
    if (!a.isBot) Net.send({ t: 'tradeoffer', to: a.peerId, items: a.mine, gold: a.myGold });
    this.render();
  },
  addOffer(id) {
    const a = this.active; if (!a || a.mine.length >= 6) return;
    const offered = a.mine.filter(x => x.id === id).length;
    if (offered >= countItem(id)) return;   // can't offer more than you own
    a.mine.push({ id });
    this.sync();
  },
  removeOffer(i) {
    const a = this.active; if (!a) return;
    a.mine.splice(i, 1);
    this.sync();
  },
  setGold(n) {
    const a = this.active; if (!a) return;
    a.myGold = clamp(n | 0, 0, G.player.gold);
    $('tradeGoldMine').value = a.myGold;
    this.sync();
  },
  accept() {
    const a = this.active; if (!a || a.myOk) return;
    if (invFreeSlots() + a.mine.length < a.theirs.length) {
      chat('sys', 'Not enough bag space for their items — clear some room first.');
      return;
    }
    a.myOk = true;
    this.render();
    if (a.isBot) {
      // the villager weighs the deal for a moment
      clearTimeout(this._botTO);
      this._botTO = setTimeout(() => {
        const aa = this.active;
        if (!aa || !aa.isBot || !aa.myOk) return;
        const fair = this._offerValue(aa.mine, aa.myGold) >= this._offerValue(aa.theirs, aa.theirGold) * 0.35;
        if (fair) {
          chat('player', 'deal!', aa.peerName);
          aa.theirOk = true;
          this.render();
          this.tryExecute();
        } else {
          const grumble = ['hmm, that\'s not quite fair, friend', 'sweeten the deal a little!', 'you\'re gonna have to do better than that'];
          chat('player', grumble[Math.floor(Math.random() * grumble.length)], aa.peerName);
        }
      }, 900);
      return;
    }
    Net.send({ t: 'tradeok', to: a.peerId });
    this.tryExecute();
  },
  tryExecute() {
    const a = this.active;
    if (!a || !a.myOk || !a.theirOk) return;
    for (const s of a.mine) removeItem(s.id, 1);
    G.player.gold = Math.max(0, G.player.gold - a.myGold);
    for (const s of a.theirs) if (ITEMS[s.id]) addItem(s.id, 1);
    G.player.gold += a.theirGold;
    const gave = a.mine.map(s => ITEMS[s.id].name).join(', ') || (a.myGold ? '' : 'nothing');
    const got = a.theirs.map(s => ITEMS[s.id] && ITEMS[s.id].name).filter(Boolean).join(', ') || (a.theirGold ? '' : 'nothing');
    chat('sys', `💱 Trade complete with ${a.peerName}! Gave: ${gave}${a.myGold ? ' +' + a.myGold + 'g' : ''} · Got: ${got}${a.theirGold ? ' +' + a.theirGold + 'g' : ''}`);
    sfx('levelup');
    this.close();
  },
  cancel() {
    const a = this.active; if (!a) return;
    if (a.isBot) chat('player', 'another time, then!', a.peerName);
    else Net.send({ t: 'tradecancel', to: a.peerId });
    this.close('Trade cancelled.');
  },
  close(msg) {
    clearTimeout(this._botTO);
    this.active = null;
    $('tradePanel').classList.add('hidden');
    if (msg) chat('sys', msg);
  },
  render() { renderTradePanel(this.active); },
};

function drawRemote(ctx, r, cam) {
  const x = r.x - cam.x, y = r.y - cam.y;
  if (x < -60 || y < -60 || x > G.W + 60 || y > G.H + 60) return;
  const c = CLASSES[r.cls];
  drawHumanoid(ctx, x, y, {
    color: c.color, hair: c.hair, facing: r.facing, walkT: r.walkT, moving: r.moving,
    name: r.name, nameColor: '#ffb84a', level: r.level,
    weapon: r.cls === 'warrior' ? 'sword' : r.cls === 'mage' ? 'staff' : 'bow',
    wtier: r.wt === undefined ? 0 : r.wt,
  });
}
