// CheckMate — a live "guess the dinner bill" party game.
// Zero-dependency Node server: static files + JSON API + Server-Sent Events.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // forget rooms idle for a day
const MAX_PLAYERS = 40;
const MAX_ROUNDS = 50;
const REACTIONS = ['😂', '🔥', '😱', '👏', '🍅', '💸', '🤑', '🙈'];
const AVATARS = ['🍕', '🍔', '🌮', '🍣', '🥗', '🍝', '🥩', '🍤', '🧁', '🍷', '🍺', '🥂', '🦞', '🥑', '🌶️', '🍩', '🧀', '🍗', '🥐', '🍦'];

/** @type {Map<string, any>} */
const rooms = new Map();
/** @type {Map<string, Set<{res: http.ServerResponse, pid: string}>>} */
const streams = new Map();

// ---------- persistence (best effort, survives restarts) ----------
function loadRooms() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const r of raw) rooms.set(r.code, r);
  } catch { /* first run or unreadable — start fresh */ }
}
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([...rooms.values()]));
    } catch (e) { console.warn('Could not save rooms:', e.message); }
  }, 500);
}

// ---------- helpers ----------
const now = () => Date.now();
const id = () => crypto.randomBytes(8).toString('hex');
function roomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function cleanAmount(v) {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1e8) return null;
  return Math.round(n * 100) / 100;
}
function currentRound(room) { return room.rounds[room.rounds.length - 1]; }

function newRound(room, label) {
  room.rounds.push({
    n: room.rounds.length + 1,
    label: cleanText(label, 40) || `Round ${room.rounds.length + 1}`,
    startedAt: now(),
    guesses: {},
    actual: null,
    revealedAt: null,
  });
}

/** What one player is allowed to see. Other players' guesses stay secret until reveal. */
function viewFor(room, pid) {
  const online = new Set([...(streams.get(room.code) || [])].map(s => s.pid));
  return {
    code: room.code,
    title: room.title,
    currency: room.currency,
    mode: room.mode,
    hostId: room.hostId,
    you: pid,
    serverNow: now(),
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, joinedAt: p.joinedAt, online: online.has(p.id),
    })),
    rounds: room.rounds.map(r => {
      const revealed = r.actual != null;
      const guesses = {};
      for (const [gpid, g] of Object.entries(r.guesses)) {
        guesses[gpid] = (revealed || gpid === pid)
          ? g
          : { at: g.at, hidden: true }; // reveal *that* they guessed, not the amount
      }
      return { n: r.n, label: r.label, startedAt: r.startedAt, actual: r.actual, revealedAt: r.revealedAt, revealedBy: r.revealedBy, guesses };
    }),
  };
}

function broadcast(room) {
  room.updatedAt = now();
  scheduleSave();
  for (const s of streams.get(room.code) || []) {
    sendEvent(s.res, 'state', viewFor(room, s.pid));
  }
}
function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------- HTTP plumbing ----------
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 10_000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function auth(room, body) {
  const p = room.players[body.pid];
  if (!p || p.token !== body.token) return null;
  return p;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel.startsWith('/r/')) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // unknown paths fall back to the app shell so deep links keep working
      if (!path.extname(rel)) return serveStatic(req, res, '/');
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

// ---------- API ----------
async function api(req, res, parts, url) {
  // POST /api/rooms  → create
  if (req.method === 'POST' && parts.length === 1) {
    const body = await readBody(req);
    const name = cleanText(body.name, 24);
    if (!name) return json(res, 400, { error: 'Please enter your name', code: 'nameRequired' });
    const code = roomCode();
    const pid = id();
    const token = id();
    const room = {
      code,
      title: cleanText(body.title, 40) || 'Family dinner',
      currency: cleanText(body.currency, 4) || '$',
      mode: body.mode === 'nover' ? 'nover' : 'classic',
      hostId: pid,
      createdAt: now(), updatedAt: now(),
      players: { [pid]: { id: pid, token, name, avatar: AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0], joinedAt: now() } },
      rounds: [],
    };
    newRound(room, body.roundLabel || 'Dinner');
    rooms.set(code, room);
    scheduleSave();
    return json(res, 200, { code, pid, token });
  }

  const code = String(parts[1] || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return json(res, 404, { error: 'No dinner table with that code 🤔', code: 'notFound' });
  const action = parts[2];

  // GET /api/rooms/:code → public peek (for the join screen)
  if (req.method === 'GET' && !action) {
    return json(res, 200, {
      code: room.code, title: room.title, currency: room.currency,
      players: Object.values(room.players).map(p => ({ name: p.name, avatar: p.avatar })),
      takenAvatars: Object.values(room.players).map(p => p.avatar),
    });
  }

  // GET /api/rooms/:code/events?pid&token → live stream
  if (req.method === 'GET' && action === 'events') {
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    if (!auth(room, { pid, token })) return json(res, 403, { error: 'Not in this room', code: 'notInRoom' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const entry = { res, pid };
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(entry);
    broadcast(room); // everyone sees the new person come online
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.get(code)?.delete(entry);
      if (rooms.has(code)) broadcast(room);
    });
    return;
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const body = await readBody(req);

  if (action === 'join') {
    const name = cleanText(body.name, 24);
    if (!name) return json(res, 400, { error: 'Please enter your name', code: 'nameRequired' });
    if (Object.keys(room.players).length >= MAX_PLAYERS) return json(res, 400, { error: 'This table is full!', code: 'full' });
    // Same name again (e.g. new phone / cleared browser)? Let them take the seat back.
    const existing = Object.values(room.players).find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (AVATARS.includes(body.avatar)) existing.avatar = body.avatar;
      broadcast(room);
      return json(res, 200, { code, pid: existing.id, token: existing.token, rejoined: true });
    }
    const pid = id();
    const token = id();
    room.players[pid] = { id: pid, token, name, avatar: AVATARS.includes(body.avatar) ? body.avatar : AVATARS[crypto.randomInt(AVATARS.length)], joinedAt: now() };
    broadcast(room);
    return json(res, 200, { code, pid, token });
  }

  const player = auth(room, body);
  if (!player) return json(res, 403, { error: 'Not in this room', code: 'notInRoom' });
  const round = currentRound(room);
  const isHost = room.hostId === player.id;

  switch (action) {
    case 'guess': {
      if (round.actual != null) return json(res, 400, { error: 'Too late — the bill was already revealed!', code: 'tooLate' });
      const amount = cleanAmount(body.amount);
      if (amount == null) return json(res, 400, { error: 'That is not a price 😅', code: 'notPrice' });
      const prev = round.guesses[player.id];
      round.guesses[player.id] = {
        amount,
        at: now(),
        firstAt: prev?.firstAt ?? now(),
        changes: prev ? (prev.changes || 0) + 1 : 0,
        quote: cleanText(body.quote, 60),
      };
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'reveal': {
      if (round.actual != null) return json(res, 400, { error: 'Already revealed', code: 'alreadyRevealed' });
      const actual = cleanAmount(body.actual);
      if (actual == null) return json(res, 400, { error: 'Enter the real total from the receipt', code: 'enterActual' });
      if (!Object.keys(round.guesses).length) return json(res, 400, { error: 'Nobody has guessed yet!', code: 'nobodyGuessed' });
      round.actual = actual;
      round.revealedAt = now();
      round.revealedBy = player.id;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'next': {
      if (round.actual == null) return json(res, 400, { error: 'Finish this round first', code: 'finishRound' });
      if (room.rounds.length >= MAX_ROUNDS) return json(res, 400, { error: 'That is a lot of dinners. Start a new table!', code: 'tooManyRounds' });
      newRound(room, body.label);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'react': {
      const emoji = REACTIONS.includes(body.emoji) ? body.emoji : null;
      if (!emoji) return json(res, 400, { error: 'Unknown reaction' });
      for (const s of streams.get(code) || []) sendEvent(s.res, 'react', { emoji, from: player.id, name: player.name });
      return json(res, 200, { ok: true });
    }
    case 'profile': {
      const name = cleanText(body.name, 24);
      if (name) player.name = name;
      if (AVATARS.includes(body.avatar)) player.avatar = body.avatar;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'settings': {
      if (!isHost) return json(res, 403, { error: 'Only the host can change settings', code: 'hostOnly' });
      if (body.title != null) room.title = cleanText(body.title, 40) || room.title;
      if (body.currency != null) room.currency = cleanText(body.currency, 4) || room.currency;
      if (body.mode === 'classic' || body.mode === 'nover') room.mode = body.mode;
      if (body.roundLabel != null && round.actual == null) round.label = cleanText(body.roundLabel, 40) || round.label;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'kick': {
      if (!isHost) return json(res, 403, { error: 'Only the host can remove players', code: 'hostOnly' });
      const target = room.players[body.target];
      if (!target || target.id === room.hostId) return json(res, 400, { error: 'Cannot remove that player', code: 'cannotRemove' });
      delete room.players[target.id];
      for (const r of room.rounds) delete r.guesses[target.id];
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    default:
      return json(res, 404, { error: 'Unknown action' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
    if (parts[0] === 'api' && parts[1] === 'rooms') return await api(req, res, parts.slice(1), url);
    if (parts[0] === 'api') return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message || 'Bad request' });
  }
});

// Clean up old rooms every hour.
setInterval(() => {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if ((room.updatedAt || room.createdAt) < cutoff && !(streams.get(code)?.size)) rooms.delete(code);
  }
  scheduleSave();
}, 60 * 60 * 1000).unref();

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

if (require.main === module) {
  loadRooms();
  server.listen(PORT, HOST, () => {
    console.log(`\n♛  CheckMate is running`);
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`   Network: http://${ip}:${PORT}   ← open this on everyone's phone (same Wi-Fi)`);
    console.log('');
  });
}

module.exports = { server, rooms };
