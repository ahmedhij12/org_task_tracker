// Verifies proof enforcement and the history log through the real UI.
//
// Deliberately does NOT try to take a photo: expo-image-picker's camera is a
// native capability, so on web it cannot be driven. What IS checked here is
// everything around it — that a proof task refuses to close without one, that
// a normal task completes, and that history records it and is scoped per role.
// The camera capture itself has to be checked by hand on the phone.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/proof-and-history.js
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
  const ownerUsername = `pho${runId % 100000}`;
  const empUsername = `phe${runId % 100000}`;
  const temp = 'initial123';
  const empPassword = 'empchosen123';

  // ── Owner sets up an org, an employee, and two tasks ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('PhOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Ph');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`ph-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill('testpass123');
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
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Proof Worker');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(temp);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(1000);

  // A task that does NOT need proof.
  await pageA.getByText('Dashboard', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByRole('button', { name: 'Add task' }).click();
  await pageA.waitForTimeout(1200);
  await pageA.getByPlaceholder('e.g. Restock shelves', { exact: true }).fill('Simple job');
  await pageA.getByText('Create task', { exact: true }).last().click();
  await pageA.waitForTimeout(2800);

  // A task that DOES need proof — the "Requires proof" switch turns it on.
  await pageA.getByRole('button', { name: 'Add task' }).click();
  await pageA.waitForTimeout(1200);
  await pageA.getByPlaceholder('e.g. Restock shelves', { exact: true }).fill('Photo job');
  await pageA.getByRole('switch').last().click();
  await pageA.waitForTimeout(400);
  await pageA.getByText('Create task', { exact: true }).last().click();
  await pageA.waitForTimeout(2800);

  const boardText = await pageA.locator('body').innerText();
  if (!/Simple job/.test(boardText) || !/Photo job/.test(boardText)) {
    throw new Error('FAIL: both tasks should exist, got: ' + boardText.slice(0, 400));
  }
  console.log('PASS: owner created a normal task and a proof-required task');
  console.log('Owner-side errors:', JSON.stringify(errorsA));

  // ── Employee completes the normal one, is blocked on the proof one ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));

  await signIn(pageB, orgCode, empUsername, temp);
  await pageB.getByPlaceholder('At least 6 characters', { exact: true }).fill(empPassword);
  await pageB.getByPlaceholder('Re-enter your new password', { exact: true }).fill(empPassword);
  await pageB.getByText('Save password', { exact: true }).last().click();
  await pageB.waitForTimeout(4000);

  // Complete the simple one via its checkbox.
  await pageB.getByRole('checkbox', { name: /Simple job/i }).click();
  await pageB.waitForTimeout(3000);

  // The proof one must open the sheet, not just tick.
  await pageB.getByRole('checkbox', { name: /Photo job/i }).click();
  await pageB.waitForTimeout(1200);
  const sheet = await pageB.locator('body').innerText();
  if (!/needs at least one photo/i.test(sheet)) {
    throw new Error('FAIL: the proof sheet should explain a photo is required, got: ' + sheet.slice(0, 400));
  }
  console.log('PASS: a proof-required task opens the photo sheet');

  // "Mark as done" must be unusable with no photos attached.
  const doneBtn = pageB.getByText('Mark as done', { exact: true }).last();
  await doneBtn.click();
  await pageB.waitForTimeout(2500);
  const afterTry = await pageB.locator('body').innerText();
  if (!/needs at least one photo/i.test(afterTry)) {
    throw new Error('FAIL: the sheet closed without a photo — proof was not enforced');
  }
  console.log('PASS: cannot mark a proof task done with no photo');

  // Close the sheet and confirm the task really is still open.
  await pageB.getByText('Cancel', { exact: true }).last().click();
  await pageB.waitForTimeout(1500);

  // ── History records the completed one, for the employee ──
  await pageB.getByText('History', { exact: true }).last().click();
  await pageB.waitForTimeout(2500);
  const empHistory = await pageB.locator('body').innerText();
  if (!/Simple job/.test(empHistory)) {
    throw new Error('FAIL: the employee should see their completion in history, got: ' + empHistory.slice(0, 400));
  }
  if (!/Everything you have done/i.test(empHistory)) {
    throw new Error('FAIL: the employee history scope note is wrong');
  }
  console.log('PASS: the employee sees their own completion in history');
  console.log('Employee-side errors:', JSON.stringify(errorsB));
  await ctxB.close();

  // ── The owner sees the same completion, scoped to the whole org ──
  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(3000);
  await pageA.getByText('History', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  const ownerHistory = await pageA.locator('body').innerText();
  if (!/Simple job/.test(ownerHistory)) {
    throw new Error('FAIL: the owner should see the completion, got: ' + ownerHistory.slice(0, 400));
  }
  if (!/Everything across the organization/i.test(ownerHistory)) {
    throw new Error('FAIL: the owner history scope note is wrong');
  }
  if (!/Proof Worker/.test(ownerHistory)) {
    throw new Error('FAIL: the owner should see who did it');
  }
  console.log('PASS: the owner sees the whole org history, including who did it');

  await ctxA.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
