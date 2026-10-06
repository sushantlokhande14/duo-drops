// Screens for the three live games, plus the shared doodle pad.
import { st, esc, now, send, other, P, bar, ava, $ } from './core.js';
import { burst, sfx, shake, buzz } from './fx.js';

const top = (title, pills) => `<div class="g-top"><span class="g-title">${title}</span>${pills.map((p) => `<span class="pill">${p}</span>`).join('')}</div>`;

// ---------------------------------------------------------------- Mind Meld

const meld = {
  key: (d, g) => `meld:${g.round}:${g.phase}`,
  html(d, g, s) {
    const me = s.me, o = other(me);
    const head = top('🔮 Mind Meld', [`round ${g.round + 1}/${g.rounds}`, `✨ ${g.melds}`]);
    if (g.phase === 'answer') {
      return `${head}${bar(g.deadline, 25000)}
        <div class="card prompt-card pop"><div class="kicker">think fast, think alike</div><div class="prompt">${esc(g.prompt)}</div></div>
        <div data-r="answer"></div>
        <div class="partner-status" data-r="partner"></div>`;
    }
    const r = g.reveal;
    const bubble = (slot) => `<div class="bubble pop">${ava(P(slot))}<div class="txt">${r[slot] == null ? '⏰' : esc(r[slot])}</div></div>`;
    const verdict = r.match ? 'MIND MELD! ✨' : r.A == null || r.B == null ? "time's up ⏰" : 'so close 🙈';
    return `${head}${bar(g.deadline, 5000)}
      <div class="card prompt-card"><div class="prompt small">${esc(r.prompt)}</div></div>
      <div class="bubbles">${bubble(me)}${bubble(o)}</div>
      <div class="verdict ${r.match ? 'yay' : ''}">${verdict}</div>`;
  },
  regions(d, g, s) {
    if (g.phase !== 'answer') return {};
    const you = P(other(s.me));
    return {
      answer: g.mine == null
        ? `<form class="answer-form" data-form="meld"><input name="v" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="first thing that pops up…" enterkeyhint="send"><button class="btn">Lock 🔒</button></form>`
        : `<div class="locked pop">🔒 locked in: <b>${esc(g.mine)}</b></div>`,
      partner: `${ava(you, 'sm')} ${esc(you.name)} is ${g.partnerIn ? 'locked in! ✨' : 'thinking… 💭'}`,
    };
  },
  mount(root, d, g) {
    if (g.phase === 'answer') $('input', root)?.focus();
    else if (g.reveal.match) { burst(); sfx.ding(); buzz([30, 40, 30]); }
    else sfx.boop();
  },
};

// ---------------------------------------------------------------- Today's Special (This or That)

const special = {
  key: (d, g) => `special:${g.round}:${g.phase}`,
  html(d, g, s) {
    const me = s.me, o = other(me);
    const head = top(`${esc(g.emoji)} ${esc(g.title)}`, [`${g.round + 1}/${g.rounds}`, `💞 ${g.same}`]);
    if (g.phase === 'pick') {
      return `${head}${bar(g.deadline, 15000)}
        <div class="kicker">same pick = love points</div>
        <div class="tot" data-r="pick"></div>
        <div class="partner-status" data-r="partner"></div>`;
    }
    const r = g.reveal;
    const side = (slot) => `<div class="bubble pop">${ava(P(slot))}<div class="txt">${r[slot] == null ? '⏰' : esc(r.pair[r[slot]])}</div></div>`;
    return `${head}${bar(g.deadline, 4000)}
      <div class="card prompt-card"><div class="prompt small">${esc(r.pair[0])} <span class="or">or</span> ${esc(r.pair[1])}</div></div>
      <div class="bubbles">${side(me)}${side(o)}</div>
      <div class="verdict ${r.match ? 'yay' : ''}">${r.match ? 'SAME! 💞' : r.A == null || r.B == null ? "time's up ⏰" : 'opposites attract 😌'}</div>`;
  },
  regions(d, g, s) {
    if (g.phase !== 'pick') return {};
    const you = P(other(s.me));
    const card = (i) => `<button class="tot-card ${g.mine === i ? 'on' : ''} ${g.mine != null && g.mine !== i ? 'off' : ''}" data-act="totPick" data-i="${i}" ${g.mine != null ? 'disabled' : ''}>${esc(g.pair[i])}</button>`;
    return {
      pick: `${card(0)}<span class="tot-or">or</span>${card(1)}`,
      partner: `${ava(you, 'sm')} ${esc(you.name)} ${g.partnerIn ? 'picked! 🤫' : 'is choosing… 💭'}`,
    };
  },
  mount(root, d, g) {
    if (g.phase !== 'reveal') return;
    if (g.reveal.match) { burst(); sfx.ding(); buzz([30, 40, 30]); } else sfx.boop();
  },
};

// ---------------------------------------------------------------- Speed Duel

let react = null;

const duel = {
  key: (d, g) => `duel:${g.i}:${g.phase}`,
  html(d, g, s) {
    const me = s.me, o = other(me);
    const head = `${top('⚡ Speed Duel', [`round ${g.i + 1}/${g.n}`])}
      <div class="score">${ava(P(me), 'sm')} <b>${g.wins[me]}</b> : <b>${g.wins[o]}</b> ${ava(P(o), 'sm')}</div>`;
    if (g.phase === 'between') {
      const l = g.last;
      const w = l.winner && P(l.winner);
      let line = l.winner === me ? 'you got it! 🎉' : w ? `${esc(w.name)} got it first!` : 'nobody got it 😴';
      let detail = '';
      if (l.kind === 'react') {
        const t = (v) => (v == null ? 'no tap' : v < 0 ? 'too early 🙈' : `${v} ms`);
        detail = `<p class="muted">you: ${t(l.react[me])} · ${esc(P(o).name)}: ${t(l.react[o])}</p>`;
      } else {
        detail = `<p class="muted">answer</p><div class="answer-reveal">${l.q ? esc(l.q) + ' = ' : ''}${esc(l.show)}</div>`;
      }
      return `${head}${bar(g.deadline, 3500)}
        <div class="card round-result pop">
          <div class="big">${w ? `<span class="bob">${esc(w.avatar)}</span>` : '🫠'}</div>
          <h2>${line}</h2>${detail}
        </div>`;
    }
    const r = g.round;
    let body = '';
    if (r.kind === 'scramble') {
      body = `<div class="tiles">${r.letters.map((c) => `<span class="tile">${esc(c.toUpperCase())}</span>`).join('')}</div>
        <form class="answer-form" data-form="duel"><input name="v" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type the word" enterkeyhint="send"><button class="btn lav">Go!</button></form>`;
    } else if (r.kind === 'math') {
      body = `<div class="equation">${esc(r.q)} = ?</div>
        <form class="answer-form" data-form="duel"><input name="v" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="answer" enterkeyhint="send"><button class="btn lav">Go!</button></form>`;
    } else if (r.kind === 'count') {
      body = `<div class="egrid">${r.grid.map((e) => `<span>${e}</span>`).join('')}</div>
        <div class="numpad">${Array.from({ length: 10 }, (_, i) => `<button class="nbtn" data-act="duelAns" data-v="${i + 4}">${i + 4}</button>`).join('')}</div>`;
    } else if (r.kind === 'odd') {
      body = `<div class="egrid odd">${r.grid.map((e, i) => `<button data-act="duelAns" data-v="${i}">${e}</button>`).join('')}</div>`;
    } else {
      body = `<button class="react-pad" id="reactPad"><span class="wait">wait for it… 👀</span><span class="go">💗</span></button>
        <div class="partner-status" data-r="react"></div>`;
    }
    return `${head}
      <div class="ready-overlay" data-before="${g.startAt}"><div class="countdown" data-until="${g.startAt}"></div><div class="muted">get ready…</div></div>
      <div class="gate" data-after="${g.startAt}" data-focus="1">${bar(g.deadline, g.deadline - g.startAt)}
        <div class="kicker">${esc(r.prompt)}</div>${body}
      </div>`;
  },
  regions(d, g) {
    if (g.phase !== 'play' || g.round.kind !== 'react') return {};
    return { react: g.myReact == null ? '' : g.myReact < 0 ? 'too early 🙈 waiting for the other tap…' : `${g.myReact} ms! waiting for the other tap…` };
  },
  mount(root, d, g, s) {
    if (g.phase === 'between') {
      if (g.last.winner === s.me) { sfx.win(); burst(innerWidth / 2, innerHeight / 3, 12); }
      else sfx.boop();
      return;
    }
    if (g.round.kind !== 'react') return;
    const pad = $('#reactPad', root);
    react = { shownAt: 0, sent: g.myReact != null, timer: 0 };
    if (react.sent) { pad.classList.add('done'); return; }
    react.timer = setTimeout(() => { pad.classList.add('go'); react.shownAt = performance.now(); buzz([20]); }, Math.max(0, g.startAt + g.round.delay - now()));
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (react.sent || now() < g.startAt) return;
      react.sent = true;
      clearTimeout(react.timer);
      const ms = react.shownAt ? Math.round(performance.now() - react.shownAt) : -1;
      pad.classList.remove('go');
      pad.classList.add('done');
      pad.querySelector('.wait').textContent = ms < 0 ? 'too early! 🙈' : `${ms} ms ⚡`;
      ms < 0 ? sfx.nope() : sfx.pop();
      send({ t: 'act', a: 'react', ms });
    });
  },
  unmount() { if (react) clearTimeout(react.timer); react = null; },
};

// ---------------------------------------------------------------- Doodle Guess

const COLORS = ['#5b3a57', '#ff6fa5', '#a58bff', '#4fcf9c', '#ffc94d', '#8cc8ff', '#ff9a62', '#ffffff'];
const SIZES = [4, 9, 18];
export const pad = { strokes: [], canvas: null, ctx: null, px: 0, live: false, color: COLORS[0], width: SIZES[1], cur: null, pend: [], raf: 0 };

const draw = {
  key: (d, g) => `draw:${g.turn}:${g.phase}`,
  html(d, g, s) {
    const me = s.me, isDrawer = g.drawer === me, dp = P(g.drawer);
    const head = top('🎨 Doodle Guess', [`turn ${g.turn + 1}/${g.turns}`]);
    if (g.phase === 'choose') {
      if (isDrawer) {
        return `${head}${bar(g.deadline, 15000)}
          <div class="card stack pop"><h2 class="center">Pick something to doodle ✏️</h2>
          <div class="word-opts">${g.options.map((w, i) => `<button class="btn soft big" data-act="pickWord" data-i="${i}">${esc(w)}</button>`).join('')}</div>
          <p class="muted center">${esc(P(other(me)).name)} will guess it. No letters or numbers!</p></div>`;
      }
      return `${head}${bar(g.deadline, 15000)}
        <div class="card center pop"><div class="waiting-art"><span class="bob">${esc(dp.avatar)}</span><span class="wiggle">✏️</span></div>
        <h2>${esc(dp.name)} is picking a word…</h2><p class="muted">get your guessing brain ready 🧠</p></div>`;
    }
    if (g.phase === 'reveal') {
      const l = g.last;
      return `${head}
        <div class="word-line pop">${l.solved ? '🎉' : '🙈'} it was <b>${esc(l.word)}</b></div>
        <div class="pad-wrap"><canvas id="pad"></canvas></div>
        <p class="center muted">${l.solved ? `guessed in ${l.secs}s · +${l.points} 💗` : 'nobody got it this time, still a masterpiece'}</p>`;
    }
    const tools = `<div class="tools">
        ${COLORS.map((c) => `<button class="sw ${c === pad.color ? 'on' : ''}" data-act="color" data-c="${c}" style="--c:${c}" aria-label="color"></button>`).join('')}
      </div><div class="tools">
        ${SIZES.map((w) => `<button class="sz ${w === pad.width ? 'on' : ''}" data-act="size" data-w="${w}" aria-label="brush"><i style="width:${w}px;height:${w}px"></i></button>`).join('')}
        <button class="tbtn" data-act="undo" aria-label="undo">↩️</button>
        <button class="tbtn" data-act="clearPad" aria-label="clear">🧽</button>
        <button class="tbtn" data-act="giveUp" aria-label="give up">🏳️</button>
      </div>`;
    const guess = `<form class="answer-form" data-form="guess"><input name="v" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your guess…" enterkeyhint="send"><button class="btn">Guess</button></form>`;
    return `${head}${bar(g.endAt, 80000)}
      <div class="word-line" data-r="word"></div>
      <div class="pad-wrap"><canvas id="pad" class="${isDrawer ? 'live' : ''}"></canvas></div>
      ${isDrawer ? tools : guess}
      <div class="guesses" data-r="guesses"></div>`;
  },
  regions(d, g, s) {
    if (g.phase !== 'draw') return {};
    const isDrawer = g.drawer === s.me;
    const letters = g.mask.filter((c) => c !== ' ').length;
    return {
      word: isDrawer
        ? `draw: <b>${esc(g.word)}</b>`
        : `<span class="mask">${g.mask.map((c) => (c === ' ' ? '&nbsp;&nbsp;' : `<i>${c === '_' ? '&nbsp;' : esc(c)}</i>`)).join('')}</span> <small class="muted">(${letters})</small>`,
      guesses: g.guesses.map((x) => `<span class="gchip ${x.ok ? 'ok' : ''}">${esc(x.text)} ${x.ok ? '✅' : '❌'}</span>`).join(''),
    };
  },
  mount(root, d, g, s) {
    const canvas = $('#pad', root);
    if (canvas) padMount(canvas, g.phase === 'draw' && g.drawer === s.me);
    if (g.phase === 'draw' && g.drawer !== s.me) $('input', root)?.focus();
    if (g.phase === 'reveal') {
      g.last.solved ? (sfx.ding(), burst()) : sfx.boop();
      setTimeout(() => {
        try {
          const list = (st.doodles[d.id] ??= []);
          if (!list.some((x) => x.word === g.last.word)) list.push({ word: g.last.word, by: g.last.drawer, img: canvas.toDataURL('image/png') });
        } catch {}
      }, 60);
    }
  },
  unmount() { padUnmount(); },
};

function padMount(canvas, live) {
  padUnmount();
  pad.canvas = canvas;
  pad.ctx = canvas.getContext('2d');
  pad.live = live;
  padResize();
  if (live) {
    canvas.addEventListener('pointerdown', padDown);
    canvas.addEventListener('pointermove', padMove);
    canvas.addEventListener('pointerup', padUp);
    canvas.addEventListener('pointercancel', padUp);
  }
}

function padUnmount() {
  if (pad.cur) padUp();
  pad.canvas = null;
  pad.ctx = null;
}

export function padResize() {
  const c = pad.canvas;
  if (!c || !c.isConnected) return;
  const w = c.getBoundingClientRect().width;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(w * dpr);
  pad.px = w;
  pad.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  padRedraw();
}

function padRedraw() {
  const { ctx, px } = pad;
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  for (const s of pad.strokes) drawStroke(s, 0);
}

function drawStroke(s, from) {
  const { ctx, px } = pad;
  if (!ctx || !s.pts.length) return;
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = (s.w * px) / 400;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.pts.length === 1) {
    ctx.beginPath();
    ctx.arc(s.pts[0][0] * px, s.pts[0][1] * px, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const start = Math.max(1, from);
  ctx.beginPath();
  ctx.moveTo(s.pts[start - 1][0] * px, s.pts[start - 1][1] * px);
  for (let i = start; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * px, s.pts[i][1] * px);
  ctx.stroke();
}

const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
function padPoint(e) {
  const r = pad.canvas.getBoundingClientRect();
  return [r3((e.clientX - r.left) / r.width), r3((e.clientY - r.top) / r.height)];
}

function padDown(e) {
  e.preventDefault();
  pad.canvas.setPointerCapture?.(e.pointerId);
  const s = { id: Math.random().toString(36).slice(2, 9), c: pad.color, w: pad.width, pts: [padPoint(e)] };
  pad.strokes.push(s);
  pad.cur = s;
  pad.pend = [];
  drawStroke(s, 0);
  send({ t: 'draw', op: 'start', s });
}

function padMove(e) {
  const s = pad.cur;
  if (!s) return;
  const evs = e.getCoalescedEvents?.() ?? [e];
  for (const ev of evs) {
    const p = padPoint(ev);
    const last = s.pts[s.pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.004) continue;
    s.pts.push(p);
    pad.pend.push(p);
  }
  drawStroke(s, s.pts.length - pad.pend.length);
  // Batch points: one message per ~50ms keeps the free-tier request count low.
  if (!pad.raf) pad.raf = setTimeout(padFlush, 50);
}

function padFlush() {
  clearTimeout(pad.raf);
  pad.raf = 0;
  if (pad.cur && pad.pend.length) {
    send({ t: 'draw', op: 'pts', id: pad.cur.id, pts: pad.pend });
    pad.pend = [];
  }
}

function padUp() {
  padFlush();
  pad.cur = null;
}

// Strokes coming from the server (the other player drawing, or a full resync).
export function padMessage(m) {
  if (m.t === 'strokes') { pad.strokes = m.list || []; return padRedraw(); }
  if (m.op === 'clear') { pad.strokes = []; pad.cur = null; return padRedraw(); }
  if (m.op === 'undo') { pad.strokes.pop(); return padRedraw(); }
  if (m.op === 'start') { pad.strokes.push(m.s); return drawStroke(m.s, 0); }
  if (m.op === 'pts') {
    const s = pad.strokes.findLast((x) => x.id === m.id);
    if (!s) return;
    const from = s.pts.length;
    s.pts.push(...m.pts);
    drawStroke(s, from);
  }
}

// ---------------------------------------------------------------- actions + forms

export const gameActions = {
  duelAns: (el) => { sfx.tap(); send({ t: 'act', a: 'answer', v: el.dataset.v }); },
  pickWord: (el) => { sfx.pop(); send({ t: 'act', a: 'pick', i: Number(el.dataset.i) }); },
  totPick: (el) => { sfx.pop(); buzz([15]); send({ t: 'act', a: 'pick', i: Number(el.dataset.i) }); },
  color: (el) => { pad.color = el.dataset.c; document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b === el)); },
  size: (el) => { pad.width = Number(el.dataset.w); document.querySelectorAll('.sz').forEach((b) => b.classList.toggle('on', b === el)); },
  undo: () => { if (pad.strokes.length) { pad.strokes.pop(); padRedraw(); send({ t: 'draw', op: 'undo' }); } },
  clearPad: () => { pad.strokes = []; padRedraw(); send({ t: 'draw', op: 'clear' }); },
  giveUp: () => { if (confirm('Give up on this doodle? 🏳️')) send({ t: 'act', a: 'giveup' }); },
};

export const gameForms = {
  meld: (form, v) => { send({ t: 'act', a: 'answer', text: v }); sfx.pop(); },
  duel: (form, v) => { send({ t: 'act', a: 'answer', v }); form.querySelector('input').value = ''; },
  guess: (form, v) => { send({ t: 'act', a: 'guess', text: v }); form.querySelector('input').value = ''; sfx.tap(); },
};

// Wrong answer in the duel: wobble and a short cooldown.
export function nope() {
  sfx.nope();
  buzz([60]);
  const form = document.querySelector('[data-form="duel"]') || document.querySelector('.numpad') || document.querySelector('.egrid.odd');
  shake(form);
  form?.querySelectorAll('input, button').forEach((b) => { b.disabled = true; });
  setTimeout(() => form?.querySelectorAll('input, button').forEach((b) => { b.disabled = false; }), 1200);
  setTimeout(() => form?.querySelector('input')?.focus(), 1220);
}

export const gameScreens = { meld, duel, draw, special };
