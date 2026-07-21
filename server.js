// ============================================================
// EMBERFALL ONLINE — realm server
// Zero-dependency Node server: serves the game over HTTP and
// relays player presence/chat over a hand-rolled WebSocket.
//   node server.js          → http://localhost:8377
//   PORT=3000 node server.js
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8377;
const ROOT = __dirname;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

// ---------------- Accounts (persistent, salted+hashed passwords) ----------------
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
let accounts = { _secret: crypto.randomBytes(16).toString('hex'), users: {} };
try {
  const loaded = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  if (loaded && loaded.users) accounts = loaded;
} catch (e) {}
let accDirty = false;
setInterval(() => {
  if (!accDirty) return;
  accDirty = false;
  fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts), () => {});
}, 3000);

// Dev accounts: set DEV_USERS=name1,name2 in the environment (Render → Environment),
// or list one username per line in dev_users.txt next to server.js (gitignored).
const DEV_SET = new Set(String(process.env.DEV_USERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
try {
  fs.readFileSync(path.join(ROOT, 'dev_users.txt'), 'utf8').split(/\r?\n/)
    .map(s => s.trim().toLowerCase()).filter(Boolean).forEach(u => DEV_SET.add(u));
} catch (e) {}
if (DEV_SET.size) log(`dev accounts: ${[...DEV_SET].join(', ')}`);
function isDev(key) { return DEV_SET.has(key); }
// DEV_KEY (env or dev_key.txt): the secret required to register a reserved dev username.
// This is what stops someone from grabbing a dev name after a free-tier realm reset.
let DEV_KEY = String(process.env.DEV_KEY || '');
try { if (!DEV_KEY) DEV_KEY = fs.readFileSync(path.join(ROOT, 'dev_key.txt'), 'utf8').trim(); } catch (e) {}

function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString('hex'); }
// stateless session token: survives server restarts, invalidated by password change
function tokenFor(key) {
  const u = accounts.users[key];
  return crypto.createHash('sha256').update(key + ':' + u.hash.slice(0, 16) + ':' + accounts._secret).digest('hex');
}
function validToken(key, token) {
  const u = accounts.users[key];
  return !!u && typeof token === 'string' && token === tokenFor(key);
}

// light per-IP rate limit on auth endpoints
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = ipHits.get(ip) || { n: 0, ts: now };
  if (now - h.ts > 300000) { h.n = 0; h.ts = now; }
  h.n++;
  ipHits.set(ip, h);
  return h.n > 30;
}

function handleApi(req, res, urlPath) {
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > 65536) req.destroy(); else chunks.push(c); });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) {}
    const j = obj => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    const ip = req.socket.remoteAddress || '?';
    const user = String(body.user || '').trim();
    const key = user.toLowerCase();

    if (urlPath === '/api/register') {
      if (rateLimited(ip)) return j({ ok: false, error: 'Slow down a little — try again in a few minutes.' });
      if (!/^[a-zA-Z0-9_]{3,14}$/.test(user)) return j({ ok: false, error: 'Username: 3–14 letters, numbers, or _' });
      if (String(body.pass || '').length < 4) return j({ ok: false, error: 'Password must be at least 4 characters.' });
      if (accounts.users[key]) return j({ ok: false, error: 'That name is already taken.' });
      // reserved dev usernames need the secret key — even after a realm reset
      if (isDev(key) && (!DEV_KEY || String(body.devkey || '') !== DEV_KEY))
        return j({ ok: false, error: 'reserved' });
      const salt = crypto.randomBytes(12).toString('hex');
      accounts.users[key] = { user, salt, hash: hashPass(body.pass, salt), chars: {}, created: Date.now() };
      accDirty = true;
      log(`account created: ${user}`);
      return j({ ok: true, token: tokenFor(key), user, chars: {}, dev: isDev(key) });
    }
    if (urlPath === '/api/login') {
      if (rateLimited(ip)) return j({ ok: false, error: 'Slow down a little — try again in a few minutes.' });
      const u = accounts.users[key];
      if (!u) return j({ ok: false, error: 'no_account' });
      if (hashPass(body.pass, u.salt) !== u.hash) return j({ ok: false, error: 'Wrong password.' });
      u.lastLogin = Date.now();
      accDirty = true;
      return j({ ok: true, token: tokenFor(key), user: u.user, chars: u.chars || {}, dev: isDev(key) });
    }
    if (urlPath === '/api/session') {
      const u = accounts.users[key];
      if (!u || !validToken(key, body.token)) return j({ ok: false, error: 'no_session' });
      return j({ ok: true, user: u.user, chars: u.chars || {}, dev: isDev(key) });
    }
    if (urlPath === '/api/savechar') {
      const u = accounts.users[key];
      if (!u || !validToken(key, body.token)) return j({ ok: false, error: 'no_session' });
      const slot = body.slot | 0;
      if (slot < 0 || slot > 2 || typeof body.data !== 'object') return j({ ok: false, error: 'bad_request' });
      if (JSON.stringify(body.data).length > 60000) return j({ ok: false, error: 'save_too_large' });
      u.chars[slot] = body.data;
      // keep the hero-name registry current (first claim wins, restores re-claim)
      accounts.names = accounts.names || {};
      const nk = String(body.data.name || '').toLowerCase();
      if (nk && !accounts.names[nk]) accounts.names[nk] = key;
      accDirty = true;
      return j({ ok: true });
    }
    if (urlPath === '/api/claimname') {
      const u = accounts.users[key];
      if (!u || !validToken(key, body.token)) return j({ ok: false, error: 'no_session' });
      const hn = String(body.name || '').trim();
      if (hn.length < 5 || hn.length > 14) return j({ ok: false, error: 'Hero names are 5–14 characters.' });
      const nk = hn.toLowerCase();
      accounts.names = accounts.names || {};
      if (accounts.names[nk] && accounts.names[nk] !== key)
        return j({ ok: false, error: 'That hero name is already taken.' });
      if (isDev(nk) && !isDev(key))
        return j({ ok: false, error: 'That name is reserved.' });
      accounts.names[nk] = key;
      accDirty = true;
      return j({ ok: true });
    }
    j({ ok: false, error: 'unknown_endpoint' });
  });
}

// ---------------- HTTP: static game files ----------------
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && urlPath.startsWith('/api/')) { handleApi(req, res, urlPath); return; }
  if (urlPath === '/accounts.json' || urlPath === '/leaderboard.json') { res.writeHead(403); res.end(); return; }
  let file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',   // always serve the latest build — stale JS breaks features silently
    });
    res.end(data);
  });
});

// ---------------- Leaderboard (persistent) ----------------
const BOARD_FILE = path.join(ROOT, 'leaderboard.json');
let board = {};
try { board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')); } catch (e) {}
let boardDirty = false;
setInterval(() => {
  if (!boardDirty) return;
  boardDirty = false;
  fs.writeFile(BOARD_FILE, JSON.stringify(board, null, 1), () => {});
}, 5000);
function topList() {
  return Object.values(board).sort((a, b) => b.score - a.score).slice(0, 10);
}
function broadcastBoard() {
  broadcast({ t: 'board', top: topList() });
}

// ---------------- WebSocket relay ----------------
let nextId = 1;
const clients = new Map();   // id -> {socket, name, cls, level, x, y}

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + WS_MAGIC)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const id = nextId++;
  const client = { socket, id, name: null, cls: 'warrior', level: 1, x: 0, y: 0, buf: Buffer.alloc(0), alive: true };
  clients.set(id, client);
  log(`#${id} connected (${clients.size} online)`);

  socket.on('data', chunk => {
    client.buf = Buffer.concat([client.buf, chunk]);
    let frame;
    while ((frame = readFrame(client))) {
      if (frame.opcode === 8) { socket.end(); return; }          // close
      if (frame.opcode === 9) { socket.write(encodeFrame(frame.payload, 10)); continue; } // ping -> pong
      if (frame.opcode === 10) { client.alive = true; continue; } // pong -> mark alive
      if (frame.opcode !== 1) continue;                          // text only
      let msg;
      try { msg = JSON.parse(frame.payload.toString('utf8')); } catch (e) { continue; }
      handleMessage(client, msg);
    }
  });
  const drop = () => {
    if (!clients.has(id)) return;
    clients.delete(id);
    try { socket.destroy(); } catch (e) {}
    log(`#${id} ${client.name || ''} left (${clients.size} online)`);
    if (client.name) { broadcast({ t: 'leave', id }, id); broadcastAuthority(); }
  };
  client.drop = drop;
  socket.on('close', drop);
  socket.on('error', drop);
});

// heartbeat: reap zombie connections so dead players don't linger in the roster
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { log(`#${c.id} ${c.name || ''} timed out`); c.drop(); continue; }
    c.alive = false;
    try { c.socket.write(encodeFrame(Buffer.alloc(0), 9)); } catch (e) { c.drop(); }
  }
}, 15000);

function handleMessage(client, m) {
  if (m.t === 'join') {
    let jname = String(m.name || 'Adventurer').slice(0, 14);
    client.cls = ['warrior', 'mage', 'ranger'].includes(m.cls) ? m.cls : 'warrior';
    client.level = m.level | 0;
    client.x = +m.x || 0; client.y = +m.y || 0;
    // dev status is token-verified so nobody can impersonate a dev by name
    client.dev = false;
    let authedKey = null;
    if (m.auth && m.auth.user) {
      const akey = String(m.auth.user).toLowerCase();
      if (validToken(akey, m.auth.token)) {
        authedKey = akey;
        if (isDev(akey)) client.dev = true;
      }
    }
    // impostor guard: claimed hero names and dev names belong to their owners
    accounts.names = accounts.names || {};
    const jkey = jname.toLowerCase();
    const owner = accounts.names[jkey];
    if ((owner && owner !== authedKey) || (isDev(jkey) && !client.dev)) {
      jname = (jname.slice(0, 10) + '_' + client.id).slice(0, 14);
      send(client, { t: 'renamed', name: jname });
      log(`#${client.id} tried claimed name — renamed to ${jname}`);
    }
    client.name = jname;
    // tell the newcomer who's already here and who runs the world
    send(client, {
      t: 'welcome', id: client.id, authId: authorityId(), board: topList(),
      players: [...clients.values()].filter(c => c.name && c.id !== client.id)
        .map(c => ({ id: c.id, name: c.name, cls: c.cls, level: c.level, x: c.x, y: c.y, dev: c.dev })),
    });
    broadcast({ t: 'join', id: client.id, name: client.name, cls: client.cls, level: client.level, x: client.x, y: client.y, dev: client.dev }, client.id);
    broadcastAuthority();
    log(`#${client.id} joined as ${client.name} the ${client.cls}`);
  } else if (m.t === 'state' && client.name) {
    client.x = +m.x || 0; client.y = +m.y || 0; client.level = m.level | 0;
    broadcast({ t: 'state', id: client.id, x: client.x, y: client.y, facing: m.facing === -1 ? -1 : 1, moving: !!m.moving, level: client.level, wt: m.wt | 0 }, client.id);
  } else if (m.t === 'chat' && client.name) {
    const text = String(m.text || '').slice(0, 120);
    if (text) broadcast({ t: 'chat', id: client.id, name: client.name, text, dev: client.dev }, client.id);
  } else if (m.t === 'score' && client.name) {
    const prev = board[client.name];
    const score = m.score | 0;
    if (!prev || score !== prev.score) {
      board[client.name] = { name: client.name, cls: client.cls, level: m.level | 0, score, ts: Date.now() };
      boardDirty = true;
      broadcastBoard();
    }
  } else if (RELAY_TYPES.has(m.t) && client.name) {
    // combat-sync messages: stamp the sender and relay to everyone else
    m.from = client.id;
    broadcast(m, client.id);
  }
}

const RELAY_TYPES = new Set(['pdmg', 'ekill', 'ehit', 'eproj', 'esnap', 'esummon', 'gift',
  'tradereq', 'tradeacc', 'tradedec', 'tradeoffer', 'tradeok', 'tradecancel',
  'duelreq', 'duelacc', 'dueldec', 'duelhit', 'duelyield', 'duelcancel',
  'partyinv', 'partyacc', 'partydec', 'partysync', 'partyleave']);

function authorityId() {
  let min = null;
  for (const c of clients.values()) if (c.name && (min === null || c.id < min)) min = c.id;
  return min;
}
function broadcastAuthority() {
  const id = authorityId();
  if (id !== null) broadcast({ t: 'auth', id });
}

function send(client, obj) {
  if (!client.socket.destroyed) client.socket.write(encodeFrame(Buffer.from(JSON.stringify(obj)), 1));
}
function broadcast(obj, exceptId) {
  const frame = encodeFrame(Buffer.from(JSON.stringify(obj)), 1);
  for (const c of clients.values())
    if (c.id !== exceptId && c.name && !c.socket.destroyed) c.socket.write(frame);
}

// ---------------- WS framing ----------------
function readFrame(client) {
  const buf = client.buf;
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); offset = 10;
  }
  if (len > MAX_PAYLOAD) { client.socket.destroy(); return null; }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;
  let payload = buf.slice(offset + maskLen, offset + maskLen + len);
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  client.buf = buf.slice(offset + maskLen + len);
  return { opcode, payload };
}

function encodeFrame(payload, opcode) {
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function log(s) { console.log(`[realm ${new Date().toISOString().slice(11, 19)}] ${s}`); }

server.listen(PORT, () => log(`Emberfall realm server on http://localhost:${PORT} — share this machine's address to play together`));
