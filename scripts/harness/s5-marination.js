// Supervisor: the marination sheet (no time field, Arabic digits);
// branch manager: an active batch → correct its start; History → day report PDF.
const fs = require('fs');
const { execSync } = require('child_process');
const { open, snap, teamBy, profileBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
const H = 3600000;
(async () => {
  // ---- supervisor
  let s = await open('karam12');
  let page = s.page;
  await page.getByText('Chicken marination', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  const buckets = page.getByPlaceholder('0').first();
  await buckets.fill('٣');
  await page.waitForTimeout(300);
  console.log('bucket math:', await page.getByTestId('bucket-math').innerText().catch(() => 'MISSING'));
  console.log('time field gone:', !(await page.getByText('Time', { exact: true }).first().isVisible().catch(() => false)));
  await page.screenshot({ path: `${OUT}/s5-a-sheet.png` });
  await buckets.fill('٢٫٥');
  await page.waitForTimeout(200);
  console.log('decimal:', await page.getByTestId('bucket-math').innerText().catch(() => 'MISSING'));
  await page.getByText('Save', { exact: true }).last().click();
  await page.waitForTimeout(1200);
  const submit = s.state.calls.filter((c) => c.includes('submit_chicken_marination'));
  console.log('submitted:', submit.length, JSON.stringify(submit));
  console.log('errors (supervisor):', s.errors.filter((e) => !e.includes('user gesture')).slice(0, 3));
  await s.browser.close();

  // ---- manager with an active batch
  const k = teamBy('Karbala').id;
  const now = Date.now();
  const active = {
    ...snap.chicken_marinations[0], id: 'aaaaaaaa-0000-4000-8000-00000000beef', team_id: k, actor_id: profileBy('mhmd').id,
    marinated_at: new Date(now - 40 * 60000).toISOString(), original_marinated_at: new Date(now - 40 * 60000).toISOString(),
    created_at: new Date(now - 40 * 60000).toISOString(), due_at: new Date(now + 140 * 60000).toISOString(),
    unloaded_at: null, unloaded_by: null, unload_photo_url: null, count_in: 4, start_edited_at: null,
  };
  const corrected = {
    ...snap.chicken_marinations.find((m) => m.team_id === k), id: 'aaaaaaaa-0000-4000-8000-00000000cafe',
    original_marinated_at: '2026-09-25T10:54:17Z', start_edited_by: profileBy('kayes11').id, start_edited_at: '2026-09-25T11:30:00Z',
    start_edit_reason: 'Mohamad forgot to record it when it went in',
  };
  const rows = [active, corrected, ...snap.chicken_marinations.filter((m) => m.id !== corrected.id)];
  s = await open('kayes11', { tables: { chicken_marinations: rows } });
  page = s.page;
  await page.screenshot({ path: `${OUT}/s5-b-manager.png` });
  const pencil = page.getByTestId('edit-start').first();
  console.log('pencil on active batch:', await pencil.isVisible().catch(() => false));
  await pencil.click();
  await page.waitForTimeout(800);
  await page.getByTestId('edit-start-reason').fill('He put it in at 20 past and forgot to record it');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/s5-c-edit-sheet.png` });
  await page.getByText('Save correction', { exact: true }).click();
  await page.waitForTimeout(1200);
  const edit = s.state.calls.filter((c) => c.includes('edit_marination_start'));
  console.log('edit sent:', edit.length, JSON.stringify(edit));
  // History → marination day → report
  await page.getByText('History', { exact: true }).last().click();
  await page.waitForTimeout(2500);
  const day = page.getByText(/records?$/).first();
  await day.scrollIntoViewIfNeeded().catch(() => {});
  // the marination section's first day row
  const chickenDay = page.locator('text=Chicken marination').last();
  await chickenDay.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/s5-d-history.png` });
  // Chicken marination → Karbala → the first day
  await page.getByText(/^17 records$/).first().click();
  await page.waitForTimeout(1200);
  const dayRows = page.getByText(/^\d+ records?$/);
  console.log('day rows visible:', await dayRows.count());
  await dayRows.first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/s5-e-day.png` });
  await page.evaluate(() => {
    const orig = HTMLElement.prototype.remove;
    window.__reports = [];
    HTMLElement.prototype.remove = function () {
      if (this.style && this.style.left === '-10000px') window.__reports.push(this.innerText);
      return orig.call(this);
    };
  });
  await page.getByTestId('marination-export').click();
  await page.getByTestId('marination-share').waitFor({ timeout: 45000 }).catch(() => {});
  console.log('share button:', await page.getByTestId('marination-share').isVisible().catch(() => false));
  console.log('REPORT TEXT >>>\n' + (await page.evaluate(() => (window.__reports || [])[0] || 'none')) + '\n<<<');
  await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
    page.getByTestId('marination-share').click().catch(() => {}),
  ]);
  if (dl) {
    const pdf = `${OUT}/s5-report.pdf`;
    await dl.saveAs(pdf);
    execSync(`sips -s format png "${pdf}" --out "${OUT}/s5-f-report.png" >/dev/null 2>&1 || true`);
    console.log('pdf bytes:', fs.statSync(pdf).size);
  } else console.log('no download');
  console.log('errors (manager):', s.errors.filter((e) => !e.includes('user gesture')).slice(0, 3));
  await s.browser.close();
})();
