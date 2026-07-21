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

// ---------------- HTTP: static game files ----------------
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
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
    client.name = String(m.name || 'Adventurer').slice(0, 14);
    client.cls = ['warrior', 'mage', 'ranger'].includes(m.cls) ? m.cls : 'warrior';
    client.level = m.level | 0;
    client.x = +m.x || 0; client.y = +m.y || 0;
    // tell the newcomer who's already here and who runs the world
    send(client, {
      t: 'welcome', id: client.id, authId: authorityId(), board: topList(),
      players: [...clients.values()].filter(c => c.name && c.id !== client.id)
        .map(c => ({ id: c.id, name: c.name, cls: c.cls, level: c.level, x: c.x, y: c.y })),
    });
    broadcast({ t: 'join', id: client.id, name: client.name, cls: client.cls, level: client.level, x: client.x, y: client.y }, client.id);
    broadcastAuthority();
    log(`#${client.id} joined as ${client.name} the ${client.cls}`);
  } else if (m.t === 'state' && client.name) {
    client.x = +m.x || 0; client.y = +m.y || 0; client.level = m.level | 0;
    broadcast({ t: 'state', id: client.id, x: client.x, y: client.y, facing: m.facing === -1 ? -1 : 1, moving: !!m.moving, level: client.level, wt: m.wt | 0 }, client.id);
  } else if (m.t === 'chat' && client.name) {
    const text = String(m.text || '').slice(0, 120);
    if (text) broadcast({ t: 'chat', id: client.id, name: client.name, text }, client.id);
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
  'tradereq', 'tradeacc', 'tradedec', 'tradeoffer', 'tradeok', 'tradecancel']);

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
