// Each fryer keeps its own oil slot (his report 2026-09-26: Baghdad has two
// fryers and only one was ever marked late). The sheet must ask the server
// about THE PICKED FRYER and show "why late" only for the one that is late.
// The server answer is faked here: KFC already did the 7 PM slot, Fanker not.
const { open, snap, teamBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');

const b = teamBy('Baghdad').id;
const fryer = (name) => snap.oil_fryers.find((f) => f.team_id === b && f.name === name && !f.archived);
const kfc = fryer('شواية الكنتاكي');
const fnk = fryer('شواية الفنكر');

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  const asked = [];
  const s = await open('karam12', {
    rpc: {
      oil_slot_for: (body) => {
        asked.push(body.p_fryer_id || null);
        return body.p_fryer_id === fnk.id ? [{ slot_time: '19:00:00', minutes_late: 9 }] : [{ slot_time: null, minutes_late: null }];
      },
    },
  });
  const { page } = s;
  await page.getByText('Oil test', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  // The harness has no row-level security, so every branch's fryers load and
  // the sheet asks for a branch first; the real Karam only sees Baghdad's.
  if (await page.getByText('Which branch?').isVisible().catch(() => false)) {
    await page.getByText('Baghdad', { exact: true }).last().click();
    await page.waitForTimeout(600);
  }
  const lateBox = () => page.getByText('This test is 9 minutes late').isVisible().catch(() => false);

  await page.getByText(kfc.name, { exact: true }).first().click();
  await page.waitForTimeout(1000);
  check('KFC (already done): no late box', !(await lateBox()));
  await page.screenshot({ path: `${OUT}/s10-a-kfc.png` });

  // Back to the fryer list, then the other fryer.
  const change = page.getByText(fnk.name, { exact: true }).first();
  if (!(await change.isVisible().catch(() => false))) {
    await page.getByText(kfc.name, { exact: true }).first().click();
    await page.waitForTimeout(600);
  }
  await page.getByText(fnk.name, { exact: true }).first().click();
  await page.waitForTimeout(1000);
  check('Fanker (not done): late box asks why', await lateBox());
  await page.screenshot({ path: `${OUT}/s10-b-fanker.png` });

  check('asked about each picked fryer', asked.includes(kfc.id) && asked.includes(fnk.id), JSON.stringify(asked));
  check('never asked without a fryer', !asked.includes(null));
  const errs = s.errors.filter((e) => !e.includes('user gesture'));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' || '));
  await s.browser.close();
  console.log(results.join('\n'));
})();
