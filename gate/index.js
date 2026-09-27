// BD Audit's web app is closed to everyone but the owner (his call,
// 2026-09-27: "keep only my access … the rest on the web please stop and
// suggest to delete"). He works on it through the app built onto his iPhone;
// the web keeps one private way in for him as a fallback.
//
// - Everyone: closed.html (Arabic + English, "please delete it"), which also
//   removes the phone's service worker so its notifications stop, and /sw.js
//   answers with a worker that unregisters itself.
// - Him: /?dev=<DEV_KEY> sets a cookie; that browser then gets the real app.
//   DEV_KEY is a Worker secret (`wrangler secret put DEV_KEY`) — the repo is
//   public, so the key never lives in code.
// - Reopen for everyone: set SITE_CLOSED to "0" in wrangler.jsonc and deploy.
import closedPage from './closed.html';

const KILL_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
`;

const noStore = { 'cache-control': 'no-store' };

function cookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (env.SITE_CLOSED !== '1') return env.ASSETS.fetch(request);

    const url = new URL(request.url);
    const key = env.DEV_KEY;
    if (key && url.searchParams.get('dev') === key) {
      return new Response(null, {
        status: 302,
        headers: { ...noStore, location: '/', 'set-cookie': `bd_dev=${key}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax` },
      });
    }
    if (key && cookie(request, 'bd_dev') === key) return env.ASSETS.fetch(request);

    if (url.pathname === '/sw.js') return new Response(KILL_SW, { headers: { ...noStore, 'content-type': 'text/javascript' } });
    // The closed page shows the app's icon.
    if (/^\/(icon-192|icon-512|apple-touch-icon)\.png$/.test(url.pathname)) return env.ASSETS.fetch(request);
    return new Response(closedPage, { headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } });
  },
};
