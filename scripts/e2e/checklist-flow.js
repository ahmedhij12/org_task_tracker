// Verifies the checklist feature end to end: template creation, downward-only
// assignment, filling and submitting (note required on "No"), history
// visibility, and the off-duty claim -> reject -> immediately-due-again flow.
//
// Unlike task proof photos, checklist photos are always optional, so this
// whole flow — unlike camera capture — is fully testable on web.
//
// Rewritten 2026-08-27: checklists no longer have a dedicated tab. A
// template is created inline from "+ New template" on the create-task
// screen, and a task is assigned to someone from that same screen right
// after. Review of a pending off-duty claim happens through History's
// "Needs review" filter -> tapping the row opens CompletionDetailSheet.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Requires SUPABASE_ACCESS_TOKEN in the environment (see _otp_bypass.js).
// Run: node scripts/e2e/checklist-flow.js
const { chromium } = require('playwright');
const { bypassSignupEmailConfirmation } = require('./_otp_bypass');

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

// Opens "+ New template" from an already-open create-task sheet, builds a
// blank template with the given questions in one section, and saves it.
// Leaves the create-task sheet open with the new template selectable.
async function createChecklistTemplate(page, name, questions) {
  await page.getByText('New template', { exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByText('Blank', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder('e.g. Daily Hygiene Checklist', { exact: true }).fill(name);
  for (const q of questions) {
    await page.getByPlaceholder('Type a question', { exact: true }).fill(q);
    await page.getByText('+ Add question', { exact: true }).click();
    await page.waitForTimeout(300);
  }
  await page.getByText('Create template', { exact: true }).click();
  await page.waitForTimeout(1500);
}

// Assumes the create-task sheet is open with `templateName` now selectable.
async function assignChecklistTask(page, templateName, taskTitle, assigneeName) {
  await page.getByText(templateName, { exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(taskTitle);
  await page.getByText(assigneeName, { exact: true }).last().click();
  await page.getByText('Create task', { exact: true }).last().click();
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `cko${runId % 100000}`;
  const empUsername = `cke${runId % 100000}`;
  const temp = 'initial123';
  const empPassword = 'empchosen123';

  // ── Owner sets up org + employee, then two checklist tasks ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Riverside Cafe', { exact: true }).fill('CkOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Ck');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  const ownerEmail = `ahmed.hijazi089+e2e-ck${runId}@gmail.com`;
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(ownerEmail);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill('testpass123');
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  await bypassSignupEmailConfirmation(ownerEmail);
  await pageA.locator('[aria-label^="Verification code"]').fill('000000');
  await pageA.waitForTimeout(4000);

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
  await pageA.getByText('Main Team', { exact: true }).last().click();
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(1000);

  // Template 1 + its task: to fill and submit.
  await pageA.getByText('Dashboard', { exact: true }).last().click();
  await pageA.waitForTimeout(800);
  await pageA.getByRole('button', { name: 'Add task' }).click();
  await pageA.waitForTimeout(1000);
  await createChecklistTemplate(pageA, 'Opening Checklist', ['Is the floor clean?', 'Are the lights working?']);
  await assignChecklistTask(pageA, 'Opening Checklist', 'Opening Checklist', 'Checklist Worker');

  // Template 2 + its task: to test the off-duty flow, left unanswered.
  await pageA.getByRole('button', { name: 'Add task' }).click();
  await pageA.waitForTimeout(1000);
  await createChecklistTemplate(pageA, 'Evening Checklist', ['Is the safe locked?']);
  await assignChecklistTask(pageA, 'Evening Checklist', 'Evening Checklist', 'Checklist Worker');

  const boardText = await pageA.locator('body').innerText();
  if (!/Opening Checklist/.test(boardText) || !/Evening Checklist/.test(boardText)) {
    throw new Error('FAIL: both checklist tasks should exist, got: ' + boardText.slice(0, 500));
  }
  console.log('PASS: owner created two checklist templates and assigned a task from each');
  console.log('Owner-side errors so far:', JSON.stringify(errorsA));

  // ── Employee signs in, sets a password, fills the Opening Checklist ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));

  await signIn(pageB, orgCode, empUsername, temp);
  await setOwnPassword(pageB, empPassword);

  const dueText = await pageB.locator('body').innerText();
  if (!/Opening Checklist/.test(dueText) || !/Evening Checklist/.test(dueText)) {
    throw new Error('FAIL: employee should see both checklist tasks pending, got: ' + dueText.slice(0, 400));
  }
  console.log('PASS: the employee sees both assigned checklists pending');

  await pageB.getByRole('checkbox', { name: /Opening Checklist/i }).click();
  await pageB.waitForTimeout(1000);

  // Submit is disabled with nothing answered yet.
  const beforeAnswer = await pageB.locator('body').innerText();
  if (!/left to answer/i.test(beforeAnswer)) {
    throw new Error('FAIL: expected a "left to answer" hint before answering, got: ' + beforeAnswer.slice(0, 300));
  }

  // Answer "Yes" on the first question, "No" on the second — a "No" needs a note.
  await pageB.getByText('Yes', { exact: true }).first().click();
  await pageB.waitForTimeout(200);
  await pageB.getByText('No', { exact: true }).last().click();
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

  await pageB.getByText('History', { exact: true }).last().click();
  await pageB.waitForTimeout(1500);
  const empHistoryAfterSubmit = await pageB.locator('body').innerText();
  if (!/Opening Checklist/.test(empHistoryAfterSubmit) || !/1 yes \/ 1 no/.test(empHistoryAfterSubmit)) {
    throw new Error('FAIL: expected Opening Checklist in history with 1 yes / 1 no, got: ' + empHistoryAfterSubmit.slice(0, 500));
  }
  console.log('PASS: submitting records the checklist in history with the right yes/no count');

  // ── Employee declares off-duty on the Evening Checklist ──
  await pageB.getByText('My Tasks', { exact: true }).last().click();
  await pageB.waitForTimeout(1000);
  await pageB.getByRole('checkbox', { name: /Evening Checklist/i }).click();
  await pageB.waitForTimeout(800);
  await pageB.getByText('Not on duty today?', { exact: true }).last().click();
  await pageB.waitForTimeout(500);
  await pageB.getByPlaceholder("Why aren't you on duty today?", { exact: true }).fill('Approved day off');
  await pageB.getByText('Send', { exact: true }).last().click();
  await pageB.waitForTimeout(2500);

  await pageB.getByText('History', { exact: true }).last().click();
  await pageB.waitForTimeout(1500);
  const empHistoryAfterOffDuty = await pageB.locator('body').innerText();
  if (!/Evening Checklist/.test(empHistoryAfterOffDuty) || !/Off duty claimed/i.test(empHistoryAfterOffDuty)) {
    throw new Error('FAIL: expected the off-duty claim in history, got: ' + empHistoryAfterOffDuty.slice(0, 500));
  }
  if (!/NEEDS REVIEW/.test(empHistoryAfterOffDuty)) {
    throw new Error('FAIL: an off-duty claim should be flagged as needing review, got: ' + empHistoryAfterOffDuty.slice(0, 500));
  }
  console.log('PASS: declaring off-duty records a claim that needs review, and does not silently clear the checklist');
  console.log('Employee-side errors so far:', JSON.stringify(errorsB));

  // ── Owner sees both in History, and rejects the off-duty claim ──
  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(3000);
  await pageA.getByText('History', { exact: true }).last().click();
  await pageA.waitForTimeout(1500);

  const ownerHistory = await pageA.locator('body').innerText();
  if (!/Opening Checklist/.test(ownerHistory) || !/Evening Checklist/.test(ownerHistory)) {
    throw new Error('FAIL: owner should see both checklist entries org-wide, got: ' + ownerHistory.slice(0, 500));
  }
  console.log('PASS: the owner sees both checklist entries org-wide');

  await pageA.getByText(/Needs review/, { exact: false }).first().click();
  await pageA.waitForTimeout(800);
  await pageA.getByText('Evening Checklist', { exact: true }).first().click();
  await pageA.waitForTimeout(800);
  const reviewSheet = await pageA.locator('body').innerText();
  if (!/Waiting for review/i.test(reviewSheet)) {
    throw new Error('FAIL: expected the review sheet to show it is waiting for review, got: ' + reviewSheet.slice(0, 400));
  }
  await pageA.getByPlaceholder('Note (optional) — e.g. what HR confirmed', { exact: true }).fill('HR shows no approved day off on file');
  await pageA.getByText('Not confirmed', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  console.log('PASS: owner rejected the off-duty claim');

  // ── Rejected off-duty is immediately pending again, not waiting on cooldown ──
  await pageB.reload({ waitUntil: 'networkidle' });
  await pageB.waitForTimeout(3000);
  await pageB.getByText('My Tasks', { exact: true }).last().click();
  await pageB.waitForTimeout(1500);
  const empAfterReject = await pageB.locator('body').innerText();
  if (!/Evening Checklist/.test(empAfterReject)) {
    throw new Error('FAIL: a rejected off-duty claim should make the checklist pending again immediately, got: ' + empAfterReject.slice(0, 500));
  }
  console.log('PASS: a rejected off-duty claim is immediately pending again, not on cooldown');

  await ctxA.close();
  await ctxB.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
