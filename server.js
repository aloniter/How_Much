// CheckMate — a live "guess the dinner bill" party game.
// Zero-dependency Node server: static files + JSON API + Server-Sent Events.
// Rooms are live dinner tables; Families are the permanent Hall of Fame they report into.
//
// Runs two ways with the same code:
//   • `node server.js`          — a long-running server (local, Docker, any VM), file storage by default
//   • `api/index.js` on Vercel  — serverless functions; state lives in Supabase (see lib/db.js)
// Live updates are SSE streams that poll storage, so they work across serverless instances; streams
// end after STREAM_MS and browsers reconnect automatically (EventSource retry + Last-Event-ID).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { createDB } = require('./lib/db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const db = createDB();
const SERVERLESS = !!process.env.VERCEL;
const POLL_MS = Number(process.env.POLL_MS) || (db.kind === 'supabase' ? 800 : 200);
const STREAM_MS = Number(process.env.STREAM_MS) || (SERVERLESS ? 45_000 : 10 * 60_000);
const ONLINE_MS = 25_000;                 // a phone counts as "at the table" if it checked in this recently
const ROOM_TTL_MS = 2 * 24 * 60 * 60 * 1000; // idle tables are forgotten after two days (families: never)
const FIX_WINDOW_MS = 60 * 60 * 1000;    // a mistyped bill can be corrected for an hour
const MAX_PLAYERS = 40;
const MAX_ROUNDS = 50;
const MAX_MEMBERS = 200;
const MAX_REACTIONS_PER_ROUND = 80;
const RATE_LIMIT = process.env.RATE_LIMIT !== '0';
const REACTIONS = ['😂', '🔥', '😱', '👏', '🍅', '💸', '🤑', '🙈'];
const AVATARS = ['🍕', '🍔', '🌮', '🍣', '🥗', '🍝', '🥩', '🍤', '🧁', '🍷', '🍺', '🥂', '🦞', '🥑', '🌶️', '🍩', '🧀', '🍗', '🥐', '🍦'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O to avoid confusion

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const id = () => crypto.randomBytes(8).toString('hex');
const secret = () => crypto.randomBytes(16).toString('hex'); // 128-bit tokens and keys
const makeCode = (len) => Array.from({ length: len }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
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
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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

// ---------- responses ----------
const ok = (body = { ok: true }) => ({ status: 200, body });
const err = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const BUSY = err(503, 'busy', 'Busy, please try again');

/**
 * Read–modify–write a room with optimistic concurrency. `fn(data, row)` mutates `data` and returns
 * a response; set `write: true` on it to save. Conflicting writers simply retry on fresh data.
 */
async function withRoom(code, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.getRoom(code);
    if (!row) return err(404, 'notFound', 'No dinner table with that code 🤔');
    const data = structuredClone(row.data);
    const out = await fn(data, row);
    if (!out.write) return out;
    data.updatedAt = now();
    if (await db.saveRoom(code, data, row.version)) { out.room = data; return out; }
    await sleep(15 + Math.random() * 60 * (attempt + 1));
  }
  return BUSY;
}
async function withFamily(code, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.getFamily(code);
    if (!row) return err(404, 'familyNotFound', 'No family with that code');
    const data = structuredClone(row.data);
    const out = await fn(data, row);
    if (!out.write) return out;
    data.rev = (data.rev || 0) + 1;
    data.updatedAt = now();
    if (await db.saveFamily(code, data, row.version)) { out.family = data; return out; }
    await sleep(15 + Math.random() * 60 * (attempt + 1));
  }
  return BUSY;
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
const isOnline = (row, pid) => now() - (row.presence?.[pid] || 0) < ONLINE_MS;

/** What one player is allowed to see. Other players' guesses stay secret until reveal. */
function viewFor(row, pid) {
  const room = row.data;
  return {
    code: room.code,
    title: room.title,
    currency: room.currency,
    mode: room.mode,
    hostId: room.hostId,
    dinnerId: room.dinnerId,
    familyCode: room.familyCode || null,
    familyName: room.familyCode ? room.familyName : null,
    familyRev: room.familyRev || 0,
    you: pid,
    serverNow: now(),
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, joinedAt: p.joinedAt, online: isOnline(row, p.id),
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

// ---------- families ----------
function publicFamily(f) { // never includes the family key
  return { code: f.code, name: f.name, createdAt: f.createdAt, rev: f.rev, members: f.members, dinners: f.dinners };
}
function addMember(f, name, avatar) {
  const m = { id: id(), name, avatar: cleanAvatar(avatar), createdAt: now() };
  f.members[m.id] = m;
  return m;
}
const memberList = (f) => Object.values(f.members).map(m => ({ id: m.id, name: m.name, avatar: m.avatar }));
const similarMatches = (f, name) => Object.values(f.members).filter(m => similarNames(m.name, name)).map(m => ({ id: m.id, name: m.name, avatar: m.avatar }));

/**
 * Copy a revealed round into the family's permanent history. The record id is derived from
 * the table + round number, so recording the same round again only overwrites it (never duplicates).
 */
async function recordRound(room, r) {
  if (!room.familyCode || r.actual == null) return null;
  const out = await withFamily(room.familyCode, (f) => {
    const dinner = f.dinners[room.dinnerId] ??= { id: room.dinnerId, tableCode: room.code, createdAt: room.createdAt, rounds: {} };
    Object.assign(dinner, { title: room.title, currency: room.currency, mode: room.mode });
    const guesses = {};
    for (const [pid, g] of Object.entries(r.guesses)) {
      const p = room.players[pid];
      if (!p) continue;
      const memberId = p.memberId && f.members[p.memberId] ? p.memberId : null;
      const key = memberId || `guest:${normName(p.name) || pid}`;
      guesses[key] = {
        memberId, guest: !memberId, name: p.name, avatar: p.avatar,
        amount: g.amount, firstAmount: g.firstAmount ?? g.amount, at: g.at, firstAt: g.firstAt ?? g.at,
        changes: g.changes || 0, quote: g.quote || '',
      };
    }
    dinner.rounds[roundId(room, r)] = {
      id: roundId(room, r), n: r.n, label: r.label, actual: r.actual,
      startedAt: r.startedAt, revealedAt: r.revealedAt, fixedAt: r.fixedAt || null, guesses,
    };
    return { ...ok(), write: true };
  });
  if (out.family) await withRoom(room.code, (d) => { d.familyRev = out.family.rev; d.familyName = out.family.name; return { ...ok(), write: true }; });
  return out.family || null;
}

function sanitizeFamilyInto(f, src) {
  for (const m of Object.values(src.members || {})) {
    if (!m || typeof m.id !== 'string') continue;
    f.members[m.id] = { id: m.id.slice(0, 40), name: cleanText(m.name, 24) || '?', avatar: cleanAvatar(m.avatar, '🍽️'), createdAt: m.createdAt || now() };
  }
  for (const d of Object.values(src.dinners || {})) {
    if (!d || typeof d.id !== 'string' || typeof d.rounds !== 'object') continue;
    const dinner = f.dinners[d.id] ??= { id: d.id.slice(0, 64), tableCode: cleanText(d.tableCode, 8), createdAt: d.createdAt || now(), rounds: {} };
    Object.assign(dinner, { title: cleanText(d.title, 40), currency: cleanText(d.currency, 4) || '$', mode: d.mode === 'nover' ? 'nover' : 'classic' });
    for (const r of Object.values(d.rounds)) {
      if (!r || typeof r.id !== 'string' || !(cleanAmount(r.actual) > 0)) continue;
      const guesses = {};
      for (const [k, g] of Object.entries(r.guesses || {})) {
        const amount = cleanAmount(g && g.amount);
        if (amount == null) continue;
        const member = g.memberId && f.members[g.memberId];
        guesses[cleanText(k, 64)] = {
          memberId: member ? g.memberId : null, guest: !member,
          name: cleanText(g.name, 24), avatar: cleanAvatar(g.avatar, '🍽️'), amount, firstAmount: cleanAmount(g.firstAmount) ?? amount,
          at: Number(g.at) || 0, firstAt: Number(g.firstAt ?? g.at) || 0, changes: Math.max(0, Number(g.changes) || 0), quote: cleanText(g.quote, 60),
        };
      }
      dinner.rounds[r.id.slice(0, 80)] = {
        id: r.id.slice(0, 80), n: Number(r.n) || 1, label: cleanText(r.label, 40), actual: cleanAmount(r.actual),
        startedAt: Number(r.startedAt) || 0, revealedAt: Number(r.revealedAt) || 0, fixedAt: r.fixedAt || null, guesses,
      };
    }
  }
}

// ---------- HTTP plumbing ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, { status, body }) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 10_000) {
  if (SERVERLESS && req.body !== undefined) { // Vercel already parsed it
    if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.length ? JSON.parse(req.body.toString('utf8')) : {});
    return Promise.resolve(req.body || {});
  }
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
const auth = (room, body) => {
  const p = room.players[body.pid];
  return p && sameSecret(p.token, body.token) ? p : null;
};

// Per-instance rate limiting: slows down code guessing and floods. Families of real people never hit it.
const hits = new Map();
function limited(req, bucket, max) {
  if (!RATE_LIMIT) return false;
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  const key = `${bucket}|${ip}`;
  const t = now();
  const h = hits.get(key);
  if (!h || t - h.start > 60_000) { hits.set(key, { start: t, n: 1 }); return false; }
  h.n++;
  if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start > 60_000) hits.delete(k);
  return h.n > max;
}
const TOO_MANY = err(429, 'tooMany', 'Too many requests — slow down a little');

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');
}
function sendEvent(res, event, data, eventId) {
  res.write(`${eventId != null ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  fs.readFile(file, (e, data) => {
    if (e) {
      if (!path.extname(rel)) return serveStatic(req, res, '/'); // deep links land on the app shell
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=300',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}

// ---------- live streams ----------
async function streamRoom(req, res, code, pid) {
  openStream(res);
  let closed = false;
  req.on('close', () => { closed = true; });
  const resumeFrom = Number(req.headers['last-event-id']);
  let lastSeq = Number.isFinite(resumeFrom) && resumeFrom > 0 ? resumeFrom : null;
  let last = '', lastTouch = 0, lastPing = now();
  const deadline = now() + STREAM_MS;
  while (!closed && now() < deadline) {
    let row;
    try { row = await db.getRoom(code); } catch { row = undefined; } // transient DB hiccup: try again
    if (row === null) { sendEvent(res, 'gone', {}); break; }
    if (row) {
      if (now() - lastTouch > 8000 && row.data.players[pid]) {
        lastTouch = now();
        row = { ...row, presence: { ...row.presence, [pid]: now() } };
        db.touch(code, pid).catch(() => {});
      }
      const view = viewFor(row, pid);
      const sig = JSON.stringify({ ...view, serverNow: 0 });
      if (sig !== last) { last = sig; sendEvent(res, 'state', view); }
      if (lastSeq == null) lastSeq = row.eventSeq;
      for (const ev of row.events) if (ev.seq > lastSeq) { sendEvent(res, 'react', ev, ev.seq); lastSeq = ev.seq; }
      if (!row.data.players[pid]) break; // removed from the table: the client sees it in the last state
    }
    if (now() - lastPing > 15_000) { res.write(': ping\n\n'); lastPing = now(); }
    await sleep(POLL_MS);
  }
  res.end();
}

async function streamFamily(req, res, code) {
  openStream(res);
  let closed = false;
  req.on('close', () => { closed = true; });
  let lastRev = null, lastPing = now();
  const deadline = now() + STREAM_MS;
  while (!closed && now() < deadline) {
    let row;
    try { row = await db.getFamily(code); } catch { row = undefined; }
    if (row === null) break;
    if (row && row.data.rev !== lastRev) { lastRev = row.data.rev; sendEvent(res, 'family', { rev: lastRev }); }
    if (now() - lastPing > 15_000) { res.write(': ping\n\n'); lastPing = now(); }
    await sleep(POLL_MS * 2);
  }
  res.end();
}

// ---------- family API ----------
async function familyApi(req, res, parts) {
  // POST /api/families → create a family (the creator becomes its first member and gets the family key)
  if (req.method === 'POST' && parts.length === 1) {
    if (limited(req, 'create', 20)) return TOO_MANY;
    const body = await readBody(req);
    const name = cleanText(body.name, 40);
    const memberName = cleanText(body.member?.name, 24);
    if (!name || !memberName) return err(400, 'nameRequired', 'Please enter a name');
    const f = { code: '', name, createdAt: now(), rev: 1, key: secret(), members: {}, dinners: {} };
    const m = addMember(f, memberName, body.member?.avatar);
    for (let i = 0; i < 10; i++) {
      f.code = makeCode(6);
      if (await db.createFamily(f.code, f)) return ok({ code: f.code, key: f.key, memberId: m.id, family: publicFamily(f) });
    }
    return BUSY;
  }
  // POST /api/families/import → restore a downloaded backup (into a new family, or one you hold the key to)
  if (req.method === 'POST' && parts[1] === 'import') {
    if (limited(req, 'create', 20)) return TOO_MANY;
    const body = await readBody(req, 4_000_000);
    const src = body && (body.family || body);
    if (!src || typeof src !== 'object' || typeof src.members !== 'object' || typeof src.dinners !== 'object') return err(400, 'badBackup', 'Not a CheckMate family backup');
    const wanted = /^[A-Z]{6}$/.test(src.code) ? src.code : null;
    if (wanted && await db.getFamily(wanted)) {
      const out = await withFamily(wanted, (f) => {
        if (!sameSecret(f.key, body.key)) return err(403, 'familyKey', 'Only family members can do that');
        sanitizeFamilyInto(f, src);
        return { ...ok(), write: true };
      });
      return out.family ? ok({ code: wanted, family: publicFamily(out.family) }) : out;
    }
    const f = { code: wanted || makeCode(6), name: cleanText(src.name, 40) || 'Family', createdAt: src.createdAt || now(), rev: 1, key: secret(), members: {}, dinners: {} };
    sanitizeFamilyInto(f, src);
    for (let i = 0; i < 10; i++) {
      if (await db.createFamily(f.code, f)) return ok({ code: f.code, key: f.key, family: publicFamily(f) });
      f.code = makeCode(6);
    }
    return BUSY;
  }

  const code = String(parts[1] || '').toUpperCase();
  const action = parts[2];
  if (req.method === 'GET') {
    if (action === 'events') {
      if (!(await db.getFamily(code))) return err(404, 'familyNotFound', 'No family with that code');
      await streamFamily(req, res, code);
      return null;
    }
    if (limited(req, 'peek', 90)) return TOO_MANY;
    const row = await db.getFamily(code);
    if (!row) return err(404, 'familyNotFound', 'No family with that code');
    if (!action) return ok(publicFamily(row.data));
    if (action === 'export') {
      const f = row.data;
      const fileName = `checkmate-${f.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'family'}-${new Date().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store', ...SECURITY_HEADERS,
      });
      res.end(JSON.stringify({ format: 'checkmate-family', version: 1, exportedAt: now(), family: publicFamily(f) }, null, 1));
      return null;
    }
    return err(404, 'unknown', 'Unknown action');
  }
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  if (limited(req, 'write', 240)) return TOO_MANY;
  const body = await readBody(req);

  // Every change to a family needs the family key, which only family members' phones hold.
  return withFamily(code, (f) => {
    if (!sameSecret(f.key, body.key)) return err(403, 'familyKey', 'Only family members can do that');
    switch (action) {
      case undefined: { // rename the family
        const name = cleanText(body.name, 40);
        if (name) f.name = name;
        return { ...ok(), write: true };
      }
      case 'members': {
        const memberId = parts[3];
        if (memberId) { // update an existing member
          const m = f.members[memberId];
          if (!m) return err(404, 'memberNotFound', 'No such family member');
          const name = cleanText(body.name, 24);
          if (name) m.name = name;
          if (AVATARS.includes(body.avatar)) m.avatar = body.avatar;
          return { ...ok(), write: true };
        }
        const name = cleanText(body.name, 24);
        if (!name) return err(400, 'nameRequired', 'Please enter your name');
        if (Object.keys(f.members).length >= MAX_MEMBERS) return err(400, 'full', 'This family is full!');
        const matches = similarMatches(f, name);
        if (matches.length && !body.force) return err(409, 'similarName', 'Is this you?', { matches });
        const m = addMember(f, name, body.avatar);
        return { ...ok({ memberId: m.id }), write: true };
      }
      case 'merge': { // fold a duplicate identity into the real one
        const from = f.members[body.from], into = f.members[body.into];
        if (!from || !into || from === into) return err(400, 'badMerge', 'Pick two different members');
        for (const d of Object.values(f.dinners)) {
          for (const r of Object.values(d.rounds)) {
            const g = r.guesses[from.id];
            if (!g) continue;
            delete r.guesses[from.id];
            if (!r.guesses[into.id]) r.guesses[into.id] = { ...g, memberId: into.id, name: into.name, avatar: into.avatar };
          }
        }
        delete f.members[from.id];
        return { ...ok(), write: true };
      }
      case 'dinners': { // POST /api/families/:code/dinners/:id/delete
        const dinner = f.dinners[parts[3]];
        if (!dinner || parts[4] !== 'delete') return err(404, 'notFound', 'No such dinner');
        delete f.dinners[dinner.id];
        return { ...ok(), write: true };
      }
      default:
        return err(404, 'unknown', 'Unknown action');
    }
  });
}

// ---------- room API ----------
async function roomApi(req, res, parts, url) {
  // POST /api/rooms → create a table (optionally playing for a family — needs the family key)
  if (req.method === 'POST' && parts.length === 1) {
    if (limited(req, 'create', 30)) return TOO_MANY;
    const body = await readBody(req);
    let fam = null, member = null;
    if (body.familyCode) {
      const famCode = String(body.familyCode).toUpperCase();
      const out = await withFamily(famCode, (f) => {
        if (!sameSecret(f.key, body.familyKey)) return err(403, 'familyKey', 'Only family members can do that');
        let m = f.members[body.memberId];
        if (m) return ok({ member: m, family: f });
        const name = cleanText(body.name, 24);
        if (!name) return err(400, 'nameRequired', 'Please enter your name');
        m = addMember(f, name, body.avatar);
        return { ...ok({ member: m }), write: true };
      });
      if (out.status !== 200) return out;
      fam = out.family || out.body.family;
      member = out.body.member;
    }
    const name = cleanText(member ? member.name : body.name, 24);
    if (!name) return err(400, 'nameRequired', 'Please enter your name');
    const pid = id();
    const token = secret();
    const createdAt = now();
    const room = {
      code: '',
      dinnerId: '',
      familyCode: fam ? fam.code : null,
      familyName: fam ? fam.name : null,
      familyRev: fam ? fam.rev : 0,
      title: cleanText(body.title, 40) || 'Family dinner',
      currency: cleanText(body.currency, 4) || '$',
      mode: body.mode === 'nover' ? 'nover' : 'classic',
      hostId: pid,
      createdAt, updatedAt: createdAt,
      players: { [pid]: { id: pid, token, name, avatar: member ? member.avatar : cleanAvatar(body.avatar, AVATARS[0]), joinedAt: now(), memberId: member?.id } },
      rounds: [],
    };
    newRound(room, body.roundLabel || 'Dinner');
    for (let i = 0; i < 12; i++) {
      room.code = makeCode(4);
      room.dinnerId = `${room.code}-${createdAt.toString(36)}`;
      if (await db.createRoom(room.code, room)) {
        if (crypto.randomInt(20) === 0) db.deleteRoomsBefore(now() - ROOM_TTL_MS).catch(() => {}); // light housekeeping
        return ok({ code: room.code, pid, token, memberId: member?.id || null });
      }
    }
    return BUSY;
  }

  const code = String(parts[1] || '').toUpperCase();
  const action = parts[2];

  if (req.method === 'GET' && !action) { // public peek (for the join screen)
    if (limited(req, 'peek', 90)) return TOO_MANY;
    const row = await db.getRoom(code);
    if (!row) return err(404, 'notFound', 'No dinner table with that code 🤔');
    const room = row.data;
    const famRow = room.familyCode ? await db.getFamily(room.familyCode) : null;
    const seated = Object.values(room.players);
    return ok({
      code: room.code, title: room.title, currency: room.currency,
      players: seated.map(p => ({ name: p.name, avatar: p.avatar, memberId: p.memberId || null })),
      takenAvatars: seated.map(p => p.avatar),
      family: famRow ? { code: famRow.data.code, name: famRow.data.name, members: memberList(famRow.data) } : null,
    });
  }

  if (req.method === 'GET' && action === 'events') { // live stream
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    const row = await db.getRoom(code);
    if (!row) return err(404, 'notFound', 'No dinner table with that code 🤔');
    if (!auth(row.data, { pid, token })) return err(403, 'notInRoom', 'Not in this room');
    await streamRoom(req, res, code, pid);
    return null;
  }

  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  if (limited(req, 'write', 300)) return TOO_MANY;
  const body = await readBody(req);

  if (action === 'join') {
    if (limited(req, 'join', 40)) return TOO_MANY;
    return joinRoom(code, body);
  }

  if (action === 'react') { // reactions don't touch the game state: they go on a small event list
    const emoji = REACTIONS.includes(body.emoji) ? body.emoji : null;
    if (!emoji) return err(400, 'unknown', 'Unknown reaction');
    let player = null, counts = null, target = null, roundN = null;
    const out = await withRoom(code, (room) => {
      player = auth(room, body);
      if (!player) return err(403, 'notInRoom', 'Not in this room');
      const round = currentRound(room);
      roundN = round.n;
      target = body.target && room.players[body.target] ? body.target : null;
      if (!target || round.actual == null) return ok();
      round.reactCount ??= {};
      if ((round.reactCount[player.id] || 0) >= MAX_REACTIONS_PER_ROUND) { counts = round.reactions?.[target] || {}; return ok(); }
      round.reactCount[player.id] = (round.reactCount[player.id] || 0) + 1;
      round.reactions ??= {};
      const c = round.reactions[target] ??= {};
      c[emoji] = Math.min(999, (c[emoji] || 0) + 1);
      counts = { ...c };
      return { ...ok(), write: true };
    });
    if (out.status !== 200) return out;
    await db.pushEvent(code, { emoji, from: player.id, name: player.name, target, round: roundN, counts });
    return ok();
  }

  let recordAfter = null;
  const out = await withRoom(code, (room) => {
    const player = auth(room, body);
    if (!player) return err(403, 'notInRoom', 'Not in this room');
    const round = currentRound(room);
    const isHost = room.hostId === player.id;
    switch (action) {
      case 'guess': {
        if (round.actual != null) return err(400, 'tooLate', 'Too late — the bill was already revealed!');
        const amount = cleanAmount(body.amount);
        if (amount == null) return err(400, 'notPrice', 'That is not a price 😅');
        const prev = round.guesses[player.id];
        round.guesses[player.id] = {
          amount,
          firstAmount: prev?.firstAmount ?? prev?.amount ?? amount,
          at: now(),
          firstAt: prev?.firstAt ?? now(),
          changes: prev ? (prev.changes || 0) + (prev.amount !== amount ? 1 : 0) : 0,
          quote: cleanText(body.quote, 60),
        };
        return { ...ok(), write: true };
      }
      case 'reveal': {
        if (round.actual != null) return err(400, 'alreadyRevealed', 'Already revealed');
        const actual = cleanAmount(body.actual);
        if (actual == null) return err(400, 'enterActual', 'Enter the real total from the receipt');
        if (!Object.keys(round.guesses).length) return err(400, 'nobodyGuessed', 'Nobody has guessed yet!');
        round.actual = actual;
        round.revealedAt = now();
        round.revealedBy = player.id;
        recordAfter = round.n;
        return { ...ok(), write: true };
      }
      case 'fix': { // correct a mistyped bill: updates the same history record, never adds a second one
        if (round.actual == null) return err(400, 'finishRound', 'Finish this round first');
        if (!isHost && round.revealedBy !== player.id) return err(403, 'hostOnly', 'Only the host can do that');
        if (now() - round.revealedAt > FIX_WINDOW_MS) return err(400, 'tooLateFix', 'Too late to change this bill');
        const actual = cleanAmount(body.actual);
        if (actual == null) return err(400, 'enterActual', 'Enter the real total from the receipt');
        round.actual = actual;
        round.fixedAt = now();
        recordAfter = round.n;
        return { ...ok(), write: true };
      }
      case 'next': {
        if (round.actual == null) return err(400, 'finishRound', 'Finish this round first');
        if (room.rounds.length >= MAX_ROUNDS) return err(400, 'tooManyRounds', 'That is a lot of dinners. Start a new table!');
        newRound(room, body.label);
        return { ...ok(), write: true };
      }
      case 'profile': {
        const name = cleanText(body.name, 24);
        if (name) player.name = name;
        if (AVATARS.includes(body.avatar)) player.avatar = body.avatar;
        return { ...ok(), write: true, profileOf: player.memberId ? { memberId: player.memberId, name: player.name, avatar: player.avatar } : null };
      }
      case 'settings': {
        if (!isHost) return err(403, 'hostOnly', 'Only the host can change settings');
        if (body.title != null) room.title = cleanText(body.title, 40) || room.title;
        if (body.currency != null) room.currency = cleanText(body.currency, 4) || room.currency;
        if (body.mode === 'classic' || body.mode === 'nover') room.mode = body.mode;
        if (body.roundLabel != null && round.actual == null) round.label = cleanText(body.roundLabel, 40) || round.label;
        return { ...ok(), write: true };
      }
      case 'kick': {
        if (!isHost) return err(403, 'hostOnly', 'Only the host can remove players');
        const target = room.players[body.target];
        if (!target || target.id === room.hostId) return err(400, 'cannotRemove', 'Cannot remove that player');
        delete room.players[target.id];
        for (const r of room.rounds) if (r.actual == null) delete r.guesses[target.id]; // history stays intact
        return { ...ok(), write: true };
      }
      default:
        return err(404, 'unknown', 'Unknown action');
    }
  });
  if (out.status === 200 && recordAfter != null && out.room?.familyCode) {
    await recordRound(out.room, out.room.rounds.find(r => r.n === recordAfter));
  }
  if (out.status === 200 && out.profileOf && out.room?.familyCode) { // keep the family member in sync
    const p = out.profileOf;
    await withFamily(out.room.familyCode, (f) => {
      const m = f.members[p.memberId];
      if (!m) return ok();
      m.name = p.name; m.avatar = p.avatar;
      return { ...ok(), write: true };
    });
  }
  return out;
}

/**
 * Joining a table. Family tables let you tap who you are (no typing → no duplicate identities);
 * new names are checked against the family for look-alikes; guests can play without being recorded.
 * A seat that is in use on another phone right now can't be taken over (identity protection).
 */
async function joinRoom(code, body) {
  const row = await db.getRoom(code);
  if (!row) return err(404, 'notFound', 'No dinner table with that code 🤔');
  const famCode = row.data.familyCode;
  const name = cleanText(body.name, 24);

  // Family tables: resolve (or create) the family member first.
  let member = null, familyKey = null;
  if (famCode && (body.memberId || !body.guest)) {
    const out = await withFamily(famCode, (f) => {
      familyKey = f.key;
      if (body.memberId) {
        const m = f.members[body.memberId];
        return m ? ok({ member: m }) : err(404, 'memberNotFound', 'No such family member');
      }
      if (!name) return err(400, 'nameRequired', 'Please enter your name');
      const matches = similarMatches(f, name);
      if (matches.length && !body.force) return err(409, 'similarName', 'Is this you?', { matches });
      if (Object.keys(f.members).length >= MAX_MEMBERS) return err(400, 'full', 'This family is full!');
      const m = addMember(f, name, body.avatar);
      return { ...ok({ member: m }), write: true };
    });
    if (out.status !== 200) return out;
    member = out.body.member;
  } else if (famCode && body.guest && !body.force && name) { // a "guest" who is really a family member? Ask first.
    const famRow = await db.getFamily(famCode);
    const matches = famRow ? similarMatches(famRow.data, name) : [];
    if (matches.length) return err(409, 'similarName', 'Is this you?', { matches });
  }
  if (!member && !name) return err(400, 'nameRequired', 'Please enter your name');

  return withRoom(code, (room, current) => {
    const seated = Object.values(room.players);
    const existing = member
      ? seated.find(p => p.memberId === member.id)
      : seated.find(p => !p.memberId && p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (isOnline(current, existing.id) && !sameSecret(existing.token, body.token || '')) {
        return err(409, 'seatTaken', 'That player is already at the table on another phone');
      }
      if (!member && AVATARS.includes(body.avatar)) existing.avatar = body.avatar;
      return { ...ok({ code, pid: existing.id, token: existing.token, memberId: member?.id, familyKey: member ? familyKey : undefined, rejoined: true }), write: !member };
    }
    if (seated.length >= MAX_PLAYERS) return err(400, 'full', 'This table is full!');
    const pid = id();
    const token = secret();
    room.players[pid] = member
      ? { id: pid, token, joinedAt: now(), name: member.name, avatar: member.avatar, memberId: member.id }
      : { id: pid, token, joinedAt: now(), name, avatar: cleanAvatar(body.avatar), guest: !!famCode };
    return { ...ok({ code, pid, token, memberId: member?.id, familyKey: member ? familyKey : undefined }), write: true };
  });
}

/** The request handler — used by the local server and by the Vercel function (api/index.js). */
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Vercel rewrites /api/* to one function and passes the original path along.
  const forwarded = url.searchParams.get('__path');
  if (forwarded) url.pathname = forwarded;
  url.searchParams.delete('__path');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    let out;
    if (url.pathname === '/healthz') {
      await db.ping();
      out = ok({ ok: true, storage: db.kind });
    } else if (url.pathname === '/api/cron') { // daily housekeeping (keeps the database active, drops stale tables)
      const expected = process.env.CRON_SECRET;
      if (expected && !sameSecret(String(req.headers.authorization || ''), `Bearer ${expected}`)) out = err(401, 'unauthorized', 'Unauthorized');
      else out = ok({ ok: true, removedTables: await db.deleteRoomsBefore(now() - ROOM_TTL_MS) });
    } else if (parts[0] === 'api' && parts[1] === 'rooms') out = await roomApi(req, res, parts.slice(1), url);
    else if (parts[0] === 'api' && parts[1] === 'families') out = await familyApi(req, res, parts.slice(1), url);
    else if (parts[0] === 'api') out = err(404, 'notFound', 'Not found');
    else if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    else { serveStatic(req, res, url.pathname); return; }
    if (out) send(res, out);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, err(400, 'bad', e.message || 'Bad request'));
    else res.end();
  }
}

const server = http.createServer(handler);

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

if (require.main === module) {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { db.flush(); process.exit(0); }); // redeploys send SIGTERM: save first
  }
  process.on('exit', () => db.flush());
  setInterval(() => db.deleteRoomsBefore(now() - ROOM_TTL_MS).catch(() => {}), 60 * 60 * 1000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`\n♛  CheckMate is running  (storage: ${db.kind})`);
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`   Network: http://${ip}:${PORT}   ← open this on everyone's phone (same Wi-Fi)`);
    console.log('');
  });
}

module.exports = { server, handler, db, similarNames };
