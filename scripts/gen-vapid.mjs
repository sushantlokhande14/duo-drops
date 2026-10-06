// Generates the VAPID key pair that signs push notifications.
// Writes .dev.vars (local dev) and .vapid-secrets.json (for `wrangler secret bulk`).
import { writeFileSync, existsSync } from 'node:fs';

if (existsSync('.vapid-secrets.json') && !process.argv.includes('--force')) {
  console.log('Keys already exist (.vapid-secrets.json). Use --force to make new ones (existing buzz subscriptions would stop working).');
  process.exit(0);
}

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const pub = Buffer.from(raw).toString('base64url');
const priv = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });

writeFileSync('.dev.vars', `VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_JWK=${priv}\n`);
writeFileSync('.vapid-secrets.json', JSON.stringify({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: priv }, null, 2));
console.log('Wrote .dev.vars and .vapid-secrets.json');
console.log('Upload to Cloudflare with:  npx wrangler secret bulk .vapid-secrets.json');
