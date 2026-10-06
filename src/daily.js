// The daily pack: a theme, a little real-life task, a fresh "This or That" game and a few
// themed prompts/words mixed into the other games. The daily agent (agent/) writes one
// per day with Workers AI; this file is the safety net (seeded fallback) and the gate
// (sanitizeDaily) every pack must pass before anyone sees it.

export const THEMES = [
  ['Cozy night in', '🕯️'], ['Beach day', '🏖️'], ['Rainy afternoon', '🌧️'], ['Midnight snacks', '🍪'],
  ['Space adventure', '🚀'], ['Garden party', '🌷'], ['Road trip', '🚗'], ['Movie marathon', '🍿'],
  ['Winter wonderland', '❄️'], ['Café date', '☕'], ['Under the sea', '🐠'], ['Fairy tale', '🏰'],
  ['Summer festival', '🎆'], ['Bookworm day', '📚'], ['Picnic in the park', '🧺'], ['Retro arcade', '🕹️'],
];

export const THIS_OR_THAT = [
  ['Sunrise', 'Sunset'], ['Coffee', 'Tea'], ['Beach', 'Mountains'], ['Cats', 'Dogs'], ['Pizza', 'Tacos'],
  ['Morning person', 'Night owl'], ['Movie night', 'Game night'], ['Texting', 'Calling'], ['Sweet', 'Salty'],
  ['Summer', 'Winter'], ['Books', 'Movies'], ['Road trip', 'Flight'], ['Pancakes', 'Waffles'],
  ['Big party', 'Cozy dinner'], ['Rain', 'Snow'], ['Cake', 'Ice cream'], ['Netflix', 'YouTube'],
  ['Hugs', 'Kisses'], ['Stars', 'Fireworks'], ['City', 'Countryside'], ['Cook together', 'Order in'],
  ['Hoodie', 'Sweater'], ['Spicy', 'Mild'], ['Sneakers', 'Sandals'], ['Museum', 'Theme park'],
  ['Window seat', 'Aisle seat'], ['Breakfast in bed', 'Brunch out'], ['Plan everything', 'Go with the flow'],
  ['Dance', 'Sing'], ['Chocolate', 'Vanilla'], ['Camping', 'Hotel'], ['Pool', 'Ocean'],
  ['Love letters', 'Voice notes'], ['Matching outfits', 'Never'], ['Little spoon', 'Big spoon'],
  ['Fries', 'Onion rings'], ['Horror movie', 'Rom-com'], ['Early check-in', 'Late checkout'],
  ['Puzzle', 'Board game'], ['Candles', 'Fairy lights'], ['Sushi', 'Ramen'], ['Bubble tea', 'Smoothie'],
];

export const TASKS = [
  ['📸', 'Sky swap', 'Send each other a photo of your sky right now. No filters!'],
  ['🎵', 'Song of the day', 'Send one song that reminds you of them, with one line about why.'],
  ['🎙️', 'Voice hug', 'Send a 10 second voice note that ends with "I miss you".'],
  ['✍️', 'Three tiny things', 'Text three tiny things you loved about them this week.'],
  ['🍽️', 'Dinner reveal', 'Take a picture of what you are eating today and rate it out of 10.'],
  ['🌙', 'Goodnight ritual', 'Tonight, say goodnight with one thing you are looking forward to together.'],
  ['🧸', 'Show and tell', 'Show them one object on your desk and tell its story.'],
  ['🗺️', 'Dream date', 'Describe your dream date in exactly five words.'],
  ['😂', 'Meme drop', 'Send the meme that best describes your day.'],
  ['🎨', 'Doodle note', 'Draw them a tiny doodle on paper and send a photo of it.'],
  ['🔮', 'Future us', 'Text one thing you want to do together within the next year.'],
  ['📖', 'Throwback', 'Send a photo of you two from the past and say what you remember.'],
  ['🌸', 'Compliment battle', 'Trade compliments until someone gives up. Loser plans the next call.'],
  ['☀️', 'Morning hello', 'Send a sleepy morning selfie (bedhead encouraged).'],
  ['🎬', 'Movie pick', 'Each pick a movie to watch "together" this week. Swap picks.'],
  ['🧩', 'Tiny quiz', 'Ask them one question you have never asked before.'],
  ['🌍', 'Window view', 'Send a photo of the view from your window and guess their weather.'],
  ['💌', 'Secret note', 'Write a two sentence love note and send it as a screenshot.'],
];

const FALLBACK_MELD = [
  'Something you pack for a trip', 'A word for this season', 'A snack for a movie night',
  'Something cute and tiny', 'A place to watch the stars', 'Something that makes you smile',
];
const FALLBACK_DRAW = ['teapot', 'rainbow', 'lantern', 'snail', 'kite', 'cupcake', 'moon', 'cactus'];

// Small deterministic PRNG so every room sees the same fallback pack on the same day.
function seeded(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const takeSeeded = (rand, list, n) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

export const utcDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

export function fallbackDaily(date) {
  const r = seeded(`duo-${date}`);
  const [name, emoji] = THEMES[Math.floor(r() * THEMES.length)];
  const [tEmoji, tTitle, tBody] = TASKS[Math.floor(r() * TASKS.length)];
  return {
    date, source: 'fallback',
    theme: { name, emoji },
    task: { emoji: tEmoji, title: tTitle, body: tBody },
    special: { title: 'This or That', emoji: '⚖️', pairs: takeSeeded(r, THIS_OR_THAT, 6) },
    meld: takeSeeded(r, FALLBACK_MELD, 3),
    draw: takeSeeded(r, FALLBACK_DRAW, 3),
  };
}

// Models like to wrap JSON in prose or ``` fences. Pull out the first balanced object.
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// ---------------------------------------------------------------- validation

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const BAD = /\b(sex|sexy|nude|naked|kill|die|death|suicide|drug|drunk|weed|gun|hate|stupid|ugly|fat)\b/i;
const ok = (s) => s && !BAD.test(s) && !/https?:|www\./i.test(s);

function emojiOf(v, fallback) {
  const s = String(v ?? '').trim();
  const seg = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(s)][0]?.segment : [...s][0];
  return seg && /\p{Extended_Pictographic}/u.test(seg) && seg.length <= 12 ? seg : fallback;
}

// Returns a safe pack, or null when the input is not usable.
export function sanitizeDaily(raw, date) {
  if (!raw || typeof raw !== 'object') return null;
  const themeName = clean(raw.theme?.name ?? raw.theme, 32);
  const task = {
    emoji: emojiOf(raw.task?.emoji, '💌'),
    title: clean(raw.task?.title, 32),
    body: clean(raw.task?.body, 150),
  };
  const pairs = (Array.isArray(raw.special?.pairs) ? raw.special.pairs : [])
    .filter((p) => Array.isArray(p) && p.length === 2)
    .map(([a, b]) => [clean(a, 24), clean(b, 24)])
    .filter(([a, b]) => ok(a) && ok(b) && a.toLowerCase() !== b.toLowerCase())
    .slice(0, 6);
  const meld = (Array.isArray(raw.meld) ? raw.meld : []).map((p) => clean(p, 48)).filter((p) => ok(p) && p.length >= 4).slice(0, 5);
  const draw = (Array.isArray(raw.draw) ? raw.draw : []).map((w) => clean(w, 20).toLowerCase())
    .filter((w) => /^[a-z]+( [a-z]+)?$/.test(w) && ok(w)).slice(0, 5);

  if (!ok(themeName) || !ok(task.title) || !ok(task.body) || task.body.length < 12 || pairs.length < 5) return null;
  return {
    date, source: 'ai',
    theme: { name: themeName, emoji: emojiOf(raw.theme?.emoji, '✨') },
    task,
    special: {
      title: ok(clean(raw.special?.title, 32)) ? clean(raw.special.title, 32) : `${themeName}: This or That`,
      emoji: emojiOf(raw.special?.emoji, '⚖️'),
      pairs,
    },
    meld, draw,
  };
}
