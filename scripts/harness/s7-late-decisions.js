// Late checklists decided by the auditor (penalty / warning / as usual) in the
// Checklists section — not on the dashboard — the penalty in the report, and
// the admin-activity locations (the quiet x-geo header + how it reads).
const { open, snap, profileBy, teamBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');

const karam = profileBy('karam12');
const fatima = profileBy('fatima');
const baghdad = teamBy('Baghdad');
const base = snap.task_completions.find((r) => r.actor_id === karam.id && r.selfie_url) || snap.task_completions.find((r) => r.selfie_url);
if (!base) throw new Error('no supervisor checklist in the snapshot to copy');
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const row = (id, extra) => ({ ...base, id, actor_id: karam.id, subject_profile_id: karam.id, team_id: baghdad.id, reviewed_by: null, reviewed_at: null, review_note: null, late_excused_at: null, late_excused_by: null, late_excuse_reason: null, late_outcome: null, late_penalty_iqd: null, ...extra });
const LATE = '00000000-0000-4000-8000-00000000a001';
const completions = [
  row(LATE, { created_at: ago(1), was_late: true, checklist_slot: 'AM', due_at: ago(3), note: 'traffic on the bridge' }),
  row('00000000-0000-4000-8000-00000000a002', { created_at: ago(30), was_late: true, checklist_slot: 'PM', due_at: ago(31), note: 'forgot', late_outcome: 'warning', reviewed_by: fatima.id, reviewed_at: ago(29) }),
  row('00000000-0000-4000-8000-00000000a003', { created_at: ago(54), was_late: true, checklist_slot: 'AM', due_at: ago(56), note: 'late bus', late_outcome: 'penalty', late_penalty_iqd: 25000, reviewed_by: fatima.id, reviewed_at: ago(53) }),
  ...snap.task_completions.filter((r) => r.actor_id !== karam.id),
];
const settings = [{ ...(snap.org_settings[0] || {}), late_checklist_penalty_iqd: 25000 }];

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

  // ------------------------------------------------ A. the auditor decides
  const decided = [];
  let s = await open('fatima', {
    tables: { task_completions: completions, org_settings: settings },
    rpc: {
      checklist_today: (body) => (body.p_team === baghdad.id ? [{ slot: 'PM', due_at: ago(2), grace_min: 30, done_at: null, done_by: null, was_late: null, on_shift: ['Obaida'], completion_id: null, excused: null }] : []),
      decide_late_checklist: (body) => {
        decided.push(body);
      },
    },
  });
  const geoHeaders = [];
  s.page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/log_activity')) geoHeaders.push(req.headers()['x-geo'] || null);
  });
  check('no deadline card on her dashboard', (await s.page.getByTestId('checklist-deadlines').count()) === 0);
  await s.page.getByText('Checklists', { exact: true }).last().click();
  await s.page.waitForTimeout(2000);
  const missing = s.page.getByTestId('late-missing-Baghdad-PM');
  check('late + not sent shows on the branch', (await missing.count()) === 1, await missing.innerText().catch(() => ''));
  check('no remind button anywhere', (await s.page.getByText('Remind them now').count()) === 0);
  await s.page.getByText('Baghdad', { exact: true }).first().click();
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: `${OUT}/s7-a-checklists.png` });
  const badge = await s.page.getByTestId(`badge-${LATE}`).innerText().catch(() => '');
  check('undecided late badge', /late.*decide/i.test(badge), badge);
  check('LATE tag on the row', (await s.page.getByTestId(`late-tag-${LATE}`).count()) === 1);
  check('decided rows say Penalty / Warning', (await s.page.getByTestId('badge-00000000-0000-4000-8000-00000000a003').innerText()) === 'Penalty' && (await s.page.getByTestId('badge-00000000-0000-4000-8000-00000000a002').innerText()) === 'Warning');

  await s.page.getByTestId(`badge-${LATE}`).click();
  await s.page.waitForTimeout(1500);
  const block = s.page.getByTestId('late-block');
  const blockText = await block.innerText().catch(() => '');
  check('reason shown', blockText.includes('traffic on the bridge'));
  check('earlier warning shown', /already warned/i.test(blockText) && /late penalties before: 1/i.test(blockText), blockText.replace(/\n/g, ' | ').slice(0, 160));
  check('three buttons', (await s.page.getByTestId('decide-penalty').count()) + (await s.page.getByTestId('decide-warning').count()) + (await s.page.getByTestId('decide-none').count()) === 3);
  check('plain Verify hidden', (await s.page.getByText('Verify', { exact: true }).count()) === 0);
  await block.screenshot({ path: `${OUT}/s7-b-decide.png` });
  await s.page.getByTestId('decide-penalty').click();
  await s.page.waitForTimeout(400);
  const confirmText = await s.page.getByTestId('decide-penalty').innerText();
  check('penalty asks for a second tap', /tap again/i.test(confirmText) && decided.length === 0, confirmText);
  await s.page.getByTestId('decide-penalty').click();
  await s.page.waitForTimeout(1200);
  check('penalty sent', decided.length === 1 && decided[0].p_outcome === 'penalty' && decided[0].p_completion_id === LATE, JSON.stringify(decided));
  const outcome = await s.page.getByTestId('late-outcome').innerText().catch(() => '');
  check('outcome shown', /penalty 25,000 IQD/i.test(outcome), outcome);
  check('buttons gone after', (await s.page.getByTestId('late-decide').count()) === 0);
  await block.screenshot({ path: `${OUT}/s7-c-decided.png` });

  // ------------------------------------------------ B. her app sends where she is
  const decodedAll = geoHeaders.filter(Boolean).map((h) => JSON.parse(Buffer.from(h, 'base64').toString('utf8')));
  const g = decodedAll[decodedAll.length - 1];
  check('every activity line carried a location', geoHeaders.length > 0 && geoHeaders.every(Boolean), `${geoHeaders.filter(Boolean).length}/${geoHeaders.length}`);
  check('location read quietly', g && g.s === 'ok' && Math.abs(g.lat - 33.3152) < 0.001 && g.place === 'Test Street, Karrada, Baghdad' && g.sw === 390 && g.sh === 844, JSON.stringify(g));
  const errsA = s.errors.filter((e) => !e.includes('user gesture'));
  check('no page errors (auditor)', errsA.length === 0, errsA.slice(0, 2).join(' || '));
  await s.browser.close();

  // a supervisor's app sends nothing
  s = await open('karam12', {});
  let sent = 0;
  s.page.on('request', (req) => {
    if (req.headers()['x-geo']) sent++;
  });
  await s.page.getByText('History', { exact: true }).last().click().catch(() => {});
  await s.page.waitForTimeout(2000);
  check('supervisor sends no location', sent === 0);
  await s.browser.close();

  // ------------------------------------------------ C. the penalty in the money
  const PERIOD = '00000000-0000-4000-8000-0000000000p1'.replace('p', 'e');
  s = await open('hijazi12', {
    tables: { report_periods: [{ id: PERIOD, org_id: karam.org_id, period_month: '2026-08-01', closed_by: null, created_at: ago(24) }] },
    rpc: {
      get_current_branch_summary: () => [{ branch_id: baghdad.id, branch_name: 'Baghdad', brand_id: null, brand_name: null, subject_profile_id: karam.id, subject_name: 'Karam', total_points: 0, iqd_amount: 0, score_sum: null, score_count: 0, late_penalty_iqd: 25000 }],
      get_period_report: () => [{ branch_id: baghdad.id, branch_name: 'Baghdad', brand_id: null, brand_name: null, subject_profile_id: karam.id, subject_name: 'Karam', total_points: -2, iqd_amount: -50000, raw_points: -2, raw_iqd_amount: -50000, late_penalty_iqd: 25000 }],
    },
  });
  // this month: the dashboard's branch cards
  let body = await s.page.locator('body').innerText();
  check('dashboard branch total counts it', /-25,000 IQD/.test(body), (body.match(/Baghdad[^\n]*\n[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' | '));
  await s.page.getByText('Baghdad', { exact: true }).first().click();
  await s.page.waitForTimeout(800);
  body = await s.page.locator('body').innerText();
  check('dashboard row names the late penalty', /incl\. 25,000 late checklist penalty/.test(body));
  await s.page.screenshot({ path: `${OUT}/s7-d-dashboard.png` });
  // a closed month: the Report
  await s.page.getByTestId('open-side-menu').first().click();
  await s.page.waitForTimeout(600);
  await s.page.getByText('Report', { exact: true }).last().click();
  await s.page.waitForTimeout(1500);
  await s.page.getByText(/August 2026/).first().click();
  await s.page.waitForTimeout(1500);
  body = await s.page.locator('body').innerText();
  check('closed month: audit -50,000 + late 25,000 = -75,000', /-75,000/.test(body) && /incl\. 25,000 late checklist penalty/.test(body));
  await s.page.screenshot({ path: `${OUT}/s7-d-report.png` });
  await s.browser.close();

  // ------------------------------------------------ D. the super admin reads where it was
  const act = (id, geo, minsAgo) => ({ id, org_id: fatima.org_id, actor_id: fatima.id, actor_name: 'Fatima sattar', kind: 'view', table_name: null, op: '/history', row_id: null, before: null, after: null, detail: null, ip: '169.224.35.107', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15', geo, txid: id, created_at: new Date(Date.now() - minsAgo * 60000).toISOString() });
  s = await open('hijazi12', {
    tables: {
      admin_activity: [
        act(3, { s: 'ok', lat: 33.3152, lng: 44.3661, acc: 14, place: 'Test Street, Karrada, Baghdad', sw: 402, sh: 874 }, 5),
        act(2, { s: 'ok', lat: baghdad.lat, lng: baghdad.lng, acc: 8, place: 'Palestine St, Baghdad', sw: 402, sh: 874 }, 60),
        act(1, { s: 'denied', sw: 402, sh: 874 }, 120),
      ],
    },
  });
  await s.page.getByTestId('open-side-menu').first().click();
  await s.page.waitForTimeout(600);
  await s.page.getByText('Admin activity', { exact: true }).last().click();
  await s.page.waitForTimeout(2000);
  const rowsText = (await s.page.getByTestId('activity-row').allInnerTexts()).map((x) => x.replace(/\n/g, ' | '));
  check('row shows phone size + street', rowsText[0]?.includes('iPhone · 6.3″') && rowsText[0]?.includes('Test Street, Karrada, Baghdad'), rowsText[0]);
  check('blocked location said plainly', rowsText[2]?.includes('Location blocked on the phone'), rowsText[2]);
  await s.page.screenshot({ path: `${OUT}/s7-e-activity.png` });
  await s.page.getByTestId('activity-row').first().click();
  await s.page.waitForTimeout(800);
  let sheet = await s.page.locator('body').innerText();
  check('detail: distance from the branch', /\d\.\d km from Baghdad/.test(sheet), (sheet.match(/Nearest branch\s*\n?.*/) || [''])[0]);
  check('detail: accuracy', sheet.includes('±14 m'));
  await s.page.screenshot({ path: `${OUT}/s7-f-activity-detail.png` });
  const errsD = s.errors.filter((e) => !e.includes('user gesture'));
  check('no page errors (activity)', errsD.length === 0, errsD.slice(0, 2).join(' || '));
  await s.browser.close();

  // inside the branch circle
  s = await open('hijazi12', { tables: { admin_activity: [act(2, { s: 'ok', lat: baghdad.lat, lng: baghdad.lng, acc: 8, place: 'Palestine St, Baghdad', sw: 402, sh: 874 }, 60)] } });
  await s.page.getByTestId('open-side-menu').first().click();
  await s.page.waitForTimeout(600);
  await s.page.getByText('Admin activity', { exact: true }).last().click();
  await s.page.waitForTimeout(1500);
  await s.page.getByTestId('activity-row').first().click();
  await s.page.waitForTimeout(800);
  sheet = await s.page.locator('body').innerText();
  check('detail: at the branch', sheet.includes('At the Baghdad branch'));
  await s.browser.close();

  console.log(results.join('\n'));
})();
