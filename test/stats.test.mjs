import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRoundStats, leaderboard, verdict, median } from '../public/js/stats.js';

const players = [
  { id: 'a', name: 'Mom', avatar: '🍕' },
  { id: 'b', name: 'Dad', avatar: '🍔' },
  { id: 'c', name: 'Noa', avatar: '🌮' },
  { id: 'd', name: 'Ben', avatar: '🍣' },
];
const round = (guesses, actual = 400) => ({ actual, startedAt: 0, guesses });

test('ranks by distance and computes average/median', () => {
  const s = computeRoundStats(round({
    a: { amount: 390, at: 5000 },
    b: { amount: 500, at: 2000 },
    c: { amount: 300, at: 9000, changes: 2 },
    d: { amount: 404, at: 12000 },
  }), players);
  assert.deepEqual(s.rows.map(r => r.pid), ['d', 'a', 'b', 'c']);
  assert.equal(s.average, 398.5);
  assert.equal(s.median, 397);
  assert.equal(s.rows[0].bullseye, true);       // 1% off
  assert.equal(s.rows[0].points, 5 + 3);         // winner + bullseye
  assert.equal(s.rows[1].points, 3);
  assert.equal(s.rows[3].points, 1);
  assert.equal(s.crowdBeats, 4);                 // avg 1.5 off beats everybody
  const keys = Object.fromEntries(s.awards.map(a => [a.key, a.who.pid]));
  assert.equal(keys.closest, 'd');
  assert.equal(keys.fastest, 'b');
  assert.equal(keys.slowest, 'd');
  assert.equal(keys.bigspender, 'b');
  assert.equal(keys.cheapskate, 'c');
  assert.equal(keys.flipflop, 'c');
  assert.equal(keys.farthest, 'b');              // 100 over vs 100 under: tie keeps first found
});

test('"don\'t go over" mode busts guesses above the bill', () => {
  const s = computeRoundStats(round({ a: { amount: 401, at: 1 }, b: { amount: 350, at: 2 } }), players, 'nover');
  assert.equal(s.rows[0].pid, 'b');
  assert.equal(s.rows[1].busted, true);
  assert.equal(s.rows[1].points, 0);
});

test('ties are broken by who answered first', () => {
  const s = computeRoundStats(round({ a: { amount: 410, at: 900 }, b: { amount: 390, at: 100 } }), players);
  assert.equal(s.rows[0].pid, 'b');
});

test('guesses from removed players are ignored', () => {
  const s = computeRoundStats(round({ a: { amount: 400, at: 1 }, zzz: { amount: 1, at: 1 } }), players);
  assert.equal(s.n, 1);
});

test('leaderboard sums points over revealed rounds only', () => {
  const rounds = [
    round({ a: { amount: 400, at: 1 }, b: { amount: 300, at: 2 } }),
    round({ a: { amount: 100, at: 1 }, b: { amount: 200, at: 2 } }, 200),
    { actual: null, startedAt: 0, guesses: { a: { amount: 1, at: 1 } } },
  ];
  const board = leaderboard(rounds, players);
  assert.equal(board.length, 2);
  assert.equal(board[0].points, board[1].points); // each won one round with a bullseye
  assert.deepEqual(board.find(b => b.pid === 'a').perRound, [8, 3]);
});

test('verdicts and median helpers', () => {
  assert.equal(verdict(0.5).text, 'Human calculator');
  assert.equal(verdict(-60).text, 'Has never paid a bill');
  assert.equal(verdict(30).text, 'Thinks we ate lobster');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});
