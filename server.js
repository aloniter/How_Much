// CheckMate — a live "guess the dinner bill" party game.
// Zero-dependency Node server: static files + JSON API + Server-Sent Events.
// Rooms are live dinner tables; Families are the permanent Hall of Fame they report into.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { JsonStore } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // forget idle tables after a day (families are kept forever)
const FIX_WINDOW_MS = 60 * 60 * 1000;    // a mistyped bill can be corrected for an hour
const MAX_PLAYERS = 40;
const MAX_ROUNDS = 50;
const MAX_MEMBERS = 200;
const MAX_REACTIONS_PER_ROUND = 80;      // per player, keeps reaction counters sane
const REACTIONS = ['😂', '🔥', '😱', '👏', '🍅', '💸', '🤑', '🙈'];
const AVATARS = ['🍕', '🍔', '🌮', '🍣', '🥗', '🍝', '🥩', '🍤', '🧁', '🍷', '🍺', '🥂', '🦞', '🥑', '🌶️', '🍩', '🧀', '🍗', '🥐', '🍦'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion

/** @type {Map<string, any>} live dinner tables */
const rooms = new Map();
/** @type {Map<string, any>} permanent family championships */
const families = new Map();
/** @type {Map<string, Set<{res: http.ServerResponse, pid: string}>>} */
const streams = new Map();
/** @type {Map<string, Set<http.ServerResponse>>} Hall of Fame viewers */
const familyStreams = new Map();

const roomStore = new JsonStore(process.env.DATA_FILE || path.join(DATA_DIR, 'rooms.json'), () => [...rooms.values()]);
const familyStore = new JsonStore(path.join(DATA_DIR, 'families.json'), () => [...families.values()]);

function loadAll() {
  rooms.clear(); families.clear();
  for (const r of roomStore.load([])) rooms.set(r.code, r);
  for (const f of familyStore.load([])) families.set(f.code, f);
}
function flushAll() { roomStore.flush(); familyStore.flush(); }

// ---------- helpers ----------
const now = () => Date.now();
const id = () => crypto.randomBytes(8).toString('hex');
function makeCode(len, taken) {
  let code;
  do code = Array.from({ length: len }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
  while (taken.has(code));
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
const cleanAvatar = (a, fallback) => (AVATARS.includes(a) ? a : fallback ?? AVATARS[crypto.randomInt(AVATARS.length)]);
const currentRound = (room) => room.rounds[room.rounds.length - 1];
const roundId = (room, r) => `${room.dinnerId}-${r.n}`;

/** Names that are probably the same person: "dad"/"Dad ", "Danny"/"Dani", "מיכל"/"מיכל ב". */
function normName(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ךםןףץ]/g, c => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[c]))
    .replace(/[^\p{L}\p{N}]/gu, '');
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}
function similarNames(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  if (short >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return short >= 4 && lev(x, y) <= 1;
}

// ---------- rooms ----------
function newRound(room, label) {
  room.rounds.push({
    n: room.rounds.length + 1,
    label: cleanText(label, 40) || `Round ${room.rounds.length + 1}`,
    startedAt: now(),
    guesses: {},
    actual: null,
    revealedAt: null,
    reactions: {},
  });
}

/** What one player is allowed to see. Other players' guesses stay secret until reveal. */
function viewFor(room, pid) {
  const online = new Set([...(streams.get(room.code) || [])].map(s => s.pid));
  const fam = room.familyCode ? families.get(room.familyCode) : null;
  return {
    code: room.code,
    title: room.title,
    currency: room.currency,
    mode: room.mode,
    hostId: room.hostId,
    dinnerId: room.dinnerId,
    familyCode: fam ? fam.code : null,
    familyName: fam ? fam.name : null,
    familyRev: fam ? fam.rev : 0,
    you: pid,
    serverNow: now(),
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, joinedAt: p.joinedAt, online: online.has(p.id),
      memberId: p.memberId || null, guest: !!p.guest,
    })),
    rounds: room.rounds.map(r => {
      const revealed = r.actual != null;
      const guesses = {};
      for (const [gpid, g] of Object.entries(r.guesses)) {
        guesses[gpid] = (revealed || gpid === pid)
          ? g
          : { at: g.at, firstAt: g.firstAt, hidden: true }; // reveal *that* they guessed, not the amount
      }
      return {
        id: roundId(room, r), n: r.n, label: r.label, startedAt: r.startedAt, actual: r.actual,
        revealedAt: r.revealedAt, revealedBy: r.revealedBy, fixedAt: r.fixedAt || null,
        reactions: revealed ? (r.reactions || {}) : {}, guesses,
      };
    }),
  };
}

function broadcast(room) {
  room.updatedAt = now();
  roomStore.save();
  for (const s of streams.get(room.code) || []) sendEvent(s.res, 'state', viewFor(room, s.pid));
}
function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------- families ----------
function publicFamily(f) {
  return { code: f.code, name: f.name, createdAt: f.createdAt, rev: f.rev, members: f.members, dinners: f.dinners };
}
function touchFamily(f) {
  f.rev = (f.rev || 0) + 1;
  f.updatedAt = now();
  familyStore.save();
  for (const res of familyStreams.get(f.code) || []) sendEvent(res, 'family', { rev: f.rev });
  // tables playing for this family learn the new revision too (their Hall of Fame teaser refreshes)
  for (const room of rooms.values()) if (room.familyCode === f.code && streams.get(room.code)?.size) broadcast(room);
}
function addMember(f, name, avatar) {
  const m = { id: id(), name, avatar: cleanAvatar(avatar), createdAt: now() };
  f.members[m.id] = m;
  return m;
}
const memberList = (f) => Object.values(f.members).map(m => ({ id: m.id, name: m.name, avatar: m.avatar }));

/**
 * Copy a revealed round into the family's permanent history. The record id is derived from
 * the table + round number, so recording the same round again only overwrites it (never duplicates).
 */
function recordRound(room, r) {
  const f = room.familyCode && families.get(room.familyCode);
  if (!f || r.actual == null) return;
  const dinner = f.dinners[room.dinnerId] ??= {
    id: room.dinnerId, tableCode: room.code, createdAt: room.createdAt, rounds: {},
  };
  Object.assign(dinner, { title: room.title, currency: room.currency, mode: room.mode });
  const guesses = {};
  for (const [pid, g] of Object.entries(r.guesses)) {
    const p = room.players[pid];
    if (!p) continue;
    const key = p.memberId || `guest:${normName(p.name) || pid}`;
    guesses[key] = {
      memberId: p.memberId || null, guest: !p.memberId, name: p.name, avatar: p.avatar,
      amount: g.amount, firstAmount: g.firstAmount ?? g.amount, at: g.at, firstAt: g.firstAt ?? g.at,
      changes: g.changes || 0, quote: g.quote || '',
    };
  }
  dinner.rounds[roundId(room, r)] = {
    id: roundId(room, r), n: r.n, label: r.label, actual: r.actual,
    startedAt: r.startedAt, revealedAt: r.revealedAt, fixedAt: r.fixedAt || null, guesses,
  };
  touchFamily(f);
}

/** Merge an exported family into this server (used to restore a backup). Idempotent. */
function importFamily(data) {
  const src = data && (data.family || data);
  if (!src || typeof src !== 'object' || typeof src.members !== 'object' || typeof src.dinners !== 'object') throw new Error('Not a CheckMate family backup');
  const code = /^[A-Z]{6}$/.test(src.code) ? src.code : makeCode(6, families);
  const f = families.get(code) || { code, name: cleanText(src.name, 40) || 'Family', createdAt: src.createdAt || now(), rev: 0, members: {}, dinners: {} };
  for (const m of Object.values(src.members)) {
    if (!m || typeof m.id !== 'string') continue;
    f.members[m.id] = { id: m.id.slice(0, 40), name: cleanText(m.name, 24) || '?', avatar: cleanAvatar(m.avatar, '🍽️'), createdAt: m.createdAt || now() };
  }
  for (const d of Object.values(src.dinners)) {
    if (!d || typeof d.id !== 'string' || typeof d.rounds !== 'object') continue;
    const dinner = f.dinners[d.id] ??= { id: d.id, tableCode: cleanText(d.tableCode, 8), createdAt: d.createdAt || now(), rounds: {} };
    Object.assign(dinner, { title: cleanText(d.title, 40), currency: cleanText(d.currency, 4) || '$', mode: d.mode === 'nover' ? 'nover' : 'classic' });
    for (const r of Object.values(d.rounds)) {
      if (!r || typeof r.id !== 'string' || !(cleanAmount(r.actual) > 0)) continue;
      const guesses = {};
      for (const [k, g] of Object.entries(r.guesses || {})) {
        const amount = cleanAmount(g && g.amount);
        if (amount == null) continue;
        guesses[cleanText(k, 64)] = {
          memberId: g.memberId && f.members[g.memberId] ? g.memberId : null, guest: !(g.memberId && f.members[g.memberId]),
          name: cleanText(g.name, 24), avatar: cleanAvatar(g.avatar, '🍽️'), amount, firstAmount: cleanAmount(g.firstAmount) ?? amount,
          at: Number(g.at) || 0, firstAt: Number(g.firstAt ?? g.at) || 0, changes: Math.max(0, Number(g.changes) || 0), quote: cleanText(g.quote, 60),
        };
      }
      dinner.rounds[r.id] = {
        id: r.id, n: Number(r.n) || 1, label: cleanText(r.label, 40), actual: cleanAmount(r.actual),
        startedAt: Number(r.startedAt) || 0, revealedAt: Number(r.revealedAt) || 0, fixedAt: r.fixedAt || null, guesses,
      };
    }
  }
  families.set(code, f);
  touchFamily(f);
  return f;
}

// ---------- HTTP plumbing ----------
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const fail = (res, status, code, error) => json(res, status, { error, code });
function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
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
function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => clearInterval(ping));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel.startsWith('/r/') || rel.startsWith('/f/')) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(rel)) return serveStatic(req, res, '/'); // deep links land on the app shell
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

// ---------- family API ----------
async function familyApi(req, res, parts, url) {
  // POST /api/families → create a family (the creator becomes its first member)
  if (req.method === 'POST' && parts.length === 1) {
    const body = await readBody(req);
    const name = cleanText(body.name, 40);
    const memberName = cleanText(body.member?.name, 24);
    if (!name || !memberName) return fail(res, 400, 'nameRequired', 'Please enter a name');
    const f = { code: makeCode(6, families), name, createdAt: now(), rev: 0, members: {}, dinners: {} };
    const m = addMember(f, memberName, body.member?.avatar);
    families.set(f.code, f);
    touchFamily(f);
    return json(res, 200, { code: f.code, memberId: m.id, family: publicFamily(f) });
  }
  // POST /api/families/import → restore a downloaded backup
  if (req.method === 'POST' && parts[1] === 'import') {
    const body = await readBody(req, 5_000_000);
    try {
      const f = importFamily(body);
      return json(res, 200, { code: f.code, family: publicFamily(f) });
    } catch (e) { return fail(res, 400, 'badBackup', e.message); }
  }

  const code = String(parts[1] || '').toUpperCase();
  const f = families.get(code);
  if (!f) return fail(res, 404, 'familyNotFound', 'No family with that code');
  const action = parts[2];

  if (req.method === 'GET' && !action) return json(res, 200, publicFamily(f));
  if (req.method === 'GET' && action === 'events') {
    openStream(req, res);
    if (!familyStreams.has(code)) familyStreams.set(code, new Set());
    familyStreams.get(code).add(res);
    sendEvent(res, 'family', { rev: f.rev });
    req.on('close', () => familyStreams.get(code)?.delete(res));
    return;
  }
  if (req.method === 'GET' && action === 'export') {
    const fileName = `checkmate-${f.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'family'}-${new Date().toISOString().slice(0, 10)}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ format: 'checkmate-family', version: 1, exportedAt: now(), family: publicFamily(f) }, null, 1));
  }
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Method not allowed');
  const body = await readBody(req);

  switch (action) {
    case undefined: { // rename the family
      const name = cleanText(body.name, 40);
      if (name) f.name = name;
      touchFamily(f);
      return json(res, 200, { ok: true });
    }
    case 'members': {
      const memberId = parts[3];
      if (memberId) { // update an existing member
        const m = f.members[memberId];
        if (!m) return fail(res, 404, 'memberNotFound', 'No such family member');
        const name = cleanText(body.name, 24);
        if (name) m.name = name;
        if (AVATARS.includes(body.avatar)) m.avatar = body.avatar;
        for (const room of rooms.values()) {
          for (const p of Object.values(room.players)) if (p.memberId === m.id) { p.name = m.name; p.avatar = m.avatar; }
        }
        touchFamily(f);
        return json(res, 200, { ok: true });
      }
      const name = cleanText(body.name, 24);
      if (!name) return fail(res, 400, 'nameRequired', 'Please enter your name');
      if (Object.keys(f.members).length >= MAX_MEMBERS) return fail(res, 400, 'full', 'This family is full!');
      const matches = Object.values(f.members).filter(m => similarNames(m.name, name));
      if (matches.length && !body.force) return json(res, 409, { code: 'similarName', error: 'Is this you?', matches: matches.map(m => ({ id: m.id, name: m.name, avatar: m.avatar })) });
      const m = addMember(f, name, body.avatar);
      touchFamily(f);
      return json(res, 200, { memberId: m.id });
    }
    case 'merge': { // fold a duplicate identity into the real one
      const from = f.members[body.from], into = f.members[body.into];
      if (!from || !into || from === into) return fail(res, 400, 'badMerge', 'Pick two different members');
      for (const d of Object.values(f.dinners)) {
        for (const r of Object.values(d.rounds)) {
          const g = r.guesses[from.id];
          if (!g) continue;
          delete r.guesses[from.id];
          if (!r.guesses[into.id]) r.guesses[into.id] = { ...g, memberId: into.id, name: into.name, avatar: into.avatar };
        }
      }
      for (const room of rooms.values()) {
        if (room.familyCode !== f.code) continue;
        for (const p of Object.values(room.players)) if (p.memberId === from.id) { p.memberId = into.id; p.name = into.name; p.avatar = into.avatar; }
      }
      delete f.members[from.id];
      touchFamily(f);
      return json(res, 200, { ok: true });
    }
    case 'dinners': { // POST /api/families/:code/dinners/:id/delete
      const dinner = f.dinners[parts[3]];
      if (!dinner || parts[4] !== 'delete') return fail(res, 404, 'notFound', 'No such dinner');
      delete f.dinners[dinner.id];
      touchFamily(f);
      return json(res, 200, { ok: true });
    }
    default:
      return fail(res, 404, 'unknown', 'Unknown action');
  }
}

// ---------- room API ----------
async function roomApi(req, res, parts, url) {
  // POST /api/rooms → create a table (optionally playing for a family)
  if (req.method === 'POST' && parts.length === 1) {
    const body = await readBody(req);
    const fam = body.familyCode ? families.get(String(body.familyCode).toUpperCase()) : null;
    let member = fam ? fam.members[body.memberId] : null;
    const name = cleanText(member ? member.name : body.name, 24);
    if (!name) return fail(res, 400, 'nameRequired', 'Please enter your name');
    if (fam && !member) { member = addMember(fam, name, body.avatar); touchFamily(fam); }
    const code = makeCode(4, rooms);
    const pid = id();
    const token = id();
    const createdAt = now();
    const room = {
      code,
      dinnerId: `${code}-${createdAt.toString(36)}`,
      familyCode: fam ? fam.code : null,
      title: cleanText(body.title, 40) || 'Family dinner',
      currency: cleanText(body.currency, 4) || '$',
      mode: body.mode === 'nover' ? 'nover' : 'classic',
      hostId: pid,
      createdAt, updatedAt: createdAt,
      players: { [pid]: { id: pid, token, name, avatar: member ? member.avatar : cleanAvatar(body.avatar, AVATARS[0]), joinedAt: now(), memberId: member?.id } },
      rounds: [],
    };
    newRound(room, body.roundLabel || 'Dinner');
    rooms.set(code, room);
    roomStore.save();
    return json(res, 200, { code, pid, token, memberId: member?.id || null });
  }

  const code = String(parts[1] || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return fail(res, 404, 'notFound', 'No dinner table with that code 🤔');
  const action = parts[2];
  const fam = room.familyCode ? families.get(room.familyCode) : null;

  // GET /api/rooms/:code → public peek (for the join screen)
  if (req.method === 'GET' && !action) {
    const seated = Object.values(room.players);
    return json(res, 200, {
      code: room.code, title: room.title, currency: room.currency,
      players: seated.map(p => ({ name: p.name, avatar: p.avatar, memberId: p.memberId || null })),
      takenAvatars: seated.map(p => p.avatar),
      family: fam ? { code: fam.code, name: fam.name, members: memberList(fam) } : null,
    });
  }

  // GET /api/rooms/:code/events?pid&token → live stream
  if (req.method === 'GET' && action === 'events') {
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    if (!auth(room, { pid, token })) return fail(res, 403, 'notInRoom', 'Not in this room');
    openStream(req, res);
    const entry = { res, pid };
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(entry);
    broadcast(room); // everyone sees the new person come online
    req.on('close', () => {
      streams.get(code)?.delete(entry);
      if (rooms.has(code)) broadcast(room);
    });
    return;
  }

  if (req.method !== 'POST') return fail(res, 405, 'method', 'Method not allowed');
  const body = await readBody(req);

  if (action === 'join') return joinRoom(res, room, fam, body);

  const player = auth(room, body);
  if (!player) return fail(res, 403, 'notInRoom', 'Not in this room');
  const round = currentRound(room);
  const isHost = room.hostId === player.id;

  switch (action) {
    case 'guess': {
      if (round.actual != null) return fail(res, 400, 'tooLate', 'Too late — the bill was already revealed!');
      const amount = cleanAmount(body.amount);
      if (amount == null) return fail(res, 400, 'notPrice', 'That is not a price 😅');
      const prev = round.guesses[player.id];
      round.guesses[player.id] = {
        amount,
        firstAmount: prev?.firstAmount ?? prev?.amount ?? amount,
        at: now(),
        firstAt: prev?.firstAt ?? now(),
        changes: prev ? (prev.changes || 0) + (prev.amount !== amount ? 1 : 0) : 0,
        quote: cleanText(body.quote, 60),
      };
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'reveal': {
      if (round.actual != null) return fail(res, 400, 'alreadyRevealed', 'Already revealed');
      const actual = cleanAmount(body.actual);
      if (actual == null) return fail(res, 400, 'enterActual', 'Enter the real total from the receipt');
      if (!Object.keys(round.guesses).length) return fail(res, 400, 'nobodyGuessed', 'Nobody has guessed yet!');
      round.actual = actual;
      round.revealedAt = now();
      round.revealedBy = player.id;
      recordRound(room, round);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'fix': { // correct a mistyped bill: updates the same history record, never adds a second one
      if (round.actual == null) return fail(res, 400, 'finishRound', 'Finish this round first');
      if (!isHost && round.revealedBy !== player.id) return fail(res, 403, 'hostOnly', 'Only the host can do that');
      if (now() - round.revealedAt > FIX_WINDOW_MS) return fail(res, 400, 'tooLateFix', 'Too late to change this bill');
      const actual = cleanAmount(body.actual);
      if (actual == null) return fail(res, 400, 'enterActual', 'Enter the real total from the receipt');
      round.actual = actual;
      round.fixedAt = now();
      recordRound(room, round);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'next': {
      if (round.actual == null) return fail(res, 400, 'finishRound', 'Finish this round first');
      if (room.rounds.length >= MAX_ROUNDS) return fail(res, 400, 'tooManyRounds', 'That is a lot of dinners. Start a new table!');
      newRound(room, body.label);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'react': {
      const emoji = REACTIONS.includes(body.emoji) ? body.emoji : null;
      if (!emoji) return fail(res, 400, 'unknown', 'Unknown reaction');
      let counts = null;
      const target = body.target && room.players[body.target] ? body.target : null;
      if (target && round.actual != null) { // a reaction to someone's roast card is counted
        round.reactCount ??= {};
        if ((round.reactCount[player.id] || 0) < MAX_REACTIONS_PER_ROUND) {
          round.reactCount[player.id] = (round.reactCount[player.id] || 0) + 1;
          round.reactions ??= {};
          const c = round.reactions[target] ??= {};
          c[emoji] = Math.min(999, (c[emoji] || 0) + 1);
          roomStore.save();
        }
        counts = round.reactions[target];
      }
      for (const s of streams.get(code) || []) sendEvent(s.res, 'react', { emoji, from: player.id, name: player.name, target, round: round.n, counts });
      return json(res, 200, { ok: true });
    }
    case 'profile': {
      const name = cleanText(body.name, 24);
      if (name) player.name = name;
      if (AVATARS.includes(body.avatar)) player.avatar = body.avatar;
      const m = fam && player.memberId && fam.members[player.memberId];
      if (m) { m.name = player.name; m.avatar = player.avatar; touchFamily(fam); }
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'settings': {
      if (!isHost) return fail(res, 403, 'hostOnly', 'Only the host can change settings');
      if (body.title != null) room.title = cleanText(body.title, 40) || room.title;
      if (body.currency != null) room.currency = cleanText(body.currency, 4) || room.currency;
      if (body.mode === 'classic' || body.mode === 'nover') room.mode = body.mode;
      if (body.roundLabel != null && round.actual == null) round.label = cleanText(body.roundLabel, 40) || round.label;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    case 'kick': {
      if (!isHost) return fail(res, 403, 'hostOnly', 'Only the host can remove players');
      const target = room.players[body.target];
      if (!target || target.id === room.hostId) return fail(res, 400, 'cannotRemove', 'Cannot remove that player');
      delete room.players[target.id];
      for (const r of room.rounds) if (r.actual == null) delete r.guesses[target.id]; // history stays intact
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    default:
      return fail(res, 404, 'unknown', 'Unknown action');
  }
}

function seatPlayer(room, fields) {
  const pid = id();
  const token = id();
  room.players[pid] = { id: pid, token, joinedAt: now(), ...fields };
  broadcast(room);
  return { pid, token };
}

/**
 * Joining a table. Family tables let you tap who you are (no typing → no duplicate identities);
 * new names are checked against the family for look-alikes; guests can play without being recorded.
 */
function joinRoom(res, room, fam, body) {
  if (Object.keys(room.players).length >= MAX_PLAYERS) return fail(res, 400, 'full', 'This table is full!');
  const seated = Object.values(room.players);

  if (fam && body.memberId) {
    const m = fam.members[body.memberId];
    if (!m) return fail(res, 404, 'memberNotFound', 'No such family member');
    const existing = seated.find(p => p.memberId === m.id);
    if (existing) return json(res, 200, { code: room.code, pid: existing.id, token: existing.token, memberId: m.id, rejoined: true });
    const seat = seatPlayer(room, { name: m.name, avatar: m.avatar, memberId: m.id });
    return json(res, 200, { code: room.code, ...seat, memberId: m.id });
  }

  const name = cleanText(body.name, 24);
  if (!name) return fail(res, 400, 'nameRequired', 'Please enter your name');

  if (fam && !body.guest) { // a new family member
    const matches = Object.values(fam.members).filter(m => similarNames(m.name, name));
    if (matches.length && !body.force) return json(res, 409, { code: 'similarName', error: 'Is this you?', matches: matches.map(m => ({ id: m.id, name: m.name, avatar: m.avatar })) });
    if (Object.keys(fam.members).length >= MAX_MEMBERS) return fail(res, 400, 'full', 'This family is full!');
    const m = addMember(fam, name, body.avatar);
    touchFamily(fam);
    const seat = seatPlayer(room, { name: m.name, avatar: m.avatar, memberId: m.id });
    return json(res, 200, { code: room.code, ...seat, memberId: m.id });
  }

  // Plain table, or a guest at a family table. Same name again (new phone)? Take the seat back.
  const existing = seated.find(p => !p.memberId && p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (AVATARS.includes(body.avatar)) existing.avatar = body.avatar;
    broadcast(room);
    return json(res, 200, { code: room.code, pid: existing.id, token: existing.token, rejoined: true });
  }
  if (fam && !body.force) { // a "guest" who is really a family member? Ask first.
    const matches = Object.values(fam.members).filter(m => similarNames(m.name, name));
    if (matches.length) return json(res, 409, { code: 'similarName', error: 'Is this you?', matches: matches.map(m => ({ id: m.id, name: m.name, avatar: m.avatar })) });
  }
  const seat = seatPlayer(room, { name, avatar: cleanAvatar(body.avatar), guest: !!fam });
  return json(res, 200, { code: room.code, ...seat });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size, families: families.size });
    if (parts[0] === 'api' && parts[1] === 'rooms') return await roomApi(req, res, parts.slice(1), url);
    if (parts[0] === 'api' && parts[1] === 'families') return await familyApi(req, res, parts.slice(1), url);
    if (parts[0] === 'api') return fail(res, 404, 'notFound', 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) fail(res, 400, 'bad', e.message || 'Bad request');
  }
});

// Clean up old tables every hour (family history is never cleaned up).
setInterval(() => {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if ((room.updatedAt || room.createdAt) < cutoff && !(streams.get(code)?.size)) { rooms.delete(code); roomStore.save(); }
  }
}, 60 * 60 * 1000).unref();

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

if (require.main === module) {
  loadAll();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { flushAll(); process.exit(0); }); // redeploys send SIGTERM: save first
  }
  process.on('exit', flushAll);
  server.listen(PORT, HOST, () => {
    console.log(`\n♛  CheckMate is running  (data: ${DATA_DIR})`);
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`   Network: http://${ip}:${PORT}   ← open this on everyone's phone (same Wi-Fi)`);
    console.log('');
  });
}

module.exports = { server, rooms, families, loadAll, flushAll, similarNames };
