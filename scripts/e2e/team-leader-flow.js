// Verifies the full hierarchy the org actually uses:
//   admin creates a team -> admin creates a team leader on it ->
//   the leader signs in, sets their own password, and creates an employee
//   on their own team -> that employee can sign in.
// Also checks that self-service join is gone.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/team-leader-flow.js
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

async function setOwnPassword(page, newPassword) {
  await page.getByPlaceholder('At least 6 characters', { exact: true }).fill(newPassword);
  await page.getByPlaceholder('Re-enter your new password', { exact: true }).fill(newPassword);
  await page.getByText('Save password', { exact: true }).last().click();
  await page.waitForTimeout(4000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `tlo${runId % 100000}`;
  const leaderUsername = `tll${runId % 100000}`;
  const empUsername = `tle${runId % 100000}`;
  const temp = 'initial123';
  const leaderPassword = 'leaderown123';
  const empPassword = 'empown123';

  // ── Self-service join must be gone from the landing screen ──
  const ctx0 = await browser.newContext();
  const page0 = await ctx0.newPage();
  await page0.setViewportSize({ width: 420, height: 900 });
  await page0.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const landing = await page0.locator('body').innerText();
  if (/Join an organization/i.test(landing)) {
    throw new Error('FAIL: the landing screen still offers "Join an organization"');
  }
  console.log('PASS: the landing screen no longer offers self-service join');
  await ctx0.close();

  // ── Owner creates the org, a second team, and a leader on that team ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('TlOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Tl');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`ownertl-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill('testpass123');
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  await pageA.getByText('Settings', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  const idMatch = (await pageA.locator('body').innerText()).match(/ID:\s*([A-Z0-9]+)/);
  const orgCode = idMatch ? idMatch[1] : null;
  if (!orgCode) throw new Error('Could not read the org code');
  console.log('Org code:', orgCode);

  // A second team, created the new way (name only).
  await pageA.getByText('Teams', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('Team', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByPlaceholder('e.g. Branch 2 - Downtown', { exact: true }).fill('Coach Team');
  await pageA.getByText('Create team', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  const teamsText = await pageA.locator('body').innerText();
  if (!/Coach Team/i.test(teamsText)) {
    throw new Error('FAIL: the new team was not created, got: ' + teamsText.slice(0, 300));
  }
  console.log('PASS: owner created a team with the simplified create_team');

  // A team leader on that new team.
  await pageA.getByText('People', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('Add person', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Team Leader');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(leaderUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(temp);
  await pageA.getByText('Team leader', { exact: true }).last().click();
  await pageA.waitForTimeout(300);
  await pageA.getByText('Coach Team', { exact: true }).last().click();
  await pageA.waitForTimeout(300);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  const createdText = await pageA.locator('body').innerText();
  if (!/Account created/i.test(createdText)) {
    throw new Error('FAIL: team leader was not created, got: ' + createdText.slice(0, 300));
  }
  console.log('PASS: owner created a team leader on a chosen team');
  console.log('Owner-side errors:', JSON.stringify(errorsA));
  await ctxA.close();

  // ── The leader signs in, sets a password, and creates an employee ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));

  await signIn(pageB, orgCode, leaderUsername, temp);
  const leaderForced = await pageB.locator('body').innerText();
  if (!/Set your password/i.test(leaderForced)) {
    throw new Error('FAIL: the leader should be forced to change password, got: ' + leaderForced.slice(0, 250));
  }
  await setOwnPassword(pageB, leaderPassword);

  const leaderApp = await pageB.locator('body').innerText();
  if (!/People/i.test(leaderApp)) {
    throw new Error('FAIL: a team leader should see the People tab, got: ' + leaderApp.slice(0, 250));
  }
  console.log('PASS: the team leader signed in, set a password, and sees the People tab');

  await pageB.getByText('People', { exact: true }).last().click();
  await pageB.waitForTimeout(600);
  const leaderPeople = await pageB.locator('body').innerText();
  if (/Owner Tl/i.test(leaderPeople)) {
    throw new Error('FAIL: a team leader must not see members outside their own team');
  }
  console.log('PASS: the team leader only sees their own team');

  await pageB.getByText('Add person', { exact: true }).last().click();
  await pageB.waitForTimeout(600);
  const sheetText = await pageB.locator('body').innerText();
  if (/Team leader/i.test(sheetText.split('New person')[1] ?? '')) {
    throw new Error('FAIL: the role picker must be hidden for a team leader');
  }
  await pageB.getByPlaceholder('e.g. Ali', { exact: true }).fill('Leader Employee');
  await pageB.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageB.getByPlaceholder('At least 6 characters', { exact: true }).fill(temp);
  await pageB.getByText('Create account', { exact: true }).last().click();
  await pageB.waitForTimeout(3000);
  const empCreated = await pageB.locator('body').innerText();
  if (!/Account created/i.test(empCreated)) {
    throw new Error('FAIL: the leader could not create an employee, got: ' + empCreated.slice(0, 300));
  }
  console.log('PASS: the team leader created an employee on their own team');
  console.log('Leader-side errors:', JSON.stringify(errorsB));
  await ctxB.close();

  // ── That employee can sign in ──
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.setViewportSize({ width: 420, height: 900 });
  await signIn(pageC, orgCode, empUsername, temp);
  const empForced = await pageC.locator('body').innerText();
  if (!/Set your password/i.test(empForced)) {
    throw new Error('FAIL: the leader-created employee should be forced to change password');
  }
  await setOwnPassword(pageC, empPassword);
  const empApp = await pageC.locator('body').innerText();
  if (!/My Tasks/i.test(empApp)) {
    throw new Error('FAIL: the employee did not reach the app, got: ' + empApp.slice(0, 250));
  }
  if (/People/i.test(empApp)) {
    throw new Error('FAIL: an employee must not see the People tab');
  }
  console.log('PASS: the leader-created employee signed in and has no People tab');
  await ctxC.close();

  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
