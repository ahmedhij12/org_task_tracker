// Verifies that an admin-created account is forced to change its password
// before it can reach the main app, and lands in the app afterwards.
//
// This is the test that matters most: it proves GoTrue actually accepts a
// login for an account whose auth.users row was written by admin_create_user
// rather than by supabase.auth.signUp().
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/forced-password-change.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8081/';
const PASSWORD = 'testpass123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `owner${runId % 100000}`;
  const empUsername = `emp${runId % 100000}`;
  const initialPassword = 'initial123';
  const newPassword = 'chosen456';

  // ── Owner creates the org, then creates an employee account ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));
  pageA.on('response', async (res) => {
    if (res.status() >= 400) {
      let body = '';
      try { body = await res.text(); } catch {}
      errorsA.push(`${res.status()} ${res.url().slice(0, 90)} :: ${body.slice(0, 200)}`);
    }
  });

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('PwOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Pw');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`owner-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(PASSWORD);
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  await pageA.getByText('Settings', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  const settingsText = await pageA.locator('body').innerText();
  const idMatch = settingsText.match(/ID:\s*([A-Z0-9]+)/);
  const orgCode = idMatch ? idMatch[1] : null;
  if (!orgCode) throw new Error('Could not read the org code from Settings');
  console.log('Org code:', orgCode);

  await pageA.getByText('People', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('Add person', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Forced Change');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(initialPassword);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  const afterCreate = await pageA.locator('body').innerText();
  if (!/Account created/i.test(afterCreate)) {
    throw new Error('FAIL: account creation did not confirm, got: ' + afterCreate.slice(0, 300));
  }
  console.log('PASS: owner created an account');
  console.log('Owner-side errors:', JSON.stringify(errorsA));
  await ctxA.close();

  // ── The employee signs in and must be sent to the change-password screen ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));
  pageB.on('response', async (res) => {
    if (res.status() >= 400) {
      let body = '';
      try { body = await res.text(); } catch {}
      errorsB.push(`${res.status()} ${res.url().slice(0, 90)} :: ${body.slice(0, 200)}`);
    }
  });

  await pageB.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageB.getByText('Sign in', { exact: true }).click();
  await pageB.waitForTimeout(400);
  await pageB.getByPlaceholder('e.g. 48213', { exact: true }).fill(orgCode);
  await pageB.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageB.getByPlaceholder('Your password', { exact: true }).fill(initialPassword);
  await pageB.getByText('Sign in', { exact: true }).last().click();
  await pageB.waitForTimeout(4000);

  const forcedText = await pageB.locator('body').innerText();
  console.log('After sign-in:', forcedText.slice(0, 220).replace(/\n/g, ' | '));
  console.log('Employee-side errors:', JSON.stringify(errorsB));
  if (!/Set your password/i.test(forcedText)) {
    throw new Error('FAIL: expected the forced password change screen, got: ' + forcedText.slice(0, 250));
  }
  console.log('PASS: an admin-created account can sign in, and is forced to change its password');

  // ── Setting a new password lets them into the app ──
  await pageB.getByPlaceholder('At least 6 characters', { exact: true }).fill(newPassword);
  await pageB.getByPlaceholder('Re-enter your new password', { exact: true }).fill(newPassword);
  await pageB.getByText('Save password', { exact: true }).last().click();
  await pageB.waitForTimeout(4000);

  const appText = await pageB.locator('body').innerText();
  console.log('After change:', appText.slice(0, 220).replace(/\n/g, ' | '));
  if (/Set your password/i.test(appText)) {
    throw new Error('FAIL: still stuck on the change-password screen');
  }
  if (!/My Tasks/i.test(appText)) {
    throw new Error('FAIL: expected to land in the app, got: ' + appText.slice(0, 250));
  }
  console.log('PASS: landed in the app after changing the password');
  await ctxB.close();

  // ── The new password works on a fresh sign-in, the old one does not ──
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.setViewportSize({ width: 420, height: 900 });
  await pageC.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageC.getByText('Sign in', { exact: true }).click();
  await pageC.waitForTimeout(400);
  await pageC.getByPlaceholder('e.g. 48213', { exact: true }).fill(orgCode);
  await pageC.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageC.getByPlaceholder('Your password', { exact: true }).fill(newPassword);
  await pageC.getByText('Sign in', { exact: true }).last().click();
  await pageC.waitForTimeout(4000);

  const reText = await pageC.locator('body').innerText();
  if (/Set your password/i.test(reText)) {
    throw new Error('FAIL: the forced-change flag was not cleared, it came back on re-login');
  }
  if (!/My Tasks/i.test(reText)) {
    throw new Error('FAIL: could not sign in again with the chosen password, got: ' + reText.slice(0, 250));
  }
  console.log('PASS: the self-chosen password works on a fresh sign-in and the flag stays cleared');
  await ctxC.close();

  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
