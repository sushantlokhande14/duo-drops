import { Room } from './room.js';

export { Room };

// No look-alike characters (0/O, 1/I/L) so codes are easy to read out loud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const room = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/vapid') return Response.json({ key: env.VAPID_PUBLIC_KEY || null });

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = await req.text();
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const res = await room(env, code).fetch(`https://room/create?code=${code}`, { method: 'POST', body });
        if (res.status !== 409) return res;
      }
      return Response.json({ error: 'Could not find a free code, try again' }, { status: 503 });
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|me|ws)$/);
    if (m) return room(env, m[1]).fetch(new Request(`https://room/${m[2]}${url.search}`, req));

    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });
    return new Response('Not found', { status: 404 });
  },
};
