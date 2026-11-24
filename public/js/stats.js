// Pure scoring/statistics logic — shared by the browser app and the Node tests.

export const POINTS_BY_RANK = [5, 3, 2];
export const PARTICIPATION_POINTS = 1;
export const BULLSEYE_PCT = 1; // within 1% = bullseye bonus
export const BULLSEYE_BONUS = 3;

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A funny one-liner (translation key) based on how far, and which way, someone was off. */
export function verdict(pct) {
  const a = Math.abs(pct);
  const under = pct < 0;
  if (a < 1) return { emoji: '🎯', key: 'calc' };
  if (a < 3) return { emoji: '🦅', key: 'eagle' };
  if (a < 7) return { emoji: '😎', key: 'sharp' };
  if (a < 15) return { emoji: '🙂', key: 'notbad' };
  if (a < 25) return under ? { emoji: '🧾', key: 'drinks' } : { emoji: '🍾', key: 'champagne' };
  if (a < 50) return under ? { emoji: '🕰️', key: 'prices2015' } : { emoji: '🦞', key: 'lobster' };
  return under ? { emoji: '🧒', key: 'neverPaid' } : { emoji: '🤑', key: 'buyRestaurant' };
}

/**
 * Compute everything the results screen needs for one revealed round.
 * @param {{actual:number, startedAt:number, guesses:Record<string,{amount:number, at:number, firstAt?:number, changes?:number, quote?:string}>}} round
 * @param {{id:string, name:string, avatar:string}[]} players
 * @param {'classic'|'nover'} mode  classic = closest wins; nover = closest without going over
 */
export function computeRoundStats(round, players, mode = 'classic') {
  const actual = round.actual;
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const rows = Object.entries(round.guesses)
    .filter(([pid, g]) => byId[pid] && typeof g.amount === 'number')
    .map(([pid, g]) => {
      const diff = g.amount - actual;
      const pct = actual ? (diff / actual) * 100 : 0;
      return {
        pid,
        name: byId[pid].name,
        avatar: byId[pid].avatar,
        amount: g.amount,
        diff,
        absDiff: Math.abs(diff),
        pct,
        absPct: Math.abs(pct),
        timeMs: Math.max(0, (g.at ?? round.startedAt) - round.startedAt),
        firstTimeMs: Math.max(0, (g.firstAt ?? g.at ?? round.startedAt) - round.startedAt),
        changes: g.changes || 0,
        quote: g.quote || '',
        busted: mode === 'nover' && g.amount > actual,
        verdict: verdict(pct),
      };
    });

  rows.sort((a, b) => (a.busted - b.busted) || (a.absDiff - b.absDiff) || (a.timeMs - b.timeMs));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.bullseye = !r.busted && r.absPct <= BULLSEYE_PCT;
    r.points = r.busted ? 0 : (POINTS_BY_RANK[i] ?? PARTICIPATION_POINTS) + (r.bullseye ? BULLSEYE_BONUS : 0);
  });

  const amounts = rows.map(r => r.amount);
  const n = rows.length;
  const average = n ? amounts.reduce((s, v) => s + v, 0) / n : null;
  const med = median(amounts);
  const avgDiff = average == null ? null : average - actual;
  const avgPct = average == null || !actual ? null : (avgDiff / actual) * 100;
  const crowdBeats = average == null ? 0 : rows.filter(r => r.absDiff > Math.abs(avgDiff)).length;
  const meanAbsPct = n ? rows.reduce((s, r) => s + r.absPct, 0) / n : null;

  // Each award: { key (unique), type (translation key), emoji, who, detail: {key, vars} }
  const awards = [];
  const add = (type, emoji, who, detailKey, vars = {}, key = type) => awards.push({ key, type, emoji, who, detail: { key: detailKey, vars } });
  if (n) {
    const pick = (cmp) => [...rows].sort(cmp)[0];
    const winner = rows[0];
    if (!winner.busted) add('closest', '🏆', winner, ...offDetail(winner));
    if (n > 1) {
      const worst = pick((a, b) => b.absDiff - a.absDiff);
      add('farthest', '🤡', worst, ...offDetail(worst));
      const fast = pick((a, b) => a.firstTimeMs - b.firstTimeMs);
      add('fastest', '⚡', fast, 'answeredIn', { ms: fast.firstTimeMs });
      const slow = pick((a, b) => b.firstTimeMs - a.firstTimeMs);
      if (slow.pid !== fast.pid) add('slowest', '🐢', slow, 'took', { ms: slow.firstTimeMs });
      const high = pick((a, b) => b.amount - a.amount);
      add('bigspender', '💸', high, 'highest');
      const low = pick((a, b) => a.amount - b.amount);
      if (low.pid !== high.pid) add('cheapskate', '🪙', low, 'lowest');
      const flip = pick((a, b) => b.changes - a.changes);
      if (flip.changes >= 1) add('flipflop', '🔄', flip, 'changed', { n: flip.changes });
      if (n >= 3) {
        const mid = pick((a, b) => Math.abs(a.amount - average) - Math.abs(b.amount - average));
        add('average', '😐', mid, 'closestAvg');
      }
    }
    for (const r of rows.filter(r => r.bullseye)) add('bullseye', '🎯', r, 'within', { p: BULLSEYE_PCT, b: BULLSEYE_BONUS }, 'bullseye-' + r.pid);
    if (mode === 'nover') {
      for (const r of rows.filter(r => r.busted)) add('busted', '💥', r, 'wentOver', {}, 'bust-' + r.pid);
    }
  }

  return {
    actual,
    rows,
    n,
    average,
    median: med,
    avgDiff,
    avgPct,
    crowdBeats,
    meanAbsPct,
    over: rows.filter(r => r.diff > 0).length,
    under: rows.filter(r => r.diff < 0).length,
    exact: rows.filter(r => r.diff === 0).length,
    min: n ? Math.min(...amounts) : null,
    max: n ? Math.max(...amounts) : null,
    awards,
  };
}

/** Cumulative points across all revealed rounds. */
export function leaderboard(rounds, players, mode = 'classic') {
  const totals = Object.fromEntries(players.map(p => [p.id, { pid: p.id, name: p.name, avatar: p.avatar, points: 0, wins: 0, played: 0, perRound: [] }]));
  for (const round of rounds) {
    if (round.actual == null) continue;
    const stats = computeRoundStats(round, players, mode);
    const got = Object.fromEntries(stats.rows.map(r => [r.pid, r]));
    for (const t of Object.values(totals)) {
      const r = got[t.pid];
      t.perRound.push(r ? r.points : 0);
      if (r) { t.points += r.points; t.played++; if (r.rank === 1 && !r.busted) t.wins++; }
    }
  }
  return Object.values(totals).filter(t => t.played).sort((a, b) => b.points - a.points || b.wins - a.wins);
}

function offDetail(r) {
  if (r.diff === 0) return ['exact'];
  return [r.diff > 0 ? 'over' : 'under', { pct: r.absPct }];
}
