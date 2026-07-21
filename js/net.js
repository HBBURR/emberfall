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
      this.send({
        t: 'join', name: p.name, cls: p.cls, level: p.level, x: Math.round(p.x), y: Math.round(p.y),
        auth: (Auth.user && Auth.token) ? { user: Auth.user, token: Auth.token } : undefined,
      });
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
      else if (Party.has(m.killer)) Party.shareKill(e);   // party: shared quest credit + half XP
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
      const bossType = m.stype === 'drowned' ? 'maw' : m.stype === 'voidknight' ? 'hollowking' : 'warden';
      const w = G.enemies.find(en => en.type === bossType);
      bossSummonAt(w ? w.x : m.pts[0][0], w ? w.y : m.pts[0][1], m.pts, m.stype);
    } else if (m.t === 'join') {
      this.addRemote(m);
      chat('sys', `⚔ ${m.name} has entered Emberfall!`);
    } else if (m.t === 'state') {
      const r = this.remotes[m.id];
      if (r) { r.tx = m.x; r.ty = m.y; r.facing = m.facing; r.moving = m.moving; r.level = m.level; r.wt = m.wt; r.hpf = m.hpf; r.av = m.av; r.hv = m.hv; r.bv = m.bv; }
    } else if (m.t && m.t.startsWith('trade')) {
      Trade.handle(m);
    } else if (m.t && m.t.startsWith('duel')) {
      Duel.handle(m);
    } else if (m.t && m.t.startsWith('party')) {
      Party.handle(m);
    } else if (m.t === 'gift') {
      if (m.to === this.id) {
        addItem(m.item, 1);
        const sender = this.remotes[m.from];
        chat('sys', `🎁 ${sender ? sender.name : 'A friend'} sent you ${itemLabel(m.item)}!`);
        sfx('quest');
      }
    } else if (m.t === 'chat') {
      chat('player', m.text, m.name, m.dev);
    } else if (m.t === 'leave') {
      const r = this.remotes[m.id];
      if (r) { chat('sys', `${r.name} has left the realm.`); delete this.remotes[m.id]; }
      if (Trade.active && Trade.active.peerId === m.id) Trade.close('Trade cancelled — they left the realm.');
      if (Duel.peerId === m.id) Duel.reset('Duel over — your opponent left the realm.');
      if (Party.has(m.id)) Party.drop(m.id);
    }
  },

  addRemote(pl) {
    this.remotes[pl.id] = {
      id: pl.id, name: pl.name, cls: pl.cls || 'warrior', level: pl.level || 1, dev: !!pl.dev,
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
      const gv = gearVis(p.equip);
      this.send({ t: 'state', x: Math.round(p.x), y: Math.round(p.y), facing: Math.cos(p.facing) < 0 ? -1 : 1, moving: p.moving, level: p.level, wt: playerWeaponTier(p), hpf: Math.round(clamp(p.hp / pStat(p).maxHp, 0, 1) * 100), av: gv.a === null ? -1 : gv.a, hv: gv.h === null ? -1 : gv.h, bv: gv.b === null ? -1 : gv.b });
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
      peerGear: r ? { a: r.av >= 0 ? r.av : null, h: r.hv >= 0 ? r.hv : null, b: r.bv >= 0 ? r.bv : null } : {},
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

// ============================================================
// Party — quest together. Shared kill-quest credit, half XP
// from partymates' kills, live HP frames, green minimap dots.
// Roster is kept in sync by whoever last changed it.
// ============================================================
const Party = {
  members: new Set(),   // remote ids

  has(id) { return this.members.has(id); },
  size() { return this.members.size; },

  invite(r) {
    if (this.members.size >= 3) { chat('sys', 'Your party is full (4 heroes).'); return; }
    if (this.has(r.id)) { chat('sys', `${r.name} is already in your party.`); return; }
    Net.send({ t: 'partyinv', to: r.id });
    chat('sys', `🤝 Party invite sent to ${r.name}...`);
  },
  leaveParty() {
    if (!this.members.size) return;
    Net.send({ t: 'partyleave' });
    this.members.clear();
    chat('sys', '🚪 You left the party.');
    refreshPartyFrames();
  },
  drop(id) {
    this.members.delete(id);
    chat('sys', 'A hero left your party.');
    refreshPartyFrames();
  },

  handle(m) {
    if (m.t === 'partyinv') {
      if (m.to !== Net.id) return;
      const r = Net.remotes[m.from];
      const name = r ? r.name : 'An adventurer';
      showAsk(`🤝 <b style="color:#7fd18a">${name}</b> invites you to a <b>party</b>!`,
        () => {
          Net.send({ t: 'partyacc', to: m.from });
          this.members.add(m.from);
          chat('sys', `🤝 You joined ${name}'s party!`);
          refreshPartyFrames();
        },
        () => Net.send({ t: 'partydec', to: m.from }));
    } else if (m.t === 'partyacc') {
      if (m.to !== Net.id) return;
      this.members.add(m.from);
      const r = Net.remotes[m.from];
      chat('sys', `🤝 ${r ? r.name : 'A hero'} joined your party!`);
      // sync the full roster to every member so everyone agrees
      const ids = [Net.id, ...this.members];
      for (const id of this.members) Net.send({ t: 'partysync', to: id, ids });
      refreshPartyFrames();
    } else if (m.t === 'partydec') {
      if (m.to === Net.id) chat('sys', 'Your party invite was declined.');
    } else if (m.t === 'partysync') {
      if (m.to !== Net.id || !Array.isArray(m.ids)) return;
      if (!m.ids.includes(Net.id)) return;
      this.members = new Set(m.ids.filter(id => id !== Net.id && Net.remotes[id]));
      refreshPartyFrames();
    } else if (m.t === 'partyleave') {
      if (this.has(m.from)) this.drop(m.from);
    }
  },

  // a partymate killed something: quest credit for me too, plus half XP (bosses already reward everyone)
  shareKill(e) {
    questEvent('kill', e.type);
    const p = G.player;
    let xp = Math.round(e.xp * 0.5);
    if (p.level - e.lv > 3) xp = Math.max(1, Math.round(xp * 0.25));
    gainXp(xp);
  },
};

// ============================================================
// Duel — honorable PvP. Challenge via right-click; 3-2-1 then
// fight. Dodge rolls grant i-frames. The first player beaten
// below 10% HP yields (no death) and the realm hears about it.
// ============================================================
const Duel = {
  peerId: null, peerName: null, state: 'none', countdown: 0,   // none | counting | fighting

  request(r) {
    if (this.state !== 'none') { chat('sys', 'You are already in a duel.'); return; }
    if (Trade.active) { chat('sys', 'Finish your trade first.'); return; }
    Net.send({ t: 'duelreq', to: r.id });
    chat('sys', `⚔ Duel challenge sent to ${r.name}...`);
  },

  handle(m) {
    if (m.t === 'duelreq') {
      if (m.to !== Net.id) return;
      const r = Net.remotes[m.from];
      const name = r ? r.name : 'An adventurer';
      if (this.state !== 'none' || Trade.active) { Net.send({ t: 'dueldec', to: m.from }); return; }
      showAsk(`⚔ <b style="color:#e15b5b">${name}</b> challenges you to a <b>DUEL</b>!`,
        () => { Net.send({ t: 'duelacc', to: m.from }); this.begin(m.from, name); },
        () => Net.send({ t: 'dueldec', to: m.from }));
    } else if (m.t === 'duelacc') {
      if (m.to !== Net.id) return;
      const r = Net.remotes[m.from];
      this.begin(m.from, r ? r.name : 'Adventurer');
    } else if (m.t === 'dueldec') {
      if (m.to === Net.id) chat('sys', 'Your duel challenge was declined.');
    } else if (m.t === 'duelhit') {
      if (m.to === Net.id && this.fighting() && m.from === this.peerId) this.takeHit(m.dmg | 0);
    } else if (m.t === 'duelyield') {
      // broadcast: everyone hears the result
      chat('sys', `⚔ ${m.winnerName} has defeated ${m.loserName} in a duel!`);
      if (m.to === Net.id && m.from === this.peerId) {   // I won
        const p = G.player;
        p.counters.duelWins = (p.counters.duelWins || 0) + 1;
        if (p.counters.duelWins >= 3) unlockAch('duelist');
        questBanner('⚔ DUEL VICTORY ⚔');
        sfx('levelup');
        G.shake = 0.4;
        this.reset();
      }
    } else if (m.t === 'duelcancel') {
      if (m.from === this.peerId && this.state !== 'none') this.reset('Duel cancelled.');
    }
  },

  begin(peerId, name) {
    this.peerId = peerId;
    this.peerName = name;
    this.state = 'counting';
    this.countdown = 3.999;
    this._shown = null;
    chat('sys', `⚔ Duel with ${name} — ready yourself!`);
    sfx('quest');
  },

  tick(dt) {
    if (this.state === 'none') return;
    const r = Net.remotes[this.peerId];
    if (!r) { this.reset('Duel over — opponent vanished.'); return; }
    if (dist(G.player.x, G.player.y, r.x, r.y) > 750) {
      Net.send({ t: 'duelcancel', to: this.peerId });
      this.reset('Duel cancelled — you drifted too far apart.');
      return;
    }
    if (this.state === 'counting') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this._shown && n > 0) { this._shown = n; flashDuel(String(n)); sfx('gather'); }
      if (this.countdown <= 0) { this.state = 'fighting'; flashDuel('⚔ FIGHT ⚔'); sfx('crit'); }
    }
  },

  fighting() { return this.state === 'fighting'; },
  peer() { return this.fighting() ? Net.remotes[this.peerId] : null; },

  // ---- attacker side: my swings/spells connecting with my opponent ----
  hitPeer(mult) {
    const r = this.peer();
    if (!r) return;
    const { dmg, crit } = playerDamageRoll(mult);
    Net.send({ t: 'duelhit', to: this.peerId, dmg });
    if (G.settings.dmgNums) floater(r.x, r.y - 22, dmg, crit ? '#ffe14a' : '#ff9a9a', crit);
    spawnParticles(r.x, r.y - 10, crit ? 10 : 5, '#ff7a5a', 90, 0.35);
    sfx(crit ? 'crit' : 'hit');
  },
  tryMelee(sk, aim) {
    const r = this.peer();
    if (!r) return;
    const p = G.player;
    const d = dist(p.x, p.y, r.x, r.y);
    if (d > sk.range + 12) return;
    let da = Math.atan2(r.y - p.y, r.x - p.x) - aim;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) < sk.arc / 2) this.hitPeer(sk.mult);
  },
  tryNova(sk) {
    const r = this.peer();
    if (r && dist(G.player.x, G.player.y, r.x, r.y) < sk.range + 14) this.hitPeer(sk.mult);
  },

  // ---- defender side ----
  takeHit(dmg) {
    const p = G.player;
    if (p.dead) return;
    if (p.rollT > 0 || p.dashT > 0) {   // dodged!
      floater(p.x, p.y - 26, 'DODGED', '#8fd4ff');
      return;
    }
    const st = pStat(p);
    const final = Math.max(1, Math.round(dmg * (0.9 + Math.random() * 0.2) - st.def));
    p.hp -= final;
    p.hurtT = 0.3;
    if (G.settings.dmgNums) floater(p.x, p.y - 26, '-' + final, '#ff6a5a');
    G.shake = Math.max(G.shake, 0.18);
    sfx('hurt');
    if (p.hp <= st.maxHp * 0.1) {
      p.hp = Math.max(1, Math.round(st.maxHp * 0.25));   // yield with dignity, not death
      Net.send({ t: 'duelyield', to: this.peerId, winnerName: this.peerName, loserName: p.name });
      chat('sys', `⚔ You yield! ${this.peerName} wins the duel.`);
      questBanner('⚔ DEFEAT');
      this.reset();
    }
  },

  reset(msg) {
    this.peerId = null;
    this.peerName = null;
    this.state = 'none';
    if (msg) chat('sys', msg);
  },
};

function drawRemote(ctx, r, cam) {
  const x = r.x - cam.x, y = r.y - cam.y;
  if (x < -60 || y < -60 || x > G.W + 60 || y > G.H + 60) return;
  const c = CLASSES[r.cls];
  drawHumanoid(ctx, x, y, {
    color: c.color, hair: c.hair, facing: r.facing, walkT: r.walkT, moving: r.moving,
    name: (r.dev ? '⚙ ' : '') + r.name,
    nameColor: r.dev ? '#ff5a5a' : Party.has(r.id) ? '#7fd18a' : '#ffb84a', level: r.level,
    weapon: r.cls === 'warrior' ? 'sword' : r.cls === 'mage' ? 'staff' : 'bow',
    wtier: r.wt === undefined ? 0 : r.wt,
    gear: { a: r.av >= 0 ? r.av : null, h: r.hv >= 0 ? r.hv : null, b: r.bv >= 0 ? r.bv : null },
  });
}
