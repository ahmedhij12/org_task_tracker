# Branch Audit Report — Implementation Plan

Source spec: `docs/superpowers/specs/2026-09-13-audit-report-design.md`.
Direct-to-`master`, per this project's established workflow — no branch.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans
> or superpowers:subagent-driven-development to work this task-by-task. Steps
> use `- [ ]` checkboxes for tracking.

## Global constraints

- Never run `supabase/SETUP.sql` against the live project — write each
  schema/RPC change to a scratch file and apply it with `psql` (see
  `secrets.txt` for the pooler connection string), then update `SETUP.sql` to
  match so a future full rebuild stays correct.
- Every schema change gets a new `TESTS.sql` block, run live, before commit.
- Every new native-adjacent package (signature pad, PDF generation) gets its
  current docs checked before writing code against it, per this project's
  `AGENTS.md` — the `expo-file-system` legacy-API mistake earlier this week
  is exactly the failure mode to avoid.
- The two checklist templates are **not interchangeable**: all schema/RPC
  work in this plan targets `checklist_templates.id = 'a17e9208-8504-40dc-ae67-e35f6f7d2d2b'`
  ("Daily Hygiene Checklist — Audit") only. Never touch
  `76bf89f1-8d39-43fe-a276-7f70205e1595` (the supervisors' plain checklist).
- `npx tsc --noEmit` clean after every UI task.

---

### Task 1: Schema — point weights and signature storage

- [ ] **Step 1: Add failing schema assertions to `TESTS.sql`**

Assert `checklist_template_items.point_weight` exists, defaults to `0.25`,
and rejects negative values; assert `task_completions.signature_url` exists
and is nullable.

- [ ] **Step 2: Run against the live project, confirm it fails**

- [ ] **Step 3: Write the migration to a scratch file and apply live**

```sql
alter table public.checklist_template_items
  add column point_weight numeric not null default 0.25 check (point_weight >= 0);

alter table public.task_completions
  add column signature_url text;
```

- [ ] **Step 4: Add the same to `SETUP.sql`** (inline on the two `create
  table` statements, not as a separate `alter table` — `SETUP.sql` rebuilds
  from scratch every time).

- [ ] **Step 5: Re-run `TESTS.sql` live — all prior blocks plus the new one
  pass.**

- [ ] **Step 6: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add point_weight and signature_url columns for the audit report"
```

---

### Task 2: `update_checklist_template` RPC — edit an existing template

- [ ] **Step 1: Add failing tests** covering: an owner can add/remove/reorder
  questions and change `point_weight`/`section_title` on an existing
  template; a `team_admin` is rejected; editing never rewrites existing
  `checklist_answers` rows (they keep their original question-text
  snapshot); editing a template belonging to another org is rejected.

- [ ] **Step 2: Run live, confirm failure.**

- [ ] **Step 3: Write the RPC** (owner-only, `security definer`, mirrors
  `create_checklist_template`'s shape). Signature:

```sql
create function public.update_checklist_template(
  p_template_id uuid,
  p_name text,
  p_requires_note_on_no boolean,
  p_items jsonb  -- [{ "section_title", "question", "point_weight" }, ...]
)
returns void
```

Simplest correct approach: verify the caller is `owner` and the template
belongs to their org, update the template row, then `delete from
checklist_template_items where template_id = p_template_id` and re-insert
`p_items` in order (sort_order = array position) — safe because
`checklist_answers.question` already snapshots the text independently, so
deleting-and-reinserting items never touches historical completions (FK is
`on delete cascade` from items to nothing downstream that matters — answers
reference the *completion*, not the item).

- [ ] **Step 4: Apply live via `psql`, re-run `TESTS.sql` — all pass.**

- [ ] **Step 5: Commit.**

---

### Task 3: Fix the stale `is_audit` comment

- [ ] Update the comment on `tasks.is_audit` in `SETUP.sql` — it currently
  says "the same checklist as a supervisor's routine copy," which is no
  longer true now that the audit gets its own template. One-line fix,
  bundle into Task 2's commit or its own trivial commit.

---

### Task 4: Create an audit task (`create-task.tsx`)

- [ ] **Step 1**: Add an "This is an audit" toggle, visible only to the
  owner, that appears once a checklist template is picked. Restrict the
  template chips shown when the toggle is on to templates whose name ends in
  " — Audit" (simplest correct filter without a schema flag; revisit with a
  real `is_audit_template` boolean if a second audit template is ever added
  — flag this as a known shortcut, not a permanent design).
- [ ] **Step 2**: When the toggle is on, hide the assignee/checklist-assignee
  pickers entirely (the subject is chosen at completion time — see Task 5)
  and self-assign the task to the creating owner.
- [ ] **Step 3**: Wire `is_audit: true` into the `createTask` call. Default
  `priority: 'medium'`, `requiresReview: false` — the admin's own audit
  doesn't need a second reviewer.
- [ ] **Step 4**: Typecheck.
- [ ] **Step 5**: Commit.

---

### Task 5: Branch → subject → shift picker (`CompleteTaskSheet`)

- [ ] **Step 1**: When `task.isAudit` is true, before rendering the
  checklist, render three steps in sequence: branch picker (reuse `teams`
  from `useOrgData`), then a subject picker scoped to that branch's members
  via `profile_teams` (same scoping already used on the People screen), then
  a shift picker (`morning`/`evening`, matching the existing DB values —
  label them "AM"/"PM" in the UI per the user's own wording, store the
  existing `morning`/`evening` values).
- [ ] **Step 2**: Carry `subjectProfileId`/`shift` forward into the existing
  checklist-filling flow and, at submit, into `set_task_completion`'s
  `p_subject_profile_id`/`p_shift`.
- [ ] **Step 3**: Typecheck.
- [ ] **Step 4**: Commit.

---

### Task 6: Server-computed scoring

- [ ] **Step 1: Add failing tests** — a submission with a mix of Yes/No
  answers against known `point_weight`s produces the exact expected negative
  sum in `points_awarded`; a client-supplied `p_points` is ignored (not
  merely capped) for any `is_audit` completion with a checklist.

- [ ] **Step 2: Run live, confirm failure.**

- [ ] **Step 3: Edit `set_task_completion`** — for a completion where
  `v_task.is_audit` and `v_task.template_id` is not null, compute:

```sql
select coalesce(sum(case when (a->>'answer')::boolean then 0 else
  (select it.point_weight from public.checklist_template_items it
   where it.template_id = v_task.template_id
     and it.question = (a->>'question')
     and it.section_title = coalesce(a->>'section_title', ''))
end), 0) * -1
into v_points
from jsonb_array_elements(p_answers) a;
```

joined by question text + section (matches how answers are already
snapshotted — no item id round-trips through the client today, so this
avoids widening `p_answers`' shape). Ignore `p_points` entirely on this path;
keep using it as-is for the non-checklist/non-audit case if any exists
today (check before assuming — read the current branch first).

- [ ] **Step 4: Apply live, re-run `TESTS.sql` — all pass.**

- [ ] **Step 5: Show each question's point value in `FillChecklistSheet`**
  next to the question text (small muted label, e.g. "0.25 pts").

- [ ] **Step 6: Typecheck, commit.**

---

### Task 7: Edit-template screen (admin-only)

- [ ] **Step 1**: Add an edit (pencil) icon next to each template chip in
  `create-task.tsx`'s template picker, visible only to the owner, opening a
  new `EditChecklistTemplateSheet` pre-filled from the template's current
  items (reuse `CreateChecklistTemplateSheet`'s row-editing UI as the base
  rather than writing a second one from scratch — extend it to take an
  optional existing template + point-weight field per row instead of
  duplicating the component).
- [ ] **Step 2**: Wire it to `update_checklist_template`.
- [ ] **Step 3**: Typecheck, commit.

---

### Task 8: Signature capture

- [ ] **Step 1**: Check current Expo/React Native docs for a signature-pad
  library before picking one — do not assume a package from training data.
- [ ] **Step 2**: Install and add a signature step after the checklist,
  before submit, required only when `task.isAudit`.
- [ ] **Step 3**: On submit, upload the signature image to the `task-proofs`
  bucket the same way photos upload today; pass the resulting URL as a new
  `p_signature_url` param on `set_task_completion` (add the param + column
  write — small addition to Task 1/6's RPC edit, or its own tiny migration
  if done as a separate commit).
- [ ] **Step 4**: Typecheck, commit.

---

### Task 9: Pre-submit total

- [ ] Show the computed points and IQD penalty (`points × 25000`, matching
  the existing convention) on a confirmation screen/section right before the
  final submit button, computed client-side from the same answers/weights
  logic as Task 6 (a preview, not a second source of truth — the server
  computation in Task 6 is what actually gets stored). Typecheck, commit.

---

### Task 10: PDF export

- [ ] **Step 1**: Check current `expo-print` docs (or whatever the docs
  check in Task 8 surfaces as the best fit) before writing code.
- [ ] **Step 2**: Write `src/lib/exportAuditReport.ts` — HTML template with
  the logo (`assets/basra-delight-logo.png`, embedded as a data URI so it
  renders identically in the generated PDF regardless of asset bundling),
  branch/subject/shift/date header, every zone with its questions, answers,
  notes, and photos, the point/IQD total, and the signature image. Render to
  PDF via `expo-print`, share via the already-installed `expo-sharing`
  (same pattern as this week's `.xlsx` export).
- [ ] **Step 3**: Add an Export button on the audit's detail view, enabled
  only after submission.
- [ ] **Step 4**: Typecheck, commit.

---

### Task 11: Supervisor-side visibility

- [ ] **Step 1**: Add a new History filter/section — completions where
  `subject_profile_id` = the viewer's own id — visible to any role (this is
  specifically for the audited person to see their own results, unlike the
  existing filters which are scoped by team/actor).
- [ ] **Step 2**: Read-only: no edit/adjust controls, matching a supervisor's
  existing access level everywhere else.
- [ ] **Step 3**: Typecheck, commit.

---

### Task 12: Live QA (flag for the user, do not attempt)

Create a real audit task, complete one end-to-end against a real
branch/supervisor, sign, submit, confirm Dashboard/Report totals update by
exactly the expected amount, export the PDF and confirm it opens with the
logo and correct content, and confirm the audited supervisor sees it under
their own History.

---

## Explicitly out of scope (see spec)

Oil test, hood cleaning, chicken marination templates; the combined
hood+checklist+oil report; Branch Manager role; read-only owner-viewer
account; `create_organization`'s default-team seeding.
