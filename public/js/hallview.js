// Family Hall of Fame screens: championship dashboard, records, player profiles and dinner history.
import { t, fmtDuration, getLang } from './i18n.js';
import { esc, fmtMoney, fmtPct, hbarChart, divergingChart, columnChart, trendChart } from './charts.js';
import { TITLE_DEFS, BADGE_DEFS, MIN_ROUNDS_FOR_TITLES, rivalries } from './hall.js';
import { computeRoundStats } from './stats.js';

const fmtDate = (ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  ts ? new Date(ts).toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', opts) : '';
const pctRate = (x) => `${Math.round(x * 100)}%`;
const medal = (place) => ['🥇', '🥈', '🥉'][place - 1] || `${place}.`;
const titleName = (key) => t('titles')[key]?.[0] || key;
const titleDesc = (key) => t('titles')[key]?.[1] || '';
const who = (m) => (m ? `${m.avatar} ${m.name}` : '?');

/** count-up numbers: <b data-count="123" data-fmt="money|pct|int" data-cur="₪"> */
const countEl = (value, fmt = 'int', cur = '') => `<b class="count-up" data-count="${value ?? 0}" data-fmt="${fmt}" data-cur="${esc(cur)}">${esc(formatCount(value ?? 0, fmt, cur))}</b>`;
function formatCount(v, fmt, cur) {
  if (fmt === 'money') return fmtMoney(Math.round(v), cur);
  if (fmt === 'pct') return fmtPct(v, false);
  return String(Math.round(v));
}
export function animateCounts(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of root.querySelectorAll('.count-up:not(.done)')) {
    el.classList.add('done');
    const target = Number(el.dataset.count), fmt = el.dataset.fmt, cur = el.dataset.cur;
    const t0 = performance.now(), dur = 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = formatCount(target * (1 - (1 - k) ** 3), fmt, cur);
      if (k < 1) requestAnimationFrame(step); else el.textContent = formatCount(target, fmt, cur);
    };
    requestAnimationFrame(step);
  }
}

export function hallView(H) {
  const { family, data, tab = 'board', meId } = H;
  const me = meId && family.members[meId];
  const cur = data.totals.mainCurrency;
  const tabs = ['board', 'records', 'players', 'history'];
  const spent = Object.entries(data.totals.spent);
  return `
  <div class="topbar" data-key="hall-top">
    <button class="btn icon ghost" data-action="hall-back" aria-label="${esc(t('back'))}">${t('backArrow')}</button>
    <h1 dir="auto">${esc(family.name)}</h1>
    <button class="btn icon ghost" data-action="hall-settings" aria-label="${esc(t('hallSettings'))}">⚙️</button>
  </div>
  <section class="card hall-hero" data-key="hall-hero">
    <div class="trophy" aria-hidden="true">🏆</div>
    <div class="hall-kicker">${esc(t('hallSub'))}</div>
    <div class="hall-season">${esc(t('hallSeason'))}</div>
    <div class="kpis kpis-4">
      <div class="kpi"><div class="k">${esc(t('kpiDinners'))}</div><div class="v">${countEl(data.totals.dinners)}</div></div>
      <div class="kpi"><div class="k">${esc(t('kpiRounds'))}</div><div class="v">${countEl(data.totals.rounds)}</div></div>
      <div class="kpi"><div class="k">${esc(t('kpiSpent'))}</div><div class="v">${spent.length ? countEl(data.totals.spent[cur], 'money', cur) : '—'}</div></div>
      <div class="kpi"><div class="k">${esc(t('kpiAccuracy'))}</div><div class="v">${data.totals.avgAbsPct != null ? countEl(data.totals.avgAbsPct, 'pct') : '—'}</div></div>
    </div>
  </section>
  <div class="me-strip" data-key="hall-me">${me
    ? `<span>${esc(t('youOnThisPhone', { who: who(me) }))}</span> <button class="link" data-action="hall-pick-me">${esc(t('switchMe'))}</button>`
    : Object.keys(family.members).length ? `<span>${esc(t('pickMe'))}</span> <button class="link" data-action="hall-pick-me">👤</button>` : ''}</div>
  <nav class="tabs" role="tablist" data-key="hall-tabs">${tabs.map(k =>
    `<button role="tab" aria-selected="${tab === k}" data-action="hall-tab" data-tab="${k}">${esc(t('tab' + k[0].toUpperCase() + k.slice(1)))}</button>`).join('')}</nav>
  <div class="tab-body" data-key="hall-body-${tab}">${
    !data.rounds.length && tab !== 'players' ? `<section class="card center empty-hall"><div class="big-emoji">🍽️</div><p>${esc(t('emptyHall'))}</p></section>`
      : tab === 'board' ? boardTab(H) : tab === 'records' ? recordsTab(H) : tab === 'players' ? playersTab(H) : historyTab(H)}</div>
  <p class="footer" data-key="hall-foot"><button class="link-lang" data-action="lang" aria-label="${esc(t('switchAria'))}">${esc(t('switchTo'))}</button></p>`;
}

function boardTab({ family, data, meId }) {
  const lb = data.leaderboard;
  const champ = lb[0];
  const titlesOf = (m) => m.titles.map(x => `<span class="title-chip" title="${esc(titleName(x.key))}">${x.emoji}</span>`).join('');
  return `
  ${champ ? `<section class="card champion-card" data-action="hall-profile" data-id="${esc(champ.id)}">
    <div class="crown" aria-hidden="true">👑</div>
    <div class="champ-av">${esc(champ.avatar)}</div>
    <div class="champ-label">${esc(t('championSpot'))}</div>
    <div class="champ-name" dir="auto">${esc(champ.name)}</div>
    <div class="champ-line">${esc(t('championLine', { wins: champ.wins, rate: pctRate(champ.winRate), dinners: champ.dinners }))}</div>
    <div class="chips center-chips">${champ.titles.map(x => `<span class="title-pill">${x.emoji} ${esc(titleName(x.key))}</span>`).join('')}</div>
  </section>` : ''}
  <section class="card">
    <h2>${esc(t('tabBoard'))}</h2>
    <table class="rank-table hall-table">
      <thead><tr><th>#</th><th>${esc(t('colPlayer'))}</th><th class="num">${esc(t('colWins'))}</th><th class="num">${esc(t('colRate'))}</th><th class="num">${esc(t('colAcc'))}</th></tr></thead>
      <tbody>${lb.map(m => `<tr class="${m.id === meId ? 'me' : ''} tap" data-action="hall-profile" data-id="${esc(m.id)}">
        <td>${medal(m.place)}</td>
        <td class="who"><span dir="auto">${esc(m.avatar + ' ' + m.name)}</span> ${titlesOf(m)}
          <span class="vd">${m.curStreak >= 2 ? esc(t('streakN', { n: m.curStreak })) + ' · ' : ''}${formChips(m)}</span></td>
        <td class="num"><b>${m.wins}</b></td>
        <td class="num">${esc(pctRate(m.winRate))}</td>
        <td class="num">${esc(fmtPct(m.avgAbsPct, false))}</td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="small muted" style="margin-top:8px">${esc(t('tieNote'))}</p>
  </section>
  <section class="card">
    <h2>${esc(t('accuracyChart'))}</h2>
    <p class="small muted chart-note">${esc(t('accuracyNote'))}</p>
    <div class="chart-box" data-hall-chart="accuracy"></div>
  </section>
  <section class="card">
    <h2>${esc(t('tendencyChart'))}</h2>
    <p class="small muted chart-note">${esc(t('tendencyNote'))}</p>
    <div class="chart-box" data-hall-chart="tendency"></div>
  </section>
  <section class="card">
    <h2>${esc(t('titlesTitle'))}</h2>
    <div class="titles-grid">${TITLE_DEFS.map(def => {
      const held = data.titles.find(x => x.key === def.key);
      const m = held && data.members[held.memberId];
      return `<div class="title-card ${m ? '' : 'vacant'}" ${m ? `data-action="hall-profile" data-id="${esc(m.id)}"` : ''}>
        <div class="tc-emoji">${def.emoji}</div><div class="tc-name">${esc(titleName(def.key))}</div>
        <div class="tc-desc">${esc(titleDesc(def.key))}</div>
        <div class="tc-holder" dir="auto">${m ? esc(who(m)) : esc(t('vacant'))}</div></div>`;
    }).join('')}</div>
    <p class="small muted" style="margin-top:8px">${esc(t('titlesUnlock', { n: MIN_ROUNDS_FOR_TITLES }))}</p>
  </section>`;
}

function formChips(m) {
  return m.history.slice(-5).map(h => `<i class="form ${h.win ? 'w' : 'l'}">${esc(t(h.win ? 'formW' : 'formL'))}</i>`).join('');
}

function recordsTab({ data }) {
  const R = data.records;
  if (!R) return '';
  const m = (id) => data.members[id];
  const card = (title, big, detail, date) => `<div class="record-card"><div class="rec-title">${esc(title)}</div>
    <div class="rec-big">${big}</div><div class="rec-detail">${detail}</div><div class="rec-date">${esc(date || '')}</div></div>`;
  const place = (r) => [r.title, r.label].filter(Boolean).join(' · ');
  const spent = Object.entries(data.totals.spent).map(([c, v]) => fmtMoney(Math.round(v), c)).join(' + ');
  return `
  <section class="card">
    <h2>${esc(t('recordsTitle'))}</h2>
    <div class="records-grid">
      ${card(t('recMostExpensive'), esc(fmtMoney(R.mostExpensive.actual, R.mostExpensive.currency)), esc(place(R.mostExpensive)), fmtDate(R.mostExpensive.at))}
      ${card(t('recCheapest'), esc(fmtMoney(R.cheapest.actual, R.cheapest.currency)), esc(place(R.cheapest)), fmtDate(R.cheapest.at))}
      ${R.wisestCrowd ? card(t('recWisest'), esc(fmtPct(R.wisestCrowd.avgPct)), esc(t('recWisestDetail', { pct: fmtPct(Math.abs(R.wisestCrowd.avgPct), false), n: R.wisestCrowd.n })) + '<br>' + esc(place(R.wisestCrowd)), fmtDate(R.wisestCrowd.at)) : ''}
      ${R.biggestFail ? card(t('recFail'), esc(fmtPct(R.biggestFail.pct)), esc(who(m(R.biggestFail.memberId))) + '<br>' + esc(t('guessOf', { amount: fmtMoney(R.biggestFail.amount, R.biggestFail.currency), actual: fmtMoney(R.biggestFail.actual, R.biggestFail.currency), pct: fmtPct(R.biggestFail.pct) })), fmtDate(R.biggestFail.at)) : ''}
      ${R.fastest ? card(t('recFastest'), esc(fmtDuration(R.fastest.ms)), esc(t('recFastestDetail', { who: who(m(R.fastest.memberId)), t: fmtDuration(R.fastest.ms) })), fmtDate(R.fastest.at)) : ''}
      ${card(t('recSpent'), esc(spent), '', '')}
      ${R.biggestTable ? card(t('recBiggestTable'), esc(String(R.biggestTable.n)), esc(t('recTableDetail', { n: R.biggestTable.n })) + '<br>' + esc(place(R.biggestTable)), fmtDate(R.biggestTable.at)) : ''}
    </div>
  </section>
  <section class="card">
    <h2>${esc(t('billsChart'))}</h2>
    <div class="chart-box" data-hall-chart="bills"></div>
  </section>`;
}

function playersTab({ family, data, meId }) {
  const all = Object.values(data.members).sort((a, b) => (b.rounds > 0) - (a.rounds > 0) || (a.place || 99) - (b.place || 99) || a.name.localeCompare(b.name));
  return `<section class="card"><h2>${esc(t('tabPlayers'))}</h2><div class="player-grid">${all.map(m => `
    <button class="player-card ${m.id === meId ? 'me' : ''}" data-action="hall-profile" data-id="${esc(m.id)}">
      <span class="pc-av">${esc(m.avatar)}</span>
      <span class="pc-name" dir="auto">${esc(m.name)}</span>
      <span class="pc-titles">${m.titles.map(x => x.emoji).join(' ')}</span>
      <span class="pc-line">${m.rounds ? `🏆 ${m.wins} · 🎯 ${esc(fmtPct(m.avgAbsPct, false))}` : esc(t('noRoundsYet'))}</span>
      <span class="pc-badges">${m.badges.map(b => BADGE_DEFS.find(d => d.key === b)?.emoji).join('')}</span>
    </button>`).join('')}</div></section>`;
}

function historyTab({ family, data }) {
  const dinners = {};
  for (const fr of data.rounds) (dinners[fr.dinner.id] ??= { dinner: fr.dinner, rounds: [] }).rounds.push(fr);
  const list = Object.values(dinners).sort((a, b) => b.rounds[0].at - a.rounds[0].at);
  if (!list.length) return `<section class="card center"><p>${esc(t('histEmpty'))}</p></section>`;
  return list.map(({ dinner, rounds }) => {
    const cur = dinner.currency;
    const total = rounds.reduce((s, fr) => s + fr.stats.actual, 0);
    const champId = data.dinnerChampions[dinner.id];
    const champ = champId && data.members[champId];
    return `<details class="card history-card">
      <summary>
        <div class="hc-date">${esc(fmtDate(rounds[0].at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div>
        <div class="hc-title" dir="auto">${esc(dinner.title || t('defaultTitle'))}</div>
        <div class="hc-line">🧾 ${esc(fmtMoney(total, cur))} · ${champ ? '👑 ' + esc(who(champ)) : ''} · ${esc(t('histPlayers', { n: Math.max(...rounds.map(fr => fr.stats.n)) }))}</div>
      </summary>
      ${rounds.map(fr => historyRound(fr, cur)).join('')}
      <button class="btn ghost block danger" data-action="hall-delete-dinner" data-id="${esc(dinner.id)}">${esc(t('deleteDinner'))}</button>
    </details>`;
  }).join('');
}

function historyRound(fr, cur) {
  const s = fr.stats;
  const winner = s.rows[0];
  const name = (row) => row.name + (fr.players.find(p => p.id === row.pid)?.memberId ? '' : t('guestSuffix'));
  return `<div class="hist-round">
    <div class="hr-head"><b>${esc(t('histRound', { n: fr.round.n, label: fr.round.label }))}</b><span>${esc(fmtMoney(s.actual, cur))}</span></div>
    <div class="small muted">${winner && !winner.busted ? esc(t('histWinner', { who: winner.avatar + ' ' + name(winner) })) + ' · ' : ''}${s.n >= 2 ? esc(t('histGroup', { pct: fmtPct(Math.abs(s.avgPct), false) })) : ''}</div>
    <table class="rank-table compact"><tbody>${s.rows.map(r => `<tr>
      <td>${r.rank}</td><td class="who" dir="auto">${esc(r.avatar + ' ' + name(r))}<span class="vd">${esc(r.verdict.emoji + ' ' + t('verdicts.' + r.verdict.key))}</span></td>
      <td class="num">${esc(fmtMoney(r.amount, cur))}</td><td class="num ${r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : ''}">${esc(fmtPct(r.pct))}</td></tr>`).join('')}</tbody></table>
    <div class="chips award-chips">${s.awards.filter(a => ['closest', 'farthest', 'fastest', 'bullseye'].includes(a.type)).map(a => `<span class="chip small-chip">${a.emoji} ${esc(t('awards.' + a.type))}: ${esc(a.who.name)}</span>`).join('')}</div>
  </div>`;
}

export function profileHtml(H, id) {
  const { data, family } = H;
  const m = data.members[id];
  if (!m) return '';
  const stat = (k, v) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
  const tendency = m.avgPct == null ? '' : Math.abs(m.avgPct) < 3 ? t('tendBalanced')
    : t(m.avgPct > 0 ? 'tendOver' : 'tendUnder', { p: fmtPct(Math.abs(m.avgPct), false) });
  const guessLine = (g) => g ? esc(t('guessOf', { amount: fmtMoney(g.amount, g.currency), actual: fmtMoney(g.actual, g.currency), pct: fmtPct(g.pct) })) + ` <span class="muted small">${esc(fmtDate(g.at))}</span>` : '—';
  const rivals = rivalries(m, data.members);
  return `<div class="profile">
    <div class="prof-head"><span class="prof-av">${esc(m.avatar)}</span><h2 dir="auto">${esc(m.name)}</h2>
      ${m.place ? `<div class="muted">${medal(m.place)}${m.curStreak >= 1 ? ' · ' + esc(t('streakN', { n: m.curStreak })) : ''}</div>` : ''}</div>
    ${m.titles.length ? `<div class="chips center-chips">${m.titles.map(x => `<span class="title-pill" title="${esc(titleDesc(x.key))}">${x.emoji} ${esc(titleName(x.key))}</span>`).join('')}</div>` : ''}
    ${!m.rounds ? `<p class="center muted" style="margin:18px 0">${esc(t('noRoundsYet'))}</p>` : `
    <div class="kpis kpis-3 prof-kpis">
      ${stat(t('profWins'), countEl(m.wins))}${stat(t('profWinRate'), esc(pctRate(m.winRate)))}${stat(t('profAvgMiss'), esc(fmtPct(m.avgAbsPct, false)))}
      ${stat(t('profDinners'), countEl(m.dinners))}${stat(t('profRounds'), countEl(m.rounds))}${stat(t('profAvgTime'), esc(fmtDuration(m.avgTimeMs)))}
      ${stat(t('profStreak'), m.curStreak ? '🔥' + m.curStreak : '0')}${stat(t('profLongest'), String(m.longestStreak))}${stat(t('profDinnerTitles'), '👑' + m.dinnerTitles)}
      ${stat(t('profExact'), String(m.exact))}${stat(t('profBullseyes'), String(m.bullseyes))}${stat(t('form'), formChips(m) || '—')}
    </div>
    <p class="tendency"><b>${esc(t('profTendency'))}:</b> ${esc(tendency)}</p>
    <div class="best-worst">
      <div><div class="k">🌟 ${esc(t('profBest'))}</div><div>${guessLine(m.best)}</div></div>
      <div><div class="k">🙈 ${esc(t('profWorst'))}</div><div>${guessLine(m.worst)}</div></div>
    </div>
    <h3>${esc(t('profTrend'))}</h3><p class="small muted chart-note">${esc(t('profTrendNote'))}</p>
    <div class="chart-box" data-profile-chart="${esc(m.id)}"></div>
    ${rivals.length ? `<h3>${esc(t('profH2H'))}</h3><p class="small muted chart-note">${esc(t('h2hHint'))}</p>
    <div class="h2h">${rivals.map(r => `<div class="h2h-row"><span dir="auto">${esc(r.avatar + ' ' + r.name)}</span>
      <div class="h2h-bar" dir="ltr"><i class="w" style="flex:${r.w || 0.001}"></i><i class="l" style="flex:${r.l || 0.001}"></i></div>
      <b dir="ltr">${r.w}–${r.l}</b></div>`).join('')}</div>` : ''}`}
    <h3>${esc(t('profBadges'))}</h3>
    <div class="badge-grid">${BADGE_DEFS.map(b => {
      const has = m.badges.includes(b.key);
      return `<div class="badge ${has ? 'on' : 'off'}" title="${esc(t('badges')[b.key][1])}"><span>${b.emoji}</span><b>${esc(t('badges')[b.key][0])}</b><small>${esc(t('badges')[b.key][1])}</small></div>`;
    }).join('')}</div>
    <button class="btn ghost block" data-close>${esc(t('done'))}</button>
  </div>`;
}

/** Draw every chart currently on screen (Hall tabs and profile sheets). */
export function drawHallCharts(root, H) {
  const { data } = H;
  const cur = data.totals.mainCurrency;
  for (const box of root.querySelectorAll('[data-hall-chart]')) {
    const w = box.clientWidth || 320;
    const kind = box.dataset.hallChart;
    const lb = data.players;
    if (kind === 'accuracy') {
      const items = [...lb].sort((a, b) => a.avgAbsPct - b.avgAbsPct).map(m => ({
        label: `${m.avatar} ${m.name}`, value: m.avgAbsPct, text: fmtPct(m.avgAbsPct, false),
        tip: `${m.name}: ${fmtPct(m.avgAbsPct, false)} · ${m.rounds} ${t('kpiRounds')}`,
      }));
      box.innerHTML = hbarChart(items, w, { aria: t('accuracyChart') });
    }
    if (kind === 'tendency') {
      const items = [...lb].sort((a, b) => a.avgPct - b.avgPct).map(m => ({
        label: `${m.avatar} ${m.name}`, value: m.avgPct, tip: `${m.name}: ${m.over}↑ ${m.under}↓`,
      }));
      box.innerHTML = divergingChart(items, w, { aria: t('tendencyChart'), low: t('chartLow'), high: t('chartHigh') });
    }
    if (kind === 'bills') {
      const items = data.rounds.filter(fr => (fr.dinner.currency || '') === cur).map(fr => ({
        value: fr.stats.actual, label: fmtDate(fr.at, { day: 'numeric', month: 'numeric' }),
        tip: `${fr.dinner.title || ''} · ${fr.round.label}: ${fmtMoney(fr.stats.actual, cur)} (${fmtDate(fr.at)})`,
      }));
      box.innerHTML = columnChart(items, w, cur, { aria: t('billsChart') });
    }
  }
  for (const box of root.querySelectorAll('[data-profile-chart]')) {
    const m = data.members[box.dataset.profileChart];
    if (!m) continue;
    const pts = m.history.map(h => ({ value: h.absPct, win: h.win, tip: `${fmtDate(h.at)} · #${h.rank}/${h.n} · ${fmtPct(h.pct)}` }));
    box.innerHTML = trendChart(pts, box.clientWidth || 300, { aria: t('profTrend') });
  }
  animateCounts(root);
}

export function settingsHtml(H, shareUrl, qrSvg) {
  const { family } = H;
  const members = Object.values(family.members).sort((a, b) => a.name.localeCompare(b.name));
  const opts = members.map(m => `<option value="${esc(m.id)}">${esc(m.avatar + ' ' + m.name)}</option>`).join('');
  return `<div class="stack">
    <h2>${esc(t('hallSettings'))}</h2>
    <label class="field"><span>${esc(t('familyName'))}</span><input class="text" dir="auto" id="fam-name" maxlength="40" value="${esc(family.name)}"></label>
    <button class="btn block" data-act="rename">${esc(t('save'))}</button>
    <div class="center stack">
      <div class="muted small">${esc(t('familyCodeLabel'))}</div><div class="big-code" dir="ltr">${esc(family.code)}</div>
      <p class="small muted">${esc(t('inviteFamilyHint'))}</p>
      <div class="qr">${qrSvg}</div>
      <div class="link-box" dir="ltr">${esc(shareUrl)}</div>
      <button class="btn block" data-act="copy">${esc(t('copyLink'))}</button>
    </div>
    ${members.length >= 2 ? `<h3>${esc(t('mergeTitle'))}</h3><p class="small muted">${esc(t('mergeHint'))}</p>
    <div class="row wrap"><label class="field grow"><span>${esc(t('mergeFrom'))}</span><select class="text" id="merge-from">${opts}</select></label>
    <label class="field grow"><span>${esc(t('mergeInto'))}</span><select class="text" id="merge-into">${opts}</select></label></div>
    <button class="btn block" data-act="merge">${esc(t('mergeBtn'))}</button>` : ''}
    <h3>${esc(t('backupTitle'))}</h3><p class="small muted">${esc(t('backupHint'))}</p>
    <a class="btn primary block" href="/api/families/${esc(family.code)}/export" download>${esc(t('downloadBackup'))}</a>
    <button class="btn ghost block danger" data-act="forget">${esc(t('forgetFamily'))}</button>
    <button class="btn ghost block" data-close>${esc(t('done'))}</button>
  </div>`;
}

/** The pick-a-person grid used on the join screen, the Hall and family setup. */
export function rosterHtml(members, { seated = [], meId = null, action = 'pick-member' } = {}) {
  const list = [...members].sort((a, b) => (b.id === meId) - (a.id === meId) || a.name.localeCompare(b.name));
  return `<div class="roster">${list.map(m => `
    <button type="button" class="roster-btn ${m.id === meId ? 'me' : ''}" data-action="${action}" data-id="${esc(m.id)}">
      <span class="av">${esc(m.avatar)}</span><span class="nm" dir="auto">${esc(m.name)}</span>
      ${m.id === meId ? `<span class="tag">${esc(t('thatsMe'))}</span>` : seated.includes(m.id) ? `<span class="tag muted">${esc(t('atTableNow'))}</span>` : ''}
    </button>`).join('')}</div>`;
}
