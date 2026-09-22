// BD Audit web-push sender (RFC 8291 aes128gcm + RFC 8292 VAPID).
// Called server-side (by the DB trigger / a trusted caller with the shared
// token) to deliver a notification to a set of browser subscriptions.
// Secrets: VAPID_PRIVATE_D (base64url), PUSH_TOKEN (shared bearer for callers).
const VAPID_PUBLIC = 'BEqHHjQUwRHuM8c2AbyGqRqNWEG2Cq5SdvP1F5Z28hABEHJemh-rJg5ckQyuYOSbjMdMYhHDkJKPhGJ6H3RFhnY';
const VAPID_SUBJECT = 'mailto:ahmed.hijazi089@gmail.com';

const b64urlToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
};
const bytesToB64url = (buf) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

async function vapidAuth(endpoint) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT };
  const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const pub = b64urlToBytes(VAPID_PUBLIC); // 0x04 || x(32) || y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)),
    d: PRIVATE_D_B64URL, ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return { Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}` };
}

let PRIVATE_D_B64URL = '';

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

async function encrypt(p256dhB64, authB64, plaintext) {
  const clientPub = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  const localKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeys.publicKey)); // 65 bytes
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeys.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  // PRK per RFC 8291: HKDF(auth, ecdh, "WebPush: info\0" || clientPub || localPub)
  const info = concat(new TextEncoder().encode('WebPush: info\0'), clientPub, localPubRaw);
  const ikm = await hkdf(authSecret, shared, info, 32);

  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, Uint8Array.from([0x02])); // last record delimiter
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  // aes128gcm header: salt(16) || rs(4, big-endian) || idlen(1) || keyid(localPub)
  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // 4096
  const header = concat(salt, rs, Uint8Array.from([localPubRaw.length]), localPubRaw);
  return concat(header, ct);
}

async function sendOne(sub, payloadObj) {
  const body = await encrypt(sub.p256dh, sub.auth, new TextEncoder().encode(JSON.stringify(payloadObj)));
  const auth = await vapidAuth(sub.endpoint);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      // Without this, Apple is free to batch the notification and hand it over
      // only when the app next runs — which looked like "notifications don't
      // work unless I open the app". High urgency = deliver now, even locked.
      Urgency: 'high',
    },
    body,
  });
  return { endpoint: sub.endpoint, status: res.status };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (request.headers.get('Authorization') !== `Bearer ${env.PUSH_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    PRIVATE_D_B64URL = env.VAPID_PRIVATE_D;

    let body;
    try { body = await request.json(); } catch { return new Response('bad', { status: 400 }); }
    const { subscriptions, title, body: text, url, tag } = body || {};
    if (!Array.isArray(subscriptions)) return new Response('no subs', { status: 400 });

    const payload = { title: title || 'BD Audit', body: text || '', url: url || '/', tag };
    const results = await Promise.all(subscriptions.map((s) => sendOne(s, payload).catch((e) => ({ endpoint: s.endpoint, error: String(e) }))));
    return new Response(JSON.stringify({ results }), { headers: { 'content-type': 'application/json' } });
  },
};
