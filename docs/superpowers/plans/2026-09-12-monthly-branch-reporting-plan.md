# Monthly Branch Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the org owner ("Admin") a per-branch points/penalty rollup on Dashboard, and a Report tab that closes a calendar month and exports a combined points/IQD report per staff member — without touching the team_admin or employee experience.

**Architecture:** Reuse the existing `teams` table as "branches" (label-only rename). Add one new table, `report_periods` (one row per closed calendar month), and three `security definer` RPCs that compute everything live from `task_completions` at read time — nothing is snapshotted, so a later points correction still shows correctly in an already-closed month. The Dashboard and Report screens are read-only consumers of those RPCs; export is done client-side to a `.xlsx` file handed to the OS share sheet.

**Tech Stack:** Expo Router + Supabase (Postgres/plpgsql RPCs) + react-i18next, `xlsx` (SheetJS) for export, `expo-file-system` + `expo-sharing` for the share sheet.

**Spec:** `docs/superpowers/specs/2026-09-12-monthly-branch-reporting-design.md`

## Global Constraints

- Admin-interface only. The `team_admin` (branch supervisor) and `employee` dashboards/screens must not change — see Task 9 for how `AdminDashboard` gets split so this holds.
- Every new RPC is `security definer`, checks `role = 'owner'` internally (raising an exception otherwise), and follows the exact pattern already used by `public.create_team` (`supabase/SETUP.sql:1271`) and `public.adjust_completion_points`.
- A branch's points must be attributed via `profile_teams` on the completion's `subject_profile_id` — **never** `task_completions.team_id`, which is the task's own team and can differ from the audited person's branch (see the auditor/subject model — already the source of a real, documented gotcha in this codebase).
- Nothing is snapshotted. `get_period_report` and `get_current_branch_summary` always compute from `task_completions` at read time, keyed only by a date range.
- `report_periods.period_month` is always the 1st of a calendar month (a `date`), never an arbitrary range.
- **`supabase/SETUP.sql` is never executed against the live project during this plan.** It is a full drop-and-rebuild of every table in the schema — running it live would destroy the real organization's real data (staff, tasks, audit history). It still gets edited in git (Tasks 1-4) so a future fresh environment builds correctly, but the file itself is not run live.
- Live verification for every SQL task instead applies **only the new objects being added in that task** — the exact `create table`/`create function`/`create policy`/`grant` snippet the task adds to `SETUP.sql`, nothing else — directly against the live project via `psql "<connection string>" -c "<snippet>"` or `-f` on a small scratch `.sql` file holding just that snippet. These are all brand-new objects (a new table, new functions); nothing existing is touched, so this is additive and safe regardless of what real data is currently in the database.
- Then run `supabase/TESTS.sql` (the **whole file**, not a fragment) against the live project via `psql "<connection string>" -f supabase/TESTS.sql`. This is safe to run live as-is and always has been: the entire file is one `begin; ... rollback;` transaction — every test org/user it creates (e.g. `close-month-owner.test@example.com`) is rolled back automatically at the end, so nothing it creates or touches persists, and it never reads or modifies the real organization's data (each test creates and scopes to its own fresh org). Confirm every `PASS:` notice appears, including all pre-existing ones (no regressions), with no `ERROR`, ending in a clean rollback.
- Connection string lives in `~/Projects/rungs/secrets.txt` (gitignored) — read it yourself, never paste its contents into chat, a commit, or a report file.
- This project has no JS test framework — deliberate; SQL correctness is proven live, not assumed.
- Verification for every TS/UI task additionally includes `npx tsc --noEmit` with zero errors.
- Labels: "Owner" badge → "Admin"; "Teams" tab → "Branches"; "People" tab → "Staff". All three are copy/i18n-value changes only — no schema or route renames.

---

## File Structure

New:
- `docs/superpowers/specs/2026-09-12-monthly-branch-reporting-design.md` (already exists)
- `src/hooks/useReports.tsx` — plain hook (no Context/Provider: only two screens consume it, so a shared provider would be premature — `OrgDataProvider`/`ChecklistDataProvider` exist because Realtime channel dedup requires exactly one subscription; this data has no Realtime subscription, so each screen just fetches its own copy)
- `src/app/(main)/report.tsx` — new Report tab screen
- `src/lib/exportReport.ts` — `.xlsx` generation + share

Modified:
- `supabase/SETUP.sql` — `report_periods` table, RLS policy, 3 RPCs, grants
- `supabase/TESTS.sql` — matching test blocks
- `src/types/index.ts` — `ReportPeriod`, `BranchSummaryRow`
- `src/i18n/en.ts`, `src/i18n/ar.ts` — new `report.*` keys, changed `dashboard.ownerBadge`/`mainTabs.teams`/`mainTabs.people` values
- `src/app/(main)/settings.tsx` — one-line `roleLabel` fix ('Owner' → 'Admin')
- `src/app/(main)/index.tsx` — split `AdminDashboard` into `OwnerDashboard` (new branch rollup) and `TeamAdminDashboard` (existing body, owner-only dead branches removed)
- `src/app/(main)/_layout.tsx` — register the `report` tab, owner-only
- `package.json` — add `xlsx`, `expo-file-system`, `expo-sharing`

---

### Task 1: `report_periods` table

**Files:**
- Modify: `supabase/SETUP.sql` (drop-list near line 14; table defs near line 110; RLS near line 435; grants near line 1938)
- Modify: `supabase/TESTS.sql` (schema block near the top, alongside the existing "Schema: the columns and helpers the app depends on" block)

**Interfaces:**
- Produces: table `public.report_periods(id uuid, org_id uuid, period_month date, closed_at timestamptz, closed_by uuid)`, unique on `(org_id, period_month)`.

- [ ] **Step 1: Add the failing schema assertion to `supabase/TESTS.sql`**

Add this block right after the existing "Schema: the columns and helpers the app depends on" `do $$ ... $$;` block near the top of the file:

```sql
-- ── Schema: report_periods exists with the right shape ───────────────────
do $$
declare
  v_has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_periods' and column_name = 'period_month'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: report_periods.period_month is missing';
  end if;
  raise notice 'PASS: report_periods has period_month';
end $$;
```

- [ ] **Step 2: Run it against the live project and confirm it fails**

Run: `psql "<connection string from secrets.txt>" -f supabase/TESTS.sql`
Expected: `ERROR: relation "public.report_periods" does not exist` (or similar) — the table isn't there yet.

- [ ] **Step 3: Add the table to `supabase/SETUP.sql`**

In the "Clean slate" drop list, right after `drop table if exists public.points_adjustments cascade;`:

```sql
drop table if exists public.report_periods cascade;
```

In the table-definitions section, right after the `teams` table (around line 110):

```sql
-- ── Monthly branch reporting ────────────────────────────────────────────
-- One row per calendar month an owner has closed. Nothing is snapshotted —
-- every report, past or current, is computed live from task_completions at
-- read time (see get_period_report / get_current_branch_summary below), so
-- a correction made after a month is closed still shows up correctly. Same
-- append-only philosophy as points_adjustments.
create table public.report_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_month date not null, -- always the 1st of the month, e.g. 2026-08-01
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id) on delete cascade,
  unique (org_id, period_month)
);

create index report_periods_org_idx on public.report_periods(org_id, period_month desc);
```

Right after `alter table public.teams enable row level security;` (around line 435):

```sql
alter table public.report_periods enable row level security;
```

In the policies section, near the `points_adjustments` policy:

```sql
-- Only the owner sees closed periods — closing a month and reading its
-- report is an org-wide action, same restriction as adjusting any audit.
create policy "report periods are visible only to the org owner"
  on public.report_periods for select
  using (org_id = public.my_org_id() and public.my_role() = 'owner');
```

In `SETUP.sql` itself no explicit grant line is needed — on a full rebuild, `report_periods` is created before the script's blanket `grant select, insert, update, delete on all tables in schema public to authenticated, service_role;` (around line 1940), which already covers it. **Applying this table to the already-running live project is different**: that blanket grant already ran once, in the past, and only covers tables that existed at that time (or future tables, if `alter default privileges` for the creating role covers it — don't rely on that holding here). So the live-apply step below adds one explicit grant that has no equivalent line in `SETUP.sql` — it's only needed because we're adding this table to an already-live database instead of rebuilding from scratch.

- [ ] **Step 4: Apply the new table live, then verify with TESTS.sql**

Do **not** run `supabase/SETUP.sql` against the live project — see this task's Global Constraints note; it would drop and rebuild every table, destroying real data.

Instead, write the table + RLS + policy snippet from Step 3 above, **plus one extra explicit grant**, to a scratch file (e.g. `/tmp/task1-live.sql`):

```sql
create table public.report_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_month date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id) on delete cascade,
  unique (org_id, period_month)
);

create index report_periods_org_idx on public.report_periods(org_id, period_month desc);

alter table public.report_periods enable row level security;

create policy "report periods are visible only to the org owner"
  on public.report_periods for select
  using (org_id = public.my_org_id() and public.my_role() = 'owner');

grant select, insert, update, delete on public.report_periods to authenticated, service_role;
```

Run: `psql "<connection string from secrets.txt>" -f /tmp/task1-live.sql`
Expected: no errors (this only creates a new table — nothing existing is touched).

Then run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `PASS: report_periods has period_month` appears, no `ERROR`, and the script ends with a clean `ROLLBACK` (every prior assertion still passes too — confirms no regression). Delete the scratch file when done.

- [ ] **Step 5: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add report_periods table for monthly branch reporting"
```

---

### Task 2: `close_next_month()` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (function drop-list near line 30; new function after `create_team` around line 1297; grant near line 1911)
- Modify: `supabase/TESTS.sql` (new block after the audit-model block)

**Interfaces:**
- Consumes: `public.report_periods` (Task 1), `public.my_org_id()`/`public.my_role()` (existing), `public.organizations.created_at`.
- Produces: `public.close_next_month() returns table (period_id uuid, period_month date)` — zero rows if nothing is closeable yet.

- [ ] **Step 1: Add the failing test to `supabase/TESTS.sql`**

Append near the end of the file (before the final `rollback;`):

```sql
-- ── Monthly close: picks the org's first elapsed month, then catches up ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_admin_id uuid;
  v_period_id uuid;
  v_period_month date;
  v_count int;
  v_raised boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'close-month-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Close Month Co', 'Owner', 'closemonthowner');

  v_admin_id := public.admin_create_user('Team Admin', 'closemonthadmin', 'initial123', 'team_admin', v_team_id);

  -- Backdate the org so June/July 2026 are already-elapsed months to close,
  -- regardless of what "now" actually is when this test runs.
  update public.organizations set created_at = '2026-06-10'::timestamptz where id = v_org_id;

  set role authenticated;

  -- ── A team_admin cannot close the month ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  v_raised := false;
  begin
    perform public.close_next_month();
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team_admin must not be able to close the month';
  end if;
  raise notice 'PASS: a team_admin cannot close the month';

  -- ── The owner's first close picks June 2026 (the org's creation month) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-06-01'::date then
    raise exception 'FAIL: expected the first close to be June 2026, got %', v_period_month;
  end if;
  raise notice 'PASS: the first close picks the org''s creation month';

  -- ── A second call catches up to July, not a repeat of June ──
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-07-01'::date then
    raise exception 'FAIL: expected the second close to be July 2026, got %', v_period_month;
  end if;
  raise notice 'PASS: a second close catches up to the next oldest unclosed month';

  -- ── The current, still-in-progress month is never closeable ──
  select count(*) into v_count from public.report_periods
  where org_id = v_org_id and period_month = date_trunc('month', now())::date;
  if v_count <> 0 then
    raise exception 'FAIL: the current in-progress month must never be closed';
  end if;
  raise notice 'PASS: the current in-progress month is never closed';

  reset role;
end $$;
```

- [ ] **Step 2: Run it against the live project and confirm it fails**

Run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `ERROR: function public.close_next_month() does not exist`.

- [ ] **Step 3: Add the function to `supabase/SETUP.sql`**

In the function drop-list near the top:

```sql
drop function if exists public.close_next_month() cascade;
```

Right after `public.create_team` (around line 1297):

```sql
-- Closes whichever calendar month has fully elapsed but has no
-- report_periods row yet. If the admin is behind (skipped a month or two),
-- calling this again catches up to the next oldest one — one per call.
create function public.close_next_month()
returns table (period_id uuid, period_month date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_org_created_month date;
  v_last_closed date;
  v_next_month date;
  v_new_period_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can close a month';
  end if;

  select date_trunc('month', o.created_at)::date into v_org_created_month
  from public.organizations o where o.id = v_org_id;

  select max(rp.period_month) into v_last_closed
  from public.report_periods rp where rp.org_id = v_org_id;

  v_next_month := coalesce((v_last_closed + interval '1 month')::date, v_org_created_month);

  if v_next_month + interval '1 month' > now() then
    return; -- that month hasn't fully elapsed yet — nothing to close
  end if;

  insert into public.report_periods (org_id, period_month, closed_by)
  values (v_org_id, v_next_month, auth.uid())
  returning id into v_new_period_id;

  return query select v_new_period_id, v_next_month;
end;
$$;
```

Near the other `grant execute` lines (around line 1911):

```sql
grant execute on function public.close_next_month() to authenticated;
```

- [ ] **Step 4: Apply the new function live, then verify with TESTS.sql**

Do **not** run `supabase/SETUP.sql` against the live project (see Global Constraints — it wipes real data). Instead write the `drop function if exists ... cascade;` + `create function public.close_next_month()...` + `grant execute ...` snippet from Step 3 to a scratch file (e.g. `/tmp/task2-live.sql`) and run it:

Run: `psql "<connection string from secrets.txt>" -f /tmp/task2-live.sql`
Expected: no errors (the `drop function if exists` is a no-op since it doesn't exist yet; this only adds a new function).

Then run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: all 4 new `PASS:` notices for this block, no `ERROR`, full rollback (nothing persists — this is the "create a test account, verify, then it's gone" flow, automatic via the transaction). Delete the scratch file when done.

- [ ] **Step 5: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add close_next_month RPC for monthly branch reporting"
```

---

### Task 3: `get_period_report(p_period_id)` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (function drop-list; new function after `close_next_month`; grant)
- Modify: `supabase/TESTS.sql` (new block)

**Interfaces:**
- Consumes: `public.report_periods` (Task 1), `public.task_completions`, `public.profile_teams`, `public.teams`, `public.profiles`.
- Produces: `public.get_period_report(p_period_id uuid) returns table (branch_id uuid, branch_name text, subject_profile_id uuid, subject_name text, total_points numeric, iqd_amount numeric)`.

- [ ] **Step 1: Add the failing test to `supabase/TESTS.sql`**

```sql
-- ── get_period_report attributes points to the SUBJECT's branch, not the
-- completion's own team_id (the auditor and subject can be on different
-- teams — this is the exact gotcha already documented on task_completions) ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_hq_team_id uuid;      -- the auditor's own team, where the audit TASK lives
  v_branch_team_id uuid;  -- the subject's real branch
  v_auditor_id uuid;
  v_subject_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_period_id uuid;
  v_period_month date;
  v_points numeric;
  v_branch_name text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'period-report-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_hq_team_id
  from public.create_organization('Period Report Co', 'Owner', 'periodreportowner');

  insert into public.teams (org_id, name) values (v_org_id, 'Zubair Branch') returning id into v_branch_team_id;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_auditor_id := public.admin_create_user('Hygiene Mgr', 'periodauditor', 'initial123', 'team_admin', v_hq_team_id);
  v_subject_id := public.admin_create_user('Zubair Supervisor', 'periodsubject', 'initial123', 'employee', v_branch_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_hq_team_id, 'Zubair Hygiene Audit', v_auditor_id, v_auditor_id, true, 'medium', false)
  returning id into v_task_id;

  v_completion_id := public.set_task_completion(
    v_task_id, true, 'good visit', '{}', null, '[]'::jsonb, v_subject_id, 'morning', -2
  );

  -- Backdate the org and the completion into a fully-elapsed month so it
  -- can actually be closed and reported on.
  update public.organizations set created_at = '2026-06-10'::timestamptz where id = v_org_id;
  update public.task_completions set created_at = '2026-06-15'::timestamptz where id = v_completion_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-06-01'::date then
    raise exception 'FAIL: expected to close June 2026, got %', v_period_month;
  end if;

  select total_points, branch_name into v_points, v_branch_name
  from public.get_period_report(v_period_id)
  where subject_profile_id = v_subject_id;

  if v_points is distinct from -2::numeric then
    raise exception 'FAIL: expected -2 total points for the subject, got %', v_points;
  end if;
  if v_branch_name is distinct from 'Zubair Branch' then
    raise exception 'FAIL: report must attribute points to the SUBJECT''s branch (Zubair), not the auditor''s team; got %', v_branch_name;
  end if;
  raise notice 'PASS: get_period_report attributes points via profile_teams on the subject, not task_completions.team_id';

  reset role;
end $$;
```

- [ ] **Step 2: Run it against the live project and confirm it fails**

Run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `ERROR: function public.get_period_report(uuid) does not exist`.

- [ ] **Step 3: Add the function to `supabase/SETUP.sql`**

Drop-list:

```sql
drop function if exists public.get_period_report(uuid) cascade;
```

Right after `close_next_month`:

```sql
-- One row per (subject, branch) for a closed period. Joins the subject's
-- branch via profile_teams — NOT task_completions.team_id, which is the
-- audit TASK's team and can differ from who's actually being audited (see
-- the auditor/subject model). If a subject belongs to more than one branch
-- (allowed for employees, rare for supervisors), their totals appear once
-- per branch — a known, accepted edge case.
create function public.get_period_report(p_period_id uuid)
returns table (
  branch_id uuid,
  branch_name text,
  subject_profile_id uuid,
  subject_name text,
  total_points numeric,
  iqd_amount numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_role text;
  v_period_org_id uuid;
  v_month date;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can view reports';
  end if;

  select rp.org_id, rp.period_month into v_period_org_id, v_month
  from public.report_periods rp where rp.id = p_period_id;

  if v_period_org_id is distinct from v_org_id then
    raise exception 'that report period does not belong to your organization';
  end if;

  return query
  select
    t.id,
    t.name,
    tc.subject_profile_id,
    sp.name,
    sum(tc.points_awarded),
    sum(tc.points_awarded) * 25000
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and tc.created_at >= v_month
    and tc.created_at < (v_month + interval '1 month')
  group by t.id, t.name, tc.subject_profile_id, sp.name
  order by t.name, sp.name;
end;
$$;
```

Grant:

```sql
grant execute on function public.get_period_report(uuid) to authenticated;
```

- [ ] **Step 4: Apply the new function live, then verify with TESTS.sql**

Do **not** run `supabase/SETUP.sql` against the live project (see Global Constraints). Write the `drop function if exists ... cascade;` + `create function public.get_period_report(...)...` + `grant execute ...` snippet from Step 3 to a scratch file (e.g. `/tmp/task3-live.sql`) and run it:

Run: `psql "<connection string from secrets.txt>" -f /tmp/task3-live.sql`
Expected: no errors.

Then run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `PASS: get_period_report attributes points via profile_teams on the subject, not task_completions.team_id`, no `ERROR`, clean rollback. Delete the scratch file when done.

- [ ] **Step 5: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add get_period_report RPC, attributed via the subject's branch"
```

---

### Task 4: `get_current_branch_summary()` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (function drop-list; new function after `get_period_report`; grant)
- Modify: `supabase/TESTS.sql` (new block)

**Interfaces:**
- Consumes: same tables as Task 3, but keyed on "1st of this month → now" instead of a closed period.
- Produces: `public.get_current_branch_summary() returns table (branch_id uuid, branch_name text, subject_profile_id uuid, subject_name text, total_points numeric, iqd_amount numeric)` — same column shape as `get_period_report`, so both map to one `BranchSummaryRow` TS type (Task 7).

- [ ] **Step 1: Add the failing test to `supabase/TESTS.sql`**

```sql
-- ── get_current_branch_summary: only this month, attributed by branch ───
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_hq_team_id uuid;
  v_branch_team_id uuid;
  v_auditor_id uuid;
  v_subject_id uuid;
  v_task_id uuid;
  v_current_completion_id uuid;
  v_old_completion_id uuid;
  v_points numeric;
  v_branch_name text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'branch-summary-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_hq_team_id
  from public.create_organization('Branch Summary Co', 'Owner', 'branchsummaryowner');

  insert into public.teams (org_id, name) values (v_org_id, 'Olympic Branch') returning id into v_branch_team_id;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_auditor_id := public.admin_create_user('Hygiene Mgr', 'summaryauditor', 'initial123', 'team_admin', v_hq_team_id);
  v_subject_id := public.admin_create_user('Olympic Supervisor', 'summarysubject', 'initial123', 'employee', v_branch_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_hq_team_id, 'Olympic Hygiene Audit', v_auditor_id, v_auditor_id, true, 'medium', false)
  returning id into v_task_id;

  -- This month: must show up.
  v_current_completion_id := public.set_task_completion(
    v_task_id, true, 'this month', '{}', null, '[]'::jsonb, v_subject_id, 'morning', 1.5
  );

  -- Backdated to last month: must NOT show up.
  v_old_completion_id := public.set_task_completion(
    v_task_id, true, 'last month', '{}', null, '[]'::jsonb, v_subject_id, 'evening', -3
  );
  update public.task_completions
    set created_at = date_trunc('month', now()) - interval '1 day'
    where id = v_old_completion_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  select total_points, branch_name into v_points, v_branch_name
  from public.get_current_branch_summary()
  where subject_profile_id = v_subject_id;

  if v_points is distinct from 1.5::numeric then
    raise exception 'FAIL: expected only this month''s 1.5 points, got % (did last month leak in?)', v_points;
  end if;
  if v_branch_name is distinct from 'Olympic Branch' then
    raise exception 'FAIL: expected Olympic Branch, got %', v_branch_name;
  end if;
  raise notice 'PASS: get_current_branch_summary includes only the current month, attributed to the subject''s branch';

  reset role;
end $$;
```

- [ ] **Step 2: Run it against the live project and confirm it fails**

Run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `ERROR: function public.get_current_branch_summary() does not exist`.

- [ ] **Step 3: Add the function to `supabase/SETUP.sql`**

Drop-list:

```sql
drop function if exists public.get_current_branch_summary() cascade;
```

Right after `get_period_report`:

```sql
-- Same shape and attribution rule as get_period_report, but for the
-- calendar month containing "now" (which is never closeable) — powers the
-- Dashboard's live, current-month rollup.
create function public.get_current_branch_summary()
returns table (
  branch_id uuid,
  branch_name text,
  subject_profile_id uuid,
  subject_name text,
  total_points numeric,
  iqd_amount numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_role text;
  v_month_start date;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can view the branch summary';
  end if;

  v_month_start := date_trunc('month', now())::date;

  return query
  select
    t.id,
    t.name,
    tc.subject_profile_id,
    sp.name,
    sum(tc.points_awarded),
    sum(tc.points_awarded) * 25000
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and tc.created_at >= v_month_start
  group by t.id, t.name, tc.subject_profile_id, sp.name
  order by t.name, sp.name;
end;
$$;
```

Grant:

```sql
grant execute on function public.get_current_branch_summary() to authenticated;
```

- [ ] **Step 4: Apply the new function live, then verify with TESTS.sql**

Do **not** run `supabase/SETUP.sql` against the live project (see Global Constraints). Write the `drop function if exists ... cascade;` + `create function public.get_current_branch_summary()...` + `grant execute ...` snippet from Step 3 to a scratch file (e.g. `/tmp/task4-live.sql`) and run it:

Run: `psql "<connection string from secrets.txt>" -f /tmp/task4-live.sql`
Expected: no errors.

Then run: `psql "<connection string>" -f supabase/TESTS.sql`
Expected: `PASS: get_current_branch_summary includes only the current month, attributed to the subject's branch`, no `ERROR`, full rollback. This is the last schema task — confirm the whole file still ends in a clean rollback with every prior `PASS:` intact (no regressions across all 4 schema tasks' test blocks). Delete the scratch file when done.

- [ ] **Step 5: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add get_current_branch_summary RPC for the live Dashboard rollup"
```

---

### Task 5: Label renames (Owner→Admin, Teams→Branches, People→Staff)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`
- Modify: `src/app/(main)/settings.tsx:24`

**Interfaces:**
- Consumes: existing i18n keys `dashboard.ownerBadge`, `mainTabs.teams`, `mainTabs.people` (already wired to `t()` calls in `index.tsx`, `teams.tsx`, `_layout.tsx` — no component changes needed there).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update `src/i18n/en.ts`**

Change:
```ts
    ownerBadge: 'OWNER',
```
to:
```ts
    ownerBadge: 'ADMIN',
```

Change:
```ts
    teams: 'Teams',
```
to:
```ts
    teams: 'Branches',
```

Change:
```ts
    people: 'People',
```
to:
```ts
    people: 'Staff',
```

- [ ] **Step 2: Update `src/i18n/ar.ts`**

Change:
```ts
    ownerBadge: 'المالك',
```
to:
```ts
    ownerBadge: 'المدير',
```

Change:
```ts
    teams: 'الفرق',
```
to:
```ts
    teams: 'الفروع',
```

Change:
```ts
    people: 'الأشخاص',
```
to:
```ts
    people: 'الموظفون',
```

(Also update every other `teams.*`/`people.*`-adjacent string in both files that literally says "team"/"فريق" as a *branch* concept — check `teams.title`, `teams.addTeam`, `teams.newTeamTitle`, `teams.teamNameLabel` from the earlier teams.tsx migration and change "Team"/"فريق" → "Branch"/"فرع" in each, e.g. `teams.title: 'Branches'`, `teams.addTeam: 'Branch'`, `teams.newTeamTitle: 'New branch'`, `teams.teamNameLabel: 'Branch name'`, and their Arabic equivalents using فرع/الفروع instead of فريق/الفرق.)

- [ ] **Step 3: Fix the one hardcoded role label in `settings.tsx`**

In `src/app/(main)/settings.tsx:24`, change:
```ts
  const roleLabel = profile?.role === 'owner' ? 'Owner' : profile?.role === 'team_admin' ? 'Team Admin' : 'Employee';
```
to:
```ts
  const roleLabel = profile?.role === 'owner' ? 'Admin' : profile?.role === 'team_admin' ? 'Team Admin' : 'Employee';
```

- [ ] **Step 4: Typecheck and verify both dictionaries resolve**

Run: `npx tsc --noEmit`
Expected: no errors.

Run the same standalone-i18next verification pattern used earlier in this project (load `en`/`ar` into a real i18next instance, print each changed key in both languages) to confirm no typo broke a key.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/ar.ts "src/app/(main)/settings.tsx"
git commit -m "Rename Owner->Admin, Teams->Branches, People->Staff (labels only)"
```

---

### Task 6: TS types for reports

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `ReportPeriod`, `BranchSummaryRow` — consumed by Tasks 7-10.

- [ ] **Step 1: Add the two interfaces**

Append to `src/types/index.ts`:

```ts
export interface ReportPeriod {
  id: string;
  orgId: string;
  /** Always the 1st of the month, e.g. '2026-08-01'. */
  periodMonth: string;
  closedAt: string;
  closedBy: string;
}

/** One row per (subject, branch) — the shared shape returned by both
 * get_period_report and get_current_branch_summary. */
export interface BranchSummaryRow {
  branchId: string;
  branchName: string;
  subjectProfileId: string;
  subjectName: string;
  totalPoints: number;
  iqdAmount: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (nothing consumes these types yet, so this is purely additive).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add ReportPeriod and BranchSummaryRow types"
```

---

### Task 7: `useReports` hook

**Files:**
- Create: `src/hooks/useReports.tsx`

**Interfaces:**
- Consumes: `supabase.rpc('close_next_month')`, `supabase.rpc('get_period_report', { p_period_id })`, `supabase.rpc('get_current_branch_summary')`, `supabase.from('report_periods')` (Tasks 1-4); `useAuth()` for `organization`; `ReportPeriod`/`BranchSummaryRow` (Task 6).
- Produces: `useReports(): { periods: ReportPeriod[]; currentSummary: BranchSummaryRow[]; loading: boolean; refresh: () => Promise<void>; closeNextMonth: () => Promise<{ periodId: string; periodMonth: string } | null>; getPeriodReport: (periodId: string) => Promise<BranchSummaryRow[]> }` — consumed by Tasks 9 and 10.

- [ ] **Step 1: Write the hook**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { BranchSummaryRow, ReportPeriod } from '../types';

function mapPeriod(row: any): ReportPeriod {
  return {
    id: row.id,
    orgId: row.org_id,
    periodMonth: row.period_month,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

function mapSummaryRow(row: any): BranchSummaryRow {
  return {
    branchId: row.branch_id,
    branchName: row.branch_name,
    subjectProfileId: row.subject_profile_id,
    subjectName: row.subject_name,
    totalPoints: Number(row.total_points),
    iqdAmount: Number(row.iqd_amount),
  };
}

export function useReports() {
  const { organization } = useAuth();
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [currentSummary, setCurrentSummary] = useState<BranchSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!organization) {
      setPeriods([]);
      setCurrentSummary([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: periodRows }, { data: summaryRows }] = await Promise.all([
      supabase
        .from('report_periods')
        .select('*')
        .eq('org_id', organization.id)
        .order('period_month', { ascending: false }),
      supabase.rpc('get_current_branch_summary'),
    ]);
    setPeriods((periodRows ?? []).map(mapPeriod));
    setCurrentSummary((summaryRows ?? []).map(mapSummaryRow));
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeNextMonth = useCallback(async () => {
    const { data, error } = await supabase.rpc('close_next_month');
    if (error) throw error;
    await refresh();
    const row = data?.[0];
    return row ? { periodId: row.period_id as string, periodMonth: row.period_month as string } : null;
  }, [refresh]);

  const getPeriodReport = useCallback(async (periodId: string): Promise<BranchSummaryRow[]> => {
    const { data, error } = await supabase.rpc('get_period_report', { p_period_id: periodId });
    if (error) throw error;
    return (data ?? []).map(mapSummaryRow);
  }, []);

  return { periods, currentSummary, loading, refresh, closeNextMonth, getPeriodReport };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useReports.tsx
git commit -m "Add useReports hook for branch summaries and closed periods"
```

---

### Task 8: Dashboard split — `OwnerDashboard` + `TeamAdminDashboard`

**Files:**
- Modify: `src/app/(main)/index.tsx`

**Interfaces:**
- Consumes: `useReports()` (Task 7), `BranchSummaryRow` (Task 6), existing `useAuth`, `useOrgData`, `Card`/`useThemeColors` from `@/components/ui`.
- Produces: `MainIndex` now dispatches to `EmployeeHome | OwnerDashboard | TeamAdminDashboard` by role, instead of `EmployeeHome | AdminDashboard`.

This is the one task that changes behavior for an existing role (`team_admin`), so it's worth stating precisely what does and doesn't change for them: **nothing**. `TeamAdminDashboard` is the exact current `AdminDashboard` body, minus the two `isOwner`-gated blocks (the org-code copy button, the team-filter chip scroller) that could never render for a `team_admin` caller anyway — deleting unreachable code, not changing behavior.

- [ ] **Step 1: Add the new imports and i18n keys**

In `src/i18n/en.ts`, inside the `dashboard` block, add:
```ts
    branchesHeading: 'Branches',
    noBranchActivity: 'No branch activity yet this month.',
    pointsSuffix: 'pts',
    iqdSuffix: 'IQD',
```
In `src/i18n/ar.ts`, inside the `dashboard` block, add:
```ts
    branchesHeading: 'الفروع',
    noBranchActivity: 'لا يوجد نشاط للفروع هذا الشهر بعد.',
    pointsSuffix: 'نقطة',
    iqdSuffix: 'دينار',
```

- [ ] **Step 2: Replace the top of `index.tsx` with a 3-way dispatch**

Change:
```tsx
export default function MainIndex() {
  const { profile } = useAuth();
  if (profile?.role === 'employee') return <EmployeeHome />;
  return <AdminDashboard />;
}
```
to:
```tsx
export default function MainIndex() {
  const { profile } = useAuth();
  if (profile?.role === 'employee') return <EmployeeHome />;
  if (profile?.role === 'owner') return <OwnerDashboard />;
  return <TeamAdminDashboard />;
}
```

- [ ] **Step 3: Rename `AdminDashboard` to `TeamAdminDashboard` and remove the dead owner-only branches**

Change the function name:
```tsx
function AdminDashboard() {
```
to:
```tsx
function TeamAdminDashboard() {
```

Remove the now-dead `isOwner` variable and its two conditional blocks. Change:
```tsx
  const { profile, organization } = useAuth();
  const { tasks, teams, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const isOwner = profile?.role === 'owner';
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>(isOwner ? 'all' : profile?.teamIds[0] ?? 'all');
```
to:
```tsx
  const { profile, organization } = useAuth();
  const { tasks, teams, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>(profile?.teamIds[0] ?? 'all');
```

Change:
```tsx
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.indigo }}>
                  {isOwner ? t('dashboard.ownerBadge') : t('dashboard.teamAdminBadge')}
                </Text>
              </View>
              {isOwner ? (
                <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{organization?.orgCode}</Text>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={c.textMuted} />
                </Pressable>
              ) : null}
```
to:
```tsx
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.indigo }}>{t('dashboard.teamAdminBadge')}</Text>
              </View>
```

Change:
```tsx
        {isOwner && teams.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8 }}>
            <TeamChip label={t('dashboard.allTeams')} active={selectedTeamId === 'all'} onPress={() => setSelectedTeamId('all')} />
            {teams.map((tm) => (
              <TeamChip key={tm.id} label={tm.name} active={selectedTeamId === tm.id} onPress={() => setSelectedTeamId(tm.id)} />
            ))}
          </ScrollView>
        ) : null}

```
to nothing (delete the block entirely).

`handleCopy`, `copied`, and the `Clipboard` import become unused in this function — remove the `const [copied, setCopied] = useState(false);` line and the `handleCopy` function from `TeamAdminDashboard`, but **keep the `expo-clipboard` import** at the top of the file since `OwnerDashboard` (Step 4) uses it too.

- [ ] **Step 4: Add `OwnerDashboard` right after `TeamAdminDashboard`**

```tsx
function OwnerDashboard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { organization } = useAuth();
  const { currentSummary, loading, refresh } = useReports();
  const [copied, setCopied] = useState(false);
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!organization) return;
    await Clipboard.setStringAsync(organization.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const branches = useMemo(() => {
    const map = new Map<
      string,
      { branchId: string; branchName: string; totalPoints: number; iqdAmount: number; supervisors: BranchSummaryRow[] }
    >();
    for (const row of currentSummary) {
      const existing = map.get(row.branchId);
      if (existing) {
        existing.totalPoints += row.totalPoints;
        existing.iqdAmount += row.iqdAmount;
        existing.supervisors.push(row);
      } else {
        map.set(row.branchId, {
          branchId: row.branchId,
          branchName: row.branchName,
          totalPoints: row.totalPoints,
          iqdAmount: row.iqdAmount,
          supervisors: [row],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.branchName.localeCompare(b.branchName));
  }, [currentSummary]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>{organization?.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.indigo }}>{t('dashboard.ownerBadge')}</Text>
              </View>
              <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{organization?.orgCode}</Text>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={c.textMuted} />
              </Pressable>
            </View>
          </View>
        </View>

        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
          {t('dashboard.branchesHeading')}
        </Text>

        {branches.length === 0 ? (
          <EmptyState text={t('dashboard.noBranchActivity')} />
        ) : (
          branches.map((branch) => {
            const expanded = expandedBranchId === branch.branchId;
            return (
              <Card key={branch.branchId} style={{ marginBottom: 10 }}>
                <Pressable
                  onPress={() => setExpandedBranchId(expanded ? null : branch.branchId)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{branch.branchName}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <View
                    style={{
                      backgroundColor: branch.totalPoints < 0 ? c.roseSoft : c.emeraldSoft,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: branch.totalPoints < 0 ? c.rose : c.emerald }}>
                      {branch.totalPoints} {t('dashboard.pointsSuffix')}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.indigo }}>
                      {branch.iqdAmount.toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                    </Text>
                  </View>
                </View>
                {expanded ? (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {branch.supervisors.map((s) => (
                      <View key={s.subjectProfileId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, color: c.text }}>{s.subjectName}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: s.totalPoints < 0 ? c.rose : c.emerald }}>
                          {s.totalPoints} · {s.iqdAmount.toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Add the new imports at the top of `index.tsx`**

Change:
```tsx
import { useState } from 'react';
```
to:
```tsx
import { useMemo, useState } from 'react';
```

Add, alongside the other `@/` imports:
```tsx
import { useReports } from '@/hooks/useReports';
import type { BranchSummaryRow } from '@/types';
```
(`OrgTask` is already imported from `@/types` — extend that same `import type { OrgTask } from '@/types';` line to `import type { OrgTask, BranchSummaryRow } from '@/types';` instead of adding a second line.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. In particular, confirm nothing outside this file still references `AdminDashboard` (it doesn't — `MainIndex` was the only caller).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(main)/index.tsx" src/i18n/en.ts src/i18n/ar.ts
git commit -m "Split Dashboard into OwnerDashboard (branch rollup) and TeamAdminDashboard"
```

---

### Task 9: Report tab screen

**Files:**
- Create: `src/app/(main)/report.tsx`
- Modify: `src/app/(main)/_layout.tsx` (register the tab)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (new `report.*` block)

**Interfaces:**
- Consumes: `useReports()` (Task 7), `ReportPeriod`/`BranchSummaryRow` (Task 6), `exportReportToExcel` (Task 10 — imported here but not yet implemented; this task's typecheck will fail until Task 10 lands, which is fine since these two tasks are meant to be done back-to-back and reviewed together as one screen).

Actually — to keep Task 9 independently verifiable (per the plan's own rule that each task ends in a working, typechecked state), build the export button as a no-op stub in this task and wire in the real implementation in Task 10, rather than importing a not-yet-written module.

- [ ] **Step 1: Add the `report.*` i18n keys**

In `src/i18n/en.ts`, add a new top-level block (after `dashboard`):
```ts
  report: {
    title: 'Report',
    closeMonth: 'Close month',
    nothingToClose: 'This month is still in progress — nothing to close yet.',
    closeError: 'Could not close the month.',
    noClosedMonths: 'No months closed yet.',
    tableHeading: 'This month',
    export: 'Export',
    loadingReport: 'Loading report…',
    total: 'Total',
  },
```
In `src/i18n/ar.ts`:
```ts
  report: {
    title: 'التقرير',
    closeMonth: 'إغلاق الشهر',
    nothingToClose: 'هذا الشهر لا يزال جارياً — لا يوجد شيء لإغلاقه بعد.',
    closeError: 'تعذر إغلاق الشهر.',
    noClosedMonths: 'لا توجد أشهر مغلقة بعد.',
    tableHeading: 'هذا الشهر',
    export: 'تصدير',
    loadingReport: 'جارٍ تحميل التقرير…',
    total: 'الإجمالي',
  },
```
Also add `mainTabs.report: 'Report'` (en) / `'التقرير'` (ar) to the existing `mainTabs` block in both files.

- [ ] **Step 2: Write `src/app/(main)/report.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useReports } from '@/hooks/useReports';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';
import type { BranchSummaryRow, ReportPeriod } from '@/types';

function formatPeriodLabel(period: ReportPeriod, locale: string) {
  return new Date(period.periodMonth).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export default function ReportScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { periods, closeNextMonth, getPeriodReport } = useReports();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [rows, setRows] = useState<BranchSummaryRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? periods[0] ?? null;

  useEffect(() => {
    if (!selectedPeriod) {
      setRows([]);
      return;
    }
    setRowsLoading(true);
    getPeriodReport(selectedPeriod.id)
      .then(setRows)
      .finally(() => setRowsLoading(false));
  }, [selectedPeriod?.id, getPeriodReport]);

  const handleClose = async () => {
    setClosing(true);
    setCloseError(null);
    try {
      const result = await closeNextMonth();
      if (!result) setCloseError(t('report.nothingToClose'));
    } catch (e: any) {
      setCloseError(e?.message ?? t('report.closeError'));
    } finally {
      setClosing(false);
    }
  };

  const handleExport = () => {
    // Wired to a real .xlsx export in the next task.
  };

  const totalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);
  const totalIqd = rows.reduce((sum, r) => sum + r.iqdAmount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 }}>{t('report.title')}</Text>

        <PrimaryButton title={t('report.closeMonth')} onPress={handleClose} loading={closing} />
        {closeError ? <Text style={{ color: c.rose, fontSize: 12, marginTop: 8 }}>{closeError}</Text> : null}

        {periods.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 20 }}>{t('report.noClosedMonths')}</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 20 }} contentContainerStyle={{ gap: 8 }}>
              {periods.map((p) => {
                const active = selectedPeriod?.id === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelectedPeriodId(p.id)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: active ? c.indigo : c.bgSubtle,
                      borderWidth: 1,
                      borderColor: active ? c.indigo : c.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                      {formatPeriodLabel(p, i18n.language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' }}>
                {t('report.tableHeading')}
              </Text>
              <Pressable onPress={handleExport} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="share-outline" size={16} color={c.indigo} />
                <Text style={{ fontSize: 13, color: c.indigo, fontWeight: '700' }}>{t('report.export')}</Text>
              </Pressable>
            </View>

            {rowsLoading ? (
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 12 }}>{t('report.loadingReport')}</Text>
            ) : (
              <Card style={{ marginTop: 12 }}>
                {rows.map((r) => (
                  <View
                    key={`${r.subjectProfileId}-${r.branchId}`}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{r.subjectName}</Text>
                      <Text style={{ fontSize: 12, color: c.textMuted }}>{r.branchName}</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: r.totalPoints < 0 ? c.rose : c.emerald }}>
                      {r.totalPoints} · {r.iqdAmount.toLocaleString(i18n.language)}
                    </Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{t('report.total')}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                    {totalPoints} · {totalIqd.toLocaleString(i18n.language)}
                  </Text>
                </View>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Register the tab in `_layout.tsx`, owner-only**

Add, right after the `teams` `Tabs.Screen` block:

```tsx
        <Tabs.Screen
          name="report"
          options={{
            title: t('mainTabs.report'),
            href: isOwner ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" size={size} color={color} />,
          }}
        />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Live QA — do not run this against the real organization**

Do not sign in as the real owner account and do not call `close_next_month()` for real — that would create a real, hard-to-undo closed-month row in production data, and the user (who owns that account) asked to keep it untouched for this plan. Instead run the app (`npm run web` or `npm run watch`) against a disposable test org created through the normal signup flow (own email alias, own throwaway org), close a month there, and confirm: the Report tab is visible for the owner and hidden for a team_admin/employee; the month switcher lists closed periods; selecting one loads its rows; totals at the bottom sum correctly. Note in the report that this still needs a final pass by the user on their own account before they consider it done.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(main)/report.tsx" "src/app/(main)/_layout.tsx" src/i18n/en.ts src/i18n/ar.ts
git commit -m "Add the Report tab: month switcher, combined table, close-month button"
```

---

### Task 10: `.xlsx` export

**Files:**
- Modify: `package.json` (add `xlsx`, `expo-file-system`, `expo-sharing`)
- Create: `src/lib/exportReport.ts`
- Modify: `src/app/(main)/report.tsx` (wire the real export in)

**Interfaces:**
- Consumes: `ReportPeriod`/`BranchSummaryRow` (Task 6).
- Produces: `exportReportToExcel(period: ReportPeriod, rows: BranchSummaryRow[], locale: string): Promise<void>` — consumed by `report.tsx`'s `handleExport`.

- [ ] **Step 1: Check the current Expo SDK docs before adding native-adjacent packages**

Per this project's `AGENTS.md`, read the versioned Expo docs for `expo-file-system` and `expo-sharing` before writing any code against them (API shapes have changed release to release — confirm `FileSystem.cacheDirectory`, `writeAsStringAsync`, `EncodingType.Base64`, and `Sharing.isAvailableAsync`/`shareAsync` are still the current API for the SDK version this project pins).

- [ ] **Step 2: Install the packages**

Run: `npx expo install expo-file-system expo-sharing`
Run: `npm install xlsx`

- [ ] **Step 3: Write `src/lib/exportReport.ts`**

```ts
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { BranchSummaryRow, ReportPeriod } from '@/types';

export async function exportReportToExcel(period: ReportPeriod, rows: BranchSummaryRow[], locale: string): Promise<void> {
  const monthLabel = new Date(period.periodMonth).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const sheetData = rows.map((r) => ({
    Name: r.subjectName,
    Branch: r.branchName,
    Points: r.totalPoints,
    'Amount (IQD)': r.iqdAmount,
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  // Excel sheet names are capped at 31 characters.
  XLSX.utils.book_append_sheet(workbook, worksheet, monthLabel.slice(0, 31));

  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const fileUri = `${FileSystem.cacheDirectory}report-${period.periodMonth}.xlsx`;
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: monthLabel,
    });
  }
}
```

- [ ] **Step 4: Wire it into `report.tsx`**

Change:
```tsx
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';
import type { BranchSummaryRow, ReportPeriod } from '@/types';
```
to:
```tsx
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';
import { exportReportToExcel } from '@/lib/exportReport';
import type { BranchSummaryRow, ReportPeriod } from '@/types';
```

Change:
```tsx
  const handleExport = () => {
    // Wired to a real .xlsx export in the next task.
  };
```
to:
```tsx
  const handleExport = async () => {
    if (!selectedPeriod) return;
    await exportReportToExcel(selectedPeriod, rows, i18n.language);
  };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Flag for the user's own device QA — do not attempt this step**

The native OS share sheet only exists on a real device, not in the subagent's environment, and it involves the user's own physical iPhone and real accounts (WhatsApp/email) — not something to automate here. Mark this step as deferred in the report: "Needs the user to verify on their own device: open Report tab, select a closed month, tap Export, confirm the share sheet opens and the shared `.xlsx` file opens correctly with the right columns/values."

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/exportReport.ts "src/app/(main)/report.tsx"
git commit -m "Add .xlsx export for the Report tab via the OS share sheet"
```

---

## Self-Review Notes

- **Spec coverage:** all 6 spec sections have a task — renames (5), `report_periods`+RLS (1), 3 RPCs (2-4), Dashboard rollup (8), Report tab (9), export (10). Types (6) and the hook (7) are spec-implied infrastructure, not separate spec sections, but both are required by 8-10.
- **Placeholder scan:** no TBD/TODO left in any step; the one intentional stub (`handleExport` no-op in Task 9) is explicitly called out and closed by Task 10 in the very next task, with the exact diff that replaces it.
- **Type consistency:** `BranchSummaryRow` (Task 6) is the single shape returned by both `get_period_report` and `get_current_branch_summary` (Tasks 3-4), consumed identically by `useReports` (Task 7), `OwnerDashboard` (Task 8), and `report.tsx` (Task 9) — one name, one shape, everywhere.
- **Scope check:** every task stays inside "admin interface only." `TeamAdminDashboard` (Task 8) is explicitly a no-behavior-change extraction, not a redesign, keeping the team_admin/employee experience untouched as required.
