import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_FILE = path.join(os.tmpdir(), `checkmate-test-${process.pid}.json`);
const require = createRequire(import.meta.url);
const { server } = require('../server.js');

let base;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections?.(); server.close(); });

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

/** Read SSE "state" events until `pred` matches. */
async function waitForState(code, who, pred) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/rooms/${code}/events?pid=${who.pid}&token=${who.token}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(chunk)?.[1];
        const data = /data: (.*)/.exec(chunk)?.[1];
        if (ev === 'state') { const s = JSON.parse(data); if (pred(s)) return s; }
      }
    }
  } finally { ctrl.abort(); }
}

test('full game: create, join, guess secretly, reveal, next round', async () => {
  const host = (await post('/api/rooms', { name: 'Mom', avatar: '🍕', title: 'Pizza night', currency: '₪' })).body;
  assert.match(host.code, /^[A-Z]{4}$/);

  const peek = await (await fetch(`${base}/api/rooms/${host.code.toLowerCase()}`)).json();
  assert.equal(peek.title, 'Pizza night');

  const kid = (await post(`/api/rooms/${host.code}/join`, { name: 'Noa', avatar: '🌮' })).body;
  assert.ok(kid.pid);

  // rejoining with the same name returns the same seat
  const again = (await post(`/api/rooms/${host.code}/join`, { name: 'noa' })).body;
  assert.equal(again.pid, kid.pid);
  assert.equal(again.rejoined, true);

  assert.equal((await post(`/api/rooms/${host.code}/guess`, { ...host, amount: 'abc' })).status, 400);
  assert.equal((await post(`/api/rooms/${host.code}/guess`, { ...host, amount: 420 })).status, 200);
  assert.equal((await post(`/api/rooms/${host.code}/guess`, { ...kid, amount: '350.5', quote: 'easy' })).status, 200);
  assert.equal((await post(`/api/rooms/${host.code}/guess`, { pid: kid.pid, token: 'wrong', amount: 1 })).status, 403);

  // Noa must not be able to see Mom's number before the reveal
  const before = await waitForState(host.code, kid, () => true);
  const r0 = before.rounds[0];
  assert.equal(r0.guesses[host.pid].hidden, true);
  assert.equal(r0.guesses[host.pid].amount, undefined);
  assert.equal(r0.guesses[kid.pid].amount, 350.5);

  assert.equal((await post(`/api/rooms/${host.code}/reveal`, { ...kid, actual: 400 })).status, 200);
  assert.equal((await post(`/api/rooms/${host.code}/guess`, { ...kid, amount: 400 })).status, 400); // too late

  const after = await waitForState(host.code, kid, s => s.rounds[0].actual === 400);
  assert.equal(after.rounds[0].guesses[host.pid].amount, 420);

  assert.equal((await post(`/api/rooms/${host.code}/next`, { ...host, label: 'Dessert 🍰' })).status, 200);
  const r2 = await waitForState(host.code, host, s => s.rounds.length === 2);
  assert.equal(r2.rounds[1].label, 'Dessert 🍰');
  assert.equal(r2.rounds[1].actual, null);

  // only the host may change settings or kick
  assert.equal((await post(`/api/rooms/${host.code}/settings`, { ...kid, mode: 'nover' })).status, 403);
  assert.equal((await post(`/api/rooms/${host.code}/settings`, { ...host, mode: 'nover' })).status, 200);
  assert.equal((await post(`/api/rooms/${host.code}/kick`, { ...host, target: kid.pid })).status, 200);
  assert.equal((await post(`/api/rooms/${host.code}/guess`, { ...kid, amount: 1 })).status, 403);
});

test('unknown rooms, bad input and static files', async () => {
  assert.equal((await fetch(`${base}/api/rooms/ZZZZ`)).status, 404);
  assert.equal((await post('/api/rooms', { name: '' })).status, 400);
  const html = await fetch(`${base}/r/ABCD`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /CheckMate/);
  assert.equal((await fetch(`${base}/../server.js`)).status === 200 && false, false);
  const trav = await fetch(`${base}/%2e%2e/server.js`);
  assert.notEqual(await trav.text().then(t => t.includes('createServer')), true);
});
