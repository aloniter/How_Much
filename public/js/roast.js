// The Roast: picks a personal, context-aware joke for every player from the template library.
// Deterministic (same round → same roasts on every phone) and rotating (the same person never
// gets the same line for the same situation twice in a row across dinners).
import { LINES } from './roast-lines.js';

export function hash(str) { // FNV-1a
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rand01 = (seed) => (hash(seed) % 10000) / 10000;

/** Facts about one player's performance this round (+ history context when we have it). */
export function roastFacts(stats, row, ctx, nameOfMember, memberOf = (pid) => pid) {
  nameOfMember ||= () => null;
  const rows = stats.rows;
  const n = stats.n;
  const times = rows.map(r => r.firstTimeMs);
  const isWinner = row.rank === 1 && !row.busted;
  const firstAmount = row.firstAmount ?? row.amount;
  const firstErr = Math.abs(firstAmount - stats.actual);
  const f = {
    n, rank: row.rank, isWinner, busted: row.busted,
    isLast: n >= 2 && row.rank === n && !isWinner,
    exact: row.diff === 0, bullseye: row.diff !== 0 && row.absPct <= 1,
    absPct: row.absPct, over: row.diff > 0,
    secs: Math.max(1, Math.round(row.firstTimeMs / 1000)),
    fastest: n >= 2 && row.firstTimeMs === Math.min(...times),
    slowest: n >= 2 && row.firstTimeMs === Math.max(...times),
    changes: row.changes, firstAmount,
    flipWorse: row.changes >= 1 && firstErr < row.absDiff,
    flipBetter: row.changes >= 1 && firstErr > row.absDiff,
    crowdBeat: n >= 3 && Math.abs(stats.avgDiff) < row.absDiff && row.rank > Math.ceil(n / 2),
    played: 0, lossStreak: 0, winStreak: 0, firstWin: false, comeback: 0,
    personalBest: false, worstEver: false, rival: null, beatRival: false, rivalBeatYou: false,
  };
  if (ctx) {
    f.played = ctx.played + 1;
    f.lossStreak = isWinner ? 0 : ctx.lossStreak + 1;
    f.winStreak = isWinner ? ctx.winStreak + 1 : 0;
    f.firstWin = isWinner && ctx.played >= 2 && ctx.wins === 0;
    f.comeback = isWinner && ctx.lossStreak >= 3 ? ctx.lossStreak : 0;
    f.personalBest = ctx.played >= 3 && ctx.bestAbsPct != null && row.absPct < ctx.bestAbsPct && row.diff !== 0 && row.absPct < 10;
    f.worstEver = ctx.played >= 3 && ctx.worstAbsPct != null && row.absPct > ctx.worstAbsPct && row.absPct >= 15;
    // rival = someone at this table who has beaten you clearly more often than you beat them
    let best = null;
    for (const o of rows) {
      if (o.pid === row.pid) continue;
      const rec = ctx.h2h[memberOf(o.pid)];
      if (!rec || rec.l < 2 || rec.l - rec.w < 1) continue;
      const edge = rec.l - rec.w;
      if (!best || edge > best.edge) best = { edge, row: o };
    }
    if (best) {
      f.rival = nameOfMember(best.row.pid) || best.row.name;
      f.beatRival = row.rank < best.row.rank;
      f.rivalBeatYou = row.rank > best.row.rank;
    }
  }
  return f;
}

/** Which situation to joke about, plus an optional secondary "kicker". */
export function chooseAngle(f, seed) {
  const c = [];
  const add = (angle, w) => c.push({ angle, w });
  if (f.isWinner) {
    if (f.exact) add('exact', 100);
    if (f.bullseye) add('bullseye', 90);
    if (f.comeback) add('comeback', 85);
    if (f.firstWin) add('firstWin', 82);
    if (f.winStreak >= 2) add('winStreak', 75);
    if (f.beatRival) add('beatRival', 72);
    if (f.fastest && f.n >= 2) add('fastRight', 62);
    if (f.personalBest) add('personalBest', 58);
    add(f.absPct > 10 ? 'winnerLucky' : 'winnerClose', 50);
    return pick(c, seed, 'compliment', f);
  }
  if (f.isLast) {
    const angle = f.fastest && f.n >= 3 ? 'fastLast' : 'disaster';
    return { angle, kind: 'disaster', kicker: chooseKicker(f, angle, seed) };
  }
  if (f.busted) add('busted', 80);
  if (f.exact) add('exact', 95);
  if (f.bullseye) add('bullseye', 88);
  if (f.lossStreak >= 3) add('lossStreak', 70);
  if (f.flipWorse) add('flipWorse', 66);
  if (f.rank === 2 && f.absPct <= 5) add('nearMiss', 64);
  if (f.fastest && f.rank > Math.ceil(f.n / 2)) add('fastWrong', 60);
  if (f.worstEver) add('worstEver', 58);
  if (f.personalBest) add('personalBest', 58);
  if (f.slowest && f.secs >= 20) add('slow', 56);
  if (f.beatRival) add('beatRival', 55);
  if (f.absPct > 40) add(f.over ? 'wayOver' : 'wayUnder', 55);
  else if (f.absPct >= 15) add(f.over ? 'over' : 'under', 45);
  if (f.crowdBeat) add('crowdBeat', 50);
  if (f.flipBetter) add('flipBetter', 40);
  add('middle', 25);
  return pick(c, seed, 'roast', f);
}

function pick(cands, seed, kind, f) {
  const top = Math.max(...cands.map(x => x.w));
  const close = cands.filter(x => x.w >= top - 12);
  const angle = close[hash(seed + ':angle') % close.length].angle;
  return { angle, kind, kicker: kind === 'compliment' ? null : chooseKicker(f, angle, seed) };
}

function chooseKicker(f, angle, seed) {
  const k = [];
  if (f.slowest && f.secs >= 15 && angle !== 'slow') k.push('slow');
  if (f.fastest && !['fastWrong', 'fastLast', 'fastRight'].includes(angle)) k.push('fast');
  if (f.changes >= 2 && !angle.startsWith('flip')) k.push('flip');
  if (f.lossStreak >= 3 && angle !== 'lossStreak') k.push('loss');
  if (f.crowdBeat && angle !== 'crowdBeat') k.push('crowd');
  if (f.rivalBeatYou) k.push('rival');
  if (!k.length || rand01(seed + ':kick') > 0.6) return null;
  return k[hash(seed + ':kicker') % k.length];
}

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

/**
 * Roast every player in a round.
 * @param {object} o
 * @param {object} o.stats          computeRoundStats result
 * @param {string} o.roundId        stable id (same on every phone)
 * @param {'en'|'he'} o.lang
 * @param {(pid:string)=>string} [o.memberOf]   pid → stable person key (family member id when known)
 * @param {(pid:string)=>object|null} [o.ctxOf] history before this round, per pid
 * @param {(pid:string)=>string|null} [o.nameOf] display name for a pid (for rival names)
 * @param {Map<string,number>} [o.used]  how often each person already got each angle (for rotation)
 * @param {{money:(v:number)=>string, pct:(v:number)=>string}} o.fmt
 */
export function roastRound(o) {
  const L = LINES[o.lang] || LINES.en;
  const memberOf = o.memberOf || ((pid) => pid);
  const out = [];
  for (const row of o.stats.rows) {
    const who = memberOf(row.pid);
    const ctx = o.ctxOf ? o.ctxOf(row.pid) : null;
    const f = roastFacts(o.stats, row, ctx, o.nameOf, memberOf);
    const seed = `${o.roundId}|${who}`;
    const choice = chooseAngle(f, seed);
    const pool = L[choice.angle] || L.middle;
    // rotation: with history, walk through the pool one step per use; without, a seeded spot
    const used = o.used?.get(`${who}|${choice.angle}`) || 0;
    const base = hash(`${who}|${choice.angle}${o.used ? '' : '|' + o.roundId}`);
    const vars = {
      guess: o.fmt.money(row.amount), actual: o.fmt.money(o.stats.actual), diff: o.fmt.money(row.absDiff),
      pct: o.fmt.pct(row.absPct), secs: f.secs, changes: f.changes, first: o.fmt.money(f.firstAmount),
      streak: f.isWinner ? f.winStreak : f.lossStreak, lost: f.comeback, played: f.played,
      rival: f.rival || '', avg: o.fmt.money(Math.round(o.stats.average ?? 0)), rank: row.rank, n: f.n,
    };
    let text = fill(pool[(base + used) % pool.length], vars);
    if (choice.kicker) {
      const kp = L.kickers[choice.kicker];
      text += ' ' + fill(kp[hash(seed + ':kp') % kp.length], vars);
    }
    out.push({
      pid: row.pid, who, name: row.name, avatar: row.avatar, rank: row.rank, n: f.n,
      angle: choice.angle, kicker: choice.kicker, kind: choice.kind, text,
      intro: choice.kind === 'disaster' ? L.intros[hash(seed + ':intro') % L.intros.length] : null,
      amount: row.amount, pct: row.pct,
    });
  }
  // Show order: champion first, then the middle of the pack, the biggest failure as the finale.
  const rank = { compliment: 0, roast: 1, disaster: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.rank - b.rank);
}

/**
 * For rotation: how many times each person has already been roasted from each angle, replaying the
 * family's history (chronologically) up to — not including — `untilRoundId`.
 */
export function angleUsage(hall, untilRoundId, statsFor = (fr) => fr.stats) {
  const used = new Map();
  for (const fr of hall.rounds) {
    if (fr.id === untilRoundId) break;
    const ctxs = hall.contexts[fr.id] || {};
    const memberOf = (key) => fr.players.find(p => p.id === key)?.memberId || key;
    const stats = statsFor(fr);
    for (const row of stats.rows) {
      const mid = memberOf(row.pid);
      const f = roastFacts(stats, row, ctxs[mid] || null, null, memberOf);
      const { angle } = chooseAngle(f, `${fr.id}|${mid}`);
      used.set(`${mid}|${angle}`, (used.get(`${mid}|${angle}`) || 0) + 1);
    }
  }
  return used;
}
