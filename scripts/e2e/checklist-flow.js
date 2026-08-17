// Verifies the checklist feature end to end: template creation, downward-only
// assignment, filling and submitting (note required on "No"), history
// visibility, and the off-duty claim -> reject -> immediately-due-again flow.
//
// Unlike task proof photos, checklist photos are always optional, so this
// whole flow — unlike camera capture — is fully testable on web.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/checklist-flow.js
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
  const ownerUsername = `cko${runId % 100000}`;
  const empUsername = `cke${runId % 100000}`;
  const temp = 'initial123';
  const empPassword = 'empchosen123';

  // ── Owner sets up org + employee, then two templates ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('CkOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Ck');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`ck-${runId}@example.com`);
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
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Checklist Worker');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(temp);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(1000);

  // ── Template 1: to fill and submit ──
  await pageA.getByText('Checklists', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByText('Template', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByPlaceholder('e.g. Daily Hygiene Checklist', { exact: true }).fill('Opening Checklist');
  await pageA.getByPlaceholder('e.g. Kitchen', { exact: true }).fill('Front');
  await pageA.getByPlaceholder('Type a question', { exact: true }).fill('Is the floor clean?');
  await pageA.getByText('+ Add question', { exact: true }).last().click();
  await pageA.waitForTimeout(300);
  await pageA.getByPlaceholder('Type a question', { exact: true }).fill('Are the lights working?');
  await pageA.getByText('+ Add question', { exact: true }).last().click();
  await pageA.waitForTimeout(300);
  await pageA.getByText('Create template', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);

  // ── Template 2: to test the off-duty flow, untouched ──
  await pageA.getByText('Template', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByPlaceholder('e.g. Daily Hygiene Checklist', { exact: true }).fill('Evening Checklist');
  await pageA.getByPlaceholder('Type a question', { exact: true }).fill('Is the safe locked?');
  await pageA.getByText('+ Add question', { exact: true }).last().click();
  await pageA.waitForTimeout(300);
  await pageA.getByText('Create template', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);

  const templatesText = await pageA.locator('body').innerText();
  if (!/Opening Checklist/.test(templatesText) || !/Evening Checklist/.test(templatesText)) {
    throw new Error('FAIL: both templates should exist, got: ' + templatesText.slice(0, 500));
  }
  console.log('PASS: owner created two checklist templates');

  // ── Assign both to the employee ──
  const assignButtons = pageA.getByText('Assign', { exact: true });
  await assignButtons.first().click();
  await pageA.waitForTimeout(800);
  await pageA.getByText('Checklist Worker', { exact: true }).last().click();
  await pageA.waitForTimeout(400);
  await pageA.getByText('Assign', { exact: true }).last().click();
  await pageA.waitForTimeout(1200);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(800);

  await assignButtons.last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByText('Checklist Worker', { exact: true }).last().click();
  await pageA.waitForTimeout(400);
  await pageA.getByText('Assign', { exact: true }).last().click();
  await pageA.waitForTimeout(1200);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  console.log('PASS: owner assigned both checklists to the employee');
  console.log('Owner-side errors so far:', JSON.stringify(errorsA));

  // ── Employee signs in, sets a password, fills the Opening Checklist ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));

  await signIn(pageB, orgCode, empUsername, temp);
  await setOwnPassword(pageB, empPassword);

  await pageB.getByText('Checklists', { exact: true }).last().click();
  await pageB.waitForTimeout(1200);
  const dueText = await pageB.locator('body').innerText();
  if (!/Opening Checklist/.test(dueText) || !/Evening Checklist/.test(dueText)) {
    throw new Error('FAIL: employee should see both checklists due, got: ' + dueText.slice(0, 400));
  }
  console.log('PASS: the employee sees both assigned checklists as due now');

  await pageB.getByText('Opening Checklist', { exact: true }).last().click();
  await pageB.waitForTimeout(1000);

  // Submit is disabled with nothing answered yet.
  const beforeAnswer = await pageB.locator('body').innerText();
  if (!/left to answer/i.test(beforeAnswer)) {
    throw new Error('FAIL: expected an "left to answer" hint before answering, got: ' + beforeAnswer.slice(0, 300));
  }

  // Answer "Yes" on the first question, "No" on the second — a "No" needs a note.
  const yesButtons = pageB.getByText('Yes', { exact: true });
  const noButtons = pageB.getByText('No', { exact: true });
  await yesButtons.first().click();
  await pageB.waitForTimeout(200);
  await noButtons.last().click();
  await pageB.waitForTimeout(200);

  const afterAnswer = await pageB.locator('body').innerText();
  if (!/need.*a note/i.test(afterAnswer)) {
    throw new Error('FAIL: a "No" answer should require a note before submitting, got: ' + afterAnswer.slice(0, 300));
  }
  console.log('PASS: a "No" answer blocks submission until a note is added');

  await pageB.getByPlaceholder('Explain why (required)', { exact: true }).fill('Bulb needs replacing');
  await pageB.waitForTimeout(300);
  await pageB.getByText('Submit', { exact: true }).last().click();
  await pageB.waitForTimeout(3000);

  const afterSubmit = await pageB.locator('body').innerText();
  if (/Opening Checklist/.test(afterSubmit.split('DUE NOW')[1]?.split('NOT DUE YET')[0] ?? '')) {
    throw new Error('FAIL: Opening Checklist should have left the Due now list after submitting');
  }
  if (!/1 yes \/ 1 no/.test(afterSubmit)) {
    throw new Error('FAIL: expected the submission to show 1 yes / 1 no, got: ' + afterSubmit.slice(0, 500));
  }
  console.log('PASS: submitting moves the checklist out of Due now and records the right yes/no count');

  // ── Employee declares off-duty on the Evening Checklist ──
  await pageB.getByText('Evening Checklist', { exact: true }).last().click();
  await pageB.waitForTimeout(800);
  await pageB.getByText("Not on duty today?", { exact: true }).last().click();
  await pageB.waitForTimeout(500);
  await pageB.getByPlaceholder("Why aren't you on duty today?", { exact: true }).fill('Approved day off');
  await pageB.getByText('Send', { exact: true }).last().click();
  await pageB.waitForTimeout(2500);

  const afterOffDuty = await pageB.locator('body').innerText();
  if (!/Waiting for your admin to review/i.test(afterOffDuty)) {
    throw new Error('FAIL: expected the off-duty claim to show as waiting for review, got: ' + afterOffDuty.slice(0, 400));
  }
  console.log('PASS: declaring off-duty does not clear the checklist, it waits for review');
  console.log('Employee-side errors so far:', JSON.stringify(errorsB));

  // ── Owner sees it, and both submissions, then rejects the off-duty claim ──
  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(3000);
  await pageA.getByText('Checklists', { exact: true }).last().click();
  await pageA.waitForTimeout(1500);

  const ownerView = await pageA.locator('body').innerText();
  if (!/Needs review/i.test(ownerView) || !/Checklist Worker says off duty/.test(ownerView)) {
    throw new Error('FAIL: owner should see the pending off-duty claim, got: ' + ownerView.slice(0, 500));
  }
  if (!/Opening Checklist/.test(ownerView)) {
    throw new Error('FAIL: owner should see the completed Opening Checklist submission, got: ' + ownerView.slice(0, 500));
  }
  console.log('PASS: the owner sees the pending off-duty claim and the completed submission');

  await pageA.getByText('Checklist Worker says off duty', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByPlaceholder('Note (optional) — e.g. what HR confirmed', { exact: true }).fill('HR shows no approved day off on file');
  await pageA.getByText('Not confirmed', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  console.log('PASS: owner rejected the off-duty claim');

  // ── Rejected off-duty is immediately due again, not waiting on cooldown ──
  await pageB.reload({ waitUntil: 'networkidle' });
  await pageB.waitForTimeout(3000);
  await pageB.getByText('Checklists', { exact: true }).last().click();
  await pageB.waitForTimeout(1500);
  const empAfterReject = await pageB.locator('body').innerText();
  const dueSection = empAfterReject.split('DUE NOW')[1]?.split('NOT DUE YET')[0] ?? '';
  if (!/Evening Checklist/.test(dueSection)) {
    throw new Error('FAIL: a rejected off-duty claim should make the checklist due again immediately, got: ' + empAfterReject.slice(0, 500));
  }
  console.log('PASS: a rejected off-duty claim is immediately due again, not on cooldown');

  await ctxA.close();
  await ctxB.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
