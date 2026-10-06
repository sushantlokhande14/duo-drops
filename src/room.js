// One Durable Object per pair of players. It owns that room's state, schedules the
// surprise Drops with alarms, runs the live games and relays doodle strokes.
// Rooms never see each other: each one is its own object with its own storage.

import { DurableObject } from 'cloudflare:workers';
import { GAMES, other } from './games.js';
import { sendPush } from './push.js';
import { POKE_LINES } from './content.js';
import { fallbackDaily, sanitizeDaily } from './daily.js';

const DROP_OPEN_MS = 15 * 60_000;
const BONUS_OPEN_MS = 5 * 60_000;
const MIN_GAP_MS = 75 * 60_000;
const PAUSE_AFTER_MS = 7 * 864e5;      // nobody opened the app for a week: stop scheduling drops
const EXPIRE_AFTER_MS = 120 * 864e5;   // nobody opened it for four months: delete the room
const HISTORY_MAX = 40;
const MAX_MESSAGE = 20_000;
const MAX_SOCKETS_PER_PLAYER = 4;
const TASK_LOVE = 30;
const SLOTS = ['A', 'B'];
export const AVATARS = ['🐻', '🐰', '🐱', '🐶', '🐼', '🦊', '🐸', '🐧', '🐨', '🐹', '🦄', '🐥'];
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_SETTINGS = { perDay: 5, wake: 9, sleep: 23, reward: 'Winner picks our next movie night 🍿' };

// ---------------------------------------------------------------- helpers

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

const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
const pickAvatar = (v) => (AVATARS.includes(v) ? v : AVATARS[0]);
const randomInvite = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');

function newPlayer(body) {
  const name = cleanName(body?.name);
  if (!name) return null;
  return { name, avatar: pickAvatar(body?.avatar), tz: validTz(body?.tz) || 'UTC', token: crypto.randomUUID(), subs: [], joined: Date.now() };
}

// The device key travels in a header, never in the URL, so it stays out of logs and history.
function tokenFrom(req) {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const protos = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim());
  return protos.find((p) => p && p !== 'duo') || null;
}

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// ---------------------------------------------------------------- the room

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.S = null;
    this.daily = null;      // today's pack for this room's home time zone
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
    if (!this.S) return json({ error: 'No room with that code 🥺' }, 404);
    if (path === 'join') return this.join(await req.json().catch(() => ({})));
    const token = tokenFrom(req);
    const slot = token && SLOTS.find((s) => this.S.players[s]?.token === token);
    if (path === 'me') return slot ? json({ ok: true }) : json({ error: 'This device key does not open that room 🔑' }, 401);
    if (path === 'ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!slot) return new Response('bad key', { status: 401 });
      // Keep a few devices per player at most; the oldest gets bumped.
      const mine = this.ctx.getWebSockets(slot);
      for (const w of mine.slice(0, Math.max(0, mine.length - MAX_SOCKETS_PER_PLAYER + 1))) try { w.close(4000, 'too many devices'); } catch {}
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, [slot]);
      server.serializeAttachment({ slot });
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'duo' } });
    }
    return new Response('not found', { status: 404 });
  }

  async create(body, code) {
    if (this.S) return json({ error: 'taken' }, 409);
    const p = newPlayer(body);
    if (!p) return json({ error: 'Tell us your name first 🥺' }, 400);
    const now = Date.now();
    this.S = {
      code, invite: randomInvite(), created: now, lastSeen: now, homeTz: p.tz,
      players: { A: p, B: null },
      settings: { ...DEFAULT_SETTINGS },
      stats: { love: 0, streak: 0, best: 0, lastDay: null, week: null, lastWeek: null, played: 0 },
      schedule: [], drop: null, history: [], recent: {}, task: null,
    };
    await this.save();
    await this.arm();
    return json({ code, token: p.token });
  }

  async join(body) {
    if (this.S.players.B) return json({ error: 'This room already has its two players 🐦🐦' }, 409);
    if (String(body?.invite ?? '').toUpperCase() !== this.S.invite) return json({ error: 'That invite code does not match 🔑 check the link?' }, 403);
    const p = newPlayer(body);
    if (!p) return json({ error: 'Tell us your name first 🥺' }, 400);
    this.S.players.B = p;
    this.S.invite = null; // spent: the room is full now
    this.S.lastSeen = Date.now();
    this.plan(Date.now());
    const a = this.S.players.A;
    this.notify(['A'], { title: `${p.avatar} ${p.name} joined your room!`, body: 'Your first Drop is on its way ✨', tag: 'join' });
    await this.commit();
    return json({ code: this.S.code, token: p.token, partner: a.name });
  }

  // ------------------------------------------------------------ sockets

  async webSocketMessage(ws, raw) {
    if (!this.S || typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const slot = ws.deserializeAttachment()?.slot;
    if (!slot || !this.S.players[slot]) return;
    if (m.t === 'draw') return this.relayDraw(ws, slot, m);

    const now = Date.now();
    const S = this.S;
    const me = S.players[slot];
    await this.ensureDaily(now);
    const d = S.drop;

    switch (m.t) {
      case 'hello': {
        const tz = validTz(m.tz);
        if (tz) me.tz = tz;
        S.lastSeen = now;
        if (S.players.B && !S.schedule.length) this.plan(now);
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
      case 'task': {
        const t = this.todayTask(now);
        if (t.done[slot] || !S.players.B) return;
        t.done[slot] = true;
        if (t.done.A && t.done.B) {
          S.stats.love += TASK_LOVE;
          this.bumpStreak(now);
          const dt = this.daily.task;
          this.pushHistory({ at: now, kind: 'task', title: dt.title, emoji: dt.emoji, status: 'done', summary: 'little task done together', love: TASK_LOVE, winner: null });
        } else {
          this.notify([other(slot)], { title: `${me.avatar} ${me.name} did today's little task ✅`, body: `${this.daily.task.emoji} ${this.daily.task.title}: your turn!`, tag: 'task' });
        }
        break;
      }
      case 'poke': {
        if (now - (this.lastPoke[slot] ?? 0) < 2500 || !S.players[other(slot)]) return;
        this.lastPoke[slot] = now;
        const line = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
        this.sendTo(other(slot), { t: 'poke', from: slot, line });
        this.sendTo(slot, { t: 'poked' });
        this.notify([other(slot)], { title: `${me.avatar} ${me.name} poked you 💗`, body: line, tag: 'poke' });
        return;
      }
      case 'settings': {
        const st = S.settings;
        const int = (v, lo, hi, dflt) => (Number.isInteger(+v) && +v >= lo && +v <= hi ? +v : dflt);
        const reward = String(m.reward ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
        const next = {
          perDay: int(m.perDay, 1, 10, st.perDay),
          wake: int(m.wake, 0, 23, st.wake),
          sleep: int(m.sleep, 1, 24, st.sleep),
          reward: reward || st.reward,
        };
        const replan = next.perDay !== st.perDay || next.wake !== st.wake || next.sleep !== st.sleep;
        S.settings = next;
        if (replan) { S.schedule = []; this.plan(now); }
        break;
      }
      case 'profile': {
        const name = cleanName(m.name);
        if (name) me.name = name;
        if (AVATARS.includes(m.avatar)) me.avatar = m.avatar;
        break;
      }
      case 'sub': {
        const sub = m.sub;
        if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || sub.endpoint.length > 1000) return;
        if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return;
        const known = me.subs.some((x) => x.endpoint === sub.endpoint);
        me.subs = [...me.subs.filter((x) => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }].slice(-5);
        if (!known && !m.quiet) this.notify([slot], { title: 'Buzzes are on! 🔔', body: 'You will feel it when a Drop lands 💌', tag: 'hello' });
        break;
      }
      case 'unsub':
        me.subs = me.subs.filter((x) => x.endpoint !== m.endpoint);
        break;
      case 'deleteRoom':
        return this.wipe(`${me.avatar} ${me.name} deleted the room`);
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

  // Deletes everything this room ever stored. Used by "delete our room" and by expiry.
  async wipe(reason) {
    this.sendAll({ t: 'deleted', reason });
    for (const w of this.ctx.getWebSockets()) try { w.close(4001, 'room deleted'); } catch {}
    clearTimeout(this.strokeTimer);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.S = null;
    this.strokes = [];
  }

  // ------------------------------------------------------------ daily pack + task

  async ensureDaily(now) {
    const key = dayKey(now, this.S.homeTz);
    if (this.daily?.date === key) return;
    let pack = null;
    try {
      const raw = await this.env.DAILY?.get(`day:${key}`, 'json');
      pack = raw && sanitizeDaily(raw, key);
      if (pack) pack.source = raw.source === 'fallback' ? 'fallback' : 'ai';
    } catch (e) {
      console.log('daily pack read failed', e.message);
    }
    this.daily = pack || fallbackDaily(key);
  }

  todayTask(now) {
    const day = dayKey(now, this.S.homeTz);
    if (this.S.task?.day !== day) this.S.task = { day, done: { A: false, B: false } };
    return this.S.task;
  }

  bumpStreak(now) {
    const st = this.S.stats;
    const today = dayKey(now, this.S.homeTz);
    if (st.lastDay === today) return 0;
    st.streak = st.lastDay && dayNum(today) - dayNum(st.lastDay) === 1 ? st.streak + 1 : 1;
    st.lastDay = today;
    st.best = Math.max(st.best, st.streak);
    return st.streak;
  }

  // ------------------------------------------------------------ drops

  active() {
    const st = this.S.drop?.status;
    return st === 'open' || st === 'playing';
  }

  meta(kind) {
    const G = GAMES[kind];
    if (kind === 'special') {
      const sp = (this.daily ?? fallbackDaily(dayKey(Date.now(), this.S.homeTz))).special;
      return { title: sp.title, emoji: sp.emoji, blurb: G.blurb };
    }
    return { title: G.title, emoji: G.emoji, blurb: G.blurb };
  }

  randomKind() {
    const kinds = Object.keys(GAMES).filter((k) => k !== this.S.history.at(-1)?.kind);
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  startDrop(kind, bonus, by = null) {
    const now = Date.now();
    const meta = this.meta(kind);
    this.S.drop = {
      id: crypto.randomUUID().slice(0, 8), kind, ...meta, bonus, by, status: 'open',
      opensAt: now, expiresAt: now + (bonus ? BONUS_OPEN_MS : DROP_OPEN_MS),
      ready: { A: by === 'A', B: by === 'B' }, game: null, result: null,
    };
    if (bonus) {
      const p = this.S.players[by];
      this.notify([other(by)], { title: `${p.avatar} ${p.name} wants to play ${meta.emoji} ${meta.title}!`, body: 'Bonus round! 5 minutes to jump in 💨', tag: 'drop' });
    } else {
      this.notify(SLOTS, { title: '💌 A Drop just landed!', body: `${meta.emoji} ${meta.title}: 15 minutes to play it together`, tag: 'drop' });
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
    const streak = this.bumpStreak(now);
    if (streak) res.streakUp = streak;
    d.status = 'done';
    d.result = res;
    d.game = null;
    this.pushHistory({ at: now, kind: d.kind, title: d.title, emoji: d.emoji, bonus: d.bonus, status: 'done', summary: res.summary, love: res.love, winner: res.winner });
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

  // Pick the next 24h of surprise drop times, inside hours when both players are awake.
  plan(now) {
    const { A, B } = this.S.players;
    if (!A || !B || now - this.S.lastSeen > PAUSE_AFTER_MS) { this.S.schedule = []; return; }
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
    if (Date.now() - (this.S.lastSeen ?? this.S.created) > EXPIRE_AFTER_MS) return this.wipe('room expired');
    await this.ensureDaily(Date.now());
    for (let guard = 0; guard < 25; guard++) {
      const now = Date.now();
      const d = this.S.drop;
      if (d?.status === 'open' && now >= d.expiresAt) {
        if (d.bonus) this.S.drop = null;
        else {
          d.status = 'missed';
          this.pushHistory({ at: now, kind: d.kind, title: d.title, emoji: d.emoji, bonus: false, status: 'missed' });
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
    const extras = { meld: this.daily?.meld ?? [], draw: this.daily?.draw ?? [] };
    return {
      now: Date.now(),
      rand: Math.random,
      shuffle,
      daily: this.daily,
      names: { A: this.S.players.A?.name, B: this.S.players.B?.name },
      // Picks n items, preferring today's themed extras, and avoids repeating recent ones.
      pick: (key, list, n) => {
        const recent = (this.S.recent[key] ??= []);
        const fresh = shuffle((extras[key] ?? []).filter((x) => !recent.includes(x))).slice(0, Math.ceil(n / 2));
        let pool = list.filter((x) => !recent.includes(x) && !fresh.includes(x));
        if (pool.length < n) { recent.length = 0; pool = list.filter((x) => !fresh.includes(x)); }
        const out = shuffle([...fresh, ...shuffle(pool).slice(0, n - fresh.length)]);
        recent.push(...out);
        const cap = Math.floor(list.length * 0.7);
        if (recent.length > cap) recent.splice(0, recent.length - cap);
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
    // Always keep one alarm so an abandoned room eventually cleans itself up.
    times.push((this.S.lastSeen ?? this.S.created) + EXPIRE_AFTER_MS + 60_000);
    await this.ctx.storage.setAlarm(Math.min(...times));
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

  // Everything a player's screen gets. Tokens, push endpoints, the invite of a full room,
  // the other player's game answers and the doodle word never leave the server here.
  view(slot) {
    const S = this.S;
    const now = Date.now();
    this.rollWeek(now);
    const st = S.stats;
    const today = dayKey(now, S.homeTz);
    const alive = st.lastDay && dayNum(today) - dayNum(st.lastDay) <= 1;
    const pv = (s) => {
      const p = S.players[s];
      if (!p) return null;
      const out = { name: p.name, avatar: p.avatar, tz: p.tz, online: this.online(s) };
      if (s === slot) out.push = p.subs.length > 0;
      return out;
    };
    const d = S.drop;
    const daily = this.daily ?? fallbackDaily(today);
    const task = S.task?.day === today ? S.task.done : { A: false, B: false };
    return {
      t: 'state', now, code: S.code, me: slot,
      invite: slot === 'A' && !S.players.B ? S.invite : null,
      players: { A: pv('A'), B: pv('B') },
      settings: S.settings,
      stats: { love: st.love, streak: alive ? st.streak : 0, playedToday: st.lastDay === today, best: st.best, week: st.week, lastWeek: st.lastWeek, played: st.played },
      upcoming: S.schedule.length,
      today: S.history.filter((h) => dayKey(h.at, S.homeTz) === today).reverse(),
      daily: { theme: daily.theme, task: { ...daily.task, mine: task[slot], partner: task[other(slot)] }, source: daily.source },
      drop: d && {
        id: d.id, kind: d.kind, title: d.title, emoji: d.emoji, blurb: d.blurb, bonus: d.bonus, by: d.by,
        status: d.status, expiresAt: d.expiresAt, ready: d.ready, result: d.result,
        game: d.status === 'playing' ? GAMES[d.kind].view(d.game, slot) : null,
      },
      games: Object.keys(GAMES).map((kind) => ({ kind, ...this.meta(kind) })),
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
            if (r.gone) { p.subs = p.subs.filter((x) => x.endpoint !== sub.endpoint); if (this.S) await this.save(); }
            else if (r.status >= 400) console.log('push rejected', r.status);
          })
          .catch((e) => console.log('push failed', e.message));
        this.ctx.waitUntil?.(job);
      }
    }
  }
}
