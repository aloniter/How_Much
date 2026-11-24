// CheckMate — the browser app. Plain ES modules, no build step.
import { computeRoundStats, leaderboard } from './stats.js';
import { t, fmtDuration, errorText, getLang, setLang, applyLang } from './i18n.js';
import { esc, fmtMoney, fmtPct, numberLine, errorBars, speedBars, pointsBars, installTooltips } from './charts.js';
import { sfx, unlockAudio, confetti, floatEmoji, buzz, isMuted, setMuted } from './fx.js';

const AVATARS = ['🍕', '🍔', '🌮', '🍣', '🥗', '🍝', '🥩', '🍤', '🧁', '🍷', '🍺', '🥂', '🦞', '🥑', '🌶️', '🍩', '🧀', '🍗', '🥐', '🍦'];
const REACTIONS = ['😂', '🔥', '😱', '👏', '🍅', '💸', '🤑', '🙈'];
const CURRENCIES = ['₪', '$', '€', '£', '¥', '₹'];
// Hebrew keyboard → the English letter on the same key, so codes can be typed without switching keyboards.
const HE_KEYS = { '/': 'Q', "'": 'W', 'ק': 'E', 'ר': 'R', 'א': 'T', 'ט': 'Y', 'ו': 'U', 'ן': 'I', 'ם': 'O', 'פ': 'P', 'ש': 'A', 'ד': 'S', 'ג': 'D', 'כ': 'F', 'ע': 'G', 'י': 'H', 'ח': 'J', 'ל': 'K', 'ך': 'L', 'ז': 'Z', 'ס': 'X', 'ב': 'C', 'ה': 'V', 'נ': 'B', 'מ': 'N', 'צ': 'M' };
const toCode = (v) => [...v].map(ch => HE_KEYS[ch] || ch).join('').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4);

const $app = document.getElementById('app');

// ---------- tiny storage helpers (storage can be blocked: never crash) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const sessionKey = (code) => `checkmate:session:${code}`;

// ---------- app state ----------
const S = {
  screen: 'home',          // home | create | join | room
  code: null,
  session: null,           // {pid, token}
  room: null,              // latest server view
  skew: 0,                 // serverNow - Date.now()
  es: null,
  animatedRounds: new Set(),
  revealing: false,
  editingGuess: false,
  draft: { amount: '', quote: '', actual: '' },
  split: { tip: 10, people: null },
  profile: store.get('checkmate:profile') || { name: '', avatar: AVATARS[(Math.random() * AVATARS.length) | 0] },
  createOpts: { title: '', currency: store.get('checkmate:currency') || '₪', mode: 'classic' },
  joinInfo: null,
  lastStateJSON: '',
};

// ---------- utilities ----------
function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
const toastErr = (err) => toast(errorText(err));
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, code: data.code });
  return data;
}
const act = (action, extra = {}) => api(`/api/rooms/${S.code}/${action}`, { pid: S.session.pid, token: S.session.token, ...extra });
const shareUrl = (code) => `${location.origin}/r/${code}`;
const serverNow = () => Date.now() + S.skew;
const round = () => S.room?.rounds[S.room.rounds.length - 1];
const me = () => S.room?.players.find(p => p.id === S.session?.pid);
const isHost = () => S.room?.hostId === S.session?.pid;
const cur = () => S.room?.currency || '';
const playerById = (id) => S.room?.players.find(p => p.id === id);

function saveProfile() { store.set('checkmate:profile', S.profile); }

// ---------- routing ----------
function go(screen, code) {
  S.screen = screen;
  if (code) S.code = code;
  const path = screen === 'room' || screen === 'join' ? `/r/${S.code}` : '/';
  if (location.pathname !== path) history.pushState({}, '', path);
  render();
  window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', boot);

async function boot() {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{4})/);
  const qp = new URLSearchParams(location.search).get('room');
  const code = (m?.[1] || qp || '').toUpperCase();
  if (!code) { disconnect(); S.screen = 'home'; render(); return; }
  S.code = code;
  const saved = store.get(sessionKey(code));
  if (saved) { S.session = saved; enterRoom(); return; }
  await openJoin(code);
}

async function openJoin(code) {
  S.code = code;
  try {
    S.joinInfo = await api(`/api/rooms/${code}`);
    go('join', code);
  } catch (e) {
    toastErr(e);
    go('home');
  }
}

// ---------- live connection ----------
function enterRoom() {
  S.screen = 'room';
  if (location.pathname !== `/r/${S.code}`) history.replaceState({}, '', `/r/${S.code}`);
  render();
  connect();
}
function disconnect() {
  if (S.es) { S.es.close(); S.es = null; }
  S.room = null;
}
function connect() {
  if (S.es) S.es.close();
  const { pid, token } = S.session;
  const es = new EventSource(`/api/rooms/${S.code}/events?pid=${encodeURIComponent(pid)}&token=${encodeURIComponent(token)}`);
  S.es = es;
  let failures = 0;
  es.addEventListener('state', (e) => {
    failures = 0;
    const raw = e.data;
    const data = JSON.parse(raw);
    S.skew = data.serverNow - Date.now();
    const prev = S.room;
    S.room = data;
    if (!data.players.some(p => p.id === S.session.pid)) { kicked(); return; }
    onStateChange(prev, data);
    // ignore pure "who is online" ticks for heavy re-renders while typing
    render();
  });
  es.addEventListener('react', (e) => {
    const { emoji, name, from } = JSON.parse(e.data);
    floatEmoji(emoji, from === S.session.pid ? 'you' : name);
  });
  es.onerror = async () => {
    failures++;
    if (failures >= 3) {
      // Is the room gone, or were we removed? Then stop retrying.
      try { await api(`/api/rooms/${S.code}`); }
      catch (err) {
        if (err.status === 404) { es.close(); store.del(sessionKey(S.code)); toast(t('tableClosed')); go('home'); }
      }
    }
  };
}
function kicked() {
  S.es?.close();
  store.del(sessionKey(S.code));
  toast(t('removed'));
  go('home');
}

function onStateChange(prev, next) {
  if (!prev) {
    // Arriving fresh: animate a reveal only if it just happened.
    const r = next.rounds[next.rounds.length - 1];
    if (r.actual != null && serverNow() - r.revealedAt < 15000) playReveal(r);
    else if (r.actual != null) S.animatedRounds.add(r.n);
    return;
  }
  const pr = prev.rounds[prev.rounds.length - 1];
  const nr = next.rounds[next.rounds.length - 1];
  if (nr.n !== pr.n) { S.draft = { amount: '', quote: '', actual: '' }; S.editingGuess = false; sfx.pop(); toast(t('newRound', { label: nr.label })); return; }
  if (pr.actual == null && nr.actual != null) { playReveal(nr); return; }
  // someone new locked in a guess
  const before = Object.keys(pr.guesses).length, after = Object.keys(nr.guesses).length;
  if (after > before) {
    const newPid = Object.keys(nr.guesses).find(id => !pr.guesses[id]);
    if (newPid !== S.session.pid) { sfx.tick(); buzz(30); }
  }
  if (next.players.length > prev.players.length) {
    const fresh = next.players.find(p => !prev.players.some(q => q.id === p.id));
    if (fresh) { sfx.join(); toast(t('satDown', { who: `${fresh.avatar} ${fresh.name}` })); }
  }
}

// ---------- translated bits of stats ----------
const verdictText = (v) => `${v.emoji} ${t('verdicts.' + v.key)}`;
function awardDetail(a) {
  const v = { ...a.detail.vars };
  if (v.ms != null) v.t = fmtDuration(v.ms);
  if (v.pct != null) v.p = fmtPct(v.pct, false);
  return t('details.' + a.detail.key, v);
}

// ---------- the big reveal ----------
function playReveal(r) {
  if (S.animatedRounds.has(r.n)) return;
  S.animatedRounds.add(r.n);
  S.revealing = true;
  const stats = computeRoundStats(r, S.room.players, S.room.mode);
  const winner = stats.rows[0];
  const mine = stats.rows.find(x => x.pid === S.session.pid);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div><div class="drum">🥁</div><div class="count pop">3</div><div class="sub">${esc(t('realBillIs'))}</div></div>
    <button class="btn ghost skip">${esc(t('skip'))}</button>`;
  document.body.appendChild(ov);
  const box = ov.firstElementChild;
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    ov.remove(); S.revealing = false; render();
  };
  ov.querySelector('.skip').onclick = finish;
  sfx.drumroll(3);
  buzz([40, 60, 40, 60, 40]);
  const countEl = box.querySelector('.count');
  [2, 1].forEach((n, i) => setTimeout(() => {
    if (done) return;
    countEl.textContent = n; countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop');
  }, (i + 1) * 1000));
  setTimeout(() => {
    if (done) return;
    box.innerHTML = `<div class="sub">${esc(t('theRealBillOverlay'))}</div><div class="bill">${esc(fmtMoney(0, cur()))}</div>`;
    const billEl = box.querySelector('.bill');
    const t0 = performance.now(), dur = 1300;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - k) ** 3;
      billEl.textContent = fmtMoney(Math.round(stats.actual * eased), cur());
      if (k < 1) requestAnimationFrame(step);
      else {
        billEl.textContent = fmtMoney(stats.actual, cur());
        sfx.tada(); buzz(200); confetti();
        if (winner && !winner.busted) {
          const w = document.createElement('div');
          w.className = 'winner';
          w.textContent = t('checkmateWins', { who: `${winner.avatar} ${winner.name}` });
          box.appendChild(w);
        }
        if (mine) {
          const m = document.createElement('div');
          m.className = 'sub';
          m.textContent = mine.rank === 1 && !mine.busted ? t('thatsYou') : t('youWere', { rank: mine.rank, verdict: verdictText(mine.verdict) });
          box.appendChild(m);
        }
        setTimeout(finish, 3200);
      }
    };
    requestAnimationFrame(step);
  }, 3000);
}

// ---------- renderers ----------
function render() {
  if (S.revealing && S.screen === 'room') return; // the overlay owns the screen
  const focused = document.activeElement?.id;
  const selStart = document.activeElement?.selectionStart;
  if (S.screen === 'home') $app.innerHTML = homeView();
  else if (S.screen === 'create') $app.innerHTML = createView();
  else if (S.screen === 'join') $app.innerHTML = joinView();
  else if (S.screen === 'room') patch(S.room ? roomView() : `<div class="card center" style="margin-top:40vh">${esc(t('connecting'))}</div>`);
  if (focused) {
    const el = document.getElementById(focused);
    if (el) { el.focus({ preventScroll: true }); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch { /* number inputs */ } }
  }
  renderReactBar();
  sizeCharts();
}

/**
 * Re-render the room without disturbing what the person is doing: top-level blocks that carry
 * a data-sig equal to the one already on screen are kept as-is (so a half-typed guess, an open
 * keyboard or a slider mid-drag survive other people's live updates).
 */
function patch(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const next = [...tpl.content.children];
  const prev = [...$app.children];
  const sameShape = prev.length === next.length && prev.every((n, i) => (n.dataset.key || '') === (next[i].dataset.key || ''));
  if (!sameShape) { $app.replaceChildren(...next); return; }
  next.forEach((n, i) => {
    const old = prev[i];
    if (n.dataset.sig && old.dataset.sig === n.dataset.sig) return;
    if (old.outerHTML !== n.outerHTML) old.replaceWith(n);
  });
}

const langButton = (cls = 'lang-btn') => `<button class="${cls}" data-action="lang" aria-label="${esc(t('switchAria'))}">${esc(t('switchTo'))}</button>`;

function homeView() {
  return `
  <div class="lang-row">${langButton()}</div>
  <div class="hero">
    <img class="logo-icon" src="/icon-256.png" width="128" height="128" alt="">
    <h1 class="logo">CheckMate</h1>
    <p class="tagline">${esc(t('tagline'))}</p>
  </div>
  <div class="card stack">
    <button class="btn primary big block" data-go="create">${esc(t('startTable'))}</button>
    <div class="row">
      <input class="text code grow" id="home-code" maxlength="4" placeholder="${esc(t('codePh'))}" autocomplete="off" autocapitalize="characters" aria-label="${esc(t('codeAria'))}" dir="ltr">
      <button class="btn big" data-action="join-code">${esc(t('join'))}</button>
    </div>
  </div>
  <div class="card">
    <h2>${esc(t('howItWorks'))}</h2>
    <div class="how">
      <div><b>📱</b>${esc(t('how1'))}</div>
      <div><b>🤔</b>${esc(t('how2'))}</div>
      <div><b>🥁</b>${esc(t('how3'))}</div>
    </div>
  </div>
  ${recentTablesView()}
  <p class="footer">${esc(t('footerHome'))}</p>`;
}

function recentTablesView() {
  const list = store.get('checkmate:recent') || [];
  if (!list.length) return '';
  return `<div class="card"><h2>${esc(t('recentTables'))}</h2><div class="chips">${list.slice(0, 5).map(x =>
    `<button class="chip" data-action="open-recent" data-code="${esc(x.code)}">${esc(x.title)} · ${esc(x.code)}</button>`).join('')}</div></div>`;
}

function avatarPicker(taken = []) {
  return `<div class="avatar-grid" role="group" aria-label="${esc(t('pickAvatarAria'))}">${AVATARS.map(a =>
    `<button type="button" class="avatar-btn ${taken.includes(a) && a !== S.profile.avatar ? 'taken' : ''}" data-avatar="${a}" aria-pressed="${a === S.profile.avatar}">${a}</button>`).join('')}</div>`;
}

const modeButtons = (attr, current) => `
  <div class="seg">
    <button type="button" ${attr}="classic" aria-pressed="${current === 'classic'}">${esc(t('modeClassic'))}</button>
    <button type="button" ${attr}="nover" aria-pressed="${current === 'nover'}">${esc(t('modeNover'))}</button>
  </div>`;

function createView() {
  const o = S.createOpts;
  return `
  <div class="topbar"><button class="btn icon ghost" data-go="home" aria-label="${esc(t('back'))}">${t('backArrow')}</button><h1>${esc(t('newTable'))}</h1>${langButton('lang-btn small-lang')}</div>
  <form class="card stack" data-form="create">
    <label class="field"><span>${esc(t('yourName'))}</span><input class="text" dir="auto" id="c-name" name="name" maxlength="24" required placeholder="${esc(t('namePhHost'))}" value="${esc(S.profile.name)}" autocomplete="nickname"></label>
    <div class="field"><span class="small muted" style="font-weight:600">${esc(t('yourAvatar'))}</span>${avatarPicker()}</div>
    <label class="field"><span>${esc(t('whereEating'))}</span><input class="text" dir="auto" id="c-title" name="title" maxlength="40" placeholder="${esc(t('titlePh'))}" value="${esc(o.title)}"></label>
    <div class="field"><span class="small muted" style="font-weight:600">${esc(t('currency'))}</span>
      <div class="chips">${CURRENCIES.map(c => `<button type="button" class="chip" data-currency="${c}" aria-pressed="${c === o.currency}">${c}</button>`).join('')}</div>
    </div>
    <div class="field"><span class="small muted" style="font-weight:600">${esc(t('rules'))}</span>
      ${modeButtons('data-mode', o.mode)}
      <p class="small muted" style="margin-top:6px">${esc(t(o.mode === 'nover' ? 'modeNoverDesc' : 'modeClassicDesc'))}</p>
    </div>
    <button class="btn primary big block" type="submit">${esc(t('openTable'))}</button>
  </form>`;
}

function joinView() {
  const info = S.joinInfo || { players: [], takenAvatars: [] };
  return `
  <div class="lang-row">${langButton()}</div>
  <div class="hero" style="padding-top:4px">
    <img class="logo-icon small" src="/icon-256.png" width="84" height="84" alt="">
    <h1 class="display" style="font-size:1.8rem" dir="auto">${esc(info.title || t('dinnerTable'))}</h1>
    <p class="tagline">${esc(t('tableInfo', { code: S.code, n: info.players.length }))}</p>
    <p class="tagline">${info.players.map(p => esc(p.avatar)).join(' ')}</p>
  </div>
  <form class="card stack" data-form="join">
    <label class="field"><span>${esc(t('yourName'))}</span><input class="text" dir="auto" id="j-name" name="name" maxlength="24" required placeholder="${esc(t('namePhJoin'))}" value="${esc(S.profile.name)}" autocomplete="nickname"></label>
    <div class="field"><span class="small muted" style="font-weight:600">${esc(t('pickAvatar'))}</span>${avatarPicker(info.takenAvatars)}</div>
    <button class="btn primary big block" type="submit">${esc(t('sitDown'))}</button>
    <p class="small muted center">${esc(t('rejoinHint'))}</p>
  </form>
  <p class="footer"><button data-go="home">${esc(t('backHome'))}</button></p>`;
}

function roomView() {
  const r = round();
  const revealed = r.actual != null;
  return `
  <div class="topbar" data-key="top">
    <button class="btn icon ghost" data-action="leave" aria-label="${esc(t('home'))}">🏠</button>
    <h1 dir="auto">${esc(S.room.title)}</h1>
    <button class="btn icon ghost" data-action="mute" aria-label="${esc(t(isMuted() ? 'unmute' : 'mute'))}">${isMuted() ? '🔇' : '🔊'}</button>
    <button class="code-pill" data-action="share" aria-label="${esc(t('shareAria'))}" dir="ltr">${esc(S.room.code)} 📲</button>
  </div>
  <div class="row wrap" style="margin-bottom:12px" data-key="tags">
    <span class="round-tag">🍽️ ${esc(r.label)}</span>
    ${S.room.rounds.length > 1 ? `<span class="round-tag">${esc(t('roundN', { n: r.n }))}</span>` : ''}
    <span class="round-tag">${esc(t(S.room.mode === 'nover' ? 'modeNover' : 'modeClassic'))}</span>
  </div>
  ${revealed ? resultsView(r) : guessingView(r)}
  <p class="footer" data-key="foot">${isHost() ? `<button data-action="settings">${esc(t('settingsLink'))}</button> · ` : ''}<button data-action="profile">${esc(t('profileLink'))}</button> · ${langButton('link-lang')}</p>`;
}

function guessingView(r) {
  const mine = r.guesses[S.session.pid];
  const total = S.room.players.length;
  const done = Object.keys(r.guesses).length;
  const elapsed = Math.max(0, serverNow() - r.startedAt);
  const showForm = !mine || S.editingGuess;
  const waitingFor = S.room.players.filter(p => !r.guesses[p.id]);
  const trash = t('trash');
  return `
  <section class="card stack" data-key="guess" data-sig="${esc(`${getLang()}|${r.n}|${showForm}|${mine?.amount}|${mine?.quote}|${cur()}`)}">
    ${showForm ? `
      <div class="row spread"><h2 style="margin:0">${esc(t('whatTotal'))}</h2><span class="timer" data-timer="${r.startedAt}">⏱ ${esc(fmtDuration(elapsed))}</span></div>
      <form data-form="guess" class="stack">
        <div class="money-input"><span class="cur">${esc(cur())}</span>
          <input id="g-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(S.draft.amount)}" aria-label="${esc(t('guessAria'))}" required>
        </div>
        <label class="field"><span>${esc(t('trashTalk'))}</span>
          <input class="text" dir="auto" id="g-quote" name="quote" maxlength="60" placeholder="${esc(trash[r.n % trash.length])}" value="${esc(S.draft.quote)}">
        </label>
        <button class="btn primary big block" type="submit">${esc(t(mine ? 'updateGuess' : 'lockIn'))}</button>
        ${mine ? `<button class="btn ghost block" type="button" data-action="cancel-edit">${esc(t('keep', { amount: fmtMoney(mine.amount, cur()) }))}</button>` : ''}
        <p class="small muted center">${esc(t('secretHint'))}</p>
      </form>` : `
      <div class="my-guess">
        <span class="locked-badge">${esc(t('lockedAfter', { t: fmtDuration(mine.firstAt - r.startedAt) }))}</span>
        <div class="amt">${esc(fmtMoney(mine.amount, cur()))}</div>
        ${mine.quote ? `<p class="muted">“${esc(mine.quote)}”</p>` : ''}
        <button class="btn ghost" data-action="edit-guess" style="margin-top:8px">${esc(t('changeMind'))}</button>
      </div>`}
  </section>

  <section class="card stack" data-key="players">
    <div class="row spread"><h2 style="margin:0">${esc(t('atTable'))}</h2><span class="muted small">${esc(t('guessedCount', { done, total }))}</span></div>
    <div class="progress" aria-hidden="true"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
    <div class="players">${S.room.players.map(p => playerCard(p, r)).join('')}</div>
    ${waitingFor.length && done ? `<p class="small muted">${esc(t('waitingFor', { names: waitingFor.map(p => p.avatar + ' ' + p.name).join(', ') }))}</p>` : ''}
    ${total === 1 ? `<button class="btn block" data-action="share">${esc(t('inviteFamily'))}</button>` : ''}
  </section>

  <section class="card stack" data-key="reveal" data-sig="${esc(`${getLang()}|${r.n}|${done > 0}|${cur()}`)}">
    <h2 style="margin:0">${esc(t('gotReceipt'))}</h2>
    <p class="small muted">${esc(t('receiptHint'))}</p>
    <form data-form="reveal" class="row">
      <div class="money-input grow"><span class="cur" style="font-size:1.4rem;left:14px">${esc(cur())}</span>
        <input id="r-actual" name="actual" inputmode="decimal" autocomplete="off" placeholder="${esc(t('realTotalPh'))}" value="${esc(S.draft.actual)}" style="font-size:1.6rem;min-height:58px;padding-left:40px" aria-label="${esc(t('realTotalAria'))}">
      </div>
      <button class="btn hot big" type="submit" ${done ? '' : 'disabled'}>${esc(t('reveal'))}</button>
    </form>
  </section>`;
}

function playerCard(p, r) {
  const g = r.guesses[p.id];
  const isMe = p.id === S.session.pid;
  const status = g ? t('inTime', { t: fmtDuration((g.firstAt ?? g.at) - r.startedAt) }) : t('thinking');
  return `<div class="player ${g ? 'done' : 'thinking'} ${isMe ? 'me' : ''}">
    <span class="dot ${p.online ? 'on' : ''}" title="${esc(t(p.online ? 'online' : 'offline'))}"></span>
    ${isHost() && !isMe && p.id !== S.room.hostId ? `<button class="kick" data-action="kick" data-pid="${esc(p.id)}" aria-label="${esc(t('removeX', { name: p.name }))}">✕</button>` : ''}
    <span class="av">${esc(p.avatar)}</span>
    <span class="nm" dir="auto">${esc(p.name)}${p.id === S.room.hostId ? ' 👑' : ''}</span>
    <span class="st">${esc(status)}</span>
  </div>`;
}

function resultsView(r) {
  const stats = computeRoundStats(r, S.room.players, S.room.mode);
  const c = cur();
  const mine = stats.rows.find(x => x.pid === S.session.pid);
  const [p1, p2, p3] = stats.rows;
  const board = leaderboard(S.room.rounds, S.room.players, S.room.mode);
  const people = S.split.people ?? S.room.players.length;
  const perPerson = (stats.actual * (1 + S.split.tip / 100)) / Math.max(1, people);
  const revealer = playerById(r.revealedBy);
  const last = stats.rows[stats.rows.length - 1];
  const step = (row, cls, medal) => row ? `<div class="step ${cls}"><div class="medal">${medal}</div><span class="av">${esc(row.avatar)}</span><span class="nm">${esc(row.name)}</span><span class="gs">${esc(fmtMoney(row.amount, c))}</span><div class="small muted">${esc(fmtPct(row.pct))}</div></div>` : '<div></div>';

  return `
  <section class="card bill-hero">
    <div class="lbl">${esc(t('theRealBill'))}</div>
    <div class="val">${esc(fmtMoney(stats.actual, c))}</div>
    <p class="muted small">${revealer ? esc(t('revealedBy', { who: revealer.avatar + ' ' + revealer.name })) : ''}</p>
    ${mine ? `<p style="margin-top:10px;font-weight:650">${esc(t('youLine', { amount: fmtMoney(mine.amount, c), rank: mine.rank, n: stats.n, verdict: verdictText(mine.verdict) }))}</p>` : `<p class="muted" style="margin-top:10px">${esc(t('didntGuess'))}</p>`}
    <div class="kpis">
      <div class="kpi"><div class="k">${esc(t('average'))}</div><div class="v">${esc(fmtMoney(Math.round(stats.average), c))}</div><div class="s">${esc(fmtPct(stats.avgPct))}</div></div>
      <div class="kpi"><div class="k">${esc(t('median'))}</div><div class="v">${esc(fmtMoney(Math.round(stats.median), c))}</div><div class="s">${esc(fmtPct((stats.median - stats.actual) / stats.actual * 100))}</div></div>
      <div class="kpi"><div class="k">${esc(t('range'))}</div><div class="v" style="font-size:1rem" dir="ltr">${esc(compactMoney(stats.min, c))}–${esc(compactMoney(stats.max, c))}</div><div class="s" dir="ltr">${stats.under}⬇ ${stats.over}⬆</div></div>
    </div>
  </section>

  <section class="card">
    <h2>${esc(t('podium'))}</h2>
    <div class="podium" dir="ltr">${step(p2, 'p2', '🥈')}${step(p1, 'p1', p1?.busted ? '💥' : '🥇')}${step(p3, 'p3', '🥉')}</div>
  </section>

  <section class="card">
    <h2>${esc(t('crowdTitle'))}</h2>
    <p>${esc(crowdText(stats))}</p>
  </section>

  <section class="card">
    <h2>${esc(t('whereLanded'))}</h2>
    <div class="chart-box" data-chart="line"></div>
    <div class="legend"><span><i class="ln"></i>${esc(t('legendReal'))}</span><span><i class="ln avg"></i>${esc(t('legendAvg'))}</span><span class="muted">${esc(t('tapFace'))}</span></div>
  </section>

  <section class="card">
    <h2>${esc(t('howFar'))}</h2>
    <div class="chart-box" data-chart="error"></div>
    <div class="legend"><span><i style="background:var(--under)"></i>${esc(t('legendLow'))}</span><span><i style="background:var(--over)"></i>${esc(t('legendHigh'))}</span></div>
  </section>

  <section class="card">
    <h2>${esc(t('speedRace'))}</h2>
    <div class="chart-box" data-chart="speed"></div>
  </section>

  <section class="card">
    <h2>${esc(t('awardsNight'))}</h2>
    <div class="awards">${stats.awards.map(a => `<div class="award"><div class="e">${a.emoji}</div><div class="t">${esc(t('awards.' + a.type))}</div><div class="w">${esc(a.who.avatar + ' ' + a.who.name)}</div><div class="d">${esc(awardDetail(a))}</div></div>`).join('')}</div>
  </section>

  <section class="card">
    <h2>${esc(t('fullResults'))}</h2>
    <table class="rank-table">
      <thead><tr><th>#</th><th>${esc(t('colWho'))}</th><th class="num">${esc(t('colGuess'))}</th><th class="num">${esc(t('colOff'))}</th></tr></thead>
      <tbody>${stats.rows.map(x => `<tr class="${x.pid === S.session.pid ? 'me' : ''}">
        <td>${x.rank}</td>
        <td class="who">${esc(x.avatar + ' ' + x.name)}<span class="vd">${esc(verdictText(x.verdict))} · ${esc(fmtDuration(x.firstTimeMs))}</span>${x.quote ? `<span class="q">“${esc(x.quote)}”</span>` : ''}</td>
        <td class="num">${esc(fmtMoney(x.amount, c))}</td>
        <td class="num ${x.diff > 0 ? 'pos' : x.diff < 0 ? 'neg' : ''}">${esc(fmtPct(x.pct))}<span class="vd">${esc(x.diff === 0 ? t('exact') : (x.diff > 0 ? '+' : '−') + fmtMoney(x.absDiff, c))}</span></td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="small muted" style="margin-top:10px">${esc(t('pointsRule') + (S.room.mode === 'nover' ? t('pointsRuleBust') : ''))}</p>
  </section>

  ${board.length && S.room.rounds.filter(x => x.actual != null).length > 1 ? `
  <section class="card">
    <h2>${esc(t('overall'))}</h2>
    <div class="chart-box" data-chart="points"></div>
  </section>` : ''}

  <section class="card stack" data-key="split" data-sig="${esc(`${getLang()}|${r.n}|${people}|${c}`)}">
    <h2 style="margin:0">${esc(t('split'))}</h2>
    <div class="row spread"><span>${esc(t('tip'))}</span><b id="split-tip-val">${S.split.tip}%</b></div>
    <input type="range" id="split-tip" min="0" max="25" step="1" value="${S.split.tip}" aria-label="${esc(t('tipAria'))}">
    <div class="row spread"><span>${esc(t('peoplePaying'))}</span>
      <div class="row" dir="ltr"><button class="btn icon" data-action="people" data-d="-1" aria-label="${esc(t('fewer'))}">−</button><b style="min-width:2ch;text-align:center">${people}</b><button class="btn icon" data-action="people" data-d="1" aria-label="${esc(t('more'))}">+</button></div>
    </div>
    <div class="center"><div class="muted small">${esc(t('eachPays'))}</div><div class="split-out" id="split-each">${esc(fmtMoney(Math.ceil(perPerson * 100) / 100, c))}</div>
    <div class="muted small" id="split-total">${esc(t('totalWithTip', { x: fmtMoney(Math.round(stats.actual * (1 + S.split.tip / 100) * 100) / 100, c) }))}</div></div>
    ${p1 && stats.n > 1 ? `<p class="small center">${esc(t('funRule', { who: last.avatar + ' ' + last.name }))}</p>` : ''}
  </section>

  <section class="card stack">
    <button class="btn block" data-action="share-results">${esc(t('shareResults'))}</button>
    <h2 style="margin:6px 0 0">${esc(t('playAgain'))}</h2>
    <div class="chips">${t('nextIdeas').map(x => `<button class="chip" data-action="next-round" data-label="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <p class="small muted">${esc(t('playAgainHint'))}</p>
  </section>`;
}

const compactMoney = (v, c) => (v >= 10000 ? c + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmtMoney(Math.round(v), c));

function crowdText(s) {
  if (s.n < 2) return t('crowdOne');
  const off = Math.abs(s.avgPct);
  const how = t('crowdHow')[off < 3 ? 0 : off < 10 ? 1 : off < 25 ? 2 : 3];
  const main = t('crowdMain', { avg: fmtMoney(Math.round(s.average), cur()), pct: fmtPct(s.avgPct, false), over: s.avgDiff >= 0, how });
  if (s.crowdBeats === s.n) return main + t('crowdAll');
  if (s.crowdBeats === 0) return main + t('crowdNone');
  return main + t('crowdSome', { beat: s.crowdBeats, n: s.n }) + t(s.over > s.under ? 'crowdMostOver' : s.under > s.over ? 'crowdMostUnder' : 'crowdSplit');
}

function sizeCharts() {
  const r = round();
  if (S.screen !== 'room' || !r || r.actual == null) return;
  const stats = computeRoundStats(r, S.room.players, S.room.mode);
  for (const box of $app.querySelectorAll('[data-chart]')) {
    const w = box.clientWidth || 320;
    const kind = box.dataset.chart;
    if (kind === 'line') box.innerHTML = numberLine(stats, cur(), w);
    if (kind === 'error') box.innerHTML = errorBars(stats, cur(), w, S.session.pid);
    if (kind === 'speed') box.innerHTML = speedBars(stats, w);
    if (kind === 'points') box.innerHTML = pointsBars(leaderboard(S.room.rounds, S.room.players, S.room.mode), w);
  }
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(sizeCharts, 150); });

function renderReactBar() {
  let bar = document.querySelector('.react-bar');
  if (S.screen !== 'room' || !S.room) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'react-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('dir', 'ltr');
  bar.innerHTML = REACTIONS.map(e => `<button data-react="${e}" aria-label="${e}">${e}</button>`).join('');
  document.body.appendChild(bar);
}

// ---------- modals ----------
function modal(html, onMount) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
  document.body.appendChild(back);
  onMount?.(back.firstElementChild, () => back.remove());
}

function qrSvg(text) {
  try {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch { return ''; }
}

function shareModal() {
  const url = shareUrl(S.code);
  modal(`
    <div class="stack center">
      <h2>${esc(t('inviteTitle'))}</h2>
      <div class="qr">${qrSvg(url)}</div>
      <p class="muted small">${esc(t('scanHint'))}</p>
      <div class="big-code" dir="ltr">${esc(S.code)}</div>
      <div class="link-box" dir="ltr">${esc(url)}</div>
      <div class="row">
        <button class="btn grow" data-act="copy">${esc(t('copyLink'))}</button>
        ${navigator.share ? `<button class="btn primary grow" data-act="native">${esc(t('send'))}</button>` : ''}
      </div>
      <button class="btn ghost block" data-close>${esc(t('done'))}</button>
    </div>`, (el) => {
    el.querySelector('[data-act="copy"]').onclick = () => copy(url);
    el.querySelector('[data-act="native"]')?.addEventListener('click', () =>
      navigator.share({ title: 'CheckMate ♛', text: t('inviteText', { code: S.code }), url }).catch(() => {}));
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('copied')); }
  catch { toast(t('copyFailed')); }
}

function profileModal() {
  const m = me();
  S.profile = { name: m.name, avatar: m.avatar };
  modal(`
    <form class="stack" data-modal-form="profile">
      <h2>${esc(t('profileTitle'))}</h2>
      <label class="field"><span>${esc(t('name'))}</span><input class="text" name="name" maxlength="24" value="${esc(m.name)}" required></label>
      ${avatarPicker(S.room.players.map(p => p.avatar))}
      <button class="btn primary block" type="submit">${esc(t('save'))}</button>
      <button class="btn ghost block" type="button" data-close>${esc(t('cancel'))}</button>
    </form>`, (el, close) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-avatar]');
      if (!b) return;
      S.profile.avatar = b.dataset.avatar;
      el.querySelectorAll('[data-avatar]').forEach(x => x.setAttribute('aria-pressed', x.dataset.avatar === S.profile.avatar));
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get('name');
      try { await act('profile', { name, avatar: S.profile.avatar }); S.profile.name = name; saveProfile(); close(); }
      catch (err) { toastErr(err); }
    };
  });
}

function settingsModal() {
  const r = round();
  modal(`
    <form class="stack" data-modal-form="settings">
      <h2>${esc(t('settingsTitle'))}</h2>
      <label class="field"><span>${esc(t('tableName'))}</span><input class="text" name="title" maxlength="40" value="${esc(S.room.title)}"></label>
      ${r.actual == null ? `<label class="field"><span>${esc(t('roundCalled'))}</span><input class="text" name="roundLabel" maxlength="40" value="${esc(r.label)}"></label>` : ''}
      <div class="field"><span class="small muted" style="font-weight:600">${esc(t('currency'))}</span>
        <div class="chips">${CURRENCIES.map(c => `<button type="button" class="chip" data-cur="${c}" aria-pressed="${c === S.room.currency}">${c}</button>`).join('')}</div></div>
      ${modeButtons('data-m', S.room.mode)}
      <button class="btn primary block" type="submit">${esc(t('save'))}</button>
      <button class="btn ghost block" type="button" data-close>${esc(t('cancel'))}</button>
    </form>`, (el, close) => {
    let currency = S.room.currency, mode = S.room.mode;
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cur]'), m = e.target.closest('[data-m]');
      if (c) { currency = c.dataset.cur; el.querySelectorAll('[data-cur]').forEach(x => x.setAttribute('aria-pressed', x.dataset.cur === currency)); }
      if (m) { mode = m.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === mode)); }
    });
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await act('settings', { title: fd.get('title'), roundLabel: fd.get('roundLabel'), currency, mode }); close(); toast(t('saved')); }
      catch (err) { toastErr(err); }
    };
  });
}

function shareResults() {
  const r = round();
  const s = computeRoundStats(r, S.room.players, S.room.mode);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [
    t('shareHeader', { title: S.room.title, label: r.label }),
    t('shareLine', { real: fmtMoney(s.actual, cur()), avg: fmtMoney(Math.round(s.average), cur()), pct: fmtPct(s.avgPct) }),
    '',
    ...s.rows.map((x, i) => `${medals[i] || `${i + 1}.`} ${x.avatar} ${x.name} — ${fmtMoney(x.amount, cur())} (${fmtPct(x.pct)}) ${x.verdict.emoji}`),
    '',
    ...s.awards.filter(a => ['farthest', 'fastest', 'bigspender', 'cheapskate'].includes(a.key)).map(a => `${a.emoji} ${t('awards.' + a.type)}: ${a.who.name}`),
  ];
  const text = lines.join('\n');
  if (navigator.share) navigator.share({ title: t('shareTitle'), text }).catch(() => copy(text));
  else copy(text);
}

// ---------- events ----------
function rememberTable() {
  const list = (store.get('checkmate:recent') || []).filter(x => x.code !== S.code);
  list.unshift({ code: S.code, title: S.room?.title || S.createOpts.title || t('defaultTitle') });
  store.set('checkmate:recent', list.slice(0, 8));
}

document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button, [data-go]');
  if (!btn || btn.closest('.modal')) return;

  if (btn.dataset.go) { go(btn.dataset.go); return; }
  if (btn.dataset.avatar) { S.profile.avatar = btn.dataset.avatar; saveProfile(); render(); return; }
  if (btn.dataset.currency) { syncCreateForm(); S.createOpts.currency = btn.dataset.currency; store.set('checkmate:currency', btn.dataset.currency); render(); return; }
  if (btn.dataset.mode) { syncCreateForm(); S.createOpts.mode = btn.dataset.mode; render(); return; }
  if (btn.dataset.react) {
    sfx.pop();
    btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 600); // gentle spam guard
    act('react', { emoji: btn.dataset.react }).catch(toastErr);
    return;
  }

  switch (btn.dataset.action) {
    case 'join-code': {
      const code = document.getElementById('home-code').value.trim().toUpperCase();
      if (code.length !== 4) { toast(t('codeLen')); return; }
      const saved = store.get(sessionKey(code));
      if (saved) { S.code = code; S.session = saved; enterRoom(); } else openJoin(code);
      return;
    }
    case 'open-recent': {
      const code = btn.dataset.code;
      const saved = store.get(sessionKey(code));
      S.code = code;
      if (saved) { S.session = saved; history.pushState({}, '', `/r/${code}`); enterRoom(); } else openJoin(code);
      return;
    }
    case 'leave': disconnect(); go('home'); return;
    case 'lang': setLang(getLang() === 'he' ? 'en' : 'he'); render(); return;
    case 'mute': setMuted(!isMuted()); render(); return;
    case 'share': shareModal(); return;
    case 'profile': profileModal(); return;
    case 'settings': settingsModal(); return;
    case 'edit-guess': {
      const mine = round().guesses[S.session.pid];
      S.draft.amount = String(mine.amount); S.draft.quote = mine.quote || '';
      S.editingGuess = true; render(); document.getElementById('g-amount')?.focus(); return;
    }
    case 'cancel-edit': S.editingGuess = false; render(); return;
    case 'kick': {
      const p = playerById(btn.dataset.pid);
      if (p && confirm(t('kickConfirm', { name: p.name }))) act('kick', { target: p.id }).catch(toastErr);
      return;
    }
    case 'people': {
      const base = S.split.people ?? S.room.players.length;
      S.split.people = Math.max(1, Math.min(60, base + Number(btn.dataset.d)));
      render(); return;
    }
    case 'share-results': shareResults(); return;
    case 'next-round':
      try { await act('next', { label: btn.dataset.label }); } catch (err) { toastErr(err); }
      return;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'g-amount') S.draft.amount = el.value;
  if (el.id === 'g-quote') S.draft.quote = el.value;
  if (el.id === 'r-actual') S.draft.actual = el.value;
  if (el.id === 'c-name' || el.id === 'j-name') { S.profile.name = el.value; saveProfile(); }
  if (el.id === 'c-title') S.createOpts.title = el.value;
  if (el.id === 'home-code') el.value = toCode(el.value);
  if (el.id === 'split-tip') { S.split.tip = Number(el.value); updateSplit(); }
});

function updateSplit() {
  const r = round();
  if (!r || r.actual == null) return;
  const people = Math.max(1, S.split.people ?? S.room.players.length);
  const total = r.actual * (1 + S.split.tip / 100);
  document.getElementById('split-tip-val').textContent = S.split.tip + '%';
  document.getElementById('split-each').textContent = fmtMoney(Math.ceil((total / people) * 100) / 100, cur());
  document.getElementById('split-total').textContent = 'Total with tip ' + fmtMoney(Math.round(total * 100) / 100, cur());
}

function syncCreateForm() {
  const n = document.getElementById('c-name'); if (n) S.profile.name = n.value;
  const t = document.getElementById('c-title'); if (t) S.createOpts.title = t.value;
}

const parseAmount = (v) => Number(String(v).replace(/,/g, '').replace(/[^0-9.]/g, ''));

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const btn = form.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    switch (form.dataset.form) {
      case 'create': {
        S.profile.name = String(fd.get('name')).trim(); saveProfile();
        const res = await api('/api/rooms', { name: S.profile.name, avatar: S.profile.avatar, title: String(fd.get('title') || '').trim() || t('defaultTitle'), roundLabel: t('firstRound'), currency: S.createOpts.currency, mode: S.createOpts.mode });
        S.code = res.code; S.session = { pid: res.pid, token: res.token };
        store.set(sessionKey(res.code), S.session);
        history.pushState({}, '', `/r/${res.code}`);
        enterRoom(); rememberTable();
        setTimeout(shareModal, 400);
        break;
      }
      case 'join': {
        S.profile.name = String(fd.get('name')).trim(); saveProfile();
        const res = await api(`/api/rooms/${S.code}/join`, { name: S.profile.name, avatar: S.profile.avatar });
        S.session = { pid: res.pid, token: res.token };
        store.set(sessionKey(S.code), S.session);
        if (res.rejoined) toast(t('welcomeBack'));
        enterRoom(); rememberTable();
        break;
      }
      case 'guess': {
        const amount = parseAmount(fd.get('amount'));
        if (!(amount > 0)) { toast(t('typeNumber')); break; }
        await act('guess', { amount, quote: fd.get('quote') });
        S.editingGuess = false; S.draft.amount = ''; S.draft.quote = '';
        sfx.lock(); buzz(60);
        document.activeElement?.blur();
        render();
        break;
      }
      case 'reveal': {
        const actual = parseAmount(fd.get('actual'));
        if (!(actual > 0)) { toast(t('typeReal')); break; }
        const r = round();
        const missing = S.room.players.filter(p => !r.guesses[p.id]);
        if (missing.length && !confirm(t('confirmMissing', { names: missing.map(p => p.name).join(', '), count: missing.length }))) break;
        await act('reveal', { actual });
        S.draft.actual = '';
        break;
      }
    }
  } catch (err) {
    toastErr(err);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

// live timer on the guessing screen (updates text only, no re-render)
setInterval(() => {
  const el = document.querySelector('[data-timer]');
  if (el) el.textContent = '⏱ ' + fmtDuration(Math.max(0, serverNow() - Number(el.dataset.timer)));
}, 1000);

applyLang();
installTooltips();
boot();
