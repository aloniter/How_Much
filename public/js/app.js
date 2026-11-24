// How Much? — the browser app. Plain ES modules, no build step.
import { computeRoundStats, leaderboard, fmtDuration } from './stats.js';
import { esc, fmtMoney, fmtPct, numberLine, errorBars, speedBars, pointsBars, installTooltips } from './charts.js';
import { sfx, unlockAudio, confetti, floatEmoji, buzz, isMuted, setMuted } from './fx.js';

const AVATARS = ['🍕', '🍔', '🌮', '🍣', '🥗', '🍝', '🥩', '🍤', '🧁', '🍷', '🍺', '🥂', '🦞', '🥑', '🌶️', '🍩', '🧀', '🍗', '🥐', '🍦'];
const REACTIONS = ['😂', '🔥', '😱', '👏', '🍅', '💸', '🤑', '🙈'];
const CURRENCIES = ['₪', '$', '€', '£', '¥', '₹'];
const TRASH_TALK = ['Easy money 😎', 'I saw the menu prices 👀', 'Trust me, I’m an accountant', 'Pure instinct', 'Whoever loses pays 😈', 'Wine was NOT cheap', 'I always win this'];
const NEXT_ROUND_IDEAS = ['Dessert 🍰', 'Drinks 🍷', 'Tip 💁', 'Next dinner 🍽️', 'Coffee ☕'];

const $app = document.getElementById('app');

// ---------- tiny storage helpers (storage can be blocked: never crash) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const sessionKey = (code) => `howmuch:session:${code}`;

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
  profile: store.get('howmuch:profile') || { name: '', avatar: AVATARS[(Math.random() * AVATARS.length) | 0] },
  createOpts: { title: '', currency: store.get('howmuch:currency') || '₪', mode: 'classic' },
  joinInfo: null,
  lastStateJSON: '',
};

// ---------- utilities ----------
function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
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

function saveProfile() { store.set('howmuch:profile', S.profile); }

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
    toast(e.message);
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
        if (err.status === 404) { es.close(); store.del(sessionKey(S.code)); toast('That dinner table has closed 🍽️'); go('home'); }
      }
    }
  };
}
function kicked() {
  S.es?.close();
  store.del(sessionKey(S.code));
  toast('You were removed from the table');
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
  if (nr.n !== pr.n) { S.draft = { amount: '', quote: '', actual: '' }; S.editingGuess = false; sfx.pop(); toast(`New round: ${nr.label}`); return; }
  if (pr.actual == null && nr.actual != null) { playReveal(nr); return; }
  // someone new locked in a guess
  const before = Object.keys(pr.guesses).length, after = Object.keys(nr.guesses).length;
  if (after > before) {
    const newPid = Object.keys(nr.guesses).find(id => !pr.guesses[id]);
    if (newPid !== S.session.pid) { sfx.tick(); buzz(30); }
  }
  if (next.players.length > prev.players.length) {
    const fresh = next.players.find(p => !prev.players.some(q => q.id === p.id));
    if (fresh) { sfx.join(); toast(`${fresh.avatar} ${fresh.name} sat down at the table`); }
  }
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
  ov.innerHTML = `<div><div class="drum">🥁</div><div class="count pop">3</div><div class="sub">The real bill is…</div></div>
    <button class="btn ghost skip">Skip ⏭</button>`;
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
    box.innerHTML = `<div class="sub">🧾 The real bill</div><div class="bill">${esc(cur())}0</div>`;
    const billEl = box.querySelector('.bill');
    const t0 = performance.now(), dur = 1300;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - (1 - k) ** 3;
      billEl.textContent = fmtMoney(Math.round(stats.actual * eased), cur());
      if (k < 1) requestAnimationFrame(step);
      else {
        billEl.textContent = fmtMoney(stats.actual, cur());
        sfx.tada(); buzz(200); confetti();
        if (winner && !winner.busted) {
          const w = document.createElement('div');
          w.className = 'winner';
          w.textContent = `🏆 ${winner.avatar} ${winner.name} wins!`;
          box.appendChild(w);
        }
        if (mine) {
          const m = document.createElement('div');
          m.className = 'sub';
          m.textContent = mine.rank === 1 && !mine.busted ? 'That’s YOU! 🎉' : `You were #${mine.rank} · ${mine.verdict.emoji} ${mine.verdict.text}`;
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
  else if (S.screen === 'room') patch(S.room ? roomView() : `<div class="card center" style="margin-top:40vh">Connecting to the table… 🍽️</div>`);
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

function homeView() {
  return `
  <div class="hero">
    <span class="logo-emoji">🧾</span>
    <h1 class="logo">How Much?</h1>
    <p class="tagline">Guess the dinner bill. Win eternal family glory.</p>
  </div>
  <div class="card stack">
    <button class="btn primary big block" data-go="create">🍽️ Start a new table</button>
    <div class="row">
      <input class="text code grow" id="home-code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" aria-label="Table code">
      <button class="btn big" data-action="join-code">Join</button>
    </div>
  </div>
  <div class="card">
    <h2>How it works</h2>
    <div class="how">
      <div><b>📱</b>Everyone joins with the code or QR</div>
      <div><b>🤔</b>Each person secretly guesses the total</div>
      <div><b>🥁</b>Reveal the receipt &amp; see who nailed it</div>
    </div>
  </div>
  ${recentTablesView()}
  <p class="footer">Made for loud family dinners 🍷</p>`;
}

function recentTablesView() {
  const list = store.get('howmuch:recent') || [];
  if (!list.length) return '';
  return `<div class="card"><h2>Your recent tables</h2><div class="chips">${list.slice(0, 5).map(t =>
    `<button class="chip" data-action="open-recent" data-code="${esc(t.code)}">${esc(t.title)} · ${esc(t.code)}</button>`).join('')}</div></div>`;
}

function avatarPicker(taken = []) {
  return `<div class="avatar-grid" role="group" aria-label="Pick your food avatar">${AVATARS.map(a =>
    `<button type="button" class="avatar-btn ${taken.includes(a) && a !== S.profile.avatar ? 'taken' : ''}" data-avatar="${a}" aria-pressed="${a === S.profile.avatar}">${a}</button>`).join('')}</div>`;
}

function createView() {
  const o = S.createOpts;
  return `
  <div class="topbar"><button class="btn icon ghost" data-go="home" aria-label="Back">←</button><h1>New dinner table</h1></div>
  <form class="card stack" data-form="create">
    <label class="field"><span>Your name</span><input class="text" id="c-name" name="name" maxlength="24" required placeholder="e.g. Dad" value="${esc(S.profile.name)}" autocomplete="nickname"></label>
    <div class="field"><span class="small muted" style="font-weight:600">Your avatar</span>${avatarPicker()}</div>
    <label class="field"><span>Where are we eating?</span><input class="text" id="c-title" name="title" maxlength="40" placeholder="Family dinner at Nonna’s" value="${esc(o.title)}"></label>
    <div class="field"><span class="small muted" style="font-weight:600">Currency</span>
      <div class="chips">${CURRENCIES.map(c => `<button type="button" class="chip" data-currency="${c}" aria-pressed="${c === o.currency}">${c}</button>`).join('')}</div>
    </div>
    <div class="field"><span class="small muted" style="font-weight:600">Rules</span>
      <div class="seg">
        <button type="button" data-mode="classic" aria-pressed="${o.mode === 'classic'}">🎯 Closest wins</button>
        <button type="button" data-mode="nover" aria-pressed="${o.mode === 'nover'}">💥 Don’t go over</button>
      </div>
      <p class="small muted" style="margin-top:6px">${o.mode === 'nover' ? 'Closest guess WITHOUT going over the real bill wins. Guess too high = busted!' : 'Whoever is closest to the real bill wins — over or under.'}</p>
    </div>
    <button class="btn primary big block" type="submit">Open the table 🚪</button>
  </form>`;
}

function joinView() {
  const info = S.joinInfo || { players: [], takenAvatars: [] };
  return `
  <div class="hero" style="padding-top:12px">
    <span class="logo-emoji">🍽️</span>
    <h1 class="display" style="font-size:1.8rem">${esc(info.title || 'Dinner table')}</h1>
    <p class="tagline">Table <b>${esc(S.code)}</b> · ${info.players.length} at the table</p>
    <p class="tagline">${info.players.map(p => esc(p.avatar)).join(' ')}</p>
  </div>
  <form class="card stack" data-form="join">
    <label class="field"><span>Your name</span><input class="text" id="j-name" name="name" maxlength="24" required placeholder="e.g. Grandma" value="${esc(S.profile.name)}" autocomplete="nickname"></label>
    <div class="field"><span class="small muted" style="font-weight:600">Pick your avatar</span>${avatarPicker(info.takenAvatars)}</div>
    <button class="btn primary big block" type="submit">Sit down 🪑</button>
    <p class="small muted center">Already joined on another phone? Use the same name to take your seat back.</p>
  </form>
  <p class="footer"><button data-go="home">← Back home</button></p>`;
}

function roomView() {
  const r = round();
  const revealed = r.actual != null;
  return `
  <div class="topbar" data-key="top">
    <button class="btn icon ghost" data-action="leave" aria-label="Home">🏠</button>
    <h1>${esc(S.room.title)}</h1>
    <button class="btn icon ghost" data-action="mute" aria-label="${isMuted() ? 'Unmute' : 'Mute'}">${isMuted() ? '🔇' : '🔊'}</button>
    <button class="code-pill" data-action="share" aria-label="Share the table code">${esc(S.room.code)} 📲</button>
  </div>
  <div class="row wrap" style="margin-bottom:12px" data-key="tags">
    <span class="round-tag">🍽️ ${esc(r.label)}</span>
    ${S.room.rounds.length > 1 ? `<span class="round-tag">Round ${r.n}</span>` : ''}
    <span class="round-tag">${S.room.mode === 'nover' ? '💥 Don’t go over' : '🎯 Closest wins'}</span>
  </div>
  ${revealed ? resultsView(r) : guessingView(r)}
  <p class="footer" data-key="foot">${isHost() ? `<button data-action="settings">⚙️ Table settings</button> · ` : ''}<button data-action="profile">✏️ Change my name/avatar</button></p>`;
}

function guessingView(r) {
  const mine = r.guesses[S.session.pid];
  const total = S.room.players.length;
  const done = Object.keys(r.guesses).length;
  const elapsed = Math.max(0, serverNow() - r.startedAt);
  const showForm = !mine || S.editingGuess;
  const waitingFor = S.room.players.filter(p => !r.guesses[p.id]);
  return `
  <section class="card stack" data-key="guess" data-sig="${esc(`${r.n}|${showForm}|${mine?.amount}|${mine?.quote}|${cur()}`)}">
    ${showForm ? `
      <div class="row spread"><h2 style="margin:0">What’s the total bill? 🤔</h2><span class="timer" data-timer="${r.startedAt}">⏱ ${fmtDuration(elapsed)}</span></div>
      <form data-form="guess" class="stack">
        <div class="money-input"><span class="cur">${esc(cur())}</span>
          <input id="g-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(S.draft.amount)}" aria-label="Your guess for the total bill" required>
        </div>
        <label class="field"><span>Trash talk (optional) 😈</span>
          <input class="text" id="g-quote" name="quote" maxlength="60" placeholder="${esc(TRASH_TALK[r.n % TRASH_TALK.length])}" value="${esc(S.draft.quote)}">
        </label>
        <button class="btn primary big block" type="submit">${mine ? 'Update my guess ✏️' : 'Lock it in 🔒'}</button>
        ${mine ? `<button class="btn ghost block" type="button" data-action="cancel-edit">Keep ${esc(fmtMoney(mine.amount, cur()))}</button>` : ''}
        <p class="small muted center">Nobody sees your number until the reveal. Speed counts for the ⚡ award!</p>
      </form>` : `
      <div class="my-guess">
        <span class="locked-badge">✅ Locked in after ${fmtDuration(mine.firstAt - r.startedAt)}</span>
        <div class="amt">${esc(fmtMoney(mine.amount, cur()))}</div>
        ${mine.quote ? `<p class="muted">“${esc(mine.quote)}”</p>` : ''}
        <button class="btn ghost" data-action="edit-guess" style="margin-top:8px">Change my mind 🔄</button>
      </div>`}
  </section>

  <section class="card stack" data-key="players">
    <div class="row spread"><h2 style="margin:0">At the table</h2><span class="muted small">${done}/${total} guessed</span></div>
    <div class="progress" aria-hidden="true"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
    <div class="players">${S.room.players.map(p => playerCard(p, r)).join('')}</div>
    ${waitingFor.length && done ? `<p class="small muted">Waiting for ${waitingFor.map(p => esc(p.avatar + ' ' + p.name)).join(', ')}… 👀</p>` : ''}
    ${total === 1 ? `<button class="btn block" data-action="share">📲 Invite the family</button>` : ''}
  </section>

  <section class="card stack" data-key="reveal" data-sig="${esc(`${r.n}|${done > 0}|${cur()}`)}">
    <h2 style="margin:0">🧾 Got the receipt?</h2>
    <p class="small muted">Whoever holds the bill types the real total. Everyone’s phone will do the big reveal together.</p>
    <form data-form="reveal" class="row">
      <div class="money-input grow"><span class="cur" style="font-size:1.4rem;left:14px">${esc(cur())}</span>
        <input id="r-actual" name="actual" inputmode="decimal" autocomplete="off" placeholder="Real total" value="${esc(S.draft.actual)}" style="font-size:1.6rem;min-height:58px;padding-left:40px" aria-label="Real total from the receipt">
      </div>
      <button class="btn hot big" type="submit" ${done ? '' : 'disabled'}>Reveal 🥁</button>
    </form>
  </section>`;
}

function playerCard(p, r) {
  const g = r.guesses[p.id];
  const isMe = p.id === S.session.pid;
  const status = g ? `✓ in ${fmtDuration((g.firstAt ?? g.at) - r.startedAt)}` : 'thinking…';
  return `<div class="player ${g ? 'done' : 'thinking'} ${isMe ? 'me' : ''}">
    <span class="dot ${p.online ? 'on' : ''}" title="${p.online ? 'online' : 'offline'}"></span>
    ${isHost() && !isMe && p.id !== S.room.hostId ? `<button class="kick" data-action="kick" data-pid="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
    <span class="av">${esc(p.avatar)}</span>
    <span class="nm">${esc(p.name)}${p.id === S.room.hostId ? ' 👑' : ''}</span>
    <span class="st">${status}</span>
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
  const step = (row, cls, medal) => row ? `<div class="step ${cls}"><div class="medal">${medal}</div><span class="av">${esc(row.avatar)}</span><span class="nm">${esc(row.name)}</span><span class="gs">${esc(fmtMoney(row.amount, c))}</span><div class="small muted">${esc(fmtPct(row.pct))}</div></div>` : '<div></div>';

  return `
  <section class="card bill-hero">
    <div class="lbl">The real bill</div>
    <div class="val">${esc(fmtMoney(stats.actual, c))}</div>
    <p class="muted small">${revealer ? `revealed by ${esc(revealer.avatar + ' ' + revealer.name)}` : ''}</p>
    ${mine ? `<p style="margin-top:10px;font-weight:650">You: ${esc(fmtMoney(mine.amount, c))} · #${mine.rank} of ${stats.n} · ${esc(mine.verdict.emoji + ' ' + mine.verdict.text)}</p>` : `<p class="muted" style="margin-top:10px">You didn’t guess this round 🙊</p>`}
    <div class="kpis">
      <div class="kpi"><div class="k">Average</div><div class="v">${esc(fmtMoney(Math.round(stats.average), c))}</div><div class="s">${esc(fmtPct(stats.avgPct))}</div></div>
      <div class="kpi"><div class="k">Median</div><div class="v">${esc(fmtMoney(Math.round(stats.median), c))}</div><div class="s">${esc(fmtPct((stats.median - stats.actual) / stats.actual * 100))}</div></div>
      <div class="kpi"><div class="k">Range</div><div class="v" style="font-size:1rem">${esc(compactMoney(stats.min, c))}–${esc(compactMoney(stats.max, c))}</div><div class="s">${stats.under}⬇ ${stats.over}⬆</div></div>
    </div>
  </section>

  <section class="card">
    <h2>🏆 The podium</h2>
    <div class="podium">${step(p2, 'p2', '🥈')}${step(p1, 'p1', p1?.busted ? '💥' : '🥇')}${step(p3, 'p3', '🥉')}</div>
  </section>

  <section class="card">
    <h2>🧠 Wisdom of the crowd</h2>
    <p>${crowdText(stats)}</p>
  </section>

  <section class="card">
    <h2>📍 Where everyone landed</h2>
    <div class="chart-box" data-chart="line"></div>
    <div class="legend"><span><i class="ln"></i>Real bill</span><span><i class="ln avg"></i>Group average</span><span class="muted">Tap a face for details</span></div>
  </section>

  <section class="card">
    <h2>🎯 How far off?</h2>
    <div class="chart-box" data-chart="error"></div>
    <div class="legend"><span><i style="background:var(--under)"></i>Guessed too low</span><span><i style="background:var(--over)"></i>Guessed too high</span></div>
  </section>

  <section class="card">
    <h2>⚡ The speed race</h2>
    <div class="chart-box" data-chart="speed"></div>
  </section>

  <section class="card">
    <h2>🎖️ Awards night</h2>
    <div class="awards">${stats.awards.map(a => `<div class="award"><div class="e">${a.emoji}</div><div class="t">${esc(a.title)}</div><div class="w">${esc(a.who.avatar + ' ' + a.who.name)}</div><div class="d">${esc(a.detail)}</div></div>`).join('')}</div>
  </section>

  <section class="card">
    <h2>📋 Full results</h2>
    <table class="rank-table">
      <thead><tr><th>#</th><th>Who</th><th class="num">Guess</th><th class="num">Off</th></tr></thead>
      <tbody>${stats.rows.map(x => `<tr class="${x.pid === S.session.pid ? 'me' : ''}">
        <td>${x.rank}</td>
        <td class="who">${esc(x.avatar + ' ' + x.name)}<span class="vd">${esc(x.verdict.emoji + ' ' + x.verdict.text)} · ${esc(fmtDuration(x.firstTimeMs))}</span>${x.quote ? `<span class="q">“${esc(x.quote)}”</span>` : ''}</td>
        <td class="num">${esc(fmtMoney(x.amount, c))}</td>
        <td class="num ${x.diff > 0 ? 'pos' : x.diff < 0 ? 'neg' : ''}">${esc(fmtPct(x.pct))}<span class="vd">${x.diff === 0 ? 'exact!' : esc((x.diff > 0 ? '+' : '−') + fmtMoney(x.absDiff, c))}</span></td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="small muted" style="margin-top:10px">Points: 🥇 5 · 🥈 3 · 🥉 2 · everyone else 1 · 🎯 bullseye (within 1%) +3${S.room.mode === 'nover' ? ' · 💥 busted 0' : ''}</p>
  </section>

  ${board.length && S.room.rounds.filter(x => x.actual != null).length > 1 ? `
  <section class="card">
    <h2>👑 Overall leaderboard</h2>
    <div class="chart-box" data-chart="points"></div>
  </section>` : ''}

  <section class="card stack" data-key="split" data-sig="${esc(`${r.n}|${people}|${c}`)}">
    <h2 style="margin:0">💳 Split the bill</h2>
    <div class="row spread"><span>Tip</span><b id="split-tip-val">${S.split.tip}%</b></div>
    <input type="range" id="split-tip" min="0" max="25" step="1" value="${S.split.tip}" aria-label="Tip percent">
    <div class="row spread"><span>People paying</span>
      <div class="row"><button class="btn icon" data-action="people" data-d="-1" aria-label="Fewer people">−</button><b style="min-width:2ch;text-align:center">${people}</b><button class="btn icon" data-action="people" data-d="1" aria-label="More people">+</button></div>
    </div>
    <div class="center"><div class="muted small">Each person pays</div><div class="split-out" id="split-each">${esc(fmtMoney(Math.ceil(perPerson * 100) / 100, c))}</div>
    <div class="muted small" id="split-total">Total with tip ${esc(fmtMoney(Math.round(stats.actual * (1 + S.split.tip / 100) * 100) / 100, c))}</div></div>
    ${p1 && stats.n > 1 ? `<p class="small center">😈 Fun rule: <b>${esc(stats.rows[stats.rows.length - 1].avatar + ' ' + stats.rows[stats.rows.length - 1].name)}</b> (farthest off) buys dessert!</p>` : ''}
  </section>

  <section class="card stack">
    <button class="btn block" data-action="share-results">📤 Share the results</button>
    <h2 style="margin:6px 0 0">Play again?</h2>
    <div class="chips">${NEXT_ROUND_IDEAS.map(x => `<button class="chip" data-action="next-round" data-label="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <p class="small muted">Starts a new round at this table — points keep adding up on the leaderboard.</p>
  </section>`;
}

const compactMoney = (v, c) => (v >= 10000 ? c + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmtMoney(Math.round(v), c));

function crowdText(s) {
  if (s.n < 2) return 'Only one guess this round — the crowd needs more people! 👥';
  const off = Math.abs(s.avgPct);
  const beat = s.crowdBeats;
  const how = off < 3 ? 'scary close 😳' : off < 10 ? 'pretty close 👍' : off < 25 ? 'a bit off 🤷' : 'way off 🙈';
  return `The group average (${esc(fmtMoney(Math.round(s.average), cur()))}) was ${esc(fmtPct(s.avgPct, false))} ${s.avgDiff >= 0 ? 'over' : 'under'} — ${how}. ` +
    (beat === s.n ? `It beat <b>everyone</b> individually. Together you’re smarter! 🧠` :
      beat === 0 ? `But every single person beat the average. Individually brilliant! ✨` :
        `It beat <b>${beat} of ${s.n}</b> people. ${s.over > s.under ? 'Most of you guessed too high — feeling rich? 💸' : s.under > s.over ? 'Most of you guessed too low — this place is pricier than you think 🧾' : 'Perfectly split between over and under ⚖️'}`);
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
  bar.setAttribute('aria-label', 'Send a reaction to everyone');
  bar.innerHTML = REACTIONS.map(e => `<button data-react="${e}" aria-label="Send ${e}">${e}</button>`).join('');
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
      <h2>Invite the table 📲</h2>
      <div class="qr">${qrSvg(url)}</div>
      <p class="muted small">Scan with the phone camera, or enter the code</p>
      <div class="big-code">${esc(S.code)}</div>
      <div class="link-box">${esc(url)}</div>
      <div class="row">
        <button class="btn grow" data-act="copy">📋 Copy link</button>
        ${navigator.share ? `<button class="btn primary grow" data-act="native">📤 Send…</button>` : ''}
      </div>
      <button class="btn ghost block" data-close>Done</button>
    </div>`, (el) => {
    el.querySelector('[data-act="copy"]').onclick = () => copy(url);
    el.querySelector('[data-act="native"]')?.addEventListener('click', () =>
      navigator.share({ title: 'How Much? 🧾', text: `Join our dinner game! Guess the bill 🍽️ Code: ${S.code}`, url }).catch(() => {}));
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied! 📋'); }
  catch { toast('Copy failed — long-press to copy'); }
}

function profileModal() {
  const m = me();
  S.profile = { name: m.name, avatar: m.avatar };
  modal(`
    <form class="stack" data-modal-form="profile">
      <h2>You</h2>
      <label class="field"><span>Name</span><input class="text" name="name" maxlength="24" value="${esc(m.name)}" required></label>
      ${avatarPicker(S.room.players.map(p => p.avatar))}
      <button class="btn primary block" type="submit">Save</button>
      <button class="btn ghost block" type="button" data-close>Cancel</button>
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
      catch (err) { toast(err.message); }
    };
  });
}

function settingsModal() {
  const r = round();
  modal(`
    <form class="stack" data-modal-form="settings">
      <h2>⚙️ Table settings</h2>
      <label class="field"><span>Table name</span><input class="text" name="title" maxlength="40" value="${esc(S.room.title)}"></label>
      ${r.actual == null ? `<label class="field"><span>This round is called</span><input class="text" name="roundLabel" maxlength="40" value="${esc(r.label)}"></label>` : ''}
      <div class="field"><span class="small muted" style="font-weight:600">Currency</span>
        <div class="chips">${CURRENCIES.map(c => `<button type="button" class="chip" data-cur="${c}" aria-pressed="${c === S.room.currency}">${c}</button>`).join('')}</div></div>
      <div class="seg">
        <button type="button" data-m="classic" aria-pressed="${S.room.mode === 'classic'}">🎯 Closest wins</button>
        <button type="button" data-m="nover" aria-pressed="${S.room.mode === 'nover'}">💥 Don’t go over</button>
      </div>
      <button class="btn primary block" type="submit">Save</button>
      <button class="btn ghost block" type="button" data-close>Cancel</button>
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
      try { await act('settings', { title: fd.get('title'), roundLabel: fd.get('roundLabel'), currency, mode }); close(); toast('Saved ✅'); }
      catch (err) { toast(err.message); }
    };
  });
}

function shareResults() {
  const r = round();
  const s = computeRoundStats(r, S.room.players, S.room.mode);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [
    `🧾 How Much? — ${S.room.title} (${r.label})`,
    `Real bill: ${fmtMoney(s.actual, cur())} · Group average: ${fmtMoney(Math.round(s.average), cur())} (${fmtPct(s.avgPct)})`,
    '',
    ...s.rows.map((x, i) => `${medals[i] || `${i + 1}.`} ${x.avatar} ${x.name} — ${fmtMoney(x.amount, cur())} (${fmtPct(x.pct)}) ${x.verdict.emoji}`),
    '',
    ...s.awards.filter(a => ['farthest', 'fastest', 'bigspender', 'cheapskate'].includes(a.key)).map(a => `${a.emoji} ${a.title}: ${a.who.name}`),
  ];
  const text = lines.join('\n');
  if (navigator.share) navigator.share({ title: 'How Much? results', text }).catch(() => copy(text));
  else copy(text);
}

// ---------- events ----------
function rememberTable() {
  const list = (store.get('howmuch:recent') || []).filter(t => t.code !== S.code);
  list.unshift({ code: S.code, title: S.room?.title || S.createOpts.title || 'Dinner' });
  store.set('howmuch:recent', list.slice(0, 8));
}

document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-go]');
  if (!t || t.closest('.modal')) return;

  if (t.dataset.go) { go(t.dataset.go); return; }
  if (t.dataset.avatar) { S.profile.avatar = t.dataset.avatar; saveProfile(); render(); return; }
  if (t.dataset.currency) { syncCreateForm(); S.createOpts.currency = t.dataset.currency; store.set('howmuch:currency', t.dataset.currency); render(); return; }
  if (t.dataset.mode) { syncCreateForm(); S.createOpts.mode = t.dataset.mode; render(); return; }
  if (t.dataset.react) {
    sfx.pop();
    t.disabled = true; setTimeout(() => { t.disabled = false; }, 600); // gentle spam guard
    act('react', { emoji: t.dataset.react }).catch(err => toast(err.message));
    return;
  }

  switch (t.dataset.action) {
    case 'join-code': {
      const code = document.getElementById('home-code').value.trim().toUpperCase();
      if (code.length !== 4) { toast('Codes have 4 letters'); return; }
      const saved = store.get(sessionKey(code));
      if (saved) { S.code = code; S.session = saved; enterRoom(); } else openJoin(code);
      return;
    }
    case 'open-recent': {
      const code = t.dataset.code;
      const saved = store.get(sessionKey(code));
      S.code = code;
      if (saved) { S.session = saved; history.pushState({}, '', `/r/${code}`); enterRoom(); } else openJoin(code);
      return;
    }
    case 'leave': disconnect(); go('home'); return;
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
      const p = playerById(t.dataset.pid);
      if (p && confirm(`Remove ${p.name} from the table?`)) act('kick', { target: p.id }).catch(err => toast(err.message));
      return;
    }
    case 'people': {
      const base = S.split.people ?? S.room.players.length;
      S.split.people = Math.max(1, Math.min(60, base + Number(t.dataset.d)));
      render(); return;
    }
    case 'share-results': shareResults(); return;
    case 'next-round':
      try { await act('next', { label: t.dataset.label }); } catch (err) { toast(err.message); }
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
  if (el.id === 'home-code') el.value = el.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
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
        const res = await api('/api/rooms', { name: S.profile.name, avatar: S.profile.avatar, title: fd.get('title'), currency: S.createOpts.currency, mode: S.createOpts.mode });
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
        if (res.rejoined) toast('Welcome back! 👋');
        enterRoom(); rememberTable();
        break;
      }
      case 'guess': {
        const amount = parseAmount(fd.get('amount'));
        if (!(amount > 0)) { toast('Type a number first 🙂'); break; }
        await act('guess', { amount, quote: fd.get('quote') });
        S.editingGuess = false; S.draft.amount = ''; S.draft.quote = '';
        sfx.lock(); buzz(60);
        document.activeElement?.blur();
        render();
        break;
      }
      case 'reveal': {
        const actual = parseAmount(fd.get('actual'));
        if (!(actual > 0)) { toast('Type the real total from the receipt'); break; }
        const r = round();
        const missing = S.room.players.filter(p => !r.guesses[p.id]);
        if (missing.length && !confirm(`${missing.map(p => p.name).join(', ')} ${missing.length === 1 ? 'hasn’t' : 'haven’t'} guessed yet. Reveal anyway?`)) break;
        await act('reveal', { actual });
        S.draft.actual = '';
        break;
      }
    }
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

// live timer on the guessing screen (updates text only, no re-render)
setInterval(() => {
  const el = document.querySelector('[data-timer]');
  if (el) el.textContent = '⏱ ' + fmtDuration(Math.max(0, serverNow() - Number(el.dataset.timer)));
}, 1000);

installTooltips();
boot();
