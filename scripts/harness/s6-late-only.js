// Admin dashboard shows only LATE checklists (not every branch's "Done"),
// the supervisor still sees their own branch's deadlines, and Settings can
// remove a profile photo.
const { open, snap } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');

const at = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();
const row = (slot, dueIn, extra = {}) => ({ slot, due_at: at(dueIn), grace_min: 30, done_at: null, done_by: null, was_late: null, on_shift: ['Karam'], completion_id: null, excused: null, ...extra });
const mixed = {
  Baghdad: [row('AM', -600, { done_at: at(-610), done_by: 'Obaida', was_late: false }), row('PM', -60, { done_at: at(-70), done_by: 'Karam' })],
  Karbala: [row('AM', -300, { done_at: at(-200), done_by: 'Mohamad', was_late: true, excused: false }), row('PM', -90, { on_shift: ['Oday'] })],
  Samawah: [row('AM', -300, { done_at: at(-320), done_by: 'Hamdan', was_late: true, excused: true }), row('PM', 240)],
};
const allGood = {
  Baghdad: mixed.Baghdad,
  Karbala: [row('AM', -300, { done_at: at(-310), done_by: 'Mohamad', was_late: false })],
};
const todayFrom = (table) => (body) => {
  const name = snap.teams.find((t) => t.id === body.p_team)?.name;
  return table[name] ?? [];
};

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

  // A. admin, mixed day: only Karbala's two late rows
  let s = await open('hijazi12', { rpc: { checklist_today: todayFrom(mixed) } });
  let card = s.page.getByTestId('checklist-deadlines');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/s6-a-admin-late-only.png` });
  const text = await card.innerText();
  check('title is "Late checklists"', /late checklists/i.test(text), text.split('\n')[0]);
  check('Karbala shown', text.includes('Karbala'));
  check('Baghdad hidden (all fine)', !text.includes('Baghdad'));
  check('Samawah hidden (excused + not yet due)', !text.includes('Samawah'));
  check('sent-late row shown', text.includes('Sent late'));
  check('missing-late row shown with Remind', text.includes('Late') && text.includes('Remind them now'));
  check('no "Done" rows', !/\bDone\b/.test(text) && !text.includes('On time'));
  await s.browser.close();

  // B. admin, nothing late: the card is gone
  s = await open('hijazi12', { rpc: { checklist_today: todayFrom(allGood) } });
  check('card gone when nothing is late', (await s.page.getByTestId('checklist-deadlines').count()) === 0);
  await s.browser.close();

  // C. supervisor: still sees their own branch in full
  s = await open('karam12', { rpc: { checklist_today: todayFrom(mixed) } });
  card = s.page.getByTestId('checklist-deadlines');
  const sup = (await card.count()) ? await card.innerText() : '';
  check('supervisor keeps full view', /checklist today/i.test(sup) && sup.includes('Done'), sup.replace(/\n/g, ' | ').slice(0, 90));
  await s.browser.close();

  // D. Settings: remove photo
  const profiles = snap.profiles.map((p) => (p.username === 'hijazi12' ? { ...p, avatar_url: 'https://spnvsjmmeddwompkeerh.supabase.co/storage/v1/object/public/task-proofs/x/avatar.jpg' } : p));
  let sent = null;
  s = await open('hijazi12', {
    tables: { profiles },
    rpc: {
      update_my_profile: (body, { me }) => {
        sent = body;
        const p = profiles.find((x) => x.id === me.id);
        p.avatar_url = body.p_avatar_url || null;
      },
    },
  });
  await s.page.getByText('Settings', { exact: true }).last().click();
  await s.page.waitForTimeout(1500);
  await s.page.getByLabel('Edit profile').click();
  await s.page.waitForTimeout(500);
  const btn = s.page.getByTestId('remove-photo');
  check('Remove photo offered', (await btn.count()) === 1);
  await s.page.screenshot({ path: `${OUT}/s6-d-remove-photo.png` });
  await btn.click();
  await s.page.waitForTimeout(1500);
  check('sent an empty photo', sent && sent.p_avatar_url === '', JSON.stringify(sent));
  check('Remove photo gone after', (await s.page.getByTestId('remove-photo').count()) === 0);
  await s.page.screenshot({ path: `${OUT}/s6-e-photo-removed.png` });
  const errs = s.errors.filter((e) => !e.includes('user gesture'));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' || '));
  await s.browser.close();

  console.log(results.join('\n'));
})();
