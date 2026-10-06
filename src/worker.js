import { Room } from './room.js';

export { Room };

// No look-alike characters (0/O, 1/I/L) so codes are easy to read out loud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const room = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

// Per-IP limits on the endpoints a stranger could hammer (creating rooms, guessing invites).
async function allowed(env, req, bucket) {
  if (!env.LIMITER) return true;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const { success } = await env.LIMITER.limit({ key: `${bucket}:${ip}` });
  return success;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/vapid') return json({ key: env.VAPID_PUBLIC_KEY || null });

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!(await allowed(env, req, 'create'))) return json({ error: 'Slow down a little 🐢 try again in a minute' }, 429);
      const body = await req.text();
      if (body.length > 2000) return json({ error: 'too big' }, 413);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const res = await room(env, code).fetch(`https://room/create?code=${code}`, { method: 'POST', body });
        if (res.status !== 409) return res;
      }
      return json({ error: 'Could not find a free code, try again' }, 503);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|me|ws)$/);
    if (m) {
      const [, code, action] = m;
      if (action === 'join') {
        if (req.method !== 'POST') return json({ error: 'method' }, 405);
        if (!(await allowed(env, req, 'join'))) return json({ error: 'Slow down a little 🐢 try again in a minute' }, 429);
      }
      if (action === 'me' && !(await allowed(env, req, 'me'))) return json({ error: 'Slow down a little 🐢' }, 429);
      return room(env, code).fetch(new Request(`https://room/${action}`, req));
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return new Response('Not found', { status: 404 });
  },
};
