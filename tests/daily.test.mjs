import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackDaily, sanitizeDaily, extractJson } from '../src/daily.js';
import { makePack } from '../agent/src/index.js';
import { GAMES } from '../src/games.js';

const good = {
  theme: { name: 'Cozy autumn', emoji: '🍂' },
  task: { emoji: '📸', title: 'Leaf hunt', body: 'Send each other a photo of the prettiest leaf you can find.' },
  special: { title: 'Autumn picks', emoji: '🎃', pairs: [['Pumpkin pie', 'Apple pie'], ['Hoodie', 'Scarf'], ['Rain', 'Wind'], ['Cider', 'Cocoa'], ['Hayride', 'Corn maze'], ['Candles', 'Fireplace']] },
  meld: ['A cozy drink', 'Something orange', 'A fall smell'],
  draw: ['pumpkin', 'leaf', 'acorn', 'scarecrow', 'hot cocoa'],
};

test('fallback packs are deterministic, varied and pass the gate', () => {
  assert.deepEqual(fallbackDaily('2026-10-06'), fallbackDaily('2026-10-06'));
  const themes = new Set(Array.from({ length: 30 }, (_, i) => fallbackDaily(`2026-11-${String(i + 1).padStart(2, '0')}`).theme.name));
  assert.ok(themes.size > 6, 'themes vary day to day');
  for (let i = 1; i <= 28; i++) assert.ok(sanitizeDaily(fallbackDaily(`2026-02-${String(i).padStart(2, '0')}`), 'x'));
});

test('extractJson digs JSON out of chatty model output', () => {
  assert.deepEqual(extractJson('Sure! ```json\n{"a": {"b": "x}y"}}\n``` hope that helps'), { a: { b: 'x}y' } });
  assert.deepEqual(extractJson('{"q": "say \\"hi\\" {"}'), { q: 'say "hi" {' });
  assert.equal(extractJson('no json here'), null);
  assert.deepEqual(extractJson({ already: true }), { already: true });
});

test('sanitizeDaily keeps good packs and cleans them up', () => {
  const p = sanitizeDaily({ ...good, draw: [...good.draw, 'Ice-Cream!!'], meld: [...good.meld, 'visit www.spam.com'] }, '2026-10-06');
  assert.equal(p.source, 'ai');
  assert.equal(p.special.pairs.length, 6);
  assert.ok(!p.meld.some((m) => m.includes('www')), 'links are dropped');
  assert.ok(p.draw.every((w) => /^[a-z ]+$/.test(w)));
});

test('sanitizeDaily rejects unusable or unsafe packs', () => {
  assert.equal(sanitizeDaily(null, 'd'), null);
  assert.equal(sanitizeDaily({ ...good, special: { pairs: good.special.pairs.slice(0, 2) } }, 'd'), null, 'too few pairs');
  assert.equal(sanitizeDaily({ ...good, task: { ...good.task, body: 'Take a shot of vodka and get drunk' } }, 'd'), null);
  const sneaky = sanitizeDaily({ ...good, theme: { name: '<img src=x onerror=alert(1)>', emoji: 'not an emoji' } }, 'd');
  assert.ok(!sneaky || !/[<>]/.test(sneaky.theme.name));
});

test('agent: first model fails, second works', async () => {
  const calls = [];
  const env = {
    DAILY: { get: async () => null },
    AI: { run: async (model) => { calls.push(model); return { response: calls.length === 1 ? 'oops, no json' : `Here you go: ${JSON.stringify(good)}` }; } },
  };
  const { pack, errors } = await makePack(env, '2026-10-06');
  assert.equal(calls.length, 2);
  assert.equal(pack.source, 'ai');
  assert.equal(pack.theme.name, 'Cozy autumn');
  assert.equal(errors.length, 1);
});

test('agent: AI down entirely falls back to the built-in pack', async () => {
  const env = { DAILY: { get: async () => null }, AI: { run: async () => { throw new Error('quota'); } } };
  const { pack, errors } = await makePack(env, '2026-10-06');
  assert.equal(pack.source, 'fallback');
  assert.equal(errors.length, 2);
});

test("today's special: same picks score, roles symmetric", () => {
  const G = GAMES.special;
  const api = { now: 0, daily: { special: good.special } };
  const g = G.init(api);
  assert.equal(G.view(g, 'A').title, 'Autumn picks');
  for (let r = 0; r < 6; r++) {
    G.act(g, 'A', { a: 'pick', i: 0 }, api);
    assert.equal(G.view(g, 'B').reveal, null, 'no peeking');
    G.act(g, 'B', { a: 'pick', i: r < 4 ? 0 : 1 }, api);
    G.act(g, 'B', { a: 'pick', i: 1 }, api); // second pick ignored
    assert.equal(g.phase, 'reveal');
    api.now = g.deadline;
    G.tick(g, api);
  }
  assert.ok(g.over);
  assert.match(g.result.summary, /^4\/6/);
  assert.equal(g.result.love, 10 + 4 * 12);
});
