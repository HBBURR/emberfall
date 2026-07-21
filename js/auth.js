// ============================================================
// EMBERFALL ONLINE — auth.js : accounts, character select
// Server-side accounts (hashed passwords), 3 hero slots per
// account synced across devices, local mirror for resilience.
// Guest mode preserves the old localStorage-only flow.
// ============================================================
'use strict';

const Auth = {
  user: null, token: null, chars: {}, slot: null, guest: false,
  mode: 'login',          // login | create
  online: location.protocol !== 'file:',

  // ---------- API ----------
  async api(path, body) {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      return await r.json();
    } catch (e) {
      return { ok: false, error: 'Could not reach the realm server.' };
    }
  },

  // ---------- boot ----------
  init() {
    if (!this.online) {   // opened as a file: guest-only
      $('authCard').classList.add('hidden');
      this.startGuestFlow();
      return;
    }
    $('tabLogin').onclick = () => this.setMode('login');
    $('tabCreate').onclick = () => this.setMode('create');
    $('authGo').onclick = () => this.submit();
    $('authGuest').onclick = () => this.startGuestFlow();
    $('csLogout').onclick = () => this.logout();
    $('ccBack').onclick = () => this.backFromCreate();
    const enter = e => { if (e.key === 'Enter') this.submit(); };
    $('authUser').addEventListener('keydown', enter);
    $('authPass').addEventListener('keydown', enter);
    // resume session if we have one
    const saved = this.loadLocal();
    if (saved && saved.user && saved.token) {
      $('authUser').value = saved.user;
      this.api('/api/session', { user: saved.user, token: saved.token }).then(r => {
        if (r.ok) {
          this.user = r.user; this.token = saved.token; this.chars = r.chars || {};
          this.mergeMirror();
          this.showCharSelect();
        }
      });
    }
  },

  setMode(m) {
    this.mode = m;
    $('tabLogin').classList.toggle('sel', m === 'login');
    $('tabCreate').classList.toggle('sel', m === 'create');
    $('authGo').textContent = m === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT';
    this.err('');
  },
  err(msg, shake) {
    $('authErr').textContent = msg;
    if (shake) {
      $('authCard').classList.remove('shake');
      void $('authCard').offsetWidth;   // restart animation
      $('authCard').classList.add('shake');
    }
  },

  async submit() {
    const user = $('authUser').value.trim();
    const pass = $('authPass').value;
    if (!user || !pass) { this.err('Enter a username and password.', true); return; }
    $('authGo').disabled = true;
    const r = await this.api(this.mode === 'login' ? '/api/login' : '/api/register', { user, pass });
    $('authGo').disabled = false;
    if (!r.ok) {
      if (r.error === 'no_account') {
        this.err('No account with that name — switch to Create Account.', true);
      } else this.err(r.error || 'Something went wrong.', true);
      return;
    }
    this.user = r.user; this.token = r.token; this.chars = r.chars || {};
    this.mergeMirror();     // realm reset? restore heroes from this device
    this.saveLocal();
    sfx('quest');
    this.showCharSelect();
  },

  logout() {
    this.user = null; this.token = null; this.chars = {}; this.slot = null;
    try { localStorage.removeItem('emberfall_auth_v1'); } catch (e) {}
    $('charSelect').classList.add('hidden');
    $('charCreate').classList.add('hidden');
    $('authCard').classList.remove('hidden');
    $('authPass').value = '';
    this.err('');
  },

  // ---------- local persistence / mirror ----------
  loadLocal() {
    try { return JSON.parse(localStorage.getItem('emberfall_auth_v1')); } catch (e) { return null; }
  },
  saveLocal() {
    try {
      localStorage.setItem('emberfall_auth_v1', JSON.stringify({
        user: this.user, token: this.token, mirror: this.chars,
      }));
    } catch (e) {}
  },
  // if the server lost our heroes (free-tier reset), restore from the local mirror
  mergeMirror() {
    const saved = this.loadLocal();
    if (!saved || saved.user !== this.user || !saved.mirror) return;
    let restored = 0;
    for (const slot in saved.mirror) {
      if (!this.chars[slot] && saved.mirror[slot]) {
        this.chars[slot] = saved.mirror[slot];
        this.api('/api/savechar', { user: this.user, token: this.token, slot: +slot, data: this.chars[slot] });
        restored++;
      }
    }
    if (restored) chat('sys', `🌐 Restored ${restored} hero${restored > 1 ? 'es' : ''} from this device.`);
  },

  // ---------- character select ----------
  showCharSelect() {
    $('authCard').classList.add('hidden');
    $('charCreate').classList.add('hidden');
    $('charSelect').classList.remove('hidden');
    $('csUser').textContent = '⚜ ' + this.user;
    const wrap = $('charSlots');
    wrap.innerHTML = '';
    for (let slot = 0; slot < 3; slot++) {
      const data = this.chars[slot];
      const d = document.createElement('div');
      d.className = 'charSlot' + (data ? '' : ' empty');
      if (data) {
        const cls = CLASSES[data.cls] || CLASSES.warrior;
        const quests = data.quests ? Object.values(data.quests).filter(q => q.state === 'turned').length : 0;
        d.innerHTML = `<canvas width="150" height="150" id="csDoll${slot}"></canvas>` +
          `<div class="cname">${String(data.name).replace(/</g, '&lt;')}</div>` +
          `<div class="cinfo">Level ${data.level} ${cls.name}</div>` +
          `<div class="cstats">🪙 ${data.gold || 0} · ⚜ ${quests}/${QUESTS.length} quests</div>` +
          `<div class="enterHint">— ENTER WORLD —</div>`;
        d.onclick = () => this.enterAs(slot);
      } else {
        d.innerHTML = `<div class="centersign">✦</div><div class="forge">FORGE A HERO</div>` +
          `<div class="enterHint">— NEW ADVENTURE —</div>`;
        d.onclick = () => this.openCreate(slot);
      }
      wrap.appendChild(d);
    }
  },

  // animated dolls on the select cards (called from the title render loop)
  tickDolls() {
    if ($('charSelect').classList.contains('hidden')) return;
    for (let slot = 0; slot < 3; slot++) {
      const data = this.chars[slot];
      const c = $('csDoll' + slot);
      if (!data || !c) continue;
      const x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height);
      const cls = CLASSES[data.cls] || CLASSES.warrior;
      const wtier = data.equip && data.equip.weapon && ITEMS[data.equip.weapon] ? (ITEMS[data.equip.weapon].tier || 0) : -1;
      x.save();
      x.translate(c.width / 2, 104);
      x.scale(2.5, 2.5);
      drawHumanoid(x, 0, 0, {
        color: cls.color, hair: cls.hair, facing: 1, walkT: 0, moving: false,
        weapon: data.cls === 'warrior' ? 'sword' : data.cls === 'mage' ? 'staff' : 'bow',
        wtier, aim: -0.4, hurt: 0,
      });
      x.restore();
    }
  },

  // ---------- create / enter ----------
  openCreate(slot) {
    this.slot = slot;
    this.guest = false;
    $('charSelect').classList.add('hidden');
    $('charCreate').classList.remove('hidden');
    $('contBtn').classList.add('hidden');
    $('nameInput').value = '';
    $('nameInput').focus();
  },
  startGuestFlow() {
    this.guest = true;
    this.slot = null;
    $('authCard').classList.add('hidden');
    $('charSelect').classList.add('hidden');
    $('charCreate').classList.remove('hidden');
    const save = loadGame();
    const cb = $('contBtn');
    if (save) {
      cb.classList.remove('hidden');
      cb.textContent = `Continue: ${save.name} (Lv ${save.level} ${CLASSES[save.cls].name})`;
      cb.onclick = () => { initAudio(); applySave(save); enterWorld(true); };
    } else cb.classList.add('hidden');
  },
  backFromCreate() {
    $('charCreate').classList.add('hidden');
    if (this.guest || !this.user) {
      if (this.online) $('authCard').classList.remove('hidden');
      this.guest = false;
    } else this.showCharSelect();
  },

  enterAs(slot) {
    this.slot = slot;
    this.guest = false;
    initAudio();
    applySave(this.chars[slot]);
    enterWorld(true);
  },
  // called by the FORGE HERO button (main.js) — routes account vs guest
  forgeHero(cls, name) {
    initAudio();
    G.player = makePlayer(cls, name);
    G.quests = {};
    G.bossDead = false;
    spawnAllEnemies();
    enterWorld(false);
  },

  // ---------- save sync ----------
  loggedIn() { return !this.guest && !!this.user && this.slot !== null; },
  onSaved(data) {
    if (!this.loggedIn()) return;
    this.chars[this.slot] = data;
    this.saveLocal();     // mirror on this device
    this.api('/api/savechar', { user: this.user, token: this.token, slot: this.slot, data });
  },
  beaconSave(data) {
    if (!this.loggedIn() || !navigator.sendBeacon) return;
    this.chars[this.slot] = data;
    this.saveLocal();
    navigator.sendBeacon('/api/savechar', new Blob(
      [JSON.stringify({ user: this.user, token: this.token, slot: this.slot, data })],
      { type: 'application/json' }
    ));
  },
};
