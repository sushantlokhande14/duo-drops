import { st, load, store, now, other, P, esc, $, send, patch, ava } from './core.js';
import { burst, confetti, toast, toastText, buzz, shake, floatSky, unlockAudio, sfx, setMuted } from './fx.js';
import { gameScreens, gameActions, gameForms, padMessage, padResize, nope } from './games-ui.js';

const AVATARS = ['🐻', '🐰', '🐱', '🐶', '🐼', '🦊', '🐸', '🐧', '🐨', '🐹', '🦄', '🐥'];
const app = document.getElementById('app');
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const ui = {
  joinCode: null,
  pickAva: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  screen: null,         // current screen object
  key: null,            // its key; a new key means a fresh mount
  pushSub: null,
};

// ---------------------------------------------------------------- formatting

const tzFmt = new Map();
function localTime(zone) {
  if (!tzFmt.has(zone)) {
    try { tzFmt.set(zone, new Intl.DateTimeFormat([], { timeZone: zone, hour: 'numeric', minute: '2-digit' })); }
    catch { tzFmt.set(zone, new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })); }
  }
  return tzFmt.get(zone).format(new Date());
}
function zoneHour(zone) {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); } catch { return 12; }
}
// Secrets ride in the #fragment, which browsers never send to the server.
const inviteLink = (s) => `${location.origin}/#join=${s.code}-${s.invite}`;
const keyLink = () => `${location.origin}/#key=${st.me.code}.${st.me.token}`;
const authHeaders = () => ({ Authorization: `Bearer ${st.me.token}` });
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const gameMeta = (kind) => st.s?.games.find((g) => g.kind === kind) ?? { title: kind, emoji: '🎲' };

// ---------------------------------------------------------------- screens

const welcome = {
  key: () => `welcome:${ui.joinCode ?? ''}`,
  html: () => `
    <div class="hero">
      <div class="hero-duo"><span class="bob">🐻</span><span class="heart beat">💗</span><span class="bob d2">🐰</span></div>
      <h1 class="logo">Duo Drops</h1>
      <p class="tag">tiny live games for two hearts, far apart 💌</p>
    </div>
    <div class="card pop">
      ${ui.joinCode ? `<p class="center">You're invited to room <b class="code">${esc(ui.joinCode)}</b> 💞</p>` : ''}
      <label for="nm">Your cute name</label>
      <input id="nm" maxlength="20" autocomplete="nickname" placeholder="what should they call you?" value="${esc(load('duo:lastName', ''))}">
      <label>Pick your critter</label>
      <div class="avas" data-r="avas"></div>
      <div style="height:18px"></div>
      ${ui.joinCode
        ? `<button class="btn big block" data-act="join">Join my love 💞</button>
           <button class="linkish" data-act="noInvite" style="margin-top:8px;width:100%">start my own room instead</button>`
        : `<button class="btn big block" data-act="create">Create our room ✨</button>
           <details><summary>I have a code 🔑</summary>
             <div class="row" style="margin-top:10px"><input id="codeIn" class="code-in" maxlength="13" placeholder="ABC234-XYZ789" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn lav" style="flex:none" data-act="join">Join</button></div>
           </details>`}
    </div>
    <p class="muted center">Every day, surprise Drops land on both your phones.<br>Jump in together, play a tiny live game, keep your streak going 🔥</p>`,
  regions: () => ({ avas: AVATARS.map((a) => `<button data-act="pickAva" data-a="${a}" class="${a === ui.pickAva ? 'on' : ''}">${a}</button>`).join('') }),
};

const invite = {
  key: () => 'invite',
  html: (s) => {
    const link = inviteLink(s);
    return `
      <div class="card invite pop">
        <div class="pair">${ava(P(s.me), 'lg bob')}<span class="dots">• • •</span><span class="ava lg ghost">?</span></div>
        <h2>Now invite your favorite person</h2>
        <p class="muted">Send them this private link. The moment they open it, your room comes alive ✨</p>
        <div class="linkbox">${esc(link)}</div>
        <button class="btn big block" data-act="share">Send the link 💌</button>
        <p class="muted">or tell them the invite code<br><b class="code">${esc(s.code)}-${esc(s.invite)}</b></p>
        <p class="muted small">Only someone with this code can join, and once they do the room locks to just you two 🔒</p>
      </div>
      <div class="card center stack">
        <p>While you wait: turn on buzzes so you feel it when they join and when Drops land 🔔</p>
        <div data-r="push"></div>
      </div>`;
  },
  regions: () => ({ push: pushButton() }),
};

function pushButton() {
  return st.pushHere
    ? `<button class="btn soft small" data-act="pushTest">🔔 buzzes are on</button>`
    : `<button class="btn mint" data-act="enablePush">🔔 Turn on buzzes</button>`;
}

function whoHtml(slot, s) {
  const p = P(slot);
  const asleep = (() => { const h = zoneHour(p.tz); return h >= 23 || h < 7; })();
  const status = slot === s.me ? 'you' : p.online ? 'here now 💚' : asleep ? 'probably asleep' : 'away';
  return `<div class="who">
      <span class="ava ${p.online ? '' : 'away'}">${esc(p.avatar)}${p.online ? '<i class="dot"></i>' : asleep ? '<i class="zz">💤</i>' : ''}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="tm ${slot !== s.me && p.online ? 'here' : ''}">${status}</span>
      <span class="tm">🕐 <span data-tz="${esc(p.tz)}"></span></span>
    </div>`;
}

const home = {
  key: () => 'home',
  html: () => `
    <header class="duo-head" data-r="head"></header>
    <div class="chips" data-r="chips"></div>
    <section class="card next-card" data-r="next"></section>
    <div class="row">
      <button class="btn big" data-act="openPlay">🎮 Play now</button>
      <button class="btn soft big" data-act="poke">💗 Poke</button>
    </div>
    <section class="card task-card" data-r="task"></section>
    <section class="card" data-r="week"></section>
    <section class="card" data-r="today"></section>
    <footer class="foot" data-r="foot"></footer>
    <p class="muted center small">made with 💗 for one long-distance couple, open to all ·
      <a href="https://github.com/sushantlokhande14/duo-drops" target="_blank" rel="noopener">source</a></p>`,
  regions(s) {
    const me = s.me, o = other(me), you = P(o), st_ = s.stats;
    const both = P(me).online && you.online;
    const wk = st_.week ?? { A: 0, B: 0 };
    const total = wk.A + wk.B;
    const pctMe = total ? Math.round((wk[me] / total) * 100) : 50;
    const lw = st_.lastWeek;
    const today = s.today;
    const missedRecent = s.drop?.status === 'missed';
    return {
      head: `${whoHtml(me, s)}
        <div class="tether"><span class="heart ${both ? 'beat' : 'sad'}">${both ? '💗' : '🤍'}</span><div class="string"></div>
          <div class="note">${both ? 'together right now' : 'miles apart, hearts close'}</div></div>
        ${whoHtml(o, s)}`,
      chips: `<span class="chip">🔥 ${st_.streak} <small>day streak</small></span>
        <span class="chip">💗 ${st_.love} <small>love</small></span>
        <span class="chip">✨ ${s.upcoming} <small>drops coming</small></span>
        <span class="chip">${esc(s.daily.theme.emoji)} <small>today:</small> ${esc(s.daily.theme.name)}</span>`,
      task: (() => {
        const t = s.daily.task;
        const status = t.mine && t.partner ? 'done together! +30 💗'
          : t.mine ? `waiting for ${esc(you.name)} ${esc(you.avatar)}…`
          : t.partner ? `${esc(you.name)} already did it, your turn! 👀` : 'do it, then tap done. Both done = +30 💗';
        return `<div class="task-top"><span class="task-em bob">${esc(t.emoji)}</span><div><span class="kicker-l">today's little task</span><h3>${esc(t.title)}</h3></div></div>
          <p>${esc(t.body)}</p>
          <div class="task-row">
            <span class="task-checks"><span class="${t.mine ? 'on' : ''}">${esc(P(me).avatar)}</span><span class="${t.partner ? 'on' : ''}">${esc(you.avatar)}</span></span>
            ${t.mine ? `<span class="muted">${status}</span>` : `<button class="btn mint small" data-act="taskDone">✅ I did it</button>`}
          </div>
          ${!t.mine ? `<p class="muted small">${status}</p>` : ''}`;
      })(),
      next: missedRecent
        ? `<div class="art">🥺</div><div><h3>Aww, a Drop slipped by</h3><p class="muted">Another one is on its way. Turn on buzzes so you feel the next one 🔔</p></div>`
        : `<div class="art bob">☁️</div><div><h3>A surprise Drop could land any minute ✨</h3>
            <p class="muted">${s.upcoming ? `${s.upcoming} more in the next day, at random times when you're both awake.` : 'Planning the next batch…'}
            ${st_.playedToday ? '' : ' Play one today to keep your streak 🔥'}</p></div>`,
      week: `<h3>This week's duel 🏆</h3>
        <div class="week-names"><span>${esc(P(me).avatar)} ${wk[me]}</span><span>${wk[o]} ${esc(you.avatar)}</span></div>
        <div class="week-bar"><i class="a" style="width:${pctMe}%"></i><i class="b" style="width:${100 - pctMe}%"></i></div>
        <p class="muted">Win Speed Duels to score. Resets Monday.</p>
        <div class="prize">🎁 Prize: <b>${esc(s.settings.reward)}</b></div>
        ${lw ? `<p class="muted" style="margin-top:8px">Last week: ${lw.champ ? `👑 ${esc(P(lw.champ).name)} won ${Math.max(lw.A, lw.B)} to ${Math.min(lw.A, lw.B)}` : `a ${lw.A}–${lw.B} tie 🤝`}</p>` : ''}`,
      today: `<h3>Today's drops 📅</h3>${today.length
        ? `<ul class="today-list">${today.map((h) => {
            const g = h.title ? { title: h.title, emoji: h.emoji } : gameMeta(h.kind);
            if (h.status === 'missed') return `<li class="missed"><span class="em">${g.emoji}</span><span class="tx">${esc(g.title)}<small>missed at ${clock(h.at)} 🥺</small></span></li>`;
            const w = h.winner ? ` · 👑 ${esc(P(h.winner).name)}` : '';
            return `<li><span class="em">${g.emoji}</span><span class="tx">${esc(g.title)}${h.bonus ? ' <small style="display:inline">bonus</small>' : ''}<small>${esc(h.summary)}${w}</small></span><span class="gain">+${h.love} 💗</span></li>`;
          }).join('')}</ul>`
        : `<p class="empty">Nothing yet today. Your first Drop is on its way 💌<br>or hit <b>Play now</b> 🎮</p>`}`,
      foot: `${pushButton()}
        <button class="btn soft small" data-act="mute">${st.muted ? '🔇 sound off' : '🔊 sound on'}</button>
        <button class="btn soft small" data-act="openSettings">⚙️ settings</button>`,
    };
  },
};

const lobby = {
  key: (s) => `lobby:${s.drop.id}`,
  html: (s) => {
    const d = s.drop;
    const by = d.by && P(d.by);
    return `<div class="card lobby">
        <div class="envelope">${d.bonus ? '🎮' : '💌'}</div>
        <span class="badge ${d.bonus ? 'lav' : ''}">${d.bonus ? `bonus round from ${esc(by.name)}` : 'A Drop just landed!'}</span>
        <div style="font-size:54px" class="bob">${d.emoji}</div>
        <h1>${esc(d.title)}</h1>
        <p class="muted">${esc(d.blurb)}</p>
        <div class="readies" data-r="ready"></div>
        <div data-r="cta" style="width:100%"></div>
        <p class="muted">closes in <b data-until="${d.expiresAt}" data-fmt="mmss"></b></p>
      </div>`;
  },
  regions: (s) => {
    const d = s.drop, me = s.me, o = other(me), you = P(o);
    const r = (slot) => `<div class="r ${d.ready[slot] ? 'ok' : ''}">${ava(P(slot))}<span>${d.ready[slot] ? 'ready! ✓' : slot === me ? 'you?' : you.online ? 'on the way…' : 'buzzing them… 📳'}</span></div>`;
    return {
      ready: r(me) + r(o),
      cta: d.ready[me]
        ? `<p>Waiting for <b>${esc(you.name)}</b> ${esc(you.avatar)}…</p><div style="height:10px"></div><button class="btn soft block" data-act="poke">💗 Poke them</button>`
        : `<button class="btn big block" data-act="ready">I'm in! ✨</button>`,
    };
  },
  mount: (root, s) => {
    if (!s.drop.ready[s.me]) { sfx.drop(); buzz([60, 50, 60]); }
  },
};

const result = {
  key: (s) => `result:${s.drop.id}`,
  html: (s) => {
    const d = s.drop, r = d.result, me = s.me;
    const headline = { meld: r.highlights.filter((h) => h.match).length >= 3 ? 'Two minds, one brain 🧠' : 'Mind Meld done!', duel: r.winner ? (r.winner === me ? 'You won the duel! 🏆' : `${esc(P(r.winner).name)} won the duel!`) : "It's a tie 🤝", draw: 'Art class dismissed 🎨', special: `${esc(d.title)} done!` }[d.kind];
    let hl = '';
    if (d.kind === 'meld') {
      hl = r.highlights.map((h) => `<li class="${h.match ? 'yay' : ''}"><span class="grow"><span class="q">${esc(h.prompt)}</span>${esc(P(me).avatar)} ${esc(h[me] ?? '…')} · ${esc(P(other(me)).avatar)} ${esc(h[other(me)] ?? '…')}</span>${h.match ? '✨' : ''}</li>`).join('');
    } else if (d.kind === 'duel') {
      const names = { scramble: '🔤 unscramble', math: '🧮 quick maths', count: '🔢 counting', odd: '🔍 odd one out', react: '💗 reaction' };
      hl = r.highlights.map((h) => `<li><span class="grow">${names[h.kind]}</span>${h.winner ? `${esc(P(h.winner).avatar)} 👑` : '😴'}</li>`).join('');
    } else if (d.kind === 'special') {
      const pickOf = (h, slot) => (h[slot] == null ? '⏰' : esc(h.pair[h[slot]]));
      hl = r.highlights.map((h) => `<li class="${h.match ? 'yay' : ''}"><span class="grow"><span class="q">${esc(h.pair[0])} or ${esc(h.pair[1])}</span>${esc(P(me).avatar)} ${pickOf(h, me)} · ${esc(P(other(me)).avatar)} ${pickOf(h, other(me))}</span>${h.match ? '💞' : ''}</li>`).join('');
    } else {
      hl = r.highlights.map((h) => `<li class="${h.solved ? 'yay' : ''}"><span class="grow">${esc(P(h.drawer).avatar)} drew <b>${esc(h.word)}</b></span>${h.solved ? `${h.secs}s ✅` : '🙈'}</li>`).join('');
    }
    const doodles = st.doodles[d.id] ?? [];
    return `<div class="card result">
        <div class="burst bob">${d.kind === 'duel' && r.winner ? '🏆' : '🎉'}</div>
        <h1>${headline}</h1>
        <p>${esc(r.summary)}</p>
        <div class="gain pop">+${r.love} 💗</div>
        ${r.streakUp ? `<div class="streak-up">🔥 ${r.streakUp} day streak!</div>` : ''}
        ${doodles.length ? `<div class="doodles">${doodles.map((x) => `<figure><img src="${x.img}" alt="${esc(x.word)}"><figcaption>${esc(P(x.by)?.avatar)} ${esc(x.word)}</figcaption></figure>`).join('')}</div>` : ''}
        <ul class="hl">${hl}</ul>
        <button class="btn big block" data-act="dismiss">Back home 🏡</button>
        <button class="btn soft block" data-act="openPlay">🔁 Play another</button>
      </div>`;
  },
  mount: () => { sfx.win(); confetti(); setTimeout(() => burst(innerWidth / 2, innerHeight / 3, 18), 250); buzz([40, 60, 40]); },
};

function gameScreen(s) {
  const d = s.drop, g = d.game, G = gameScreens[d.kind];
  return {
    key: () => `game:${d.id}:${G.key(d, g, s)}`,
    html: () => G.html(d, g, s),
    regions: () => G.regions(d, g, s),
    mount: (root) => G.mount?.(root, d, g, s),
    unmount: () => G.unmount?.(),
  };
}

function pick(s) {
  if (!st.me) return welcome;
  if (!s) return null;
  if (!s.players.B) return invite;
  const d = s.drop;
  if (d?.status === 'open') return lobby;
  if (d?.status === 'playing') return gameScreen(s);
  if (d?.status === 'done' && !st.dismissed.has(d.id)) return result;
  return home;
}

function render() {
  const s = st.s;
  const screen = pick(s);
  if (!screen) return;
  const key = screen.key(s);
  if (key !== ui.key) {
    ui.screen?.unmount?.();
    ui.key = key;
    ui.screen = screen;
    app.innerHTML = screen.html(s);
    patch(app, screen.regions?.(s));
    tick();
    screen.mount?.(app, s);
    window.scrollTo({ top: 0 });
  } else {
    ui.screen = screen;
    patch(app, screen.regions?.(s));
  }
  document.getElementById('conn').hidden = !st.me || st.connected || !st.s;
}

// Timers, countdown bars and clocks, all driven from data attributes.
function tick() {
  const t = now();
  for (const el of document.querySelectorAll('[data-until]')) {
    const ms = Math.max(0, Number(el.dataset.until) - t);
    el.textContent = el.dataset.fmt === 'mmss' ? mmss(ms) : String(Math.ceil(ms / 1000));
  }
  for (const el of document.querySelectorAll('[data-bar]')) {
    const [until, total] = el.dataset.bar.split(',').map(Number);
    const f = Math.max(0, Math.min(1, (until - t) / total));
    el.style.transform = `scaleX(${f})`;
    el.classList.toggle('low', f < 0.25);
  }
  for (const el of document.querySelectorAll('[data-after]')) {
    const open = t >= Number(el.dataset.after);
    if (open && !el.classList.contains('open')) {
      el.classList.add('open');
      if (el.dataset.focus) el.querySelector('input')?.focus();
    }
  }
  for (const el of document.querySelectorAll('[data-before]')) el.classList.toggle('gone', t >= Number(el.dataset.before));
  for (const el of document.querySelectorAll('[data-tz]')) {
    const v = localTime(el.dataset.tz);
    if (el.textContent !== v) el.textContent = v;
  }
}
setInterval(tick, 100);

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  const sh = document.getElementById('sheet');
  sh.querySelector('.sheet-body').innerHTML = html;
  sh.classList.add('open');
}
function closeSheet() { document.getElementById('sheet').classList.remove('open'); }
document.getElementById('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

const sheetHead = (title) => `<div class="sheet-head"><h2>${title}</h2><button class="x" data-act="closeSheet" aria-label="close">✕</button></div>`;

function playSheet() {
  const s = st.s, you = P(other(s.me));
  openSheet(`${sheetHead('Play now 🎮')}
    <p class="muted">${you.online ? `${esc(you.name)} is here, jump in together!` : `${esc(you.name)} is away, they'll get a buzz and have 5 minutes to join 📳`}</p>
    ${s.games.map((g) => `<button class="game-pick" data-act="play" data-kind="${g.kind}"><span class="em">${g.emoji}</span><span><b>${esc(g.title)}</b><small>${esc(g.blurb)}</small></span></button>`).join('')}
    <button class="game-pick" data-act="play" data-kind=""><span class="em">🎲</span><span><b>Surprise me</b><small>a random game, just like a real Drop</small></span></button>`);
}

function settingsSheet() {
  const s = st.s, me = P(s.me), set = s.settings;
  const hours = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h === 24 ? 'midnight' : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</option>`).join('');
  ui.settingsAva = me.avatar;
  openSheet(`${sheetHead('Settings ⚙️')}
    <label for="setName">Your name</label><input id="setName" maxlength="20" value="${esc(me.name)}">
    <label>Your critter</label><div class="avas" id="setAvas">${AVATARS.map((a) => `<button data-act="setAva" data-a="${a}" class="${a === me.avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
    <label for="setPer">Surprise drops per day: <b id="perOut">${set.perDay}</b></label>
    <input id="setPer" type="range" min="1" max="10" value="${set.perDay}">
    <label>Only drop between</label>
    <div class="hours"><select id="setWake">${hours(set.wake, 0, 23)}</select><span>and</span><select id="setSleep">${hours(set.sleep, 1, 24)}</select></div>
    <p class="muted" style="margin-top:6px">in each of your own time zones. Drops land when you're both awake.</p>
    <label for="setReward">Weekly duel prize 🎁</label><input id="setReward" maxlength="60" value="${esc(set.reward)}">
    <div style="height:16px"></div>
    <button class="btn block" data-act="saveSettings">Save 💾</button>
    <hr style="border:0;border-top:2px dashed var(--line);margin:22px 0">
    <p class="muted">Room code <b>${esc(s.code)}</b>. To use Duo Drops on another device of yours, copy your secret link and open it there. Don't share it, it's your key 🔑</p>
    <div style="height:10px"></div>
    <div class="row"><button class="btn soft small" data-act="copyKey">🔑 copy my secret link</button><button class="btn soft small" data-act="leave">👋 log out here</button></div>
    <hr style="border:0;border-top:2px dashed var(--line);margin:22px 0">
    <h3>Privacy 🔒</h3>
    <p class="muted" style="margin-top:6px">Your room only stores your names, critters, time zones, scores and game history. No emails, no accounts, no tracking.
      Your partner sees your name, critter, local time and whether you're online, never your device key.
      Rooms nobody opens for 4 months delete themselves.</p>
    <div style="height:12px"></div>
    <button class="btn soft small block danger" data-act="deleteRoom">🗑️ delete our room forever</button>`);
  document.getElementById('setPer').addEventListener('input', (e) => { document.getElementById('perOut').textContent = e.target.value; });
}

function iosSheet() {
  openSheet(`${sheetHead('Buzzes on iPhone 📱')}
    <p>iPhones only allow buzzes from apps on your home screen. Two taps:</p>
    <ol class="steps"><li>Tap the <b>Share</b> button ⬆️ in Safari</li><li>Choose <b>Add to Home Screen</b> ➕</li><li>Open <b>Duo Drops</b> from your home screen and tap 🔔 again</li></ol>
    <p class="muted">You'll stay logged in, your room comes with you 💞</p>`);
}

// ---------------------------------------------------------------- push

function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function checkPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    ui.pushSub = (await reg?.pushManager.getSubscription()) ?? null;
    st.pushHere = !!ui.pushSub;
  } catch {}
}

async function enablePush() {
  if (isIOS && !standalone) return iosSheet();
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return toastText("This browser can't do buzzes 😿 try Chrome or add to home screen");
  }
  try {
    const { key } = await (await fetch('/api/vapid')).json();
    if (!key) return toastText('Buzzes are not set up on the server yet (see README) 🛠️');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toastText('Buzzes are blocked 🥺 you can allow them in browser settings');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
    ui.pushSub = sub;
    st.pushHere = true;
    send({ t: 'sub', sub: sub.toJSON() });
    toastText('Buzzes on! 🔔 a test one is on its way');
    render();
  } catch (e) {
    toastText(`Couldn't turn on buzzes: ${e.message}`);
  }
}

// ---------------------------------------------------------------- networking

let retry = 0, retryTimer = 0, pingTimer = 0;

function connect() {
  clearTimeout(retryTimer);
  if (!st.me || (st.ws && st.ws.readyState <= 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // The device key goes in the subprotocol header, not the URL.
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${st.me.code}/ws`, ['duo', st.me.token]);
  st.ws = ws;
  ws.onopen = () => {
    retry = 0;
    st.connected = true;
    ws.send(JSON.stringify({ t: 'hello', tz }));
    if (ui.pushSub) ws.send(JSON.stringify({ t: 'sub', sub: ui.pushSub.toJSON(), quiet: true }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = () => {
    if (st.ws !== ws) return;
    st.connected = false;
    st.ws = null;
    clearInterval(pingTimer);
    render();
    retryTimer = setTimeout(connect, Math.min(8000, 600 * 2 ** retry++));
  };
}

function onMessage(m) {
  if (m.t === 'state') {
    st.offset = m.now - Date.now();
    const prev = st.s;
    st.s = m;
    noticeChanges(prev, m);
    render();
  } else if (m.t === 'poke') {
    const p = P(m.from);
    sfx.poke();
    buzz([80, 60, 80]);
    burst(innerWidth / 2, innerHeight / 2, 22, ['💗', '💖', '💕', p?.avatar ?? '💞']);
    toast(`${esc(p?.avatar)} <b>${esc(p?.name)}</b>: ${esc(m.line)}`, 3500);
  } else if (m.t === 'poked') {
    sfx.pop();
    burst(innerWidth / 2, innerHeight - 140, 8);
    toastText('poke sent 💗');
  } else if (m.t === 'deleted') {
    store('duo:me', null);
    st.me = null;
    st.s = null;
    st.ws = null;
    closeSheet();
    toastText(`${m.reason} 👋`, 4000);
    render();
  } else if (m.t === 'nope') {
    nope();
  } else if (m.t === 'draw' || m.t === 'strokes') {
    padMessage(m);
  }
}

function noticeChanges(prev, next) {
  if (!prev) return;
  const o = other(next.me);
  const was = prev.players[o], is = next.players[o];
  if (is && !was) { toast(`${esc(is.avatar)} <b>${esc(is.name)}</b> joined! 💞`, 3500); confetti(40); sfx.win(); }
  else if (is?.online && !was?.online) { toast(`${esc(is.avatar)} <b>${esc(is.name)}</b> is here 💚`); sfx.pop(); }
}

// ---------------------------------------------------------------- actions

async function enterRoom(path, body) {
  const name = $('#nm')?.value.trim();
  if (!name) { shake($('#nm')); $('#nm')?.focus(); return toastText('tell me your name first 🥺'); }
  store('duo:lastName', name);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, avatar: ui.pickAva, tz, ...body }) });
    const j = await res.json();
    if (!res.ok) return toastText(j.error || 'something went wrong 😿');
    st.me = { code: j.code, token: j.token };
    store('duo:me', st.me);
    history.replaceState(null, '', '/');
    ui.joinCode = null;
    if (j.partner) toast(`welcome! <b>${esc(j.partner)}</b> is waiting 💞`, 3500);
    connect();
  } catch {
    toastText('could not reach the server 😿');
  }
}

const actions = {
  ...gameActions,
  pickAva: (el) => { ui.pickAva = el.dataset.a; sfx.pop(); patch(app, welcome.regions()); },
  create: () => enterRoom('/api/rooms', {}),
  join: () => {
    const m = (ui.joinCode || $('#codeIn')?.value || '').trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]{6})-?([A-Z0-9]{6})$/);
    if (!m) { shake($('#codeIn')); return toastText('invite codes look like ABC234-XYZ789 🔑'); }
    enterRoom(`/api/rooms/${m[1]}/join`, { invite: m[2] });
  },
  noInvite: () => { ui.joinCode = null; history.replaceState(null, '', '/'); render(); },
  share: async () => {
    const link = inviteLink(st.s);
    const text = `Come play with me on Duo Drops 💌 ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Duo Drops', text: 'Come play with me on Duo Drops 💌', url: link });
      else { await navigator.clipboard.writeText(text); toastText('link copied! paste it to them 💌'); }
    } catch {}
  },
  ready: () => { sfx.pop(); send({ t: 'ready' }); },
  taskDone: () => { sfx.ding(); burst(innerWidth / 2, innerHeight / 2, 12, ['✅', '💗', '✨']); send({ t: 'task' }); },
  deleteRoom: () => {
    if (!confirm('Delete your room for both of you? Scores, streaks and history are erased forever. 🥺')) return;
    send({ t: 'deleteRoom' });
  },
  openPlay: () => {
    if (st.s.drop?.status === 'done') { st.dismissed.add(st.s.drop.id); saveDismissed(); }
    playSheet();
  },
  play: (el) => { closeSheet(); sfx.pop(); send({ t: 'play', kind: el.dataset.kind || null }); },
  poke: () => { send({ t: 'poke' }) || toastText('offline right now 😿'); },
  dismiss: () => { st.dismissed.add(st.s.drop.id); saveDismissed(); render(); },
  enablePush,
  pushTest: () => toastText("buzzes are on for this device 🔔"),
  mute: () => { setMuted(!st.muted); if (!st.muted) sfx.pop(); render(); },
  openSettings: settingsSheet,
  closeSheet,
  setAva: (el) => { ui.settingsAva = el.dataset.a; document.querySelectorAll('#setAvas button').forEach((b) => b.classList.toggle('on', b === el)); },
  saveSettings: () => {
    send({ t: 'profile', name: $('#setName').value, avatar: ui.settingsAva });
    send({ t: 'settings', perDay: Number($('#setPer').value), wake: Number($('#setWake').value), sleep: Number($('#setSleep').value), reward: $('#setReward').value });
    closeSheet();
    toastText('saved 💾');
  },
  copyKey: async () => {
    try {
      await navigator.clipboard.writeText(keyLink());
      toastText('secret link copied 🔑 open it on your other device');
    } catch { toastText("couldn't copy 😿"); }
  },
  leave: () => {
    if (!confirm('Log out on this device? You can come back with your secret link 🔑')) return;
    store('duo:me', null);
    location.href = '/';
  },
};

function saveDismissed() { store('duo:dismissed', [...st.dismissed].slice(-50)); }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const v = input?.value.trim();
  if (!v) return shake(input);
  gameForms[form.dataset.form]?.(form, v);
});

document.addEventListener('pointerdown', unlockAudio, { passive: true });
addEventListener('resize', padResize);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') connect(); });
addEventListener('online', connect);

// ---------------------------------------------------------------- boot

async function boot() {
  floatSky();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // #join=CODE-INVITE (invite link) or #key=CODE.TOKEN (your own secret link for another device)
  const hash = new URLSearchParams(location.hash.slice(1));
  const join = hash.get('join')?.toUpperCase().match(/^([A-Z0-9]{6})-([A-Z0-9]{6})$/);
  const key = hash.get('key')?.match(/^([A-Z0-9]{6})\.([0-9a-f-]{36})$/i);
  if (location.hash) history.replaceState(null, '', '/');
  if (key) {
    st.me = { code: key[1].toUpperCase(), token: key[2] };
    store('duo:me', st.me);
  } else if (join && st.me?.code !== join[1]) {
    ui.joinCode = `${join[1]}-${join[2]}`;
  }

  if (st.me && !ui.joinCode) {
    try {
      const res = await fetch(`/api/rooms/${st.me.code}/me`, { headers: authHeaders() });
      if (res.status === 401 || res.status === 404) {
        const j = await res.json().catch(() => ({}));
        toastText(j.error || 'that room is gone 🥺', 4000);
        st.me = null;
        store('duo:me', null);
      }
    } catch { /* offline: keep trying via the socket */ }
  }
  if (ui.joinCode) st.me = null;
  await checkPush();
  if (st.me) connect();
  render();
}

boot();
