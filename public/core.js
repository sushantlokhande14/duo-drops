// Shared client state and tiny helpers.

export function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function store(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const st = {
  s: null,              // latest room state from the server
  me: load('duo:me', null),
  offset: 0,            // server clock minus local clock
  ws: null,
  connected: false,
  dismissed: new Set(load('duo:dismissed', [])),
  muted: load('duo:muted', false),
  doodles: {},          // dropId -> [{ word, img }], snapshots taken locally
  pushHere: false,
};

export const now = () => Date.now() + st.offset;
export const other = (s) => (s === 'A' ? 'B' : 'A');
export const P = (slot) => st.s?.players[slot];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);

export function send(msg) {
  if (st.ws?.readyState !== 1) return false;
  st.ws.send(JSON.stringify(msg));
  return true;
}

// Replace the innerHTML of [data-r="name"] regions, only when their markup changed,
// so inputs and focus outside those regions survive state updates.
export function patch(root, regions) {
  for (const [name, html] of Object.entries(regions || {})) {
    const el = root.querySelector(`[data-r="${name}"]`);
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
  }
}

export const bar = (until, total) => `<div class="timebar"><i data-bar="${until},${total}"></i></div>`;
export const ava = (p, cls = '') => `<span class="ava ${cls}">${esc(p?.avatar ?? '❔')}</span>`;
