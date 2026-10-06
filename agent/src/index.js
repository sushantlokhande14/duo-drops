// Duo Drops daily agent.
//
// Twice a day (cron) it makes sure today's and tomorrow's packs exist (UTC dates, so every
// time zone is covered). For each missing day it:
//   1. reads the last week of themes so it doesn't repeat itself,
//   2. asks Workers AI for a new pack (theme, little task, This-or-That pairs, prompts, words),
//   3. runs it through the same sanitizeDaily() gate the app uses,
//   4. retries with a second model, and falls back to the seeded built-in pack if both fail,
//   5. stores it in KV for 5 days.
// Free: Workers AI's daily free allocation covers this many times over.

import { sanitizeDaily, fallbackDaily, extractJson, utcDay } from '../../src/daily.js';

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];
const TTL = 5 * 86400;

const SYSTEM = `You design one day of content for "Duo Drops", a cute app where two people who live far apart
(couples or best friends) play tiny live games on their phones. Everything must be wholesome, kind, playful,
PG and inclusive. No alcohol, no romance-explicit content, nothing that needs money, travel or meeting in person.
Reply with ONLY a JSON object, no prose.`;

function userPrompt(date, recentThemes) {
  return `Date: ${date}.
Avoid these recent themes: ${recentThemes.length ? recentThemes.join(', ') : 'none'}.

Return JSON with exactly this shape:
{
  "theme": { "name": "2-4 word theme for today", "emoji": "one emoji" },
  "task": {
    "emoji": "one emoji",
    "title": "2-4 word name",
    "body": "One sentence. A small, sweet thing both people can do from far apart today in under 5 minutes with their phones, like sending a photo, a voice note or a short text."
  },
  "special": {
    "title": "short fun name for today's This-or-That game, tied to the theme",
    "emoji": "one emoji",
    "pairs": [["option A", "option B"], ... exactly 6 pairs, each option 1-3 words, themed, fun to disagree on]
  },
  "meld": ["5 short category prompts tied to the theme where two people might think of the same answer, like 'A cozy drink' or 'Something you find at a fair'"],
  "draw": ["5 simple, easy to doodle nouns tied to the theme, 1-2 lowercase words, letters only"]
}`;
}

async function askModel(env, model, date, recentThemes) {
  const out = await env.AI.run(model, {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(date, recentThemes) }],
    max_tokens: 900,
    temperature: 0.9,
  });
  return sanitizeDaily(extractJson(out?.response ?? out), date);
}

// Themes from the week around this date, including the pack being replaced on a forced
// re-run, so a "fresh" pack is actually fresh.
async function recentThemes(env, date) {
  const base = Date.parse(`${date}T00:00:00Z`);
  const keys = [];
  for (let i = -2; i <= 7; i++) keys.push(`day:${utcDay(base - i * 864e5)}`);
  const packs = await Promise.all(keys.map((k) => env.DAILY.get(k, 'json')));
  return [...new Set(packs.map((p) => p?.theme?.name).filter(Boolean))];
}

export async function makePack(env, date) {
  const recent = await recentThemes(env, date);
  const errors = [];
  for (const model of MODELS) {
    try {
      const pack = await askModel(env, model, date, recent);
      if (pack && !recent.some((r) => r.toLowerCase() === pack.theme.name.toLowerCase())) return { pack: { ...pack, model }, errors };
      errors.push(`${model}: output did not pass the checks`);
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  return { pack: fallbackDaily(date), errors };
}

async function ensureDay(env, date, force = false) {
  if (!force && (await env.DAILY.get(`day:${date}`))) return { date, status: 'exists' };
  const { pack, errors } = await makePack(env, date);
  await env.DAILY.put(`day:${date}`, JSON.stringify(pack), { expirationTtl: TTL });
  return { date, status: 'made', source: pack.source, model: pack.model ?? null, theme: pack.theme.name, errors };
}

async function run(env) {
  const now = Date.now();
  const results = [];
  for (const date of [utcDay(now), utcDay(now + 864e5)]) results.push(await ensureDay(env, date));
  await env.DAILY.put('agent:lastRun', JSON.stringify({ at: new Date(now).toISOString(), results }));
  console.log('daily agent run', JSON.stringify(results));
  return results;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // GET: read-only peek at what the agent made.
  // POST /run (owner only, needs the ADMIN_TOKEN secret): make a fresh pack right now,
  // replacing the existing one. Body: {"dates": ["YYYY-MM-DD", ...]} (default: UTC today).
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/run') {
      const auth = req.headers.get('Authorization') ?? '';
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return Response.json({ error: 'not allowed' }, { status: 403 });
      const body = await req.json().catch(() => ({}));
      const dates = (Array.isArray(body.dates) ? body.dates : [utcDay()]).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 3);
      const results = [];
      for (const date of dates) results.push(await ensureDay(env, date, true));
      return Response.json({ results });
    }
    const today = utcDay();
    const [pack, lastRun] = await Promise.all([env.DAILY.get(`day:${today}`, 'json'), env.DAILY.get('agent:lastRun', 'json')]);
    return Response.json({ today: pack, lastRun }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
