// One Durable Object per couple. It owns the room state, schedules the surprise
// Drops with alarms, runs the live games and relays doodle strokes.

import { DurableObject } from 'cloudflare:workers';
import { GAMES, other } from './games.js';
import { sendPush } from './push.js';
import { POKE_LINES } from './content.js';

const DROP_OPEN_MS = 15 * 60_000;
const BONUS_OPEN_MS = 5 * 60_000;
const MIN_GAP_MS = 75 * 60_000;
const HISTORY_MAX = 40;
const SLOTS = ['A', 'B'];
const DEFAULT_SETTINGS = { perDay: 5, wake: 9, sleep: 23, reward: 'Winner picks our next movie night ðŸ¿' };

// ---------------------------------------------------------------- time helpers

const fmtCache = new Map();
function fmt(tz, opts) {
  const k = tz + JSON.stringify(opts);
  if (!fmtCache.has(k)) {
    let f;
    try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts }); }
    catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts }); }
    fmtCache.set(k, f);
  }
  return fmtCache.get(k);
}
const localHour = (ts, tz) => Number(fmt(tz, { hour: 'numeric', hourCycle: 'h23' }).format(ts)) % 24;
const dayKey = (ts, tz) => fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const weekKey = (ts, tz) => 'w' + Math.floor((dayNum(dayKey(ts, tz)) + 3) / 7); // weeks start Monday

function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newPlayer(body) {
  const name = String(body?.name ?? '').trim().slice(0, 20);
  if (!name) return null;
  return {
    name,
    avatar: String(body?.avatar ?? 'ðŸ»').slice(0, 8) || 'ðŸ»',
    tz: validTz(body?.tz) || 'UTC',
    token: crypto.randomUUID(),
    subs: [],
    joined: Date.now(),
  };
}

const json = (data, status = 200) => Response.json(data, { status });

// ---------------------------------------------------------------- the room

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.S = null;
    this.strokes = [];      // live doodle, saved with a debounce so a restart keeps it
    this.strokeTimer = 0;
    this.lastPoke = {};
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.S = (await ctx.storage.get('s')) ?? null;
      this.strokes = (await ctx.storage.get('strokes')) ?? [];
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.slice(1);
    if (path === 'create') return this.create(await req.json().catch(() => ({})), url.searchParams.get('code'));
    if (!this.S) return json({ error: 'No room with that code ðŸ¥º' }, 404);
    if (path === 'join') return this.join(await req.json().catch(() => ({})));
    const slot = SLOTS.find((s) => this.S.players[s]?.token === url.searchParams.get('token'));
    if (path === 'me') return slot ? json({ ok: true, slot }) : json({ error: 'This device key does not open that room ðŸ”‘' }, 401);
    if (path === 'ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!slot) return new Response('bad token', { status: 401 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, [slot]);
      server.serializeAttachment({ slot });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  async create(body, code) {
    if (this.S) return json({ error: 'taken' }, 409);
    const p = newPlayer(body);
    if (!p) return json({ error: 'Tell us your name first ðŸ¥º' }, 400);
    this.S = {
      code, created: Date.now(), homeTz: p.tz,
      players: { A: p, B: null },
      settings: { ...DEFAULT_SETTINGS },
      stats: { love: 0, streak: 0, best: 0, lastDay: null, week: null, lastWeek: null, played: 0 },
      schedule: [], drop: null, history: [], recent: {},
    };
    await this.save();
    return json({ code, slot: 'A', token: p.token });
  }

  async join(body) {
    if (this.S.players.B) return json({ error: 'This room already has its two lovebirds ðŸ¦ðŸ¦' }, 409);
    const p = newPlayer(body);
    if (!p) return json({ error: 'Tell us your name first ðŸ¥º' }, 400);
    this.S.players.B = p;
    this.plan(Date.now());
    const a = this.S.players.A;
    this.notify(['A'], { title: `${p.avatar} ${p.name} joined your room!`, body: 'Your first Drop is on its way âœ¨', tag: 'join' });
    await this.commit();
    return json({ code: this.S.code, slot: 'B', token: p.token, partner: a.name });
  }

  // ------------------------------------------------------------ sockets

  async webSocketMessage(ws, raw) {
    if (!this.S || typeof raw !== 'string') return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const slot = ws.deserializeAttachment()?.slot;
    if (!slot) return;
    if (m.t === 'draw') return this.relayDraw(ws, slot, m);

    const now = Date.now();
    const S = this.S;
    const me = S.players[slot];
    const d = S.drop;

    switch (m.t) {
      case 'hello': {
        const tz = validTz(m.tz);
        if (tz) me.tz = tz;
        if (d?.status === 'playing' && d.kind === 'draw') ws.send(JSON.stringify({ t: 'strokes', list: this.strokes }));
        break;
      }
      case 'ready':
        if (d?.status === 'open' && !d.ready[slot]) {
          d.ready[slot] = true;
          if (d.ready.A && d.ready.B) this.startGame();
        }
        break;
      case 'play':
        if (this.active() || !S.players.B) return;
        this.startDrop(GAMES[m.kind] ? m.kind : this.randomKind(), true, slot);
        break;
      case 'act':
        if (d?.status !== 'playing') return;
        GAMES[d.kind].act(d.game, slot, m, this.api());
        this.afterGame();
        break;
      case 'poke': {
        if (now - (this.lastPoke[slot] ?? 0) < 2500 || !S.players[other(slot)]) return;
        this.lastPoke[slot] = now;
        const line = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
        this.sendTo(other(slot), { t: 'poke', from: slot, line });
        this.sendTo(slot, { t: 'poked' });
        this.notify([other(slot)], { title: `${me.avatar} ${me.name} poked you ðŸ’—`, body: line, tag: 'poke' });
        return;
      }
      case 'settings': {
        const st = S.settings;
        const int = (v, lo, hi, d) => (Number.isInteger(+v) && +v >= lo && +v <= hi ? +v : d);
        const next = {
          perDay: int(m.perDay, 1, 10, st.perDay),
          wake: int(m.wake, 0, 23, st.wake),
          sleep: int(m.sleep, 1, 24, st.sleep),
          reward: typeof m.reward === 'string' && m.reward.trim() ? m.reward.trim().slice(0, 60) : st.reward,
        };
        const replan = next.perDay !== st.perDay || next.wake !== st.wake || next.sleep !== st.sleep;
        S.settings = next;
        if (replan) { S.schedule = []; this.plan(now); }
        break;
      }
      case 'profile': {
        const name = String(m.name ?? '').trim().slice(0, 20);
        if (name) me.name = name;
        if (typeof m.avatar === 'string' && m.avatar) me.avatar = m.avatar.slice(0, 8);
        break;
      }
      case 'sub': {
        const sub = m.sub;
        if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return;
        const known = me.subs.some((x) => x.endpoint === sub.endpoint);
        me.subs = [...me.subs.filter((x) => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }].slice(-5);
        if (!known && !m.quiet) this.notify([slot], { title: 'Buzzes are on! ðŸ””', body: 'You will feel it when a Drop lands ðŸ’Œ', tag: 'hello' });
        break;
      }
      case 'unsub':
        me.subs = me.subs.filter((x) => x.endpoint !== m.endpoint);
        break;
      default:
        return;
    }
    await this.commit();
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
    this.broadcast();
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch {}
    this.broadcast();
  }

  relayDraw(ws, slot, m) {
    const d = this.S.drop;
    if (d?.status !== 'playing' || d.kind !== 'draw' || d.game.phase !== 'draw' || d.game.drawer !== slot) return;
    const cl = (v) => Math.max(0, Math.min(1, Math.round(Number(v) * 1000) / 1000)) || 0;
    const pts = (a) => (Array.isArray(a) ? a.slice(0, 400) : []).map((p) => [cl(p?.[0]), cl(p?.[1])]);
    let out;
    if (m.op === 'start' && this.strokes.length < 3000) {
      const s = {
        id: String(m.s?.id ?? '').slice(0, 12),
        c: /^#[0-9a-f]{6}$/i.test(m.s?.c) ? m.s.c : '#5b3a57',
        w: Math.max(1, Math.min(40, Number(m.s?.w) || 8)),
        pts: pts(m.s?.pts),
      };
      this.strokes.push(s);
      out = { t: 'draw', op: 'start', s };
    } else if (m.op === 'pts') {
      const s = this.strokes.findLast((x) => x.id === m.id);
      if (!s || s.pts.length > 4000) return;
      const p = pts(m.pts);
      s.pts.push(...p);
      out = { t: 'draw', op: 'pts', id: s.id, pts: p };
    } else if (m.op === 'undo') {
      this.strokes.pop();
      out = { t: 'draw', op: 'undo' };
    } else if (m.op === 'clear') {
      this.strokes = [];
      out = { t: 'draw', op: 'clear' };
    } else return;
    const msg = JSON.stringify(out);
    for (const w of this.ctx.getWebSockets()) if (w !== ws) try { w.send(msg); } catch {}
    this.saveStrokesSoon();
  }

  saveStrokesSoon() {
    clearTimeout(this.strokeTimer);
    this.strokeTimer = setTimeout(() => this.ctx.storage.put('strokes', this.strokes), 1500);
  }

  resetStrokes() {
    this.strokes = [];
    clearTimeout(this.strokeTimer);
    this.ctx.storage.delete('strokes');
  }

  // ------------------------------------------------------------ drops

  active() {
    const st = this.S.drop?.status;
    return st === 'open' || st === 'playing';
  }

  randomKind() {
    const kinds = Object.keys(GAMES).filter((k) => k !== this.S.history.at(-1)?.kind);
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  startDrop(kind, bonus, by = null) {
    const now = Date.now();
    const G = GAMES[kind];
    this.S.drop = {
      id: crypto.randomUUID().slice(0, 8), kind, bonus, by, status: 'open',
      opensAt: now, expiresAt: now + (bonus ? BONUS_OPEN_MS : DROP_OPEN_MS),
      ready: { A: by === 'A', B: by === 'B' }, game: null, result: null,
    };
    if (bonus) {
      const p = this.S.players[by];
      this.notify([other(by)], { title: `${p.avatar} ${p.name} wants to play ${G.emoji} ${G.title}!`, body: 'Bonus round! 5 minutes to jump in ðŸ’¨', tag: 'drop' });
    } else {
      this.notify(SLOTS, { title: 'ðŸ’Œ A Drop just landed!', body: `${G.emoji} ${G.title}: 15 minutes to play it together`, tag: 'drop' });
    }
  }

  startGame() {
    const d = this.S.drop;
    d.status = 'playing';
    d.startedAt = Date.now();
    this.resetStrokes();
    d.game = GAMES[d.kind].init(this.api());
  }

  afterGame() {
    const d = this.S.drop;
    if (!d.game.over) return;
    const res = d.game.result;
    const now = Date.now();
    const st = this.S.stats;
    st.love += res.love;
    st.played++;
    this.rollWeek(now);
    st.week.A += res.duel.A;
    st.week.B += res.duel.B;
    const today = dayKey(now, this.S.homeTz);
    if (st.lastDay !== today) {
      st.streak = st.lastDay && dayNum(today) - dayNum(st.lastDay) === 1 ? st.streak + 1 : 1;
      st.lastDay = today;
      st.best = Math.max(st.best, st.streak);
      res.streakUp = st.streak;
    }
    d.status = 'done';
    d.result = res;
    d.game = null;
    this.pushHistory({ at: now, kind: d.kind, bonus: d.bonus, status: 'done', summary: res.summary, love: res.love, winner: res.winner });
  }

  pushHistory(h) {
    this.S.history.push(h);
    if (this.S.history.length > HISTORY_MAX) this.S.history.splice(0, this.S.history.length - HISTORY_MAX);
  }

  rollWeek(now) {
    const st = this.S.stats;
    const key = weekKey(now, this.S.homeTz);
    if (st.week?.key === key) return;
    if (st.week && (st.week.A || st.week.B)) {
      st.lastWeek = { ...st.week, champ: st.week.A > st.week.B ? 'A' : st.week.B > st.week.A ? 'B' : null };
    }
    st.week = { key, A: 0, B: 0 };
  }

  // Pick the next 24h of surprise drop times, inside hours when both of you are awake.
  plan(now) {
    const { A, B } = this.S.players;
    if (!A || !B) return;
    const { perDay, wake, sleep } = this.S.settings;
    const awake = (ts, tz) => {
      if (wake === sleep % 24) return true;
      const h = localHour(ts, tz);
      return wake < sleep ? h >= wake && h < sleep : h >= wake || h < sleep;
    };
    const step = 10 * 60_000;
    const both = [], either = [], all = [];
    for (let t = now + 20 * 60_000; t < now + 24 * 3600_000; t += step) {
      const a = awake(t, A.tz), b = awake(t, B.tz);
      all.push(t);
      if (a && b) both.push(t);
      if (a || b) either.push(t);
    }
    const pool = both.length >= perDay * 3 ? both : either.length >= perDay * 3 ? either : all;
    const picked = [];
    for (const t of shuffle([...pool])) {
      if (picked.length >= perDay) break;
      if (picked.every((p) => Math.abs(p - t) >= MIN_GAP_MS)) picked.push(t + Math.floor(Math.random() * step));
    }
    this.S.schedule = picked.sort((x, y) => x - y);
  }

  async alarm() {
    if (!this.S) return;
    for (let guard = 0; guard < 25; guard++) {
      const now = Date.now();
      const d = this.S.drop;
      if (d?.status === 'open' && now >= d.expiresAt) {
        if (d.bonus) this.S.drop = null;
        else {
          d.status = 'missed';
          this.pushHistory({ at: now, kind: d.kind, bonus: false, status: 'missed' });
        }
        continue;
      }
      if (d?.status === 'playing' && d.game.deadline && now >= d.game.deadline) {
        GAMES[d.kind].tick(d.game, this.api());
        this.afterGame();
        continue;
      }
      if (this.S.schedule.length && this.S.schedule[0] <= now) {
        this.S.schedule.shift();
        if (this.active()) this.S.schedule = [now + DROP_OPEN_MS, ...this.S.schedule].sort((x, y) => x - y);
        else if (this.S.players.B) this.startDrop(this.randomKind(), false);
        continue;
      }
      break;
    }
    if (!this.S.schedule.length) this.plan(Date.now());
    await this.commit();
  }

  // ------------------------------------------------------------ plumbing

  api() {
    return {
      now: Date.now(),
      rand: Math.random,
      shuffle,
      names: { A: this.S.players.A?.name, B: this.S.players.B?.name },
      pick: (key, list, n) => {
        const recent = (this.S.recent[key] ??= []);
        let pool = list.filter((x) => !recent.includes(x));
        if (pool.length < n) { recent.length = 0; pool = [...list]; }
        const out = shuffle(pool).slice(0, n);
        recent.push(...out);
        if (recent.length > Math.floor(list.length * 0.7)) recent.splice(0, recent.length - Math.floor(list.length * 0.7));
        return out;
      },
      sendTo: (slot, msg) => this.sendTo(slot, msg),
      clearStrokes: () => { this.resetStrokes(); this.sendAll({ t: 'draw', op: 'clear' }); },
    };
  }

  async save() { await this.ctx.storage.put('s', this.S); }

  async arm() {
    const d = this.S.drop;
    const times = [];
    if (d?.status === 'open') times.push(d.expiresAt);
    if (d?.status === 'playing' && d.game.deadline) times.push(d.game.deadline);
    if (this.S.schedule.length) times.push(this.S.schedule[0]);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  async commit() {
    await this.save();
    await this.arm();
    this.broadcast();
  }

  online(slot) {
    return this.ctx.getWebSockets(slot).some((w) => w.readyState === 1);
  }

  sendTo(slot, msg) {
    const s = JSON.stringify(msg);
    for (const w of this.ctx.getWebSockets(slot)) try { w.send(s); } catch {}
  }

  sendAll(msg) {
    const s = JSON.stringify(msg);
    for (const w of this.ctx.getWebSockets()) try { w.send(s); } catch {}
  }

  broadcast() {
    if (!this.S) return;
    for (const slot of SLOTS) {
      const sockets = this.ctx.getWebSockets(slot);
      if (!sockets.length) continue;
      const s = JSON.stringify(this.view(slot));
      for (const w of sockets) try { w.send(s); } catch {}
    }
  }

  view(slot) {
    const S = this.S;
    const now = Date.now();
    this.rollWeek(now);
    const st = S.stats;
    const today = dayKey(now, S.homeTz);
    const alive = st.lastDay && dayNum(today) - dayNum(st.lastDay) <= 1;
    const pv = (s) => {
      const p = S.players[s];
      return p && { name: p.name, avatar: p.avatar, tz: p.tz, online: this.online(s), push: p.subs.length > 0 };
    };
    const d = S.drop;
    const G = d && GAMES[d.kind];
    return {
      t: 'state', now, code: S.code, me: slot,
      players: { A: pv('A'), B: pv('B') },
      settings: S.settings,
      stats: { love: st.love, streak: alive ? st.streak : 0, playedToday: st.lastDay === today, best: st.best, week: st.week, lastWeek: st.lastWeek, played: st.played },
      upcoming: S.schedule.length,
      today: S.history.filter((h) => dayKey(h.at, S.homeTz) === today).reverse(),
      drop: d && {
        id: d.id, kind: d.kind, title: G.title, emoji: G.emoji, blurb: G.blurb, bonus: d.bonus, by: d.by,
        status: d.status, expiresAt: d.expiresAt, ready: d.ready, result: d.result,
        game: d.status === 'playing' ? G.view(d.game, slot) : null,
      },
      games: Object.entries(GAMES).map(([kind, g]) => ({ kind, title: g.title, emoji: g.emoji, blurb: g.blurb })),
    };
  }

  notify(slots, msg) {
    if (!this.env.VAPID_PRIVATE_JWK || !this.env.VAPID_PUBLIC_KEY) return;
    for (const slot of slots) {
      const p = this.S.players[slot];
      if (!p) continue;
      for (const sub of [...p.subs]) {
        const job = sendPush(this.env, sub, { ...msg, url: '/' })
          .then(async (r) => {
            if (r.gone) { p.subs = p.subs.filter((x) => x.endpoint !== sub.endpoint); await this.save(); }
            else if (r.status >= 400) console.log('push rejected', r.status);
          })
          .catch((e) => console.log('push failed', e.message));
        this.ctx.waitUntil?.(job);
      }
    }
  }
}
