// Super admin: Staff → folded Shifts card → Schedule sheet (branch chips);
// Fatima's sheet → Access switches → Control panel on.
const { open } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');

(async () => {
  const s = await open('hijazi12');
  const { page, errors, state } = s;
  await page.getByText('Staff', { exact: true }).last().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/s2-a-staff-folded.png` });
  console.log('folded (no day chips):', !(await page.getByText('Tomorrow', { exact: true }).first().isVisible().catch(() => false)));
  await page.getByTestId('toggle-shifts').click();
  await page.waitForTimeout(800);
  console.log('open (day chips):', await page.getByText('Tomorrow', { exact: true }).first().isVisible().catch(() => false));
  await page.getByTestId('open-schedule').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/s2-b-schedule.png` });
  console.log('branch chips in sheet:', await page.getByTestId('schedule-branch-Karbala').isVisible().catch(() => false));
  await page.getByTestId('schedule-branch-Karbala').click();
  await page.waitForTimeout(300);
  await page.getByTestId('schedule-who-Oday').click();
  await page.getByTestId('schedule-days-3').click();
  await page.waitForTimeout(300);
  await page.getByTestId('schedule-preview').screenshot({ path: `${OUT}/s2-c-preview.png` });
  console.log('preview:', (await page.getByTestId('schedule-preview').innerText()).replace(/\n/g, ' | '));
  // close the sheet
  await page.keyboard.press('Escape').catch(() => {});
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // Fatima: in "Admin / Unassigned"
  await page.getByText('Admin / Unassigned').first().click();
  await page.waitForTimeout(800);
  await page.getByText('Fatima sattar').first().click();
  await page.waitForTimeout(1500);
  const sw = page.getByTestId('access-switches');
  await sw.scrollIntoViewIfNeeded().catch(() => {});
  console.log('access switches:', await sw.isVisible().catch(() => false));
  await sw.screenshot({ path: `${OUT}/s2-d-access.png` }).catch((e) => console.log('shot failed', e.message));
  // flip Control panel on
  const cp = page.getByTestId('access-control_panel').locator('input[type=checkbox], [role=switch]').first();
  if (await cp.count()) { await cp.click({ force: true }); } else { await page.getByTestId('access-control_panel').click(); }
  await page.waitForTimeout(1200);
  await sw.screenshot({ path: `${OUT}/s2-e-access-on.png` }).catch(() => {});
  console.log('set calls:', state.calls.filter((c) => c.includes('set_person_permission')).length, '| overrides:', JSON.stringify(state.overrides));
  console.log('errors:', errors.filter((e) => !e.includes('user gesture')).slice(0, 4));
  await s.browser.close();
})();
