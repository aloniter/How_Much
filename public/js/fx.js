// Little bits of joy: synthesized sounds (no audio files), confetti, floating emoji, haptics.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem('checkmate:muted') === '1'; } catch { /* storage blocked */ }

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('checkmate:muted', v ? '1' : '0'); } catch { /* ignore */ }
}

/** Must be called from a user gesture once so phones allow sound later. */
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const b = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = b; src.connect(ctx.destination); src.start(0);
}

function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  if (!ctx || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

function noiseHit(start, gain = 0.25) {
  if (!ctx || muted) return;
  const len = ctx.sampleRate * 0.08;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + start);
}

export const sfx = {
  pop() { tone(660, 0, 0.12, 'triangle'); tone(990, 0.06, 0.12, 'triangle', 0.12); },
  lock() { tone(523, 0, 0.1, 'square', 0.08); tone(784, 0.09, 0.18, 'square', 0.08); },
  join() { tone(440, 0, 0.1); tone(660, 0.08, 0.14); },
  tick() { tone(880, 0, 0.08, 'square', 0.06); },
  drumroll(seconds = 3) {
    for (let t = 0; t < seconds; t += 0.055) noiseHit(t, 0.12 + (t / seconds) * 0.18);
  },
  tada() {
    noiseHit(0, 0.5);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.02 + i * 0.07, 0.9, 'triangle', 0.14));
  },
  whoosh() {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3);
  },
  rimshot() { noiseHit(0, 0.35); noiseHit(0.14, 0.3); tone(180, 0.26, 0.08, 'triangle', 0.12); noiseHit(0.3, 0.45); },
  siren() {
    for (let i = 0; i < 3; i++) { tone(720, i * 0.5, 0.25, 'sawtooth', 0.05); tone(540, i * 0.5 + 0.25, 0.25, 'sawtooth', 0.05); }
  },
  sad() { tone(392, 0, 0.3, 'sawtooth', 0.06); tone(370, 0.3, 0.3, 'sawtooth', 0.06); tone(349, 0.6, 0.7, 'sawtooth', 0.06); },
};

export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ---------- confetti ----------
export function confetti(durationMs = 3500) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('confetti');
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  c.scale(dpr, dpr);
  const colors = ['#f5b942', '#ff7a59', '#3ccf7e', '#3987e5', '#e87ba4', '#ffffff'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.4,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const end = performance.now() + durationMs;
  (function frame(t) {
    c.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.color; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(p.r * 2));
      c.restore();
    }
    if (t < end) requestAnimationFrame(frame);
    else c.clearRect(0, 0, innerWidth, innerHeight);
  })(performance.now());
}

// ---------- floating reactions ----------
export function floatEmoji(emoji, label) {
  const layer = document.getElementById('reactions-layer');
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.left = (8 + Math.random() * 80) + 'vw';
  el.style.setProperty('--drift', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
  el.style.setProperty('--spin', ((Math.random() - 0.5) * 60).toFixed(0) + 'deg');
  el.textContent = emoji;
  if (label) {
    const s = document.createElement('small');
    s.textContent = label;
    el.appendChild(s);
  }
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
