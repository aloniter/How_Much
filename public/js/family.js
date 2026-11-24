// Families on this phone (no accounts: a family code + "who am I" is remembered locally),
// plus a small cache of downloaded family histories and their computed Hall of Fame.
import { buildHall } from './hall.js';

const KEY = 'checkmate:families';
const CURRENT = 'checkmate:currentFamily';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

export const myFamilies = () => read(KEY, []);
export const entryFor = (code) => myFamilies().find(f => f.code === code) || null;
export function currentFamilyCode() {
  const list = myFamilies();
  const cur = read(CURRENT, null);
  return list.some(f => f.code === cur) ? cur : list[0]?.code || null;
}
export function setCurrentFamily(code) { write(CURRENT, code); }

/** Remember (or update) a family on this phone. Fields: code, name, memberId, memberName, memberAvatar. */
export function saveFamilyEntry(entry) {
  const list = myFamilies().filter(f => f.code !== entry.code);
  const prev = myFamilies().find(f => f.code === entry.code) || {};
  list.unshift({ ...prev, ...entry });
  write(KEY, list.slice(0, 10));
  setCurrentFamily(entry.code);
}
export function forgetFamily(code) {
  write(KEY, myFamilies().filter(f => f.code !== code));
  cache.delete(code);
}

const cache = new Map(); // code -> { family, hall, rev }
const inflight = new Map();
export const cached = (code) => cache.get(code) || null;

/** Fetch a family unless we already have this revision. Resolves to { family, hall } or null. */
export async function loadFamily(code, rev = null, { force = false } = {}) {
  const have = cache.get(code);
  if (have && !force && (rev == null || have.rev === rev)) return have;
  if (inflight.has(code)) return inflight.get(code);
  const p = (async () => {
    try {
      const res = await fetch(`/api/families/${code}`);
      if (!res.ok) { if (res.status === 404) cache.delete(code); return null; }
      const family = await res.json();
      const entry = { family, hall: buildHall(family), rev: family.rev };
      cache.set(code, entry);
      // keep the stored name and "me" in sync with renames
      const mine = entryFor(code);
      if (mine) {
        const m = mine.memberId && family.members[mine.memberId];
        const list = myFamilies().map(f => f.code === code ? { ...f, name: family.name, memberId: m ? m.id : null, memberName: m?.name, memberAvatar: m?.avatar } : f);
        write(KEY, list);
      }
      return entry;
    } catch { return null; } finally { inflight.delete(code); }
  })();
  inflight.set(code, p);
  return p;
}
