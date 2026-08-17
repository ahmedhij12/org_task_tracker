// Verifies that an admin can reset a user's password and deactivate them,
// and that both changes take effect at sign-in.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/manage-user.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8081/';

async function signIn(page, orgCode, username, password) {
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByText('Sign in', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('e.g. 48213', { exact: true }).fill(orgCode);
  await page.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(username);
  await page.getByPlaceholder('Your password', { exact: true }).fill(password);
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForTimeout(4000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `mgro${runId % 100000}`;
  const empUsername = `mgre${runId % 100000}`;
  const ownerPassword = 'testpass123';
  const initialPassword = 'initial123';
  const resetPassword = 'wasreset789';

  // ── Owner creates an org and an employee ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  // Deactivation confirms through Alert.alert, which is a native confirm on web.
  pageA.on('dialog', (d) => d.accept());
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('MgOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Mg');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`ownermg-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(ownerPassword);
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  await pageA.getByText('Settings', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  const idMatch = (await pageA.locator('body').innerText()).match(/ID:\s*([A-Z0-9]+)/);
  const orgCode = idMatch ? idMatch[1] : null;
  if (!orgCode) throw new Error('Could not read the org code');
  console.log('Org code:', orgCode);

  await pageA.getByText('People', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('Add person', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Managed User');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(initialPassword);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(1000);

  // ── Owner resets that user's password ──
  await pageA.getByText('Managed User', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(resetPassword);
  await pageA.getByText('Set new password', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  const afterReset = await pageA.locator('body').innerText();
  if (!/Password updated/i.test(afterReset)) {
    throw new Error('FAIL: expected a password-updated confirmation, got: ' + afterReset.slice(0, 300));
  }
  console.log('PASS: admin reset the password');

  // ── The reset password works and still forces a change ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  await signIn(pageB, orgCode, empUsername, resetPassword);
  const bText = await pageB.locator('body').innerText();
  if (!/Set your password/i.test(bText)) {
    throw new Error('FAIL: a reset password should still force a change, got: ' + bText.slice(0, 250));
  }
  console.log('PASS: the reset password works and forces a change');
  await ctxB.close();

  // ── Owner deactivates the user (two-step in-app confirm) ──
  await pageA.getByText('Deactivate account', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('Yes, deactivate', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  const afterDeactivate = await pageA.locator('body').innerText();
  if (!/INACTIVE/i.test(afterDeactivate)) {
    throw new Error('FAIL: the user should be shown as inactive, got: ' + afterDeactivate.slice(0, 400));
  }
  console.log('PASS: the user shows as inactive');

  // ── A deactivated user cannot sign in ──
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.setViewportSize({ width: 420, height: 900 });
  await signIn(pageC, orgCode, empUsername, resetPassword);
  const cText = await pageC.locator('body').innerText();
  if (!/No account found/i.test(cText)) {
    throw new Error('FAIL: a deactivated user should not be able to sign in, got: ' + cText.slice(0, 250));
  }
  console.log('PASS: a deactivated user cannot sign in');
  await ctxC.close();

  console.log('Owner-side errors:', JSON.stringify(errorsA));
  await ctxA.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
