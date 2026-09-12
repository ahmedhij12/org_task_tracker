# Monthly Branch Reporting — Design

Date: 2026-09-12
Scope: **Admin interface only.** Staff/supervisor UI is untouched in this phase.

## Why

The Dashboard tab currently shows almost nothing (org name, a pending/done
count, an empty task feed) while the schema already has everything needed to
answer a real question: which branches and which supervisors are racking up
penalties or bonuses, and how much is that worth in IQD. This feature makes
Dashboard and a new Report tab answer that question, with a monthly
close/export flow admins can hand to an owner or print/send over WhatsApp.

## Terminology changes (labels only — no schema renames)

- **"Owner" → "Admin"** in every UI string (badge, docs). The underlying
  `profiles.role = 'owner'` enum value and all RLS logic keyed on it are
  unchanged — this is display text only, same pattern already used for the
  parked "team leader → supervisor" relabel.
- **"Teams" tab → "Branches"**. The `teams` table already does exactly what's
  needed — a named group, created by an admin, people assigned into it. No
  schema change: just relabel every user-facing string ("Team" → "Branch",
  "New team" → "New branch", etc.) in `teams.tsx` and the i18n dictionaries.
- **"People" tab → "Staff"**. Relabel only; same screen, same data.

None of these three touch `SETUP.sql`. All three are copy/i18n-key changes in
the app layer.

## Data model additions

```sql
create table public.report_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_month date not null,  -- always the 1st of the month, e.g. 2026-08-01
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id) on delete cascade,
  unique (org_id, period_month)
);
```

A row only ever gets created for a calendar month that has **fully elapsed**
(i.e. `period_month + interval '1 month' <= now()`). There is no "open period"
row — the current, in-progress month is just "the calendar month containing
now, with no `report_periods` row yet." Nothing is snapshotted: every report,
past or present, is computed live from `task_completions` at read time. This
matches the existing append-only philosophy of `points_adjustments` — a
correction made after the fact must be reflected in an already-closed month's
report, never hidden by a frozen snapshot.

### RPCs

**`close_next_month()`** (admin/owner role only, org-scoped via `auth.uid()`)
Finds the earliest calendar month, after the org's last closed period (or
after the org's `created_at` if none), that has fully elapsed and has no
`report_periods` row yet. Inserts it. If the admin is behind (skipped two
months), calling this again closes the *next* oldest one — one per call, so
repeated presses catch up a backlog. Returns the period closed, or a "nothing
to close yet" result if the current month hasn't ended.

**`get_period_report(p_period_id uuid)`**
Returns one row per (subject, branch): `subject_profile_id`, `name`,
`branch_name`, `total_points`, `iqd_amount` (`total_points * 25000`), computed
by summing `task_completions.points_awarded` where `subject_profile_id`
matches and `created_at` falls within that period's month, **joined to that
subject's branch via `profile_teams` — not via `task_completions.team_id`**,
since the completion's own `team_id` is the task's team and can differ from
the audited person's team (see the auditor/subject model). If a subject
belongs to more than one branch (allowed for employees, rare in practice for
supervisors), their totals appear once per branch they belong to — a known,
accepted edge case, not something this phase resolves further.

**`get_current_branch_summary()`**
Same aggregation, but for the *current* elapsed-so-far calendar month (1st of
this month → now), grouped by branch first, with per-supervisor breakdown
nested under each branch. Powers the Dashboard.

All three are `security definer` RPCs following the existing pattern (e.g.
`adjust_completion_points`), gated to `role = 'owner'` — closing/reading
org-wide reports is an owner-level action, same restriction as adjusting any
audit in the org.

## UI changes

**Dashboard** — replaces the current pending/done/task-feed layout with a
list of branches, each showing total points and total IQD for the
current (open) month. Tapping a branch expands it inline to show each
supervisor in that branch with their individual points/IQD.

**Report tab (new)** — a month switcher (only closed periods appear), showing
one combined table for the selected month: every subject, their branch,
points, IQD amount. A "Close month" button (visible only when at least one
elapsed month is still unclosed) triggers `close_next_month()`. An export
button generates an `.xlsx` file client-side and hands it to the OS share
sheet — which already covers WhatsApp, email, and printing, so no separate
print/email integration is built.

**Export approach**: a pure-JS xlsx library (e.g. SheetJS), so it works
identically on-device (iOS) and in the web build — no native module, no new
Expo config. Written to a temp file via `expo-file-system`, shared via
`expo-sharing`. Deferred to implementation time: exact library choice and
row/column formatting, since neither affects the data model or RLS design.

## Explicitly out of scope (parked, not designed here)

- Branch Manager role (discussed later, per the user).
- Read-only "owner viewer" account (separate role/auth work, own follow-up spec).
- Liquid-glass bottom nav animation (pure UI/motion, unrelated to this data feature).
- Create-task ("+") flow changes.
- Staff/supervisor-side UI updates.
- Oil-test / hood-cleaning / marination templates.

## Testing

- New `TESTS.sql` blocks: `close_next_month` picks the right month and is
  idempotent-safe (second call without a new elapsed month does nothing);
  `get_period_report` and `get_current_branch_summary` return correct sums
  and correctly attribute a subject to *their* branch, not the completion's
  task-team, including the multi-branch edge case.
- `npx tsc --noEmit` after UI changes.
- Live QA: create branches, assign supervisors, record audit completions with
  points, close a month, generate + export a report, confirm Dashboard's
  current-month rollup matches.
