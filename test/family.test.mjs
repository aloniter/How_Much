// End-to-end API tests for the Family Hall of Fame, run against a real server process
// (so we can also kill it and prove history survives a restart).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHall } from '../public/js/hall.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'checkmate-fam-'));
const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
let proc;

async function start() {
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, RATE_LIMIT: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/healthz')).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}
async function stop() {
  const exited = new Promise(r => proc.once('exit', r));
  proc.kill('SIGTERM');
  await exited;
}
test.before(start);
test.after(async () => { await stop(); rmSync(DATA_DIR, { recursive: true, force: true }); });

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json() };
};
const get = async (p) => (await fetch(base + p)).json();
const seat = (room, who) => ({ pid: who.pid, token: who.token });

async function playRound(code, guesses, actual, revealer) {
  for (const [who, amount] of guesses) assert.equal((await post(`/api/rooms/${code}/guess`, { ...seat(code, who), amount })).status, 200);
  const r = await post(`/api/rooms/${code}/reveal`, { ...seat(code, revealer), actual });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

test('a family plays several dinners; history is exact, deduplicated and survives a restart', async () => {
  // --- the family is born
  const fam = (await post('/api/families', { name: 'The Cohens', member: { name: 'Mom', avatar: '🍷' } })).body;
  assert.match(fam.code, /^[A-Z]{6}$/);
  const momId = fam.memberId;
  const key = fam.key;
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal((await get(`/api/families/${fam.code}`)).key, undefined, 'the family key is never exposed');
  // without the family key nobody can create family tables or change the family
  assert.equal((await post('/api/rooms', { familyCode: fam.code, memberId: momId, title: 'x' })).status, 403);
  assert.equal((await post(`/api/families/${fam.code}`, { name: 'Hacked' })).status, 403);
  assert.equal((await post(`/api/families/${fam.code}`, { name: 'Hacked', key: 'f'.repeat(32) })).status, 403);

  // --- dinner 1: a family table
  const host = (await post('/api/rooms', { familyCode: fam.code, familyKey: key, memberId: momId, title: 'Pizza', currency: '₪' })).body;
  assert.equal(host.memberId, momId);
  const peek = await get(`/api/rooms/${host.code}`);
  assert.equal(peek.family.name, 'The Cohens');
  assert.equal(peek.family.members.length, 1);

  const dad = (await post(`/api/rooms/${host.code}/join`, { name: 'Dad', avatar: '🥩' })).body;
  assert.ok(dad.memberId, 'a new name becomes a family member');
  assert.equal(dad.familyKey, key, 'family members at a family table receive the family key');
  // "dad " from another phone looks like an existing member → asked "is this you?"
  const dup = await post(`/api/rooms/${host.code}/join`, { name: 'dad ', avatar: '🍔' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'similarName');
  assert.equal(dup.body.matches[0].id, dad.memberId);
  // tapping "that's me" from a second phone returns the same seat, no duplicate
  const dad2 = (await post(`/api/rooms/${host.code}/join`, { memberId: dad.memberId })).body;
  assert.equal(dad2.pid, dad.pid);
  assert.equal(dad2.rejoined, true);
  const noa = (await post(`/api/rooms/${host.code}/join`, { name: 'Noa', avatar: '🧁' })).body;
  const uncle = (await post(`/api/rooms/${host.code}/join`, { name: 'Uncle Avi', avatar: '🍺', guest: true })).body;
  assert.equal(uncle.memberId, undefined, 'guests are not family members');

  await playRound(host.code, [[host, 410], [dad, 520], [noa, 300], [uncle, 405]], 400, dad);
  // revealing twice is refused
  assert.equal((await post(`/api/rooms/${host.code}/reveal`, { ...seat(host.code, host), actual: 999 })).status, 400);
  // a typo fix rewrites the same record (not a second one)
  assert.equal((await post(`/api/rooms/${host.code}/fix`, { ...seat(host.code, noa), actual: 401 })).status, 403, 'only host or revealer');
  assert.equal((await post(`/api/rooms/${host.code}/fix`, { ...seat(host.code, dad), actual: 402 })).status, 200);

  let f = await get(`/api/families/${fam.code}`);
  let rounds = Object.values(f.dinners).flatMap(d => Object.values(d.rounds));
  assert.equal(Object.keys(f.members).length, 3);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].actual, 402);
  assert.equal(Object.keys(rounds[0].guesses).length, 4);
  assert.equal(Object.values(rounds[0].guesses).filter(g => g.guest).length, 1);

  // identity protection: while Dad's phone is online, nobody else can take over his seat
  const ctrl = new AbortController();
  await fetch(`${base}/api/rooms/${host.code}/events?pid=${dad.pid}&token=${dad.token}`, { signal: ctrl.signal });
  await new Promise(r => setTimeout(r, 300));
  const steal = await post(`/api/rooms/${host.code}/join`, { memberId: dad.memberId });
  assert.equal(steal.status, 409);
  assert.equal(steal.body.code, 'seatTaken');
  assert.equal((await post(`/api/rooms/${host.code}/join`, { memberId: dad.memberId, token: dad.token })).status, 200, 'same phone can rejoin');
  ctrl.abort();

  // reactions to a roast card are counted per round
  await post(`/api/rooms/${host.code}/react`, { ...seat(host.code, noa), emoji: '😂', target: dad.pid });
  await post(`/api/rooms/${host.code}/react`, { ...seat(host.code, host), emoji: '😂', target: dad.pid });
  const { rounds: [live] } = await new Promise(resolve => {
    // read one state event to see the stored counts
    fetch(`${base}/api/rooms/${host.code}/events?pid=${host.pid}&token=${host.token}`).then(async res => {
      const reader = res.body.getReader();
      let buf = '';
      for (;;) {
        const { value } = await reader.read();
        buf += new TextDecoder().decode(value);
        const m = /event: state\ndata: (.*)\n/.exec(buf);
        if (m) { reader.cancel(); resolve(JSON.parse(m[1])); return; }
      }
    });
  });
  assert.equal(live.reactions[dad.pid]['😂'], 2);

  // dessert round at the same dinner
  assert.equal((await post(`/api/rooms/${host.code}/next`, { ...seat(host.code, host), label: 'Dessert' })).status, 200);
  await playRound(host.code, [[host, 80], [dad, 60], [noa, 61]], 60, host);

  // --- restart the server: everything must still be there
  const before = await get(`/api/families/${fam.code}`);
  await stop();
  assert.ok(existsSync(path.join(DATA_DIR, 'families.json')));
  await start();
  const after = await get(`/api/families/${fam.code}`);
  assert.deepEqual(after, before);
  assert.equal((await get(`/api/rooms/${host.code}`)).code, host.code, 'tables survive restarts too');

  // --- dinner 2, a new table; Dad taps himself
  const host2 = (await post('/api/rooms', { familyCode: fam.code, familyKey: key, memberId: dad.memberId, title: 'Sushi', currency: '₪' })).body;
  const mom2 = (await post(`/api/rooms/${host2.code}/join`, { memberId: momId })).body;
  const noa2 = (await post(`/api/rooms/${host2.code}/join`, { memberId: noa.memberId })).body;
  await playRound(host2.code, [[host2, 900], [mom2, 1000], [noa2, 1150]], 1000, mom2);

  f = await get(`/api/families/${fam.code}`);
  const hall = buildHall(f);
  assert.equal(hall.totals.dinners, 2);
  assert.equal(hall.totals.rounds, 3);
  // round 1 (bill 402): Mom 410 is closest of members, but Uncle (guest, 405) is closer → no member win
  // round 2 (bill 60): Dad exact → win; round 3 (bill 1000): Mom exact → win
  assert.equal(hall.members[momId].wins, 1);
  assert.equal(hall.members[dad.memberId].wins, 1);
  assert.equal(hall.members[noa.memberId].wins, 0);
  assert.equal(hall.members[dad.memberId].exact, 1);
  assert.equal(hall.members[momId].dinners, 2);
  assert.equal(hall.totals.spent['₪'], 402 + 60 + 1000);

  // --- backup: re-importing the same backup does not duplicate anything
  const backup = await (await fetch(`${base}/api/families/${fam.code}/export`)).json();
  assert.equal(backup.format, 'checkmate-family');
  assert.equal((await post('/api/families/import', backup)).status, 403, 'merging into an existing family needs its key');
  assert.equal((await post('/api/families/import', { ...backup, key })).status, 200);
  const again = buildHall(await get(`/api/families/${fam.code}`));
  assert.equal(again.totals.rounds, 3);
  assert.equal(Object.keys(again.members).length, 3);
  // restoring onto a "fresh server" (code not present) recreates it
  const copy = structuredClone(backup); copy.family.code = 'ZZZZZZ';
  const restored = (await post('/api/families/import', copy)).body;
  assert.equal(restored.code, 'ZZZZZZ');
  assert.equal(buildHall(restored.family).totals.rounds, 3);
  assert.equal((await post('/api/families/import', { nope: 1 })).status, 400);

  // --- duplicates: "Daddy" was created on purpose, plays once, then gets merged into Dad
  const daddy = (await post(`/api/families/${fam.code}/members`, { name: 'Daddy', avatar: '🍔', force: true, key })).body;
  const host3 = (await post('/api/rooms', { familyCode: fam.code, familyKey: key, memberId: momId, title: 'Thai', currency: '₪' })).body;
  const dd = (await post(`/api/rooms/${host3.code}/join`, { memberId: daddy.memberId })).body;
  await playRound(host3.code, [[host3, 250], [dd, 200]], 200, host3);
  assert.equal((await post(`/api/families/${fam.code}/merge`, { from: daddy.memberId, into: dad.memberId, key })).status, 200);
  const merged = buildHall(await get(`/api/families/${fam.code}`));
  assert.equal(merged.members[daddy.memberId], undefined);
  assert.equal(merged.members[dad.memberId].rounds, 4, 'his 3 rounds + the one played as "Daddy"');
  assert.equal(merged.members[dad.memberId].wins, 2);

  // --- removing a dinner from the Hall of Fame
  const thai = Object.values((await get(`/api/families/${fam.code}`)).dinners).find(d => d.title === 'Thai');
  assert.equal((await post(`/api/families/${fam.code}/dinners/${thai.id}/delete`, { key })).status, 200);
  assert.equal(buildHall(await get(`/api/families/${fam.code}`)).totals.dinners, 2);
});

test('family errors and plain (non-family) tables still work as before', async () => {
  assert.equal((await fetch(`${base}/api/families/NOPENO`)).status, 404);
  assert.equal((await post('/api/families', { name: '' })).status, 400);
  const solo = (await post('/api/rooms', { name: 'Solo', avatar: '🍕' })).body;
  const peek = await get(`/api/rooms/${solo.code}`);
  assert.equal(peek.family, null);
  const p2 = (await post(`/api/rooms/${solo.code}/join`, { name: 'Friend' })).body;
  assert.ok(p2.pid);
  const again = (await post(`/api/rooms/${solo.code}/join`, { name: 'friend' })).body;
  assert.equal(again.pid, p2.pid);
});
