// Run: node scripts/test/describeActivity.test.mjs
import assert from 'node:assert/strict';
import { groupActivity, describeChange, deviceOf, changedFields } from '../../src/lib/describeActivity.ts';

let id = 0;
const row = (over) => ({
  id: ++id, actor_id: 'fatima', actor_name: 'Fatima', kind: 'change', table_name: null, op: null,
  row_id: null, before: null, after: null, detail: null, ip: '37.238.1.2',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', txid: 1, created_at: '2026-09-25T09:14:00Z',
  ...over,
});

// Deleting a person is a soft delete; its profile_teams rows go in the same transaction.
const del = groupActivity([
  row({ table_name: 'profile_teams', op: 'delete', before: { profile_id: 'k', team_id: 'b' }, txid: 7 }),
  row({ table_name: 'profiles', op: 'update', before: { name: 'Karam', deleted_at: null }, after: { name: 'Karam', deleted_at: '2026-09-25' }, txid: 7 }),
]);
assert.equal(del.length, 1, 'one action, one line');
assert.deepEqual(del[0].summary, { key: 'activity.deletedPerson', params: { name: 'Karam' } });
assert.equal(del[0].more, 1);
assert.equal(del[0].serious, true);
assert.equal(del[0].device, 'iPhone');

// A 73-answer audit reads as the submission, not as an answer.
const answers = Array.from({ length: 73 }, () => row({ table_name: 'checklist_answers', op: 'insert', after: { question: 'q' }, txid: 9 }));
const audit = groupActivity([...answers, row({ table_name: 'task_completions', op: 'insert', after: { task_title: 'Daily Hygiene Checklist' }, txid: 9 })]);
assert.equal(audit.length, 1);
assert.equal(audit[0].summary.key, 'activity.submitted');
assert.equal(audit[0].summary.params.title, 'Daily Hygiene Checklist');
assert.equal(audit[0].more, 73);
assert.equal(audit[0].serious, false);

// Different transactions stay different lines; views are never merged.
const mixed = groupActivity([
  row({ kind: 'view', op: '/history', txid: 1 }),
  row({ kind: 'view', op: '/history', txid: 1 }),
  row({ table_name: 'organizations', op: 'update', before: { iqd_per_point: 15000 }, after: { iqd_per_point: 20000 }, txid: 2 }),
]);
assert.equal(mixed.length, 3);
assert.deepEqual(mixed[0].summary, { key: 'activity.openedScreen', params: { screenKey: 'mainTabs.history' } });
assert.deepEqual(mixed[2].summary, { key: 'activity.pointValue', params: { from: '15,000', to: '20,000' } });

// Password reset seen from the profile flag.
assert.equal(describeChange(row({ table_name: 'profiles', op: 'update', before: { name: 'Obaida', must_change_password: false }, after: { name: 'Obaida', must_change_password: true } })).key, 'activity.resetPassword');
// Distance change names both numbers.
assert.deepEqual(describeChange(row({ table_name: 'teams', op: 'update', before: { name: 'Baghdad', radius_m: 15 }, after: { name: 'Baghdad', radius_m: 40 } })),
  { key: 'activity.branchDistance', params: { name: 'Baghdad', from: 15, to: 40 } });

assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14)'), 'Android');
assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0)'), 'Windows');
assert.equal(deviceOf(null), null);

assert.deepEqual(
  changedFields(row({ op: 'update', before: { a: 1, b: 2, updated_at: 'x' }, after: { a: 1, b: 3, updated_at: 'y' } })),
  [{ field: 'b', from: 2, to: 3 }],
);

console.log('PASS: describeActivity');
