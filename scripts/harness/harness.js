// Offline UI harness: the REAL web build (served locally from dist/), with
// every Supabase call answered from a local snapshot + fixtures. Nothing
// reaches the live database — requests to the project are intercepted and
// never forwarded; the realtime socket is closed locally.
const fs = require('fs');
const path = require('path');
const { webkit, chromium } = require('playwright');

const REF = 'spnvsjmmeddwompkeerh';
const API = `https://${REF}.supabase.co`;
const BASE = process.env.BASE || 'http://localhost:4173/';
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.dev-session', 'harness-snapshot.json'), 'utf8'));
for (const k of Object.keys(snap)) snap[k] = snap[k] || [];

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const profileBy = (u) => snap.profiles.find((p) => p.username === u);
const teamBy = (name) => snap.teams.find((t) => t.name === name);

const DEFAULTS = {
  control_panel: (r) => r === 'owner',
  excuse_late: (r) => r === 'owner' || r === 'hygiene_auditor',
  edit_marination_start: (r) => r === 'owner' || r === 'team_admin',
  checklist_alerts: (r) => r === 'hygiene_auditor',
};
const KEYS = Object.keys(DEFAULTS);

function makeState() {
  return { overrides: {}, excused: {}, calls: [] };
}

function allows(state, p, perm) {
  if (p.is_super_admin && perm !== 'checklist_alerts') return true;
  const o = state.overrides[`${p.id}|${perm}`];
  return o != null ? o : DEFAULTS[perm](p.role);
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [col, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(col)) continue;
    const v = String(raw);
    const test = (row) => {
      const cell = row[col];
      if (v.startsWith('eq.')) return String(cell) === v.slice(3);
      if (v.startsWith('neq.')) return String(cell) !== v.slice(4);
      if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(cell));
      if (v.startsWith('gte.')) return String(cell) >= v.slice(4);
      if (v.startsWith('lte.')) return String(cell) <= v.slice(4);
      if (v.startsWith('gt.')) return String(cell) > v.slice(3);
      if (v.startsWith('lt.')) return String(cell) < v.slice(3);
      if (v === 'is.null') return cell == null;
      if (v === 'not.is.null') return cell != null;
      return true;
    };
    out = out.filter(test);
  }
  const limit = params.get('limit');
  return limit ? out.slice(0, Number(limit)) : out;
}

function embed(table, rows) {
  const nameOf = (id) => ({ name: snap.profiles.find((p) => p.id === id)?.name ?? null });
  if (table === 'chicken_marinations') return rows.map((r) => ({ ...r, profiles: nameOf(r.actor_id), unloader: r.unloaded_by ? nameOf(r.unloaded_by) : null }));
  if (table === 'oil_tests') return rows.map((r) => ({ ...r, profiles: nameOf(r.actor_id), oil_fryers: { name: snap.oil_fryers.find((f) => f.id === r.fryer_id)?.name ?? '' } }));
  return rows;
}

async function open(username, opts = {}) {
  const me = profileBy(username);
  if (!me) throw new Error(`no ${username} in snapshot`);
  const state = opts.state || makeState();
  const engine = opts.engine === 'chromium' ? chromium : webkit;
  const browser = await engine.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // A registered service worker takes over the page's requests and they
    // would skip the interception below — block it so nothing leaves.
    serviceWorkers: 'block',
    deviceScaleFactor: 2,
    isMobile: opts.engine !== 'chromium' ? undefined : true,
    hasTouch: true,
    locale: opts.locale || 'en-US',
    timezoneId: 'Asia/Baghdad',
    geolocation: { latitude: 33.3152, longitude: 44.3661, accuracy: 12 },
    permissions: ['geolocation'],
  });
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: me.id, role: 'authenticated', aud: 'authenticated', exp, session_id: '00000000-0000-4000-8000-000000000001' })}.x`;
  const session = {
    access_token: jwt, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: exp, refresh_token: 'fake',
    user: { id: me.id, aud: 'authenticated', role: 'authenticated', email: `${me.username}.51880@users.rungs.internal`, app_metadata: {}, user_metadata: {}, created_at: me.created_at },
  };
  await context.addInitScript(([key, value, lang]) => {
    localStorage.setItem(key, value);
    localStorage.setItem('rungs.permissionsAsked', '1');
    if (lang) localStorage.setItem('rungs.language', lang);
  }, [`sb-${REF}-auth-token`, JSON.stringify(session), opts.lang || null]);

  const rpc = opts.rpc || {};
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: body === undefined ? '' : JSON.stringify(body) });
    state.calls.push(`${req.method()} ${p}${url.search ? '?' + decodeURIComponent(url.search.slice(1)).slice(0, 80) : ''}`);
    if (p.startsWith('/auth/v1/')) {
      if (p.endsWith('/user')) return json(session.user);
      if (p.endsWith('/token')) return json(session);
      return json({}, 200);
    }
    if (p.startsWith('/storage/v1/')) {
      // Files are answered locally too: a drawn line for a signature, a grey
      // square for a photo — never the real ones.
      if (req.method() === 'GET' && p.endsWith('.svg')) {
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" viewBox="0 0 240 90"><path d="M10 70 C 50 10, 90 10, 120 60 S 190 90, 230 20" stroke="#111" stroke-width="3" fill="none"/></svg>' });
      }
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJSwPTP8+2GAAAAABJRU5ErkJggg==', 'base64') });
      }
      return json({ Key: 'x' });
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      let body = {};
      try { body = req.postDataJSON() || {}; } catch {}
      const custom = rpc[fn];
      if (custom) {
        const out = await custom(body, { me, state, snap, teamBy, profileBy });
        return out === undefined ? route.fulfill({ status: 204, body: '' }) : json(out);
      }
      switch (fn) {
        case 'my_session_alive': return json(true);
        case 'my_permissions': return json(KEYS.filter((k) => allows(state, me, k)));
        case 'permissions_of': {
          const t = snap.profiles.find((x) => x.id === body.p_profile);
          const ok = me.role === 'owner' && t && t.id !== me.id && !t.is_super_admin && (t.role !== 'owner' || me.is_super_admin);
          return json(ok ? KEYS.map((k) => ({ permission: k, allowed: allows(state, t, k), is_default: state.overrides[`${t.id}|${k}`] == null })) : []);
        }
        case 'set_person_permission': state.overrides[`${body.p_profile}|${body.p_perm}`] = body.p_allowed; return route.fulfill({ status: 204, body: '' });
        case 'excuse_checklist_late': state.excused[body.p_completion_id] = body.p_reason; return route.fulfill({ status: 204, body: '' });
        case 'nudge_checklist': return json(2);
        case 'my_branches_needing_location': return json([]);
        default: state.calls.push('DEFAULT ' + fn); return json(opts.nullRpcs ? null : []);
      }
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.fulfill({ status: 201, body: '' });
      let rows = embed(table, applyFilters((opts.tables?.[table] ?? snap[table]) || [], url.searchParams));
      if (table === 'task_completions') rows = rows.map((r) => (state.excused[r.id] ? { ...r, late_excused_at: new Date().toISOString(), late_excused_by: me.id, late_excuse_reason: state.excused[r.id] } : r));
      const accept = req.headers()['accept'] || '';
      if (accept.includes('vnd.pgrst.object')) {
        return rows.length ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406);
      }
      return json(rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    return route.abort();
  });
  // Realtime: closed locally, never connects to the project.
  await context.routeWebSocket(/supabase\.co/, (ws) => ws.close());
  if (opts.liveBundle) {
    await context.route(/\/\?update-check=/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: `<script src="/_expo/static/js/web/entry-${opts.liveBundle}.js" defer></script>` }),
    );
  }
  const page = await context.newPage();
  // Safety net: anything for the project that the route did not answer.
  const leaked = [];
  context.on('requestfinished', (req) => {
    if (req.url().includes(REF) && !req.url().startsWith('wss')) {
      const r = req.response && req.response();
      Promise.resolve(r).then((res) => {
        if (res && !res.fromServiceWorker() && res.headers()['x-harness'] !== '1' && !String(res.headers()['content-type'] || '').includes('application/json')) leaked.push(req.url().slice(0, 120));
      }).catch(() => {});
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e) + ' @@ ' + String(e.stack || '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200) + ' @@ ' + JSON.stringify(m.location()) + ' @@ ' + (m.args().length)); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(opts.settle ?? 6000);
  return { browser, context, page, state, errors, me, leaked };
}

module.exports = { open, snap, teamBy, profileBy, makeState };
