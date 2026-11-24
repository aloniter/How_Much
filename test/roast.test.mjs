import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRoundStats } from '../public/js/stats.js';
import { roastRound, angleUsage, chooseAngle, roastFacts } from '../public/js/roast.js';
import { LINES } from '../public/js/roast-lines.js';
import { buildHall } from '../public/js/hall.js';
import { family } from './hall.test.mjs';

const fmt = { money: (v) => '₪' + v, pct: (v) => v.toFixed(1) + '%' };
const players = [
  { id: 'a', name: 'Mom', avatar: '🍷' }, { id: 'b', name: 'Dad', avatar: '🥩' },
  { id: 'c', name: 'Noa', avatar: '🧁' }, { id: 'd', name: 'Ben', avatar: '🍕' },
];
const round = { actual: 600, startedAt: 0, guesses: {
  a: { amount: 602, at: 9000, firstAt: 9000 },
  b: { amount: 1400, at: 2000, firstAt: 2000 },
  c: { amount: 480, at: 47000, firstAt: 47000 },
  d: { amount: 640, at: 15000, firstAt: 8000, firstAmount: 610, changes: 4 },
} };

test('every player gets one roast; winner first, biggest failure last', () => {
  const stats = computeRoundStats(round, players);
  for (const lang of ['en', 'he']) {
    const r = roastRound({ stats, roundId: 'R1', lang, fmt });
    assert.equal(r.length, 4);
    assert.equal(r[0].pid, 'a'); assert.equal(r[0].kind, 'compliment');
    assert.equal(r[3].pid, 'b'); assert.equal(r[3].kind, 'disaster');
    assert.ok(r[3].intro);
    for (const x of r) {
      assert.ok(x.text.length > 10);
      assert.doesNotMatch(x.text, /\{\w+\}/, 'no unfilled placeholders');
      assert.doesNotMatch(x.text, /undefined|NaN/);
    }
  }
});

test('roasts are deterministic (same on every phone)', () => {
  const stats = computeRoundStats(round, players);
  const a = roastRound({ stats, roundId: 'R1', lang: 'en', fmt }).map(x => x.text);
  const b = roastRound({ stats, roundId: 'R1', lang: 'en', fmt }).map(x => x.text);
  assert.deepEqual(a, b);
});

test('context-aware angles: flip-flop made it worse, slow, bullseye', () => {
  const stats = computeRoundStats(round, players);
  const facts = Object.fromEntries(stats.rows.map(r => [r.pid, roastFacts(stats, r, null)]));
  assert.equal(facts.d.flipWorse, true);
  assert.equal(facts.c.slowest, true);
  assert.equal(facts.a.bullseye, true);
  assert.equal(facts.b.fastest, true);
  assert.equal(chooseAngle(facts.b, 'x').angle, 'fastLast'); // fastest + last = "impressive efficiency"
});

test('history: loss streaks, rivals and first wins reach the jokes', () => {
  const stats = computeRoundStats(round, players);
  const ctx = {
    c: { played: 6, wins: 0, winStreak: 0, lossStreak: 6, bestAbsPct: 5, worstAbsPct: 60, h2h: { a: { w: 0, l: 5 } } },
    a: { played: 4, wins: 0, winStreak: 0, lossStreak: 4, bestAbsPct: 3, worstAbsPct: 30, h2h: {} },
  };
  const f = roastFacts(stats, stats.rows.find(r => r.pid === 'c'), ctx.c, (pid) => players.find(p => p.id === pid).name);
  assert.equal(f.lossStreak, 7);
  assert.equal(f.rival, 'Mom');
  assert.equal(f.rivalBeatYou, true);
  const w = roastFacts(stats, stats.rows.find(r => r.pid === 'a'), ctx.a);
  assert.equal(w.firstWin, true);
  assert.equal(w.comeback, 4);
});

test('rotation: the same person in the same situation gets a different line next time', () => {
  const stats = computeRoundStats(round, players);
  const seen = new Set();
  const used = new Map();
  for (let i = 0; i < 4; i++) {
    const r = roastRound({ stats, roundId: 'same', lang: 'en', fmt, used, memberOf: (pid) => 'member-' + pid });
    const dad = r.find(x => x.pid === 'b');
    seen.add(dad.text.split('. ')[0]);
    used.set(`member-b|${dad.angle}`, (used.get(`member-b|${dad.angle}`) || 0) + 1);
  }
  assert.equal(seen.size, 4, 'four different disaster lines in four dinners');
});

test('angle usage replays a family history', () => {
  const hall = buildHall(family);
  const used = angleUsage(hall, null);
  const total = [...used.values()].reduce((s, v) => s + v, 0);
  assert.equal(total, hall.rounds.reduce((s, fr) => s + fr.stats.rows.length, 0));
});

test('library is big, symmetric, and Hebrew lines are really Hebrew', () => {
  for (const lang of ['en', 'he']) {
    const L = LINES[lang];
    const angles = Object.keys(L).filter(k => Array.isArray(L[k]) && k !== 'intros');
    assert.ok(angles.length >= 25);
    const count = angles.reduce((s, a) => s + L[a].length, 0);
    assert.ok(count >= 120, `${lang} has ${count} lines`);
    for (const a of angles) assert.ok(L[a].length >= 2, `${lang}.${a}`);
  }
  assert.deepEqual(Object.keys(LINES.en).sort(), Object.keys(LINES.he).sort());
  for (const a of Object.keys(LINES.he)) {
    if (!Array.isArray(LINES.he[a])) continue;
    for (const line of LINES.he[a]) assert.match(line, /[֐-׿]/);
  }
});
