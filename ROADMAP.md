# Rungs Roadmap

One milestone at a time. Park mid-stream ideas here instead of building them immediately.

## Status (2026-09-15) — Brands feature

**Done, all 11 plan tasks plus a final-review fix wave** (spec:
`docs/superpowers/specs/2026-09-14-brands-design.md`, plan:
`docs/superpowers/plans/2026-09-14-brands-plan.md`, built with
superpowers:subagent-driven-development — one fresh implementer + one
independent reviewer per task, live-verified against the production
Supabase project throughout, pushed to GitHub). A branch now has a
configurable set of brands (e.g. Tuwaysah runs 360 + AA Chicken + Center);
a supervisor belongs to a branch *and* a brand within it; a branch
manager/admin never needs one. New: `brands`/`branch_brands` tables,
`profile_teams.brand_id`; `create_brand`/`set_branch_brands` RPCs; brand
validation added to `admin_create_user`/`add_profile_to_team`; brand
columns on `get_current_branch_summary`/`get_period_report`. UI: a
"manage brands" sheet on each branch card (Branches screen); a brand
picker on staff create/edit; a Branch → Brand → Subject → Shift step in
the audit picker; a branch → brand → supervisor breakdown on Dashboard,
Report, and the `.xlsx` export.

**Real bugs found and fixed along the way, all live-verified:**
1. `branchBrandIds` (which brands a branch offers, for picker ordering)
   wasn't actually sorted to match the brands list's own order — fixed in
   a task-level fix round.
2. The whole-branch final review caught a real gap no single task could
   see: `branch_brands` (what a branch *offers*) and
   `profile_teams.brand_id` (what a supervisor *holds*) were never
   reconciled. Removing a brand from a branch left an already-assigned
   supervisor silently pointing at a brand that no longer operated there
   — invisible in the staff sheet, wrong in Dashboard/Report, and made
   that supervisor un-auditable. Fixed: `set_branch_brands` now nulls a
   stale `profile_teams.brand_id` when a supervisor's brand is dropped
   from the branch; the audit picker gained an explicit "Unassigned"
   option so a brand-less supervisor at a brand-configured branch stays
   auditable; the Dashboard/Report's "Unassigned" bucket is now a real,
   bilingual i18n string instead of a hardcoded English literal, and is
   suppressed entirely for an org that hasn't configured any brands yet
   (so day-one behavior is unchanged until the user opts in).
3. This plan's own `TESTS.sql` blocks had real bugs three separate times
   (a missing setup call, a singular/plural regex-vs-message mismatch, a
   test that claimed to cover two RPCs but only ever called one) — all
   caught and fixed by the task implementers before commit, not left for
   later.

**Deliberately parked, not fixed** (see the plan's own ledger,
`.superpowers/sdd/2026-09-14-brands-plan/progress.md`, before that
workspace is cleaned up, for the full reasoning on each):
- A TOCTOU race in `create_brand`'s case-insensitive uniqueness check —
  matches an existing, accepted pattern elsewhere in this codebase
  (`create_team`, `admin_create_user`'s username check); owner-only,
  low-frequency, low-cost-if-wrong.
- `add_profile_to_team`'s upsert can silently null an existing brand if
  ever called without an explicit brand id against an existing
  membership — traced end-to-end, neither real call site does this
  today; a real risk only for a not-yet-written future caller.

**Still needs the user's own device QA** (this plan's own Task 11, not
attempted by the agent): configure Tuwaysah's and Olympic's real brands,
assign a real supervisor a brand, run a real audit through the new
Branch → Brand → Subject → Shift flow, confirm Dashboard/Report show the
right brand breakdown, and confirm removing a brand from a branch
correctly clears it from an already-assigned supervisor.

## Status (2026-09-13, later) — Branch audit report

**Done, all 11 implementation tasks** (spec/plan:
`docs/superpowers/specs/2026-09-13-audit-report-design.md` /
`docs/superpowers/plans/2026-09-13-audit-report-plan.md`). An owner can now
create a reusable "audit" task (self-assigned, targets the new "Daily
Hygiene Checklist — Audit" template — the supervisors' plain "Daily Hygiene
Checklist" is untouched); starting it walks through branch → subject →
shift, then the checklist itself with each question's point weight shown;
signing (a small custom SVG pad, no new native dependency) and submitting
computes the penalty **server-side** from the actual "No" answers' weights
(never trusted from the client); the audited supervisor now sees the result
under History → "Audits about me"; and a PDF (logo, full Q&A, photos,
total, signature) exports via the OS share sheet from the completion detail
view. An owner can also now edit the audit template's questions and weights
in-app (previously only possible via direct SQL).

Three real bugs found and fixed along the way, all live-verified:
1. The owner's RLS policy for creating a task never carved out self-
   assigning an `is_audit` task (only a branch manager's branch had that
   exception) — the owner literally could not create their own audit task.
2. A second, deeper layer of the same bug: even after fixing (1), an owner
   with **zero team memberships** (true of this org's real owner account,
   since "Main Team" was deleted earlier the same day) still couldn't
   self-assign, because a separate unconditional check required the task's
   team_id to be among the assignee's own teams.
3. A templateless `is_audit` completion (a legitimate, already-tested
   pattern with no checklist to compute a penalty from) briefly got `NULL`
   points instead of its client-supplied value after the scoring change —
   caught before commit by re-running the existing test.

**Still needs the user's own device QA** (flagged in the plan, not
attempted here): a full real audit end to end, confirming Dashboard/Report
totals move by the right amount, the PDF opens correctly, and the audited
supervisor really does see it.

**Deferred, per the user's own plan**: oil test / hood cleaning / chicken
marination templates (build one at a time after this); the combined
hood+checklist+oil report; `create_organization`'s own default-team
seeding (flagged as a separate, larger fix — see the spec's "Findings").

## Status (2026-09-13)

**Monthly branch reporting — done.** Full plan
(`docs/superpowers/plans/2026-09-12-monthly-branch-reporting-plan.md`), all 10
tasks committed to master: `report_periods` table; `close_next_month`,
`get_period_report`, `get_current_branch_summary` RPCs (owner-only, points
summed via `profile_teams` so a subject is attributed to *their* branch, not
the audit task's team); Owner/Team Admin dashboard split; new Report tab
(month switcher over closed periods, combined table, close-month button); label
renames Owner→Admin, Teams→Branches, People→Staff; `.xlsx` export via the OS
share sheet using expo-file-system's current File/Directory API (its old
string/base64 API throws at runtime on this SDK — deviated from the plan's
sample code after checking the versioned docs, per `AGENTS.md`).

One real bug found and fixed during a re-verification pass before continuing:
the three new RPCs computed calendar-month boundaries from raw UTC
`now()`/`created_at` instead of `Asia/Baghdad`, unlike the rest of the
codebase's date logic — could misattribute a completion near midnight UTC to
the wrong month, or close a month up to 3 hours early/late. Fixed, applied
live, `TESTS.sql` re-confirmed clean (all 16 blocks).

**Still needs the user's own device QA** (deferred per the plan — needs a
real device and real share-sheet apps): open the Report tab, select a closed
month, tap Export, confirm the share sheet opens and the shared `.xlsx` opens
with the right columns/values; also confirm the Dashboard's current-month
rollup matches a closed month's report once one exists.

Bilingual EN/AR migration (started 2026-09-12) is still paused mid-way —
`teams.tsx` is the last file done; `history.tsx`/`people.tsx`/`settings.tsx`/
`create-task.tsx` and all of `src/components/` are not yet translated.

## Status (2026-08-21)

Checklists were merged into tasks (Option B): there is no separate "Checklists"
tab, table, or hook any more. A checklist is a plain `tasks` row with
`template_id`/`cooldown_hours` set — creating one is creating a task, filling
it out is the same `set_task_completion` RPC every task uses, just with
`p_answers` attached. `checklist_templates` still exists (the reusable
question set), but assignment/submission tables are gone.

Alongside that, task completion review is now priority-driven and applies to
every task, checklist or not: **low** never needs review, **high** always
needs a leader/admin to review it before it's settled (enforced by a DB CHECK
constraint, not just the UI), **medium** is the creator's choice via a toggle
at task-creation time. Off-duty claims on a checklist always need review
regardless of the task's priority (attendance, not work quality). "Needs
review" surfaces as a filter on the History tab.

`SETUP.sql` and `TESTS.sql` have both been updated for this merge and are
believed structurally consistent (dollar-quote balance and grants-vs-created
cross-checked), but have **not yet been re-run against a live Supabase
instance** — that's the next step before anything else in this list.

## Status (2026-08-17)

`SETUP.sql` is the single source of truth for schema — it's an idempotent
drop-and-rebuild script (wipes all data every run, by design). Re-paste it into
Supabase SQL Editor whenever schema changes, then `TESTS.sql` to check the rules
actually hold. Both are verified clean as of today, full run, every block passing.

`npm run watch` (+ `npm run peek`, `npm run dev/reload.js`) opens a browser window
on the dev machine that Claude can inspect live over CDP — the way we test together
now instead of trading screenshots.

## Done and verified

**Email-verified self-signup** — both "Create an organization" and "Just for
yourself" now go through a two-step sign-up: `supabase.auth.signUp` creates the
auth user and emails a 6-digit code, `verifySignUpCode` exchanges it for a
session, and only then (for orgs) does `create_organization` run — it needs a
real session for `auth.uid()`. The verify screen (`(auth)/verify.tsx`) uses the
animated `OtpDial` widget instead of a plain text box. Live end-to-end tested
against the real Supabase project + real email delivery (Resend), both the
personal and organization paths, including wrong-code error/shake, resend, and
recovery after an error.
**One real bug found and fixed live**: a transient "JWT issued at future" error
can occur where `verifyOtp` confirms the email server-side but fails to hand
back a session — previously this permanently stranded the account (confirmed,
but no profile/org, and no way back in through the UI). `verifySignUpCode` now
falls back to a plain password sign-in when that happens, which succeeds
precisely because the email is already confirmed by that point. `PendingSignUp`
now carries the password in memory for this reason (both kinds).

**Admin-provisioned signup & login** — owners create accounts for anyone in the org;
team leaders create employees on their own team only. Forced password change on
first login. Admin password reset without the old one; deactivation signs the user
out. Recovery email optional, added from Settings.
Spec: `docs/superpowers/specs/2026-08-17-admin-provisioned-accounts-design.md`

**Task completion: proof photos + history** — camera-only capture (no gallery,
proof must be taken fresh), up to 6 photos per completion, enforced both client-
and server-side. Permanent `task_completions` audit log — reopening a task no
longer erases that it was ever done. History tab scoped by role (owner: org-wide,
team leader: own team, employee: own work only). "Failed" = due date passed, still
open, derived automatically.

**Checklists, merged into tasks** — a checklist is a task with a
`template_id` attached, not a separate model or tab. Creating one means
picking a template on the create-task screen (each selected person gets
their own copy, filled independently) and setting a cooldown in hours right
there — cooldown moved off the template and onto the task, since the same
template can back tasks with different repeat rates. Built-in templates
seeded from the company's two real PDFs (`src/lib/builtInChecklists.ts` — 79
+ 15 questions, Arabic, hand-corrected against the source after two failed
auto-fix attempts mangled the لا ligature). A "No" answer requires a note
when the template asks for one; photos are always optional. No due time or
shift concept — the task reappears N hours after the last submission, so a
double shift just sees it come back mid-shift instead of being falsely
marked late. Declaring "off duty" is a claim, not an escape: it sits pending
until an admin or the team's leader reviews it — approval behaves like a
normal completion for the cooldown, rejection makes it immediately due
again.

**Priority-driven review** — every task, checklist or plain, can require a
leader/admin to review and acknowledge each completion before it's settled.
Low priority never needs it, high priority always does (DB-enforced CHECK
constraint), medium is a toggle the creator sets. History has a "Needs
review" filter for owners/team leaders.

**Multi-team membership** — `profiles.team_id` (one team) replaced by
`profile_teams` (many), so one person (e.g. a supervisor) can be on two teams run
by two different leaders. Each leader sees only what *they* personally assigned to
a shared person, never into another leader's assignments for the same
person — enforced in RLS, covered by a dedicated test. Team leaders and the owner
are still tied to one team each, as before; only employees can be multi-team for
now.

**Two Alert.alert dead-on-web bugs found and fixed** — `Alert.alert` renders
nothing on react-native-web (button confirms just silently did nothing). Both the
deactivate-account confirm and the sign-out confirm were switched to in-app
two-step confirmations. Works on Android either way; was genuinely broken on web
before the fix.

## Done and verified (continued)

**Full live QA pass, 2026-08-27** — `SETUP.sql`/`TESTS.sql` confirmed in sync
with the live database (table/function diff, plus a live `TESTS.sql` run: all
66 assertions pass in a rolled-back transaction, so the "needs a live run"
item below is resolved). Walked the real app end to end against the live
Supabase project: created an org ("Basra QA Restaurant"), a team leader, and
an employee; created a checklist template from the built-in "Daily Hygiene
Checklist" starter (79 real Arabic questions, seeded client-side, not in the
DB — see `src/lib/builtInChecklists.ts`); assigned and completed it as the
employee; confirmed History is correctly scoped and shows the right tally for
both the employee and the owner.

Also fixed the 4 working `scripts/e2e/*.js` scripts (`manage-user`,
`forced-password-change`, `team-leader-flow`, `proof-and-history`), which had
gone stale in two ways unrelated to each other: (1) the org-name placeholder
they targeted was `"e.g. Basra Retail Co."` from before the de-branding
cleanup, now `"e.g. Riverside Cafe"`; (2) they signed up with fake
`@example.com` addresses, which now fail outright at `signUp()` since real
SMTP (Resend) is wired up and that domain has no mail server. Both fixed —
all 4 now pass. `scripts/e2e/_otp_bypass.js` is a new shared helper: since
sign-up is now OTP-gated, these scripts mark their one test email confirmed
via direct SQL (not the global `mailer_autoconfirm` setting) and let
`verifySignUpCode`'s fallback sign-in do the rest. Requires
`SUPABASE_ACCESS_TOKEN` in the environment to run.

- **`scripts/e2e/checklist-flow.js` rewritten and passing** — now creates
  templates inline from create-task's "+ New template" (matching the current
  UI) and reviews off-duty claims through History's "Needs review" filter.
  All 9 assertions pass: template creation, assignment, the "No" answer
  requiring a note, history with the right yes/no tally, and the off-duty
  claim → reject → immediately-pending-again cycle.
- **Camera-only proof still needs a real phone** — the one piece of this
  pass that couldn't be tested on web at all (see "Known gaps" below).

## Known gaps, not yet addressed

- **Camera-only proof can't be enforced on web** — `ImagePicker.launchCameraAsync`
  degrades to a file picker on a browser (confirmed, not a bug), so the
  "taken at this moment" guarantee only holds on the phone. Matters only if web
  becomes a real way people complete tasks.
- **`expo-updates` isn't installed** — no OTA. Every code change needs a full
  `eas build`, not just a redeploy. Worth adding once the pace of changes slows down.
- **Assignment across teams for a multi-team employee**: when a leader assigns a
  checklist/task, it's scoped to *their own* team for visibility (by design — see
  above). An owner assigning to someone on 0 or 2+ teams gets no specific team
  scoping (visible to the owner and that person only) — acceptable but worth
  knowing if it ever feels surprising.

## Backlog / mentioned but not scheduled

- More built-in checklist templates as the user provides more source PDFs — the
  extraction pipeline (PyMuPDF + explicit per-word corrections, never a blanket
  regex fix) is proven and repeatable.
- Bulk-select assignees on the checklist-template create-task flow — right now
  each person has to be tapped one by one under "Assign to."
- **Viewer mode** — a read-only role for someone who just wants to watch task
  status and who's completing work vs. falling behind, without the ability to
  create/edit/manage anything. The owner dashboard already shows everything
  organizationally, so this is really about a *narrower, safer* lens for
  someone who shouldn't have edit/admin power (a regional overseer, an
  investor, etc.) — worth scoping as its own small role rather than reusing
  `owner`/`team_admin`. Needs its own short design pass, not started.
