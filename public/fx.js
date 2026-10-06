// Hearts, confetti, toasts and little sounds.
import { st, store, esc } from './core.js';

const fx = () => document.getElementById('fx');
const rnd = (a, b) => a + Math.random() * (b - a);

export function burst(x = innerWidth / 2, y = innerHeight / 2, n = 16, set = ['💗', '💖', '✨', '💕', '🌸', '💞']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    el.className = 'fx-heart';
    el.textContent = set[i % set.length];
    const ang = rnd(0, Math.PI * 2), dist = rnd(80, 220);
    el.style.cssText = `--x:${x}px;--y:${y}px;--s:${rnd(18, 36)}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.abs(Math.sin(ang)) * dist + 60}px;--r:${rnd(-40, 40)}deg;--d:${rnd(1, 1.7)}s`;
    fx().appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }
}

export function confetti(n = 60) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff6fa5', '#a58bff', '#4fcf9c', '#ffd56b', '#ffb38a', '#8cc8ff'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    el.className = 'confetti';
    el.style.cssText = `--x:${rnd(0, 100)}vw;--c:${colors[i % colors.length]};--d:${rnd(1.8, 3.2)}s;--w:${rnd(0, .6)}s;--r:${rnd(-720, 720)}deg`;
    fx().appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

export function toast(html, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
}
export const toastText = (text, ms) => toast(esc(text), ms);

export function buzz(pattern = [40]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export function floatSky() {
  const sky = document.getElementById('sky');
  if (!sky || sky.childElementCount) return;
  const set = ['💗', '✨', '☁️', '💕', '⭐', '🌸'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    s.textContent = set[i % set.length];
    s.style.cssText = `left:${rnd(0, 100)}%;--s:${rnd(14, 30)}px;--d:${rnd(14, 28)}s;--w:${-rnd(0, 28)}s`;
    sky.appendChild(s);
  }
}

// ---------------------------------------------------------------- sounds

let ac = null;
export function unlockAudio() {
  if (!ac) try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  ac?.resume?.();
}

function tone(freq, dur = 0.12, type = 'sine', vol = 0.07, when = 0) {
  if (st.muted || !ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  pop: () => tone(740, 0.08, 'sine', 0.06),
  tap: () => tone(520, 0.05, 'triangle', 0.05),
  ding: () => { tone(880, 0.16); tone(1320, 0.22, 'sine', 0.06, 0.09); },
  boop: () => { tone(330, 0.14, 'triangle'); tone(262, 0.2, 'triangle', 0.06, 0.1); },
  nope: () => tone(180, 0.16, 'square', 0.035),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, i * 0.09)),
  drop: () => [988, 784, 1175].forEach((f, i) => tone(f, 0.18, 'sine', 0.07, i * 0.11)),
  poke: () => { tone(1046, 0.09); tone(1397, 0.14, 'sine', 0.06, 0.08); },
};

export function setMuted(m) {
  st.muted = m;
  store('duo:muted', m);
}
