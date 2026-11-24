import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHall, familyRounds } from '../public/js/hall.js';

// A small synthetic family: Dad, Mom, Noa (+ a guest), five recorded rounds over three dinners.
const members = {
  dad: { id: 'dad', name: 'Dad', avatar: '🥩' },
  mom: { id: 'mom', name: 'Mom', avatar: '🍷' },
  noa: { id: 'noa', name: 'Noa', avatar: '🧁' },
  ben: { id: 'ben', name: 'Ben', avatar: '🍕' }, // never played
};
const g = (memberId, amount, secs, extra = {}) => ({ memberId, name: memberId ? members[memberId].name : 'Uncle', avatar: '🍽️', amount, at: secs * 1000, firstAt: secs * 1000, changes: 0, ...extra });
const round = (id, n, actual, at, guesses) => ({ id, n, label: 'Dinner', actual, startedAt: 0, revealedAt: at, guesses });

export const family = {
  code: 'ABCDEF', name: 'Test family', members,
  dinners: {
    d1: { id: 'd1', title: 'Pizza', currency: '₪', mode: 'classic', rounds: {
      'd1-1': round('d1-1', 1, 400, 1000, { dad: g('dad', 404, 5), mom: g('mom', 300, 12), noa: g('noa', 700, 3) }),
      'd1-2': round('d1-2', 2, 100, 2000, { dad: g('dad', 98, 20), mom: g('mom', 140, 9), noa: g('noa', 60, 4) }),
    } },
    d2: { id: 'd2', title: 'Sushi', currency: '₪', mode: 'classic', rounds: {
      'd2-1': round('d2-1', 1, 1000, 3000, { dad: g('dad', 1000, 30), mom: g('mom', 700, 8), noa: g('noa', 1500, 2), 'guest:uncle': g(null, 990, 1) }),
    } },
    d3: { id: 'd3', title: 'Burgers', currency: '₪', mode: 'classic', rounds: {
      'd3-1': round('d3-1', 1, 200, 4000, { dad: g('dad', 230, 10), mom: g('mom', 210, 10), noa: g('noa', 150, 6) }),
      'd3-2': round('d3-2', 2, 50, 5000, { dad: g('dad', 70, 10), mom: g('mom', 52, 11), noa: g('noa', 30, 7) }),
    } },
  },
};

test('rounds are chronological and computed', () => {
  const rounds = familyRounds(family);
  assert.deepEqual(rounds.map(r => r.id), ['d1-1', 'd1-2', 'd2-1', 'd3-1', 'd3-2']);
});

test('wins, win rate, dinners, streaks and exact guesses', () => {
  const h = buildHall(family);
  const { dad, mom, noa, ben } = h.members;
  // d1-1 Dad, d1-2 Dad, d2-1 Dad (exact), d3-1 Mom, d3-2 Mom
  assert.equal(dad.wins, 3); assert.equal(mom.wins, 2); assert.equal(noa.wins, 0);
  assert.equal(dad.rounds, 5); assert.equal(dad.dinners, 3);
  assert.equal(dad.winRate, 3 / 5);
  assert.equal(dad.longestStreak, 3); assert.equal(dad.curStreak, 0); assert.equal(dad.curLossStreak, 2);
  assert.equal(mom.curStreak, 2);
  assert.equal(noa.curLossStreak, 5); assert.equal(noa.longestLossStreak, 5);
  assert.equal(dad.exact, 1);
  assert.equal(ben.rounds, 0);
  assert.equal(h.players.length, 3, 'members who never played are not ranked');
  assert.deepEqual(h.leaderboard.map(m => m.id), ['dad', 'mom', 'noa']);
});

test('accuracy, tendency, best/worst and timing', () => {
  const { noa, dad } = buildHall(family).members;
  // Noa: +75%, -40%, +50%, -25%, -40% → avg abs 46%, avg signed +4%
  assert.equal(Math.round(noa.avgAbsPct), 46);
  assert.equal(Math.round(noa.avgPct), 4);
  assert.equal(noa.over, 2); assert.equal(noa.under, 3);
  assert.equal(noa.worst.roundId, 'd1-1');
  assert.equal(dad.best.roundId, 'd2-1');
  assert.equal(dad.best.absPct, 0);
  assert.equal(noa.avgTimeMs, (3 + 4 + 2 + 6 + 7) / 5 * 1000);
});

test('head-to-head only counts rounds both played and ignores guests', () => {
  const { dad, mom } = buildHall(family).members;
  assert.deepEqual(dad.h2h.mom, { w: 3, l: 2 });
  assert.deepEqual(mom.h2h.dad, { w: 2, l: 3 });
  assert.equal(Object.keys(dad.h2h).includes('guest:uncle'), false);
});

test('a guest can win a round without anyone being credited', () => {
  const fam = structuredClone(family);
  fam.dinners.d2.rounds['d2-1'].guesses.dad.amount = 950; // now the guest (990) is closest
  const h = buildHall(fam);
  assert.equal(h.members.dad.wins, 2);
  assert.equal(h.members.mom.wins, 2);
});

test('dinner champions and records', () => {
  const h = buildHall(family);
  assert.equal(h.dinnerChampions.d1, 'dad');
  assert.equal(h.dinnerChampions.d3, 'mom');
  assert.equal(h.records.mostExpensive.actual, 1000);
  assert.equal(h.records.cheapest.actual, 50);
  assert.equal(h.records.biggestFail.memberId, 'noa');
  assert.equal(Math.round(h.records.biggestFail.absPct), 75);
  assert.equal(h.records.fastest.memberId, 'noa');
  assert.equal(h.records.fastest.ms, 2000);
  assert.equal(h.totals.spent['₪'], 1750);
  assert.equal(h.totals.dinners, 3);
  assert.equal(h.totals.rounds, 5);
});

test('titles: accountant, champion and disaster', () => {
  const h = buildHall(family);
  const holder = (k) => h.titles.find(t => t.key === k)?.memberId;
  assert.equal(holder('champion'), 'dad');
  assert.equal(holder('accountant'), 'dad');
  assert.equal(holder('disaster'), 'noa');
  assert.equal(holder('speed'), 'noa');
  assert.ok(h.members.dad.badges.includes('exact'));
  assert.ok(h.members.dad.badges.includes('hatTrick'));
  assert.ok(h.members.noa.badges.includes('bigMiss'));
});

test('comeback and roast context are tracked round by round', () => {
  const fam = structuredClone(family);
  fam.dinners.d4 = { id: 'd4', title: 'Thai', currency: '₪', mode: 'classic', rounds: {
    'd4-1': round('d4-1', 1, 300, 6000, { dad: g('dad', 200, 5), mom: g('mom', 200, 5), noa: g('noa', 299, 5) }),
  } };
  const h = buildHall(fam);
  assert.equal(h.members.noa.wins, 1);
  assert.equal(h.members.noa.maxBrokenLossStreak, 5);
  assert.ok(h.members.noa.badges.includes('comeback'));
  assert.equal(h.titles.find(t => t.key === 'comeback').memberId, 'noa');
  // the context *before* d4-1 says Noa had lost 5 in a row and Dad was champion
  assert.equal(h.contexts['d4-1'].noa.lossStreak, 5);
  assert.equal(h.contexts['d4-1'].noa.champion, 'dad');
  assert.ok(h.members.noa.badges.includes('giantSlayer'));
});

test('empty family is handled', () => {
  const h = buildHall({ members: {}, dinners: {} });
  assert.equal(h.leaderboard.length, 0);
  assert.equal(h.records, null);
  assert.equal(h.totals.rounds, 0);
});
