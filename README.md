# Duo Drops 💌

Tiny live games for two hearts far apart. Surprise **Drops** land on both phones at random
times through the day (only when you're both awake, across time zones). You get 15 minutes to
jump in and play a short live game together. Play anything anytime with **Play now**, keep a
daily streak, and fight over the weekly duel prize.

**Games**
- 🔮 **Mind Meld**: same prompt, type the first thing you think of, score when you match.
- ⚡ **Speed Duel**: five micro races (unscramble, quick maths, counting, odd one out, reaction tap).
- 🎨 **Doodle Guess**: one draws live, the other guesses, then swap. Doodles are saved to the results screen.

**Also**: 💗 pokes (a buzz plus floating hearts on their screen), each other's local time,
streaks, love points, a weekly duel with a prize you choose, push notifications ("buzzes"), and
an installable PWA for iPhone, Android and desktop.

Runs entirely on Cloudflare's free plan: one Worker plus one Durable Object per couple. No database,
no paid APIs.

## Run locally

```bash
npm install
npm run keys      # makes push keys into .dev.vars (gitignored)
npm run dev       # http://127.0.0.1:8787
npm test
```

To try it as two people on one computer, open `http://localhost:8787` and `http://127.0.0.1:8787`.
They are different origins, so each one gets its own player.

## Put it online (free)

```bash
npx wrangler login                         # opens Cloudflare in your browser (free account)
npx wrangler deploy                        # prints https://duo-drops.<you>.workers.dev
npx wrangler secret bulk .vapid-secrets.json
```

Before deploying, set `VAPID_SUBJECT` in `wrangler.jsonc` to your own `mailto:` address. Push
services use it as a contact.

Then open the URL, create your room, and send her the invite link.

**iPhone:** buzzes only work once the site is added to the Home Screen (Share → Add to Home Screen).
Open it from there, then tap 🔔. Android and desktop Chrome can turn buzzes on straight away.

## How it works

| Piece | File |
| --- | --- |
| Routing, room codes | `src/worker.js` |
| Room state, Drop scheduler (DO alarms), sockets, stroke relay | `src/room.js` |
| Game rules (server-authoritative, answers never sent to clients early) | `src/games.js` |
| Prompts, words, emoji sets | `src/content.js` |
| Web Push (RFC 8291 + VAPID on WebCrypto, no deps) | `src/push.js` |
| UI (vanilla JS modules, no build step) | `public/` |

Add prompts or doodle words in `src/content.js`. Recently used ones are skipped automatically.
