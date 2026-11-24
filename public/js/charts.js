// Hand-rolled SVG charts (no dependencies). Every value is escaped before it joins markup.
import { t, fmtDuration } from './i18n.js';

// Wrap numbers in a left-to-right isolate so "−8.4%" or "₪1,200" never get scrambled inside Hebrew text.
const LTR = (s) => `\u2066${s}\u2069`;

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtMoney(v, cur = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  const opts = Number.isInteger(Math.round(v * 100) / 100) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return LTR(cur + v.toLocaleString(undefined, opts));
}
export function fmtPct(p, signed = true) {
  if (p == null || !Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  const s = a < 10 ? a.toFixed(1) : String(Math.round(a));
  if (!signed) return LTR(s + '%');
  return LTR((p > 0 ? '+' : p < 0 ? '−' : '±') + s + '%');
}
const short = (name, n = 8) => (name.length > n ? name.slice(0, n - 1) + '…' : name);

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
const compact = (v, cur) => cur + (v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : Math.round(v).toLocaleString());

/**
 * Number line ("where did everyone land?"): each guess is an emoji on a money axis,
 * stacked beeswarm-style so nobody hides behind anybody, with the real bill and average marked.
 */
export function numberLine(stats, cur, width) {
  const W = Math.max(280, width);
  const padL = 16, padR = 16;
  const rows = [...stats.rows].sort((a, b) => a.amount - b.amount);
  const values = [stats.actual, stats.average, ...rows.map(r => r.amount)];
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 10;
  lo = Math.max(0, lo - pad); hi = hi + pad;
  const x = v => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);

  // beeswarm lanes
  const minGap = 50, laneH = 54;
  const lanes = []; // last x in each lane
  const placed = rows.map(r => {
    const px = x(r.amount);
    let lane = lanes.findIndex(last => px - last >= minGap);
    if (lane === -1) { lane = lanes.length; lanes.push(px); } else lanes[lane] = px;
    return { r, px, lane };
  });
  const top = 34; // room for the "real bill" label
  const plotH = Math.max(1, lanes.length) * laneH;
  const axisY = top + plotH + 12;
  const H = axisY + 40;

  const ticks = niceTicks(lo, hi, W < 400 ? 4 : 6);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('ariaLine'))}">`;
  for (const t of ticks) {
    const tx = x(t);
    s += `<line class="grid" x1="${tx}" x2="${tx}" y1="${top}" y2="${axisY}"/>`;
    s += `<text class="axis-label" x="${tx}" y="${axisY + 18}" text-anchor="middle">${esc(compact(t, cur))}</text>`;
  }
  s += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${axisY}" y2="${axisY}"/>`;

  // average (dashed) and actual (solid) markers
  const ax = x(stats.actual), mx = x(stats.average);
  s += `<line class="avg-line" x1="${mx}" x2="${mx}" y1="${top - 4}" y2="${axisY}"/>`;
  s += `<line class="actual-line" x1="${ax}" x2="${ax}" y1="${top - 10}" y2="${axisY + 4}"/>`;
  const anchor = (px) => (px < W * 0.2 ? 'start' : px > W * 0.8 ? 'end' : 'middle');
  s += `<text class="strong" x="${ax}" y="${top - 16}" text-anchor="${anchor(ax)}">${esc(t('chartReal', { x: fmtMoney(stats.actual, cur) }))}</text>`;
  const avgLabelClash = Math.abs(mx - ax) < 90;
  s += `<text class="accent" x="${mx}" y="${avgLabelClash ? axisY + 34 : top - 16}" text-anchor="${anchor(mx)}">${esc(t('chartAvg', { x: fmtMoney(stats.average, cur) }))}</text>`;

  for (const { r, px, lane } of placed) {
    const cy = axisY - 36 - lane * laneH;
    const tip = t('tipGuess', { name: r.name, amount: fmtMoney(r.amount, cur), pct: fmtPct(r.pct) });
    s += `<g data-tip="${esc(tip)}">`;
    s += `<line class="grid" x1="${px}" x2="${px}" y1="${cy + 14}" y2="${axisY}" stroke-dasharray="2 3"/>`;
    s += `<circle class="dot-ring" cx="${px}" cy="${cy - 4}" r="15"/>`;
    s += `<text class="emoji" x="${px}" y="${cy + 3}" text-anchor="middle">${esc(r.avatar)}</text>`;
    s += `<text x="${px}" y="${cy + 22}" text-anchor="middle" style="font-size:10px">${esc(short(r.name, 8))}</text>`;
    s += `<rect class="hit" x="${px - 22}" y="${cy - 22}" width="44" height="50"/>`;
    s += `</g>`;
  }
  return s + '</svg>';
}

/** Diverging bars: how far over (right, red) or under (left, blue) each person was. */
export function errorBars(stats, cur, width, meId) {
  const W = Math.max(280, width);
  const rows = stats.rows; // already in rank order
  const labelW = Math.min(130, W * 0.34);
  const rowH = 36, top = 26;
  const H = top + rows.length * rowH + 8;
  const maxAbs = Math.max(10, ...rows.map(r => r.absPct)) * 1.15;
  const plotL = labelW + 8, plotR = W - 8;
  const zero = (plotL + plotR) / 2;
  const scale = (plotR - plotL) / 2 / maxAbs;

  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('ariaError'))}">`;
  s += `<text class="axis-label" x="${zero - 6}" y="14" text-anchor="end">${esc(t('chartLow'))}</text>`;
  s += `<text class="axis-label" x="${zero + 6}" y="14">${esc(t('chartHigh'))}</text>`;
  s += `<line class="actual-line" x1="${zero}" x2="${zero}" y1="${top - 4}" y2="${H - 4}"/>`;
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2;
    const len = Math.max(2, r.absPct * scale);
    const isOver = r.diff > 0;
    const bx = isOver ? zero + 1 : zero - 1 - len;
    const tip = r.diff === 0
      ? t('tipErrExact', { name: r.name, amount: fmtMoney(r.amount, cur) })
      : t('tipErr', { name: r.name, amount: fmtMoney(r.amount, cur), diff: fmtMoney(r.absDiff, cur), over: isOver, pct: fmtPct(r.pct) });
    s += `<g data-tip="${esc(tip)}">`;
    s += `<text x="0" y="${cy + 5}" class="${r.pid === meId ? 'strong' : ''}">${esc(r.rank)}. ${esc(r.avatar)} ${esc(short(r.name, Math.floor(labelW / 9)))}</text>`;
    s += `<rect class="${isOver ? 'bar-over' : 'bar-under'}" x="${bx}" y="${cy - 8}" width="${len}" height="16" rx="4"/>`;
    const lx = isOver ? zero + len + 6 : zero - len - 6;
    s += `<text class="val" x="${lx}" y="${cy + 4}" text-anchor="${isOver ? 'start' : 'end'}">${esc(r.busted ? '💥 ' : '')}${esc(fmtPct(r.pct))}</text>`;
    s += `<rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** Speed race: seconds from round start to each person's first answer. */
export function speedBars(stats, width) {
  const W = Math.max(280, width);
  const rows = [...stats.rows].sort((a, b) => a.firstTimeMs - b.firstTimeMs);
  const labelW = Math.min(130, W * 0.34);
  const rowH = 34, top = 6;
  const H = top + rows.length * rowH + 4;
  const max = Math.max(1000, ...rows.map(r => r.firstTimeMs));
  const plotL = labelW + 8, plotR = W - 56;
  const scale = (plotR - plotL) / max;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('ariaSpeed'))}">`;
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2;
    const len = Math.max(3, r.firstTimeMs * scale);
    const medal = i === 0 ? '⚡ ' : '';
    s += `<g data-tip="${esc(t('tipSpeed', { name: r.name, t: fmtDuration(r.firstTimeMs) }) + (r.changes ? t('tipChanged', { n: r.changes }) : ''))}">`;
    s += `<text x="0" y="${cy + 5}">${esc(r.avatar)} ${esc(short(r.name, Math.floor(labelW / 9)))}</text>`;
    s += `<rect class="bar-speed" x="${plotL}" y="${cy - 8}" width="${len}" height="16" rx="4"/>`;
    s += `<text class="val" x="${plotL + len + 6}" y="${cy + 4}">${esc(medal + fmtDuration(r.firstTimeMs))}</text>`;
    s += `<rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** Total points across rounds. */
export function pointsBars(board, width) {
  const W = Math.max(280, width);
  const labelW = Math.min(130, W * 0.34);
  const rowH = 34, top = 6;
  const H = top + board.length * rowH + 4;
  const max = Math.max(1, ...board.map(b => b.points));
  const plotL = labelW + 8, plotR = W - 70;
  const scale = (plotR - plotL) / max;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('ariaPoints'))}">`;
  board.forEach((b, i) => {
    const cy = top + i * rowH + rowH / 2;
    const len = Math.max(3, b.points * scale);
    s += `<g data-tip="${esc(t('tipPoints', { name: b.name, points: b.points, wins: b.wins, rounds: b.perRound.join(' / ') }))}">`;
    s += `<text x="0" y="${cy + 5}">${i === 0 ? '👑' : esc(i + 1 + '.')} ${esc(b.avatar)} ${esc(short(b.name, Math.floor(labelW / 9) - 2))}</text>`;
    s += `<rect class="bar-speed" x="${plotL}" y="${cy - 8}" width="${len}" height="16" rx="4"/>`;
    s += `<text class="val" x="${plotL + len + 6}" y="${cy + 4}">${esc(t('pts', { n: b.points }))}</text>`;
    s += `<rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** One tooltip for every chart: hover on desktop, tap on phones. */
export function installTooltips() {
  const tip = document.getElementById('tooltip');
  let hideTimer;
  const show = (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) { if (e.type === 'pointerdown') tip.classList.remove('show'); return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.classList.add('show');
    const { innerWidth: vw } = window;
    const r = tip.getBoundingClientRect();
    let left = e.clientX - r.width / 2;
    left = Math.max(8, Math.min(vw - r.width - 8, left));
    let top = e.clientY - r.height - 14;
    if (top < 8) top = e.clientY + 18;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    clearTimeout(hideTimer);
    if (e.pointerType === 'touch' || e.type === 'pointerdown') hideTimer = setTimeout(() => tip.classList.remove('show'), 2500);
  };
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(e); });
  document.addEventListener('pointerdown', show);
  document.addEventListener('scroll', () => tip.classList.remove('show'), { passive: true });
}

// ---------- Hall of Fame charts ----------

/** Ranked horizontal bars (one series). items: {label, value, text, tip} */
export function hbarChart(items, width, { aria = '', cls = 'bar-speed' } = {}) {
  const W = Math.max(280, width);
  const labelW = Math.min(140, W * 0.36);
  const rowH = 34, top = 6;
  const H = top + items.length * rowH + 4;
  const max = Math.max(1e-9, ...items.map(i => i.value));
  const plotL = labelW + 8, plotR = W - 64;
  const scale = (plotR - plotL) / max;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">`;
  items.forEach((it, i) => {
    const cy = top + i * rowH + rowH / 2;
    const len = Math.max(3, it.value * scale);
    s += `<g data-tip="${esc(it.tip || '')}">`;
    s += `<text x="0" y="${cy + 5}">${esc(short(it.label, Math.floor(labelW / 8.5)))}</text>`;
    s += `<rect class="${cls} grow-x" style="animation-delay:${i * 60}ms" x="${plotL}" y="${cy - 8}" width="${len}" height="16" rx="4"/>`;
    s += `<text class="val" x="${plotL + len + 6}" y="${cy + 4}">${esc(it.text)}</text>`;
    s += `<rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** Diverging bars around zero: under (left, blue) vs over (right, red). items: {label, value(signed %), tip} */
export function divergingChart(items, width, { aria = '', low = '', high = '' } = {}) {
  const W = Math.max(280, width);
  const labelW = Math.min(130, W * 0.34);
  const rowH = 34, top = 24;
  const H = top + items.length * rowH + 6;
  const maxAbs = Math.max(5, ...items.map(i => Math.abs(i.value))) * 1.2;
  const plotL = labelW + 8, plotR = W - 8;
  const zero = (plotL + plotR) / 2;
  const scale = (plotR - plotL) / 2 / maxAbs;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">`;
  s += `<text class="axis-label" x="${zero - 6}" y="13" text-anchor="end">${esc(low)}</text>`;
  s += `<text class="axis-label" x="${zero + 6}" y="13">${esc(high)}</text>`;
  s += `<line class="actual-line" x1="${zero}" x2="${zero}" y1="${top - 4}" y2="${H - 2}"/>`;
  items.forEach((it, i) => {
    const cy = top + i * rowH + rowH / 2;
    const len = Math.max(2, Math.abs(it.value) * scale);
    const over = it.value > 0;
    s += `<g data-tip="${esc(it.tip || '')}">`;
    s += `<text x="0" y="${cy + 5}">${esc(short(it.label, Math.floor(labelW / 9)))}</text>`;
    s += `<rect class="${over ? 'bar-over' : 'bar-under'} ${over ? 'grow-x' : 'grow-x-rev'}" style="animation-delay:${i * 60}ms" x="${over ? zero + 1 : zero - 1 - len}" y="${cy - 8}" width="${len}" height="16" rx="4"/>`;
    s += `<text class="val" x="${over ? zero + len + 6 : zero - len - 6}" y="${cy + 4}" text-anchor="${over ? 'start' : 'end'}">${esc(fmtPct(it.value))}</text>`;
    s += `<rect class="hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** Vertical bars over time (e.g. every bill). items: {value, label, tip} in chronological order */
export function columnChart(items, width, cur, { aria = '' } = {}) {
  const W = Math.max(280, width);
  const H = 190, padT = 14, padB = 26, padL = 46, padR = 6;
  const max = Math.max(1, ...items.map(i => i.value)) * 1.1;
  const ticks = niceTicks(0, max, 4);
  const y = v => padT + (1 - v / max) * (H - padT - padB);
  const slot = (W - padL - padR) / Math.max(1, items.length);
  const bw = Math.max(4, Math.min(34, slot - 4));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">`;
  for (const t of ticks) {
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="axis-label" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t, cur))}</text>`;
  }
  s += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>`;
  const every = Math.ceil(items.length / Math.max(1, Math.floor((W - padL) / 54)));
  items.forEach((it, i) => {
    const cx = padL + slot * i + slot / 2;
    const top = y(it.value);
    s += `<g data-tip="${esc(it.tip || '')}">`;
    s += `<rect class="bar-speed grow-y" style="animation-delay:${i * 40}ms" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(2, y(0) - top)}" rx="4"/>`;
    if (i % every === 0) s += `<text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
    s += `<rect class="hit" x="${cx - slot / 2}" y="${padT}" width="${slot}" height="${H - padT - padB}"/>`;
    s += `</g>`;
  });
  return s + '</svg>';
}

/** A person's miss % over time: line + dots (wins highlighted). points: {value, win, tip} */
export function trendChart(points, width, { aria = '' } = {}) {
  const W = Math.max(280, width);
  const H = 150, padT = 12, padB = 18, padL = 40, padR = 12;
  const max = Math.max(10, ...points.map(p => p.value)) * 1.1;
  const x = i => padL + (points.length === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (points.length - 1));
  const y = v => padT + (1 - v / max) * (H - padT - padB);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">`;
  for (const t of niceTicks(0, max, 3)) {
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="axis-label" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(Math.round(t) + '%')}</text>`;
  }
  if (points.length > 1) s += `<polyline class="trend-line draw" points="${points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}"/>`;
  points.forEach((p, i) => {
    s += `<g data-tip="${esc(p.tip || '')}"><circle class="${p.win ? 'trend-win' : 'trend-dot'}" cx="${x(i)}" cy="${y(p.value)}" r="${p.win ? 6 : 4}"/>`;
    s += `<rect class="hit" x="${x(i) - 14}" y="${padT}" width="28" height="${H - padT - padB}"/></g>`;
  });
  return s + '</svg>';
}
