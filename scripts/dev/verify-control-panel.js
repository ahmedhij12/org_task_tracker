// Headless check of the control panel and the admin navigation against a real
// web build.
//   npx expo export -p web && npx serve dist -s -l 4173 &
//   node scripts/dev/verify-control-panel.js
// It changes ONE live value — Baghdad's check-in distance, by 1 m — through
// the real UI, and puts it back in a finally block. Everything else is read-only.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};
const visible = async (page, text, exact = false) =>
  page.getByText(text, { exact }).first().isVisible().catch(() => false);

// Tab screens stay mounted underneath the current one, each with its own menu
// button, so "the first visible one" is often covered. Click the one that is
// actually on top at its own centre.
async function clickTopmost(page, testId) {
  const handles = await page.getByTestId(testId).elementHandles();
  for (const h of handles) {
    const onTop = await h.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    if (onTop) return h.click();
  }
  throw new Error(`no ${testId} on top`);
}
async function isOnTop(page, testId) {
  return (await page.getByTestId(testId).elementHandles()).length
    ? (await Promise.all((await page.getByTestId(testId).elementHandles()).map((h) => h.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = r.width && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && el.contains(hit);
      })))).some(Boolean)
    : false;
}

async function signIn(page, username) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByText('Sign in', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const inputs = await page.locator('input').all();
  await inputs[0].fill('51880');
  await inputs[1].fill(username);
  await inputs[2].fill('123123');
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForTimeout(9000);
  // First-login popups (permissions, reinstall notice) cover the screen.
  for (const l of ['Done', 'Skip', 'Not now', 'Later']) {
    const el = page.getByText(l, { exact: true }).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
}

(async () => {
  const browser = await chromium.launch();

  // ── Super admin ──────────────────────────────────────────────────────
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(owner, 'hijazi12');
  check(await isOnTop(owner, 'start-audit'), 'hygiene audit card on the dashboard');
  check(await visible(owner, 'SUPER ADMIN', true), 'dashboard badge reads SUPER ADMIN');

  await owner.getByText('Settings', { exact: true }).last().click();
  await owner.waitForTimeout(2500);
  check(await owner.getByTestId('open-control-panel').isVisible().catch(() => false), 'Control panel row in Settings');
  check(await owner.getByTestId('open-activity').isVisible().catch(() => false), 'Admin activity row in Settings (super admin)');
  check(!(await visible(owner, 'Save point value')), 'point value is gone from Settings');

  await owner.getByTestId('open-control-panel').click();
  await owner.waitForTimeout(2500);
  for (const text of ['Point value', 'Check-in distance', 'Manage fryers', 'All branches']) {
    check(await visible(owner, text), `control panel shows "${text}"`);
  }
  await owner.screenshot({ path: `${OUT}/cp-panel.png`, fullPage: true });

  // Change Baghdad by 1 m through the UI, read it back, restore it.
  const row = owner.getByTestId('distance-Baghdad');
  const before = Number(((await row.innerText()).match(/(\d+) m now/) || [])[1]);
  check(Number.isInteger(before), "read Baghdad's current distance", `${before} m`);
  const target = before === 2000 ? before - 1 : before + 1;
  try {
    await row.locator('input').fill(String(target));
    await row.getByText('Save', { exact: true }).click();
    await owner.waitForTimeout(3000);
    check(await visible(owner, `Baghdad: ${target} m.`), 'save notice shown', `${target} m`);
    check((await row.innerText()).includes(`${target} m now`), 'Baghdad now reads the new distance');
  } finally {
    await row.locator('input').fill(String(before));
    await row.getByText('Save', { exact: true }).click().catch(() => {});
    await owner.waitForTimeout(3000);
    check((await row.innerText()).includes(`${before} m now`), 'Baghdad restored', `${before} m`);
  }

  // Side menu: what the bar dropped is reachable here.
  await clickTopmost(owner, 'open-side-menu');
  await owner.waitForTimeout(1200);
  for (const x of ['Checklists', 'Report', 'Control panel', 'Admin activity']) check(await visible(owner, x, true), `side menu has "${x}"`);
  await owner.getByText('Checklists', { exact: true }).last().click();
  await owner.waitForTimeout(3500);

  // Every checklist that shows where it was signed also says how far from its branch.
  let located = 0;
  let flagged = 0;
  for (const branch of ['Baghdad', 'Karbala']) {
    const head = owner.getByText(branch, { exact: true }).first();
    if (!(await head.isVisible().catch(() => false))) continue;
    await head.click();
    await owner.waitForTimeout(800);
    const rows = owner.getByText(/ yes · /);
    const n = Math.min(await rows.count(), 2);
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click();
      await owner.waitForTimeout(2500);
      const loc = await owner.getByText(/Submitted here|Signed here/).first().isVisible().catch(() => false);
      const flag = await owner.getByText(/At the branch ·|Outside the branch ·/).first().isVisible().catch(() => false);
      if (loc) located++;
      if (loc && flag) flagged++;
      await owner.getByText('Close', { exact: true }).last().click().catch(() => {});
      await owner.waitForTimeout(1000);
    }
    await head.click().catch(() => {});
    await owner.waitForTimeout(500);
  }
  check(located > 0 && flagged === located, 'every located checklist says how far from its branch', `${flagged}/${located}`);

  // ── Supervisor ───────────────────────────────────────────────────────
  const sup = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(sup, 'ob12');
  check(!(await isOnTop(sup, 'open-side-menu')), 'supervisor has no menu');
  await sup.getByText('Settings', { exact: true }).last().click();
  await sup.waitForTimeout(2500);
  check(!(await sup.getByTestId('open-control-panel').isVisible().catch(() => false)), 'supervisor has no Control panel row');
  check(!(await sup.getByTestId('open-activity').isVisible().catch(() => false)), 'supervisor has no Admin activity row');
  for (const path of ['control-panel', 'activity']) {
    await sup.goto(new URL(path, BASE).toString(), { waitUntil: 'domcontentloaded' });
    await sup.waitForTimeout(6000);
    check(!(await visible(sup, path === 'activity' ? 'Admin activity' : 'Check-in distance')), `supervisor typing /${path} gets nothing`);
  }

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
