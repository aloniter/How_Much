// Roast of the Night: the synchronized slideshow after the reveal, the roast cards in the results,
// and the shareable card images. Timing is derived from the server's reveal time, so every phone
// shows the same card at the same moment without any extra messages.
import { t, getLang, isRTL } from './i18n.js';
import { esc, fmtMoney, fmtPct } from './charts.js';
import { sfx, buzz } from './fx.js';

export const REVEAL_MS = 7600;        // drumroll + count-up + winner, before the roast starts
const INTRO_MS = 2800;
const SUSPENSE_MS = 3400;
const FINALE_MS = 8000;
const CARD_EMOJIS = ['😂', '🔥', '😱', '👏', '🍅', '💸'];

/** The roast timeline for a round: [{type, roast?, start, end}] relative to revealedAt. */
export function schedule(roasts) {
  const cardMs = roasts.length > 6 ? 4300 : 5400;
  const seg = [];
  let at = REVEAL_MS;
  const push = (type, ms, roast) => { seg.push({ type, roast, start: at, end: at + ms }); at += ms; };
  push('intro', INTRO_MS);
  for (const r of roasts) {
    if (r.kind === 'disaster') { push('suspense', SUSPENSE_MS, r); push('finale', FINALE_MS, r); }
    else push('card', cardMs, r);
  }
  return { seg, end: at };
}

export function cardHtml(r, { cur, counts = {}, live = false, mine = false } = {}) {
  const kind = t('roastKind')[r.kind] || '';
  const stat = t('imgStats', { g: fmtMoney(r.amount, cur), a: fmtMoney(r.actual, cur), p: fmtPct(r.pct) });
  return `<article class="roast-card ${r.kind} ${live ? 'live' : ''} ${mine ? 'mine' : ''}" data-pid="${esc(r.pid)}">
    <div class="rc-top"><span class="rc-kind">${esc(kind)}</span><span class="rc-rank">${esc(t('imgRank', { rank: r.rank, n: r.n }))}</span></div>
    <div class="rc-who"><span class="rc-av">${esc(r.avatar)}</span><span class="rc-name" dir="auto">${esc(r.name)}</span></div>
    <p class="rc-text">${esc(r.text)}</p>
    <div class="rc-stat">${esc(stat)}</div>
    <div class="rc-actions">
      <div class="rc-reacts" dir="ltr">${CARD_EMOJIS.map(e => `<button class="rc-react" data-card-react="${e}" data-pid="${esc(r.pid)}" aria-label="${e}">${e}<b>${counts[e] ? counts[e] : ''}</b></button>`).join('')}</div>
      <button class="rc-share" data-action="share-roast" data-pid="${esc(r.pid)}">${esc(t('shareCard'))}</button>
    </div>
  </article>`;
}

/**
 * Plays the show. `ctx` supplies: roasts, revealedAt, serverNow(), cur, countsFor(pid), myPid, onEnd().
 * Returns a controller with stop() and refreshCounts(pid).
 */
export function playRoastShow(ctx) {
  const { seg, end } = schedule(ctx.roasts);
  const ov = document.createElement('div');
  ov.className = 'overlay roast-show';
  ov.innerHTML = `<div class="rs-stage"></div>
    <div class="rs-foot"><div class="rs-dots">${seg.filter(s => s.type !== 'suspense').map(() => '<i></i>').join('')}</div>
    <button class="btn ghost skip">${esc(t('roastSkip'))}</button></div>`;
  document.body.appendChild(ov);
  const stage = ov.querySelector('.rs-stage');
  let current = -1, stopped = false, timer = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    ov.classList.add('leaving');
    setTimeout(() => ov.remove(), 250);
    ctx.onEnd();
  };
  ov.querySelector('.skip').onclick = stop;

  const show = (i) => {
    const s = seg[i];
    ov.classList.toggle('alarm', s.type === 'suspense' || s.type === 'finale');
    const dots = ov.querySelectorAll('.rs-dots i');
    const dotIndex = seg.slice(0, i + 1).filter(x => x.type !== 'suspense').length - 1;
    dots.forEach((d, k) => d.classList.toggle('on', k <= dotIndex));
    if (s.type === 'intro') {
      stage.innerHTML = `<div class="rs-intro"><div class="rs-flame">🔥</div><h2>${esc(t('roastTitle'))}</h2><p>${esc(t('roastSub'))}</p></div>`;
      sfx.whoosh();
    } else if (s.type === 'suspense') {
      stage.innerHTML = `<div class="rs-suspense"><div class="rs-siren">🚨</div><p>${esc(s.roast.intro)}</p><div class="rs-drum">🥁</div></div>`;
      sfx.siren(); buzz([80, 80, 80, 80, 200]);
    } else {
      stage.innerHTML = cardHtml(s.roast, { cur: ctx.cur, counts: ctx.countsFor(s.roast.pid), live: true, mine: s.roast.pid === ctx.myPid });
      sfx.whoosh();
      setTimeout(() => { if (!stopped && current === i) { s.type === 'finale' ? sfx.sad() : sfx.rimshot(); } }, s.type === 'finale' ? 1600 : 2300);
      if (s.type === 'finale') buzz([200, 100, 400]);
    }
  };
  const tick = () => {
    const el = Math.max(seg[0].start, ctx.serverNow() - ctx.revealedAt); // skipped the reveal? start with the intro
    if (el >= end) return stop();
    const i = seg.findIndex(s => el >= s.start && el < s.end);
    if (i !== -1 && i !== current) { current = i; show(i); }
  };
  timer = setInterval(tick, 200);
  tick();
  return {
    stop,
    refreshCounts(pid) {
      const card = stage.querySelector(`.roast-card[data-pid="${CSS.escape(pid)}"]`);
      if (card) updateCounts(card, ctx.countsFor(pid));
    },
  };
}

export function updateCounts(card, counts) {
  for (const b of card.querySelectorAll('[data-card-react]')) {
    const n = counts[b.dataset.cardReact] || 0;
    const tag = b.querySelector('b');
    if (tag.textContent !== String(n || '')) {
      tag.textContent = n || '';
      b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }
  }
}

/** Is a roast show still running for a round revealed at `revealedAt`? */
export function inShowWindow(roasts, revealedAt, nowMs) {
  const el = nowMs - revealedAt;
  return el >= 0 && el < schedule(roasts).end;
}

// ---------- shareable card image ----------
function wrapLines(c, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** Draw a 1080×1350 card (WhatsApp-friendly 4:5) and return it as a PNG blob. */
export async function roastImage(r, { cur, title, date }) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  try { await document.fonts?.load('700 60px Fredoka'); } catch { /* fall back to system font */ }
  const display = '"Fredoka", system-ui, sans-serif';
  const body = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  const rtl = isRTL();
  c.direction = rtl ? 'rtl' : 'ltr';
  c.textAlign = 'center';

  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, r.kind === 'disaster' ? '#3a0d12' : '#0d5a3e');
  bg.addColorStop(1, '#041f17');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#f2b632'; c.lineWidth = 10;
  roundRect(c, 40, 40, W - 80, H - 80, 48); c.stroke();

  const icon = await loadImage('/icon-256.png');
  if (icon) { c.save(); roundRect(c, W / 2 - 70, 90, 140, 140, 32); c.clip(); c.drawImage(icon, W / 2 - 70, 90, 140, 140); c.restore(); }
  c.fillStyle = '#f2b632'; c.font = `700 44px ${display}`;
  c.fillText('CheckMate · ' + t('imgTitle'), W / 2, 290);

  c.fillStyle = r.kind === 'disaster' ? '#ff8a80' : '#f7cf5a';
  c.font = `700 38px ${display}`;
  c.fillText(t('roastKind')[r.kind] + '  ·  ' + t('imgRank', { rank: r.rank, n: r.n }), W / 2, 370);

  c.font = `150px ${body}`;
  c.fillText(r.avatar, W / 2, 545);
  c.fillStyle = '#f7f0df'; c.font = `700 72px ${display}`;
  c.fillText(r.name, W / 2, 650);

  c.font = `600 52px ${body}`;
  let lines = wrapLines(c, r.text, W - 220);
  let size = 52;
  while (lines.length > 6 && size > 36) { size -= 4; c.font = `600 ${size}px ${body}`; lines = wrapLines(c, r.text, W - 220); }
  const lh = size * 1.32;
  let y = 760 + Math.max(0, (6 - lines.length) * lh) / 2;
  c.fillStyle = '#f7f0df';
  c.fillText('“', W / 2, y - lh * 0.2);
  for (const ln of lines) { y += lh; c.fillText(ln, W / 2, y); }

  c.fillStyle = '#c9d6c8'; c.font = `500 36px ${body}`;
  c.fillText(t('imgStats', { g: fmtMoney(r.amount, cur), a: fmtMoney(r.actual, cur), p: fmtPct(r.pct) }), W / 2, H - 170);
  c.fillStyle = '#8fa797'; c.font = `500 30px ${body}`;
  c.fillText([title, date].filter(Boolean).join(' · '), W / 2, H - 110);

  return new Promise(res => cv.toBlob(res, 'image/png'));
}

/** Share via the phone's share sheet (WhatsApp etc.), or download when sharing files isn't possible. */
export async function shareImage(blob, fileName, text) {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

export const langLocale = () => (getLang() === 'he' ? 'he-IL' : 'en-GB');
