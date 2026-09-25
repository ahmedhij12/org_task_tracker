// Super admin: dashboard deadlines card (all states), tap a late record →
// late block + excuse, and the update banner.
const { open, snap, teamBy, profileBy } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();

(async () => {
  const now = Date.now();
  const b = teamBy('Baghdad').id, k = teamBy('Karbala').id;
  const byUser = (u, day) => snap.task_completions.find((c) => c.actor_id === profileBy(u).id && c.created_at.startsWith(day));
  const obaida = byUser('ob12', '2026-09-25');
  const mhmd = byUser('mhmd', '2026-09-25');
  const lateId = 'c0ffee00-0000-4000-8000-00000000c0de';
  const odayTask = snap.tasks.find((t) => t.assignee_id === profileBy('oday').id && t.template_id?.startsWith('76bf89f1'));
  const late = {
    ...mhmd, id: lateId, task_id: odayTask.id, actor_id: profileBy('oday').id, subject_profile_id: profileBy('oday').id,
    created_at: iso(now - 2 * H), due_at: iso(now - 3 * H), was_late: true, checklist_slot: 'PM', checklist_day: '2026-09-25',
    note: 'The power was out and the tablet was dead until 9', reviewed_by: null, reviewed_at: null,
  };
  const s = await open('hijazi12', {
    liveBundle: 'ffffffffffffffffffffffffffffffff',
    tables: { task_completions: [late, ...snap.task_completions] },
    rpc: {
      checklist_today: (body) => {
        if (body.p_team === b) return [
          { slot: 'AM', due_at: iso(now - 15 * H), grace_min: 30, done_at: obaida.created_at, done_by: 'Obaida', was_late: null, on_shift: ['Obaida'], completion_id: obaida.id, excused: false },
          { slot: 'PM', due_at: iso(now - 4 * H), grace_min: 30, done_at: null, done_by: null, was_late: null, on_shift: ['Karam'], completion_id: null, excused: null },
        ];
        if (body.p_team === k) return [
          { slot: 'AM', due_at: iso(now - 15 * H), grace_min: 30, done_at: mhmd.created_at, done_by: 'Mohamad', was_late: false, on_shift: ['Mohamad'], completion_id: mhmd.id, excused: false },
          { slot: 'PM', due_at: iso(now - 3 * H), grace_min: 30, done_at: iso(now - 2 * H), done_by: 'Oday', was_late: true, on_shift: ['Oday'], completion_id: lateId, excused: false },
        ];
        return [];
      },
    },
  });
  const { page, errors } = s;
  await page.screenshot({ path: `${OUT}/s1-a-dashboard.png` });
  const banner = await page.getByTestId('update-banner').isVisible().catch(() => false);
  console.log('update banner visible:', banner);
  const card = await page.getByTestId('checklist-deadlines').isVisible().catch(() => false);
  console.log('deadlines card visible:', card);
  // remind the missing Baghdad PM
  const nudge = page.getByTestId('deadline-nudge-Baghdad-PM');
  console.log('nudge button:', await nudge.isVisible().catch(() => false));
  if (await nudge.isVisible().catch(() => false)) { await nudge.click(); await page.waitForTimeout(800); }
  await page.getByTestId('checklist-deadlines').screenshot({ path: `${OUT}/s1-b-card.png` });
  // open the late Karbala PM record
  await page.getByTestId('deadline-row-Karbala-PM').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/s1-c-record.png` });
  const block = page.getByTestId('late-block');
  console.log('late block:', await block.isVisible().catch(() => false));
  await page.getByPlaceholder('Why excuse it?').fill('Power cut, confirmed by the branch manager');
  await page.getByTestId('excuse-late').click();
  await page.waitForTimeout(1000);
  await block.screenshot({ path: `${OUT}/s1-d-excused.png` });
  console.log('excused line:', await page.getByText(/Excused by/).first().isVisible().catch(() => false));
  console.log('calls to live:', s.state.calls.filter((c) => c.includes('nudge') || c.includes('excuse')).join(' | '));
  console.log('errors:', errors.slice(0, 5)); console.log('401s seen:', errors.filter((e) => e.includes('401')).length);
  await s.browser.close();
})();
