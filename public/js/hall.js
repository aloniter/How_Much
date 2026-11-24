// Family Hall of Fame: turns the permanent dinner history into championship statistics,
// records, titles and achievements. Pure functions — shared by the browser and the Node tests.
import { computeRoundStats } from './stats.js';

export const MIN_ROUNDS_FOR_TITLES = 3;

/** Flatten a family's dinners into chronological rounds with their computed results. */
export function familyRounds(family) {
  const out = [];
  for (const d of Object.values(family?.dinners || {})) {
    for (const r of Object.values(d.rounds || {})) {
      if (!(r.actual > 0)) continue;
      const players = Object.entries(r.guesses || {}).map(([key, g]) => {
        const m = g.memberId && family.members[g.memberId];
        return { id: key, memberId: m ? m.id : null, name: m ? m.name : g.name, avatar: m ? m.avatar : g.avatar };
      });
      const stats = computeRoundStats(r, players, d.mode || 'classic');
      out.push({ id: r.id, dinner: d, round: r, players, stats, at: r.revealedAt || r.startedAt || d.createdAt || 0 });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.round.n - b.round.n);
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function emptyMember(m) {
  return {
    id: m.id, name: m.name, avatar: m.avatar,
    rounds: 0, dinnerIds: new Set(), dinners: 0, wins: 0, winRate: 0, points: 0, dinnerTitles: 0,
    absPcts: [], pcts: [], times: [], avgAbsPct: null, avgPct: null, avgTimeMs: null,
    over: 0, under: 0, exact: 0, bullseyes: 0, busts: 0, changes: 0,
    best: null, worst: null, fastest: null,
    curStreak: 0, longestStreak: 0, curLossStreak: 0, longestLossStreak: 0, maxBrokenLossStreak: 0,
    h2h: {}, history: [], badges: [], titles: [],
    giantSlayer: false, dinnerTitle: false,
  };
}

/**
 * Everything the Hall of Fame screen shows, plus a per-round "what did we know before this round"
 * context that the roast engine uses for streaks, rivalries and personal records.
 */
export function buildHall(family) {
  const rounds = familyRounds(family);
  const members = {};
  for (const m of Object.values(family?.members || {})) members[m.id] = emptyMember(m);
  const contexts = {}; // roundId -> memberId -> context before that round

  for (const fr of rounds) {
    const rows = fr.stats.rows.filter(r => r.pid && members[fr.players.find(p => p.id === r.pid)?.memberId]);
    const rowMember = (r) => fr.players.find(p => p.id === r.pid).memberId;
    // reigning champion before this round = most wins so far
    const champ = Object.values(members).filter(m => m.wins > 0).sort((a, b) => b.wins - a.wins)[0] || null;

    const ctx = {};
    for (const r of rows) {
      const m = members[rowMember(r)];
      ctx[m.id] = {
        played: m.rounds, wins: m.wins, winStreak: m.curStreak, lossStreak: m.curLossStreak,
        bestAbsPct: m.best ? m.best.absPct : null, worstAbsPct: m.worst ? m.worst.absPct : null,
        h2h: JSON.parse(JSON.stringify(m.h2h)), champion: champ ? champ.id : null,
      };
    }
    contexts[fr.id] = ctx;

    const date = fr.at;
    for (const r of rows) {
      const m = members[rowMember(r)];
      const won = r.rank === 1 && !r.busted;
      m.rounds++;
      m.dinnerIds.add(fr.dinner.id);
      m.points += r.points;
      m.absPcts.push(r.absPct); m.pcts.push(r.pct); m.times.push(r.firstTimeMs);
      if (r.diff > 0) m.over++; else if (r.diff < 0) m.under++;
      if (r.diff === 0) m.exact++;
      if (r.bullseye) m.bullseyes++;
      if (r.busted) m.busts++;
      m.changes += r.changes;
      const ref = { absPct: r.absPct, pct: r.pct, amount: r.amount, actual: fr.stats.actual, roundId: fr.id, title: fr.dinner.title, label: fr.round.label, currency: fr.dinner.currency, at: date };
      if (!m.best || r.absPct < m.best.absPct) m.best = ref;
      if (!m.worst || r.absPct > m.worst.absPct) m.worst = ref;
      if (!m.fastest || r.firstTimeMs < m.fastest.ms) m.fastest = { ms: r.firstTimeMs, roundId: fr.id, at: date };
      if (won) {
        if (m.curLossStreak >= 3) m.maxBrokenLossStreak = Math.max(m.maxBrokenLossStreak, m.curLossStreak);
        if (champ && champ.id !== m.id && rows.some(x => rowMember(x) === champ.id)) m.giantSlayer = true;
        m.wins++; m.curStreak++; m.curLossStreak = 0;
        m.longestStreak = Math.max(m.longestStreak, m.curStreak);
      } else {
        m.curStreak = 0; m.curLossStreak++;
        m.longestLossStreak = Math.max(m.longestLossStreak, m.curLossStreak);
      }
      m.history.push({ roundId: fr.id, rank: r.rank, n: fr.stats.n, absPct: r.absPct, pct: r.pct, win: won, at: date, amount: r.amount, actual: fr.stats.actual });
      for (const o of rows) { // head-to-head: who finished higher in rounds you both played
        const oid = rowMember(o);
        if (oid === m.id) continue;
        const rec = m.h2h[oid] ??= { w: 0, l: 0 };
        if (r.rank < o.rank) rec.w++; else rec.l++;
      }
    }
  }

  // Dinner champions: most points over all rounds of one dinner (ties → more round wins → better accuracy).
  const byDinner = {};
  for (const fr of rounds) (byDinner[fr.dinner.id] ??= []).push(fr);
  const dinnerChampions = {};
  for (const [did, list] of Object.entries(byDinner)) {
    const score = {};
    for (const fr of list) {
      for (const r of fr.stats.rows) {
        const mid = fr.players.find(p => p.id === r.pid)?.memberId;
        if (!mid || !members[mid]) continue;
        const s = score[mid] ??= { id: mid, points: 0, wins: 0, err: [] };
        s.points += r.points; s.err.push(r.absPct);
        if (r.rank === 1 && !r.busted) s.wins++;
      }
    }
    const best = Object.values(score).sort((a, b) => b.points - a.points || b.wins - a.wins || mean(a.err) - mean(b.err))[0];
    if (best) { dinnerChampions[did] = best.id; members[best.id].dinnerTitles++; }
  }

  for (const m of Object.values(members)) {
    m.dinners = m.dinnerIds.size;
    delete m.dinnerIds;
    m.winRate = m.rounds ? m.wins / m.rounds : 0;
    m.avgAbsPct = mean(m.absPcts);
    m.avgPct = mean(m.pcts);
    m.avgTimeMs = mean(m.times);
    m.badges = badgesFor(m);
  }

  const players = Object.values(members).filter(m => m.rounds > 0);
  const leaderboard = [...players].sort((a, b) =>
    b.wins - a.wins || b.winRate - a.winRate || b.points - a.points || a.avgAbsPct - b.avgAbsPct);
  leaderboard.forEach((m, i) => {
    const prev = leaderboard[i - 1];
    m.place = prev && prev.wins === m.wins && prev.winRate === m.winRate && prev.points === m.points && prev.avgAbsPct === m.avgAbsPct ? prev.place : i + 1;
  });

  const titles = awardTitles(players);
  for (const t of titles) members[t.memberId].titles.push(t);

  return { rounds, members, players, leaderboard, titles, records: familyRecords(rounds, members), dinnerChampions, contexts, totals: totals(rounds) };
}

function totals(rounds) {
  const spent = {};
  for (const fr of rounds) {
    const c = fr.dinner.currency || '';
    spent[c] = (spent[c] || 0) + fr.stats.actual;
  }
  const counts = {};
  for (const fr of rounds) counts[fr.dinner.currency || ''] = (counts[fr.dinner.currency || ''] || 0) + 1;
  const mainCurrency = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? '';
  const allErr = rounds.flatMap(fr => fr.stats.rows.map(r => r.absPct));
  return {
    dinners: new Set(rounds.map(fr => fr.dinner.id)).size,
    rounds: rounds.length,
    guesses: allErr.length,
    spent, mainCurrency,
    avgAbsPct: mean(allErr),
    exact: rounds.reduce((s, fr) => s + fr.stats.rows.filter(r => r.diff === 0).length, 0),
  };
}

function familyRecords(rounds, members) {
  if (!rounds.length) return null;
  const { mainCurrency } = totals(rounds);
  const inMain = rounds.filter(fr => (fr.dinner.currency || '') === mainCurrency);
  const ref = (fr) => ({ roundId: fr.id, title: fr.dinner.title, label: fr.round.label, at: fr.at, currency: fr.dinner.currency, actual: fr.stats.actual });
  const maxBy = (xs, f) => xs.reduce((best, x) => (best == null || f(x) > f(best) ? x : best), null);
  const minBy = (xs, f) => maxBy(xs, x => -f(x));
  const pricey = maxBy(inMain, fr => fr.stats.actual);
  const cheap = minBy(inMain, fr => fr.stats.actual);
  const crowds = rounds.filter(fr => fr.stats.n >= 2);
  const wise = minBy(crowds, fr => Math.abs(fr.stats.avgPct));
  const memberRows = rounds.flatMap(fr => fr.stats.rows.map(r => ({ fr, r, mid: fr.players.find(p => p.id === r.pid)?.memberId })))
    .filter(x => x.mid && members[x.mid]);
  const fail = maxBy(memberRows, x => x.r.absPct);
  const quick = minBy(memberRows, x => x.r.firstTimeMs);
  const crowded = maxBy(rounds, fr => fr.stats.n);
  return {
    mostExpensive: pricey && ref(pricey),
    cheapest: cheap && ref(cheap),
    wisestCrowd: wise && { ...ref(wise), avgPct: wise.stats.avgPct, n: wise.stats.n },
    biggestFail: fail && { ...ref(fail.fr), memberId: fail.mid, amount: fail.r.amount, pct: fail.r.pct, absPct: fail.r.absPct },
    fastest: quick && { ...ref(quick.fr), memberId: quick.mid, ms: quick.r.firstTimeMs },
    biggestTable: crowded && { ...ref(crowded), n: crowded.stats.n },
  };
}

/** Evolving titles: each has one holder at a time, recalculated from the whole history. */
export const TITLE_DEFS = [
  { key: 'accountant', emoji: '🧮' },
  { key: 'champion', emoji: '👑' },
  { key: 'denier', emoji: '📉' },
  { key: 'michelin', emoji: '⭐' },
  { key: 'calculator', emoji: '🤖' },
  { key: 'disaster', emoji: '💥' },
  { key: 'oneHit', emoji: '🎸' },
  { key: 'comeback', emoji: '🔁' },
  { key: 'speed', emoji: '⚡' },
  { key: 'philosopher', emoji: '🐢' },
  { key: 'regular', emoji: '🍽️' },
];

function awardTitles(players) {
  const q = players.filter(m => m.rounds >= MIN_ROUNDS_FOR_TITLES);
  const out = [];
  const give = (key, m, value) => { if (m) out.push({ key, emoji: TITLE_DEFS.find(t => t.key === key).emoji, memberId: m.id, value }); };
  const best = (xs, f) => xs.reduce((b, x) => (b == null || f(x) > f(b) ? x : b), null);

  give('accountant', best(q, m => -m.avgAbsPct), null);
  const champ = best(players.filter(m => m.wins > 0), m => m.wins * 1000 + m.winRate);
  give('champion', champ, champ?.wins);
  const deniers = q.filter(m => m.avgPct <= -8 && m.under / m.rounds >= 0.7);
  const denier = best(deniers, m => -m.avgPct); give('denier', denier, denier?.avgPct);
  const michelins = q.filter(m => m.avgPct >= 8 && m.over / m.rounds >= 0.7);
  const mich = best(michelins, m => m.avgPct); give('michelin', mich, mich?.avgPct);
  const calc = best(players.filter(m => m.bullseyes >= 2), m => m.bullseyes * 100 - m.avgAbsPct); give('calculator', calc, calc?.bullseyes);
  const disasters = q.filter(m => m.avgAbsPct >= 25);
  const dis = best(disasters, m => m.avgAbsPct); give('disaster', dis, dis?.avgAbsPct);
  const oneHits = players.filter(m => m.wins === 1 && m.curLossStreak >= 4);
  const oh = best(oneHits, m => m.curLossStreak); give('oneHit', oh, oh?.curLossStreak);
  const cb = best(players.filter(m => m.maxBrokenLossStreak >= 3), m => m.maxBrokenLossStreak); give('comeback', cb, cb?.maxBrokenLossStreak);
  if (q.length >= 2) {
    const fast = best(q, m => -m.avgTimeMs); give('speed', fast, fast?.avgTimeMs);
    const slow = best(q, m => m.avgTimeMs);
    if (slow && slow !== fast && slow.avgTimeMs >= 15000) give('philosopher', slow, slow.avgTimeMs);
  }
  const reg = best(players.filter(m => m.dinners >= 3), m => m.dinners * 1000 + m.rounds); give('regular', reg, reg?.dinners);
  return out;
}

/** Achievements: unlocked once, kept forever. */
export const BADGE_DEFS = [
  { key: 'firstWin', emoji: '🥇' },
  { key: 'hatTrick', emoji: '🔥' },
  { key: 'bullseye', emoji: '🎯' },
  { key: 'exact', emoji: '🤯' },
  { key: 'dinnerChamp', emoji: '👑' },
  { key: 'speedDemon', emoji: '⚡' },
  { key: 'giantSlayer', emoji: '🗡️' },
  { key: 'comeback', emoji: '🔁' },
  { key: 'bigMiss', emoji: '💥' },
  { key: 'regular5', emoji: '🍽️' },
  { key: 'veteran20', emoji: '🏅' },
];

function badgesFor(m) {
  const has = {
    firstWin: m.wins >= 1,
    hatTrick: m.longestStreak >= 3,
    bullseye: m.bullseyes >= 1,
    exact: m.exact >= 1,
    dinnerChamp: m.dinnerTitles >= 1,
    speedDemon: m.fastest != null && m.fastest.ms < 5000,
    giantSlayer: m.giantSlayer,
    comeback: m.maxBrokenLossStreak >= 3,
    bigMiss: m.worst != null && m.worst.absPct >= 50,
    regular5: m.dinners >= 5,
    veteran20: m.rounds >= 20,
  };
  return BADGE_DEFS.filter(b => has[b.key]).map(b => b.key);
}

/** Members that one member most often loses to / beats (for profiles and roasts). */
export function rivalries(member, members) {
  return Object.entries(member.h2h)
    .filter(([oid]) => members[oid])
    .map(([oid, rec]) => ({ id: oid, name: members[oid].name, avatar: members[oid].avatar, ...rec, played: rec.w + rec.l }))
    .sort((a, b) => b.played - a.played || (b.l - b.w) - (a.l - a.w));
}
