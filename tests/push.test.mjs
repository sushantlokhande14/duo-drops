// Checks our WebCrypto push encryption against an independent implementation
// (http_ece, the library behind the `web-push` npm package), and the VAPID JWT signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidHeader, b64uEncode } from '../src/push.js';

test('payload decrypts with http_ece (RFC 8291 aes128gcm)', async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const sub = { endpoint: 'https://push.example.com/x', keys: { p256dh: b64uEncode(ua.getPublicKey()), auth: b64uEncode(auth) } };
  const msg = JSON.stringify({ title: '💌 A Drop just landed!', body: 'hi' });
  const body = await encryptPayload(sub, msg);
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  assert.equal(plain.toString('utf8'), msg);
});

test('VAPID header carries a valid ES256 JWT', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = b64uEncode(await crypto.subtle.exportKey('raw', kp.publicKey));
  const env = { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_SUBJECT: 'mailto:test@example.com' };
  const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', env);
  const [, token, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, pub);
  const [hd, pl, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(pl, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.now() / 1000);
  const key = createPublicKey({ key: { ...jwk, d: undefined }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${hd}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});
