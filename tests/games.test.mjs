import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, same, norm } from '../src/games.js';

function fakeApi(start = 1_000_000) {
  const sent = [];
  const api = {
    now: start, rand: Math.random, names: { A: 'Sush', B: 'Bunny' }, sent, cleared: 0,
    shuffle: (a) => a.sort(() => Math.random() - 0.5),
    pick: (k, list, n) => list.slice(0, n),
    sendTo: (slot, m) => sent.push([slot, m]),
    clearStrokes: () => { api.cleared++; },
  };
  return api;
}
// Advance the clock to the game's deadline and fire its timer.
const tickNow = (G, g, api) => { api.now = Math.max(api.now, g.deadline); G.tick(g, api); };

test('answer matching is forgiving', () => {
  assert.ok(same('Pizza', 'pizza!'));
  assert.ok(same('The Cats', 'cat'));
  assert.ok(same('seven', '7'));
  assert.ok(same('strawbery', 'strawberry'));
  assert.ok(same('Strawberries', 'strawberry'));
  assert.ok(same('cherries', 'cherry'));
  assert.ok(same('peaches', 'peach'));
  assert.ok(!same('cat', 'car'));
  assert.ok(!same('', ''));
  assert.equal(norm('Ice Cream'), 'icecream');
});

test('mind meld: matches score, game ends after 5 rounds', () => {
  const G = GAMES.meld, api = fakeApi();
  const g = G.init(api);
  for (let r = 0; r < 5; r++) {
    G.act(g, 'A', { a: 'answer', text: 'Sushi' }, api);
    assert.equal(G.view(g, 'B').partnerIn, true);
    assert.equal(G.view(g, 'B').reveal, null, 'no peeking before both answer');
    G.act(g, 'B', { a: 'answer', text: r < 3 ? 'sushi' : 'tacos' }, api);
    assert.equal(g.phase, 'reveal');
    tickNow(G, g, api);
  }
  assert.ok(g.over);
  assert.equal(g.result.love, 10 + 3 * 20);
  assert.match(g.result.summary, /3\/5/);
});

test('mind meld: timeout reveals with missing answer', () => {
  const G = GAMES.meld, api = fakeApi();
  const g = G.init(api);
  G.act(g, 'A', { a: 'answer', text: 'x' }, api);
  tickNow(G, g, api);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.log[0].B, null);
  assert.equal(g.log[0].match, false);
});

test('speed duel: first right answer wins, wrong answer locks out', () => {
  const G = GAMES.duel, api = fakeApi();
  const g = G.init(api);
  g.rounds = [{ kind: 'math', prompt: '', q: '2 + 2', answer: 4, show: '4' }, { kind: 'react', prompt: '', delay: 2000, answer: null, show: '' }];
  api.now = g.startAt;
  G.act(g, 'A', { a: 'answer', v: '5' }, api);
  assert.deepEqual(api.sent.at(-1), ['A', { t: 'nope' }]);
  G.act(g, 'A', { a: 'answer', v: '4' }, api);
  assert.equal(g.phase, 'play', 'locked out right after a wrong answer');
  G.act(g, 'B', { a: 'answer', v: '4' }, api);
  assert.equal(g.phase, 'between');
  assert.equal(g.wins.B, 1);
  assert.equal(G.view(g, 'A').round.answer, undefined, 'answers never leak into the view');

  tickNow(G, g, api); // next round: reaction
  api.now = g.startAt + 3000;
  G.act(g, 'A', { a: 'react', ms: -1 }, api);   // false start
  G.act(g, 'B', { a: 'react', ms: 310 }, api);
  assert.equal(g.log.at(-1).winner, 'B');
  tickNow(G, g, api);
  assert.ok(g.over);
  assert.equal(g.result.winner, 'B');
  assert.deepEqual(g.result.duel, { A: 0, B: 4 });
});

test('speed duel: every round kind builds a solvable puzzle', () => {
  const api = fakeApi();
  for (let i = 0; i < 30; i++) {
    const g = GAMES.duel.init(api);
    for (const r of g.rounds) {
      if (r.kind === 'scramble') assert.equal([...r.letters].sort().join(''), [...r.answer].sort().join(''));
      if (r.kind === 'count') { assert.equal(r.grid.length, 25); assert.equal(r.grid.filter((e) => e === r.grid[r.grid.indexOf(r.prompt.split(' ').at(-1).replace('?', ''))]).length, r.answer); }
      if (r.kind === 'odd') assert.equal(r.grid.filter((e) => e === r.show).length, 1);
      if (r.kind === 'math') assert.ok(r.answer > 0);
    }
  }
});

test('doodle guess: drawer picks, guesser solves, roles swap', () => {
  const G = GAMES.draw, api = fakeApi();
  const g = G.init(api);
  const drawer = g.drawer, guesser = drawer === 'A' ? 'B' : 'A';
  assert.equal(G.view(g, guesser).options, null, 'guesser cannot see the options');
  G.act(g, drawer, { a: 'pick', i: 1 }, api);
  assert.equal(g.phase, 'draw');
  assert.equal(api.cleared, 1);
  assert.equal(G.view(g, guesser).word, null);
  assert.ok(G.view(g, guesser).mask.every((c) => c === '_' || c === ' '));
  tickNow(G, g, api); // hint
  assert.equal(g.revealed.length, 1);
  G.act(g, guesser, { a: 'guess', text: 'nope' }, api);
  G.act(g, guesser, { a: 'guess', text: g.word.toUpperCase() }, api);
  assert.equal(g.phase, 'reveal');
  assert.ok(g.log[0].solved && g.log[0].points > 20);
  tickNow(G, g, api);
  assert.equal(g.drawer, guesser);
  tickNow(G, g, api);   // choose times out -> auto pick
  assert.equal(g.phase, 'draw');
  api.now = g.endAt;
  G.tick(g, api);       // time is up
  assert.equal(g.log[1].solved, false);
  tickNow(G, g, api);
  assert.ok(g.over);
  assert.match(g.result.summary, /1\/2/);
});
