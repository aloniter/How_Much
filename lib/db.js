// Storage for live tables ("rooms") and the permanent family Hall of Fame.
//
// Two interchangeable backends with the same async interface:
//   • MemoryDB   — in-process maps persisted to JSON files (local play, tests, any single server)
//   • SupabaseDB — Postgres via Supabase's REST API (production; survives redeploys, works across
//                  many serverless instances)
//
// Writes are optimistic: every row carries a version, and save(code, data, version) only succeeds
// if nobody else saved in between. Callers re-read and retry — see withRoom()/withFamily() in server.js.
'use strict';

const path = require('path');
const { JsonStore } = require('./store');

const EVENT_KEEP = 40; // reactions remembered per room, for reconnecting clients

class MemoryDB {
  constructor(dataDir) {
    this.rooms = new Map();
    this.families = new Map();
    this.roomStore = new JsonStore(path.join(dataDir, 'rooms.json'), () => [...this.rooms.values()]);
    this.familyStore = new JsonStore(path.join(dataDir, 'families.json'), () => [...this.families.values()]);
    for (const r of this.roomStore.load([])) {
      // older files stored the bare room object; wrap it into a row
      const row = r && r.data ? r : { code: r.code, data: r, version: 1, presence: {}, events: [], eventSeq: 0 };
      this.rooms.set(row.code, row);
    }
    for (const f of this.familyStore.load([])) {
      const row = f && f.data ? f : { code: f.code, data: f, version: 1 };
      this.families.set(row.code, row);
    }
  }
  get kind() { return 'memory'; }

  async getRoom(code) { return this.rooms.get(code) || null; }
  async createRoom(code, data) {
    if (this.rooms.has(code)) return false;
    this.rooms.set(code, { code, data, version: 1, presence: {}, events: [], eventSeq: 0, updatedAt: Date.now() });
    this.roomStore.save();
    return true;
  }
  async saveRoom(code, data, version) {
    const row = this.rooms.get(code);
    if (!row || row.version !== version) return false;
    this.rooms.set(code, { ...row, data, version: version + 1, updatedAt: Date.now() });
    this.roomStore.save();
    return true;
  }
  async touch(code, pid) {
    const row = this.rooms.get(code);
    if (row) row.presence = { ...row.presence, [pid]: Date.now() }; // presence is ephemeral: not saved
  }
  async pushEvent(code, event) {
    const row = this.rooms.get(code);
    if (!row) return 0;
    const seq = row.eventSeq + 1;
    row.eventSeq = seq;
    row.events = [...row.events, { ...event, seq }].slice(-EVENT_KEEP);
    return seq;
  }
  async deleteRoomsBefore(cutoff) {
    let n = 0;
    for (const [code, row] of this.rooms) if ((row.updatedAt || row.data.updatedAt || 0) < cutoff) { this.rooms.delete(code); n++; }
    if (n) this.roomStore.save();
    return n;
  }

  async getFamily(code) { return this.families.get(code) || null; }
  async createFamily(code, data) {
    if (this.families.has(code)) return false;
    this.families.set(code, { code, data, version: 1 });
    this.familyStore.save();
    return true;
  }
  async saveFamily(code, data, version) {
    const row = this.families.get(code);
    if (!row || row.version !== version) return false;
    this.families.set(code, { code, data, version: version + 1 });
    this.familyStore.save();
    return true;
  }
  async ping() { return true; }
  flush() { this.roomStore.flush(); this.familyStore.flush(); }
}

/** Supabase (PostgREST). Access is limited by row-level security to requests carrying the server secret. */
class SupabaseDB {
  constructor({ url, key, secret }) {
    this.base = url.replace(/\/$/, '') + '/rest/v1';
    this.headers = { apikey: key, Authorization: `Bearer ${key}`, 'x-cm-secret': secret, 'Content-Type': 'application/json' };
  }
  get kind() { return 'supabase'; }

  async req(method, p, body, extra = {}) {
    const res = await fetch(this.base + p, { method, headers: { ...this.headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      throw new Error(`Database error ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }
  static toRoom(r) {
    return r && { code: r.code, data: r.data, version: r.version, presence: r.presence || {}, events: r.events || [], eventSeq: r.event_seq || 0 };
  }

  async getRoom(code) {
    const r = await this.req('GET', `/cm_rooms?code=eq.${encodeURIComponent(code)}&select=*`);
    return SupabaseDB.toRoom(r.json[0]) || null;
  }
  async createRoom(code, data) {
    const r = await this.req('POST', '/cm_rooms', { code, data }, { Prefer: 'return=minimal' });
    return !(r && r.status === 409);
  }
  async saveRoom(code, data, version) {
    const r = await this.req('PATCH', `/cm_rooms?code=eq.${encodeURIComponent(code)}&version=eq.${version}`,
      { data, version: version + 1, updated_at: new Date().toISOString() }, { Prefer: 'return=representation' });
    return Array.isArray(r.json) && r.json.length === 1;
  }
  async touch(code, pid) { await this.req('POST', '/rpc/cm_touch', { p_code: code, p_pid: pid }); }
  async pushEvent(code, event) {
    const r = await this.req('POST', '/rpc/cm_push_event', { p_code: code, p_event: event });
    return Number(r && r.json) || 0;
  }
  async deleteRoomsBefore(cutoff) {
    const r = await this.req('DELETE', `/cm_rooms?updated_at=lt.${encodeURIComponent(new Date(cutoff).toISOString())}`, undefined, { Prefer: 'return=representation' });
    return Array.isArray(r && r.json) ? r.json.length : 0;
  }

  async getFamily(code) {
    const r = await this.req('GET', `/cm_families?code=eq.${encodeURIComponent(code)}&select=code,data,version`);
    return r.json[0] || null;
  }
  async createFamily(code, data) {
    const r = await this.req('POST', '/cm_families', { code, data }, { Prefer: 'return=minimal' });
    return !(r && r.status === 409);
  }
  async saveFamily(code, data, version) {
    const r = await this.req('PATCH', `/cm_families?code=eq.${encodeURIComponent(code)}&version=eq.${version}`,
      { data, version: version + 1, updated_at: new Date().toISOString() }, { Prefer: 'return=representation' });
    return Array.isArray(r.json) && r.json.length === 1;
  }
  async ping() { await this.req('GET', '/cm_families?select=code&limit=1'); return true; }
  flush() {}
}

function createDB(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_KEY && env.CM_DB_SECRET) {
    return new SupabaseDB({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY, secret: env.CM_DB_SECRET });
  }
  return new MemoryDB(env.DATA_DIR || path.join(__dirname, '..', 'data'));
}

module.exports = { MemoryDB, SupabaseDB, createDB };
