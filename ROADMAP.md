# OrgTasks Roadmap

One milestone at a time. Park mid-stream ideas here instead of building them immediately.

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

## In-progress / needs your test pass

- **`SETUP.sql`/`TESTS.sql` need a live run** in the Supabase SQL Editor — not
  done yet since the checklist-into-tasks merge. `typecheck` is clean on the
  app side, but nothing has touched a real database since.
- **`scripts/e2e/checklist-flow.js` is stale** — it drives the old, now-deleted
  Checklists tab and needs a rewrite to instead create a checklist task from
  the create-task screen. Don't trust it until it's rewritten.
- Once SQL is verified, a full hands-on pass together over `npm run watch`:
  create a checklist task, fill it, off-duty claim + review, and the new
  priority → review-toggle behavior on plain tasks.

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
