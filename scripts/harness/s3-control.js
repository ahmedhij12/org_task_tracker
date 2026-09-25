// Super admin: control panel — checklist deadline editor (Safari time boxes)
// and the push test's per-person reach lines.
const { open, snap, profileBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
(async () => {
  const states = { karam12: ['registered', 1], ob12: ['registered', 1], fatima: ['default', 0], mhmd: ['needs-install', 0], oday: ['error', 0], kayes11: ['denied', 0] };
  const s = await open('hijazi12', {
    rpc: {
      push_overview: () => snap.profiles.filter((p) => !p.deleted_at && p.active).map((p) => {
        const [state, phones] = states[p.username] || [null, 0];
        return { profile_id: p.id, phones, state, detail: state === 'error' ? 'AbortError: push service not available' : null, standalone: true, checked_at: new Date().toISOString() };
      }),
    },
  });
  const { page, errors } = s;
  await page.getByTestId('open-side-menu').first().click();
  await page.waitForTimeout(600);
  await page.getByText('Control panel', { exact: true }).last().click();
  await page.waitForTimeout(2500);
  const baghdad = page.getByTestId('deadline-Baghdad');
  await baghdad.scrollIntoViewIfNeeded();
  await baghdad.click();
  await page.waitForTimeout(800);
  const editor = page.getByTestId('deadline-edit-Baghdad');
  await editor.screenshot({ path: `${OUT}/s3-a-deadline-editor.png` });
  // measure: does each time box fit inside the card?
  const fit = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input.bd-time'));
    return inputs.map((i) => {
      const r = i.getBoundingClientRect();
      const holder = i.parentElement.getBoundingClientRect();
      return { w: Math.round(r.width), right: Math.round(r.right), holderRight: Math.round(holder.right), font: getComputedStyle(i).fontFamily.slice(0, 30) };
    });
  });
  console.log('time boxes:', JSON.stringify(fit));
  await page.getByTestId('deadline-mode-day').click();
  await page.waitForTimeout(400);
  await editor.screenshot({ path: `${OUT}/s3-b-perday.png` });
  // push test, chosen people
  const push = page.getByText('Chosen people', { exact: true });
  await push.scrollIntoViewIfNeeded();
  await push.click();
  await page.waitForTimeout(800);
  await page.getByText('Send test', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/s3-c-reach.png` });
  for (const n of ['Karam', 'Fatima sattar', 'Mohamad', 'Oday', 'Kayes']) console.log(n, '→', await page.getByTestId(`reach-${n}`).innerText().catch(() => '?'));
  console.log('errors:', errors.filter((e) => !e.includes('user gesture')).slice(0, 4));
  await s.browser.close();
})();
