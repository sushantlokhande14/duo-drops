// Server-authoritative game rules. Each game keeps a plain JSON state `g` that is
// persisted with the room, so a Durable Object restart never loses a game.
//
// A game exposes:
//   init(api)              -> g
//   act(g, slot, msg, api) -> mutate g on a player action
//   tick(g, api)           -> called when api.now >= g.deadline
//   view(g, slot)          -> what that player is allowed to see
// It sets g.over = true and g.result = { love, duel: {A, B}, winner, summary, highlights } when done.

import { MELD_PROMPTS, SCRAMBLE_WORDS, DRAW_WORDS, COUNT_EMOJI, ODD_PAIRS } from './content.js';

export const other = (s) => (s === 'A' ? 'B' : 'A');

const NUMBER_WORDS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

export function norm(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' ');
  t = t.replace(/^(the|a|an|my|our) /, '');
  if (NUMBER_WORDS[t]) t = NUMBER_WORDS[t];
  if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t.replace(/ /g, '');
}

function lev(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Loose match: same word after normalizing, or a one-letter typo on longer words.
export function same(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 5 && lev(x, y) <= 1;
}

// ---------------------------------------------------------------- Mind Meld

const MELD_ROUNDS = 5, MELD_ANSWER_MS = 25_000, MELD_REVEAL_MS = 5_000;

const meld = {
  title: 'Mind Meld',
  emoji: '🔮',
  blurb: 'Same prompt, two brains. Type the first thing that pops into your head and score when you match!',
  init(api) {
    return {
      round: 0, phase: 'answer', prompts: api.pick('meld', MELD_PROMPTS, MELD_ROUNDS),
      answers: { A: null, B: null }, deadline: api.now + MELD_ANSWER_MS, log: [],
    };
  },
  act(g, slot, m, api) {
    if (m.a !== 'answer' || g.phase !== 'answer' || g.answers[slot] != null) return;
    const text = String(m.text ?? '').trim().slice(0, 40);
    if (!text) return;
    g.answers[slot] = text;
    if (g.answers.A != null && g.answers.B != null) meldReveal(g, api);
  },
  tick(g, api) {
    if (g.phase === 'answer') meldReveal(g, api);
    else meldNext(g, api);
  },
  view(g, slot) {
    return {
      round: g.round, rounds: MELD_ROUNDS, phase: g.phase, prompt: g.prompts[g.round], deadline: g.deadline,
      mine: g.answers[slot], partnerIn: g.answers[other(slot)] != null,
      reveal: g.phase === 'reveal' ? g.log[g.log.length - 1] : null,
      melds: g.log.filter((l) => l.match).length,
    };
  },
};

function meldReveal(g, api) {
  g.log.push({ prompt: g.prompts[g.round], A: g.answers.A, B: g.answers.B, match: same(g.answers.A, g.answers.B) });
  g.phase = 'reveal';
  g.deadline = api.now + MELD_REVEAL_MS;
}

function meldNext(g, api) {
  g.round++;
  if (g.round >= MELD_ROUNDS) {
    const melds = g.log.filter((l) => l.match).length;
    g.over = true;
    g.deadline = null;
    g.result = {
      love: 10 + melds * 20, duel: { A: 0, B: 0 }, winner: null,
      summary: `${melds}/${MELD_ROUNDS} mind melds${melds >= 3 ? ', totally in sync 💞' : ''}`,
      highlights: g.log,
    };
    return;
  }
  g.phase = 'answer';
  g.answers = { A: null, B: null };
  g.deadline = api.now + MELD_ANSWER_MS;
}

// ---------------------------------------------------------------- Speed Duel

const DUEL_KINDS = ['scramble', 'math', 'count', 'odd', 'react'];
const DUEL_READY_MS = 2_500, DUEL_PLAY_MS = 20_000, DUEL_GAP_MS = 3_500, DUEL_LOCK_MS = 1_200;

function duelRound(kind, api) {
  const r = (a, b) => a + Math.floor(api.rand() * (b - a + 1));
  if (kind === 'scramble') {
    const word = api.pick('scramble', SCRAMBLE_WORDS, 1)[0];
    let letters = word.split('');
    for (let i = 0; i < 10 && letters.join('') === word; i++) letters = api.shuffle(letters);
    return { kind, prompt: 'Unscramble me! 🔤', letters, answer: word, show: word.toUpperCase() };
  }
  if (kind === 'math') {
    const op = ['+', '−', '×'][r(0, 2)];
    let a, b, answer;
    if (op === '+') { a = r(12, 89); b = r(12, 89); answer = a + b; }
    else if (op === '−') { a = r(30, 99); b = r(11, a - 5); answer = a - b; }
    else { a = r(3, 12); b = r(3, 12); answer = a * b; }
    return { kind, prompt: 'Quick maths! 🧮', q: `${a} ${op} ${b}`, answer, show: String(answer) };
  }
  if (kind === 'count') {
    const [target, ...rest] = api.shuffle([...COUNT_EMOJI]);
    const n = r(5, 11);
    const fillers = rest.slice(0, 3);
    const grid = api.shuffle([...Array(n).fill(target), ...Array.from({ length: 25 - n }, (_, i) => fillers[i % 3])]);
    return { kind, prompt: `How many ${target}?`, grid, answer: n, show: `${n} × ${target}` };
  }
  if (kind === 'odd') {
    const [base, odd] = ODD_PAIRS[r(0, ODD_PAIRS.length - 1)];
    const idx = r(0, 29);
    const grid = Array.from({ length: 30 }, (_, i) => (i === idx ? odd : base));
    return { kind, prompt: 'Find the odd one out! 🔍', grid, answer: idx, show: odd };
  }
  return { kind: 'react', prompt: 'Tap the moment the heart appears! 💗', delay: r(1500, 4500), answer: null, show: '' };
}

const duel = {
  title: 'Speed Duel',
  emoji: '⚡',
  blurb: 'Five tiny races: unscramble, count, spot, tap. First right answer takes the round!',
  init(api) {
    const g = {
      i: 0, rounds: api.shuffle([...DUEL_KINDS]).map((k) => duelRound(k, api)),
      wins: { A: 0, B: 0 }, phase: 'play', startAt: 0, deadline: 0,
      lock: { A: 0, B: 0 }, react: { A: null, B: null }, log: [],
    };
    duelStart(g, api);
    return g;
  },
  act(g, slot, m, api) {
    if (g.phase !== 'play' || api.now < g.startAt - 300) return;
    const r = g.rounds[g.i];
    if (r.kind === 'react') {
      if (m.a !== 'react' || g.react[slot] != null) return;
      const ms = Number(m.ms);
      g.react[slot] = Number.isFinite(ms) && ms >= 80 ? Math.round(ms) : -1; // under 80ms is a guess
      if (g.react.A != null && g.react.B != null) duelResolveReact(g, api);
      return;
    }
    if (m.a !== 'answer' || api.now < g.lock[slot]) return;
    const ok = r.kind === 'scramble' ? norm(m.v) === norm(r.answer) : Number(m.v) === r.answer && String(m.v).trim() !== '';
    if (ok) duelEnd(g, slot, api);
    else {
      g.lock[slot] = api.now + DUEL_LOCK_MS;
      api.sendTo(slot, { t: 'nope' });
    }
  },
  tick(g, api) {
    if (g.phase === 'play') {
      if (g.rounds[g.i].kind === 'react') duelResolveReact(g, api);
      else duelEnd(g, null, api);
      return;
    }
    g.i++;
    if (g.i < g.rounds.length) return duelStart(g, api);
    const { A, B } = g.wins;
    const winner = A > B ? 'A' : B > A ? 'B' : null;
    g.over = true;
    g.deadline = null;
    g.result = {
      love: 20 + 4 * (A + B), winner,
      duel: { A: A + (winner === 'A' ? 2 : 0), B: B + (winner === 'B' ? 2 : 0) },
      summary: winner ? `${api.names[winner]} wins ${Math.max(A, B)} to ${Math.min(A, B)}` : `a ${A}–${B} tie, how romantic`,
      highlights: g.log,
    };
  },
  view(g, slot) {
    const r = g.rounds[g.i];
    return {
      i: g.i, n: g.rounds.length, phase: g.phase, startAt: g.startAt, deadline: g.deadline, wins: g.wins,
      round: { kind: r.kind, prompt: r.prompt, q: r.q, letters: r.letters, grid: r.grid, delay: r.delay },
      lockUntil: g.lock[slot], myReact: g.react[slot],
      last: g.phase === 'between' ? g.log[g.log.length - 1] : null,
    };
  },
};

function duelStart(g, api) {
  const r = g.rounds[g.i];
  g.phase = 'play';
  g.startAt = api.now + DUEL_READY_MS;
  g.deadline = g.startAt + (r.kind === 'react' ? r.delay + 6_000 : DUEL_PLAY_MS);
  g.lock = { A: 0, B: 0 };
  g.react = { A: null, B: null };
}

function duelResolveReact(g, api) {
  const valid = ['A', 'B'].filter((s) => g.react[s] > 0);
  const winner = valid.length === 2 ? (g.react.A <= g.react.B ? 'A' : 'B') : valid[0] ?? null;
  duelEnd(g, winner, api);
}

function duelEnd(g, winner, api) {
  const r = g.rounds[g.i];
  if (winner) g.wins[winner]++;
  g.log.push({ kind: r.kind, winner, show: r.show, q: r.q ?? null, react: r.kind === 'react' ? { ...g.react } : null });
  g.phase = 'between';
  g.deadline = api.now + DUEL_GAP_MS;
}

// ---------------------------------------------------------------- Doodle Guess

const DRAW_TURNS = 2, CHOOSE_MS = 15_000, DRAW_MS = 80_000, DRAW_REVEAL_MS = 5_000;

const draw = {
  title: 'Doodle Guess',
  emoji: '🎨',
  blurb: 'One of you doodles, the other guesses, then swap! Faster guesses earn more love points.',
  init(api) {
    const g = { turn: 0, drawer: api.rand() < 0.5 ? 'A' : 'B', log: [] };
    drawChoose(g, api);
    return g;
  },
  act(g, slot, m, api) {
    if (m.a === 'pick' && g.phase === 'choose' && slot === g.drawer) {
      const i = Number(m.i);
      if (i >= 0 && i < g.options.length) drawBegin(g, i, api);
    } else if (m.a === 'guess' && g.phase === 'draw' && slot !== g.drawer) {
      const text = String(m.text ?? '').trim().slice(0, 30);
      if (!text) return;
      const ok = same(text, g.word);
      g.guesses = [...g.guesses, { text, ok }].slice(-6);
      if (ok) drawReveal(g, true, api);
    } else if (m.a === 'giveup' && g.phase === 'draw' && slot === g.drawer) {
      drawReveal(g, false, api);
    }
  },
  tick(g, api) {
    if (g.phase === 'choose') return drawBegin(g, 0, api);
    if (g.phase === 'draw') {
      if (api.now >= g.endAt) return drawReveal(g, false, api);
      // Hint time: reveal one more letter.
      const hidden = [...g.word].map((c, i) => i).filter((i) => g.word[i] !== ' ' && !g.revealed.includes(i));
      if (hidden.length > 1) g.revealed.push(hidden[Math.floor(api.rand() * hidden.length)]);
      const maxHints = Math.floor(g.word.replace(/ /g, '').length / 3);
      g.hintAt = g.revealed.length < maxHints ? api.now + DRAW_MS * 0.2 : null;
      g.deadline = g.hintAt ? Math.min(g.hintAt, g.endAt) : g.endAt;
      return;
    }
    g.turn++;
    if (g.turn < DRAW_TURNS) {
      g.drawer = other(g.drawer);
      return drawChoose(g, api);
    }
    const solved = g.log.filter((l) => l.solved).length;
    g.over = true;
    g.deadline = null;
    g.result = {
      love: 10 + g.log.reduce((n, l) => n + l.points, 0), duel: { A: 0, B: 0 }, winner: null,
      summary: `${solved}/${DRAW_TURNS} doodles guessed${solved === DRAW_TURNS ? ', art geniuses 🖼️' : ''}`,
      highlights: g.log,
    };
  },
  view(g, slot) {
    const isDrawer = slot === g.drawer;
    return {
      turn: g.turn, turns: DRAW_TURNS, drawer: g.drawer, phase: g.phase, deadline: g.deadline, endAt: g.endAt,
      options: isDrawer && g.phase === 'choose' ? g.options : null,
      word: isDrawer || g.phase === 'reveal' ? g.word : null,
      mask: g.phase === 'draw' ? [...g.word].map((c, i) => (c === ' ' ? ' ' : g.revealed.includes(i) ? c : '_')) : null,
      guesses: g.guesses,
      last: g.phase === 'reveal' ? g.log[g.log.length - 1] : null,
    };
  },
};

function drawChoose(g, api) {
  Object.assign(g, {
    phase: 'choose', options: api.pick('draw', DRAW_WORDS, 3), word: null, guesses: [], revealed: [],
    startAt: null, endAt: null, hintAt: null, deadline: api.now + CHOOSE_MS,
  });
}

function drawBegin(g, i, api) {
  g.word = g.options[i];
  g.phase = 'draw';
  g.startAt = api.now;
  g.endAt = api.now + DRAW_MS;
  g.hintAt = api.now + DRAW_MS * 0.45;
  g.deadline = g.hintAt;
  api.clearStrokes();
}

function drawReveal(g, solved, api) {
  const left = Math.max(0, g.endAt - api.now);
  const points = solved ? 20 + Math.round((40 * left) / DRAW_MS) : 0;
  g.log.push({ drawer: g.drawer, word: g.word, solved, secs: Math.round((api.now - g.startAt) / 1000), points });
  g.phase = 'reveal';
  g.deadline = api.now + DRAW_REVEAL_MS;
}

// ---------------------------------------------------------------- Today's Special (This or That)
// The pairs come from the daily pack the agent writes, so this game is new every day.

const PICK_MS = 15_000, PICK_REVEAL_MS = 4_000;

const special = {
  title: "Today's Special",
  emoji: '✨',
  blurb: 'A brand new This or That, made fresh today. Pick the same side to win love points!',
  init(api) {
    const sp = api.daily.special;
    return {
      title: sp.title, emoji: sp.emoji, pairs: sp.pairs.slice(0, 6), round: 0, phase: 'pick',
      picks: { A: null, B: null }, deadline: api.now + PICK_MS, log: [],
    };
  },
  act(g, slot, m, api) {
    const i = Number(m.i);
    if (m.a !== 'pick' || g.phase !== 'pick' || g.picks[slot] != null || (i !== 0 && i !== 1)) return;
    g.picks[slot] = i;
    if (g.picks.A != null && g.picks.B != null) specialReveal(g, api);
  },
  tick(g, api) {
    if (g.phase === 'pick') return specialReveal(g, api);
    g.round++;
    if (g.round < g.pairs.length) {
      g.phase = 'pick';
      g.picks = { A: null, B: null };
      g.deadline = api.now + PICK_MS;
      return;
    }
    const same = g.log.filter((l) => l.match).length;
    g.over = true;
    g.deadline = null;
    g.result = {
      love: 10 + same * 12, duel: { A: 0, B: 0 }, winner: null,
      summary: `${same}/${g.pairs.length} same picks${same >= g.pairs.length - 1 ? ', soulmates 💞' : same <= 1 ? ', opposites attract 🧲' : ''}`,
      highlights: g.log,
    };
  },
  view(g, slot) {
    return {
      title: g.title, emoji: g.emoji, round: g.round, rounds: g.pairs.length, pair: g.pairs[g.round],
      phase: g.phase, deadline: g.deadline, mine: g.picks[slot], partnerIn: g.picks[other(slot)] != null,
      reveal: g.phase === 'reveal' ? g.log[g.log.length - 1] : null, same: g.log.filter((l) => l.match).length,
    };
  },
};

function specialReveal(g, api) {
  const { A, B } = g.picks;
  g.log.push({ pair: g.pairs[g.round], A, B, match: A != null && A === B });
  g.phase = 'reveal';
  g.deadline = api.now + PICK_REVEAL_MS;
}

export const GAMES = { meld, duel, draw, special };
