# Branch Audit Report — Design

Date: 2026-09-13
Scope: the admin's audit workflow — filling out a branch's hygiene audit with
per-question penalties, zone photos, a signature, and a shareable report.
Staff/supervisor UI beyond "see the audits done about me" is untouched.

## Why

The schema for this has existed since the auditor/subject reshape (2026-09-12)
— `tasks.is_audit`, `task_completions.subject_profile_id`/`shift`/
`points_awarded`, `points_adjustments` — but **zero UI was ever built on top
of it**. Today there is no way to even create an audit task, no branch→subject
picker, no per-question point weighting, no signature, and no way for the
audited supervisor to see a result. This spec closes that gap for the
existing "Daily Hygiene Checklist" template specifically — other templates
(oil test, hood cleaning, chicken marination) stay deferred, per the user's
own plan to build them "one at a time, to make it proper" after this.

## Findings from investigation (resolve before/alongside building)

- **Duplicate template**: two identical "Daily Hygiene Checklist" rows exist
  live (79 items each, created 0.5ms apart — almost certainly leftover test
  data from earlier schema verification, not a live double-submit bug; the
  create sheet already guards its submit button with a `loading` state).
  Zero tasks/completions reference either, so deleting one is safe — but the
  delete was **blocked by the auto-mode permission classifier** this
  session. Needs the user to either approve it directly or delete the row
  themselves in Supabase Studio before this work starts, so weighting work
  isn't accidentally split across two templates.
- **Basra Delight logo**: not present anywhere in the repo (only generic Expo
  app icons). Needed as a real file (PNG, transparent background preferred)
  before the "logo in the report" task can be built.
- **No template-editing RPC exists** — only `create_checklist_template`.
  "Add more fields to the same template" (the user's own words) requires
  building edit capability (add/remove/reorder questions, set weights) that
  doesn't exist today, not just a schema column.
- **No task creation UI for `is_audit` exists** — `create-task.tsx` has no
  awareness of `is_audit` at all. An audit task has to exist before anyone
  can complete one, so a one-time "create the audit task" step needs a UI
  home too (see Task flow below).

## Already built — reused as-is, no changes needed

- `task_completions.shift` (`morning`/`evening`) — just needs a picker.
- `subject_profile_id` — already separate from the completion's own
  `team_id`, exactly for this (an auditor's own team ≠ who they're auditing).
- `points_awarded` + `points_adjustments` — already flow into the Dashboard
  and Report tab built this week (`get_current_branch_summary`,
  `get_period_report`); nothing there needs to change.
- `checklist_section_photos` — one row per section ("zone"), already backed
  by real Supabase Storage (`task-proofs` bucket), not inline base64.
- Camera-only capture — `FillChecklistSheet` already only calls
  `ImagePicker.launchCameraAsync`; there is no gallery path to remove.

## Data model additions

```sql
alter table public.checklist_template_items
  add column point_weight numeric not null default 0.25 check (point_weight >= 0);

alter table public.task_completions
  add column signature_url text;
```

`point_weight` is set once per question, on the template — not re-typed per
audit. Editable only by an owner (per the user: "adjusted only for the
admin"). A "No" answer costs its question's `point_weight`; "Yes" costs
nothing. No bonus for a clean sheet — this checklist is penalty-only, per
"if it's not yes so the penalty will be bigger." `signature_url` follows the
same pattern as `photo_urls`: uploaded to `task-proofs`, URL stored on the
completion, nullable (only audits collect one).

### New RPC: `update_checklist_template`

Owner-only. Lets the admin add, remove, reorder questions and edit each
question's `point_weight` and `section_title` (zone) on an **existing**
template — the missing piece needed to extend the Daily Hygiene Checklist.
Shape mirrors `create_checklist_template`'s `p_items`, plus `point_weight`
per item. Existing `checklist_answers` rows are historical snapshots
(question text is already copied at answer time), so editing the template
later never rewrites past completions — matches the append-only philosophy
already used for `points_adjustments`.

### `set_task_completion` — server-computed points, not client-trusted

Today `p_points` is a raw number the client passes straight through
(`v_points := p_points`) — the one thing here that must change. For an
`is_audit` completion with a checklist, the RPC will instead **compute** the
penalty itself from `p_answers` joined to `checklist_template_items.point_weight`
(sum of weights for every `false` answer, as a negative number), ignoring any
client-supplied points entirely. This matches the codebase's existing rule of
never trusting the client for anything audit/scoring-related (already true
for `subject_profile_id`/`shift` on non-audit tasks). An admin who disagrees
with the computed total still has `adjust_completion_points` afterward,
unchanged.

## Task flow

1. **One-time setup**: an owner creates the recurring audit task (self-
   assigned, `is_audit = true`, `template_id` = Daily Hygiene Checklist).
   `create-task.tsx` needs a small addition here — an "This is an audit"
   toggle, visible to the owner, that skips the assignee/checklist-assignee
   pickers (the subject is chosen at completion time, not creation time).
2. **Starting an audit**: opening that task's `CompleteTaskSheet` when
   `is_audit` is true shows, before the checklist: a **branch picker**, then
   a **subject picker** scoped to that branch's members (reusing
   `profile_teams`, exactly like the People screen already scopes members
   per branch), then a **shift picker** (morning/evening).
3. **Filling it out**: unchanged from today's checklist UX — question by
   question, grouped by zone (`section_title`), camera photo per zone,
   required note on "No". Each question shows its point value next to it.
4. **Signature**: a draw-with-finger pad at the end (new component — see
   below), required before submit.
5. **Before submit**: shows the computed total points deducted and the IQD
   penalty (`points × 25,000`), so the auditor sees the consequence before
   confirming — not just silently computed server-side after the fact.
6. **Submit**: calls `set_task_completion` with the audit fields; server
   computes and stores `points_awarded`, uploads the signature the same way
   photos upload today.
7. **Export**: a separate button (not required to submit first, but only
   meaningful after — disabled until submitted) generates a PDF: logo
   header, branch/subject/shift/date, every zone with its questions,
   answers, notes, and photos, the point/IQD total, and the signature image.
   Handed to the OS share sheet (WhatsApp/email/print), same mechanism as
   this week's `.xlsx` export.
8. **Visibility**: the admin already sees this in Dashboard/Report (no
   change needed). The **audited supervisor** does not currently have any
   view of audits done about them — History needs a new filter/section for
   "completions where `subject_profile_id` = me," scoped read-only.

## New library needs (check current docs before writing code, per AGENTS.md)

- **Signature capture**: a draw-pad component. Needs a real package pick —
  do this at implementation time against current docs, not from memory.
- **PDF generation**: likely `expo-print` (HTML → PDF) + the already-
  installed `expo-sharing`, so the same document renders correctly on-device
  and matches this week's Expo-SDK-54 lesson (check current API before
  coding, the same way `expo-file-system`'s legacy API turned out to be
  deprecated).

## Explicitly out of scope (this spec)

- Oil test, hood cleaning, chicken marination templates — deferred, next.
- The single combined hood+checklist+oil report for hygiene managers —
  deferred until those templates exist.
- Branch Manager role, read-only owner-viewer account — unrelated, parked
  elsewhere.
- `create_organization`'s own default-team auto-seeding — flagged
  separately, not part of this feature.

## Testing

- New `TESTS.sql` blocks: `update_checklist_template` (add/remove/reorder,
  point_weight edits, doesn't touch historical `checklist_answers`);
  `set_task_completion`'s computed-points path (a mix of Yes/No answers
  produces the exact expected sum, and a client-supplied `p_points` is
  ignored/rejected for an audit completion).
- `npx tsc --noEmit` after UI changes.
- Live QA (flagged for the user, same as the `.xlsx` export): create an
  audit task, complete a real audit end to end on a branch/supervisor, sign,
  submit, confirm Dashboard/Report totals update, export the PDF and confirm
  it opens correctly, and confirm the audited supervisor sees it in their
  own History.
