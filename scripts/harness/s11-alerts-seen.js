// "Mark as seen" (his ask, 2026-09-27): admins and the hygiene auditor hide the
// waiting-checklist counts, the menu dot and the "fryer needs change" card
// once seen — on their own account only. Anything newer shows again; the
// records stay unverified; managers and supervisors get no such button.
const { open, snap, profileBy, teamBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');

const me = profileBy('hijazi12');
const karam = profileBy('karam12');
const fatima = profileBy('fatima');
const baghdad = teamBy('Baghdad');
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// Three waiting checklists at Baghdad; everything else already verified, so the counts are exact.
const base = snap.task_completions.find((r) => r.actor_id === karam.id && r.selfie_url);
const row = (n, h) => ({ ...base, id: `00000000-0000-4000-8000-00000000b00${n}`, actor_id: karam.id, subject_profile_id: karam.id, team_id: baghdad.id, created_at: ago(h), reviewed_by: null, reviewed_at: null, late_outcome: null, was_late: false, checklist_slot: null });
const completions = [
  row(1, 1), row(2, 5), row(3, 26),
  ...snap.task_completions.filter((r) => r.actor_id !== karam.id).map((r) => ({ ...r, reviewed_by: r.reviewed_by || fatima.id })),
];
// One fryer read "change" half an hour ago (like Nasryeh's on 27 Sep).
const fryer = snap.oil_fryers.find((f) => !f.archived);
const change = { ...snap.oil_tests[0], id: '00000000-0000-4000-8000-00000000c0de', team_id: fryer.team_id, fryer_id: fryer.id, tpm: 22, grade: 'change', tested_at: ago(0.5), created_at: ago(0.5) };
const oil = [change, ...snap.oil_tests.map((x) => ({ ...x, grade: 'good', tpm: Math.min(Number(x.tpm), 19) }))];

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

  // ---------------------------------------------- A. super admin marks both as seen
  const marks = [];
  let s = await open('hijazi12', {
    tables: { task_completions: completions, oil_tests: oil, alerts_seen: [] },
    rpc: { mark_alerts_seen: (b) => { marks.push(b); return b.p_until; } },
  });
  let page = s.page;
  await page.waitForTimeout(4000);
  check('A fryer card shows with its ✕', await visible(page, '[data-testid="oil-alert-seen"]'));
  check('A menu dot shows', await visible(page, '[data-testid="menu-dot"]'));
  await page.screenshot({ path: `${OUT}/s11-a-dashboard.png` });
  await page.getByTestId('oil-alert-seen').click();
  await page.waitForTimeout(800);
  check('A ✕ hides the fryer card', !(await page.getByText('1 fryer needs change').isVisible().catch(() => false)));
  const oilMark = marks.find((m) => m.p_kind === 'oil_change');
  check('A oil mark = the test that was shown', oilMark && oilMark.p_until === change.tested_at, JSON.stringify(oilMark));

  await page.goto(page.url().replace(/\/[^/]*$/, '/checklists'));
  await page.waitForTimeout(4000);
  check('A "Mark all as seen" shows', await visible(page, '[data-testid="mark-checklists-seen"]'));
  check('A Baghdad counts 3', await page.getByText('3', { exact: true }).first().isVisible().catch(() => false));
  await page.getByTestId('mark-checklists-seen').click();
  await page.waitForTimeout(800);
  check('A button gone after marking', !(await visible(page, '[data-testid="mark-checklists-seen"]')));
  check('A count gone', !(await page.getByText('3', { exact: true }).first().isVisible().catch(() => false)));
  check('A menu dot gone', !(await visible(page, '[data-testid="menu-dot"]')));
  const ckMark = marks.find((m) => m.p_kind === 'checklists');
  check('A checklist mark = the newest waiting one', ckMark && ckMark.p_until === completions[0].created_at, JSON.stringify(ckMark));
  await page.getByText('Baghdad', { exact: true }).first().click();
  await page.waitForTimeout(600);
  const notVerified = await page.getByText('Not verified', { exact: true }).count();
  check('A the 3 stay unverified, shown as "Not verified"', notVerified === 3, String(notVerified));
  await page.screenshot({ path: `${OUT}/s11-b-checklists-seen.png` });
  check('A no page errors', s.errors.filter((e) => !e.includes('user gesture')).length === 0, s.errors.slice(0, 2).join(' || '));
  await s.browser.close();

  // ---------------------------------------------- B. something newer comes back
  s = await open('hijazi12', {
    tables: {
      task_completions: completions, oil_tests: oil,
      alerts_seen: [{ profile_id: me.id, kind: 'checklists', seen_at: ago(3) }, { profile_id: me.id, kind: 'oil_change', seen_at: ago(0.25) }],
    },
  });
  page = s.page;
  await page.waitForTimeout(4000);
  check('B fryer stays hidden (no newer test)', !(await visible(page, '[data-testid="oil-alert-seen"]')));
  check('B dot back for the one newer checklist', await visible(page, '[data-testid="menu-dot"]'));
  await page.goto(page.url().replace(/\/[^/]*$/, '/checklists'));
  await page.waitForTimeout(4000);
  check('B count is 1 (only the newer one)', await page.getByText('1', { exact: true }).first().isVisible().catch(() => false));
  await page.getByText('Baghdad', { exact: true }).first().click();
  await page.waitForTimeout(600);
  const news = await page.getByText('New', { exact: true }).count();
  const olds = await page.getByText('Not verified', { exact: true }).count();
  check('B 1 New + 2 Not verified', news === 1 && olds === 2, `${news} new, ${olds} not verified`);
  await s.browser.close();

  // ---------------------------------------------- C. hygiene auditor (Arabic) has it; D. a branch manager does not
  s = await open('fatima', { lang: 'ar', tables: { task_completions: completions, oil_tests: oil, alerts_seen: [] } });
  page = s.page;
  await page.waitForTimeout(4000);
  check('C Fatima: fryer ✕ shows', await visible(page, '[data-testid="oil-alert-seen"]'));
  await page.goto(page.url().replace(/\/[^/]*$/, '/checklists'));
  await page.waitForTimeout(4000);
  check('C Fatima (Arabic): button reads تعليم الكل كمقروء', await page.getByText('تعليم الكل كمقروء').isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/s11-c-fatima-ar.png` });
  await s.browser.close();

  s = await open('kayes11', { tables: { task_completions: completions, oil_tests: oil, alerts_seen: [] } });
  page = s.page;
  await page.waitForTimeout(4000);
  check('D manager: no ✕ on the fryer card', !(await visible(page, '[data-testid="oil-alert-seen"]')));
  await page.goto(page.url().replace(/\/[^/]*$/, '/checklists'));
  await page.waitForTimeout(4000);
  check('D manager: no "Mark all as seen"', !(await visible(page, '[data-testid="mark-checklists-seen"]')));
  await s.browser.close();

  console.log(results.join('\n'));
})();
