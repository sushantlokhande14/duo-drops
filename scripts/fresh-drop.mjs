// Ask the deployed daily agent for a brand new pack right now (new theme, task and
// Today's Special game), replacing the current one for your local date.
//   npm run fresh            -> your local today
//   npm run fresh 2026-10-07 -> specific date(s)
// Needs .agent-admin-token (made by `npm run fresh -- --setup`, which also uploads it).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const AGENT = process.env.DUO_AGENT_URL || 'https://duo-drops-daily.duo-drops.workers.dev';
const TOKEN_FILE = '.agent-admin-token';

if (process.argv.includes('--setup')) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  writeFileSync(TOKEN_FILE, token);
  execSync('npx wrangler secret put ADMIN_TOKEN -c agent/wrangler.jsonc', { input: token, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`Saved ${TOKEN_FILE} and uploaded it to the agent.`);
  process.exit(0);
}

if (!existsSync(TOKEN_FILE)) {
  console.error(`No ${TOKEN_FILE}. Run: npm run fresh -- --setup`);
  process.exit(1);
}

const localToday = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in this computer's time zone
const dates = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const res = await fetch(`${AGENT}/run`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${readFileSync(TOKEN_FILE, 'utf8').trim()}`, 'content-type': 'application/json' },
  body: JSON.stringify({ dates: dates.length ? dates : [localToday] }),
});
const out = await res.json();
if (!res.ok) { console.error(out); process.exit(1); }
for (const r of out.results) {
  console.log(`${r.date}: ${r.source === 'ai' ? `new AI pack "${r.theme}" (${r.model})` : `fallback pack "${r.theme}"`}${r.errors?.length ? ` [${r.errors.join('; ')}]` : ''}`);
}
console.log('Rooms pick it up within 10 minutes. Open the app → Play now → Today\'s Special.');
