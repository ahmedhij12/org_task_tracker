// Drives the REAL web build in a headless browser, signs in as a supervisor
// and measures the bottom tab labels against their tab's clipping bounds, in
// both languages. Written after shipping three UI "fixes" that each broke
// something else, because layout is checkable here and guessing is not.
//
// Usage:
//   npx expo export -p web
//   npx serve dist -s -l 4173 &
//   node scripts/dev/verify-ui.js
const OUT = '/private/tmp/claude-501/-Users-ahmedhijazi/ca8e3e29-de00-4081-af05-fbe01d3276d8/scratchpad';

const probe = () =>
  // eslint-disable-next-line no-undef
  Array.from(document.querySelectorAll('[role="tab"], [data-testid*="tab"]')).map((tab) => {
    const r = tab.getBoundingClientRect();
    const texts = Array.from(tab.querySelectorAll('div,span'))
      .filter((n) => n.children.length === 0 && n.textContent.trim())
      .map((n) => {
        const b = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        return { text: n.textContent.trim(), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1),
                 fontSize: cs.fontSize, lineHeight: cs.lineHeight };
      });
    return { tabTop: +r.top.toFixed(1), tabBottom: +r.bottom.toFixed(1), texts };
  });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.getByText('Sign in', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  const b = await page.locator('input').all();
  await b[0].fill('51880'); await b[1].fill('ob12'); await b[2].fill('123123');
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForTimeout(9000);
  for (const l of ['Done', 'Skip', 'Not now']) {
    const el = page.getByText(l, { exact: true }).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) { await el.click().catch(() => {}); await page.waitForTimeout(1500); }
  }
  await page.waitForTimeout(2000);

  const report = (lang, rows) => {
    console.log(`\n=== ${lang} ===`);
    for (const t of rows) {
      for (const x of t.texts) {
        const overflow = +(x.bottom - t.tabBottom).toFixed(1);
        const verdict = overflow > 0 ? `CLIPPED by ${overflow}px` : `ok (${Math.abs(overflow)}px clear)`;
        console.log(`  "${x.text}"  font=${x.fontSize} line=${x.lineHeight}  textBottom=${x.bottom} tabBottom=${t.tabBottom}  -> ${verdict}`);
      }
    }
  };

  report('ENGLISH', await page.evaluate(probe));

  await page.getByText('Settings', { exact: true }).last().click();
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(1200);
  await page.getByText('العربية', { exact: true }).first().click();
  await page.waitForTimeout(3500);

  report('ARABIC', await page.evaluate(probe));
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
