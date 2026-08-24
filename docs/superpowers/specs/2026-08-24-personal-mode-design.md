# Personal Mode — Design Spec

Status: draft, awaiting approval
Author: Claude, from requirements gathered with the project owner
Date: 2026-08-24

## 1. Problem

OrgTasks is company-only today: every account belongs to an organization, has a
role (`owner`/`team_admin`/`employee`), and every screen assumes that context. The
owner wants a second, unrelated mode: a private personal task list with due-date
reminders — "buy groceries," "call the accountant" — for anyone using the app,
whether or not they belong to a company.

Confirmed with the owner: Personal must be **fully separate from the org system**,
not a company feature in disguise. A personal account has no organization, no role,
no team, and cannot see or be seen by anyone else's data — ever.

## 2. What stays the same, what's new

**Reused as-is:** Supabase Auth (`auth.users`) as the identity system — that's
"who is logged in," independent of "what company are they in." Personal accounts
authenticate the same way company accounts do (email + password against
`auth.users`); they just never get a `profiles` row, which is what currently
carries all company/org context.

**New and independent:** two tables that don't reference `organizations`,
`profiles`, or `tasks` at all — `personal_tasks` and `push_tokens`. A personal
account's data has zero path to intersect a company's data, by construction (no
shared foreign key), not just by RLS policy.

## 3. How the app knows which mode you're in

At the very first screen (before choosing "Create organization" / "Join" today),
add a **Company vs Personal** choice.

- **Company** → existing flow, completely unchanged (create org / admin-provisioned
  login with Organization ID + username).
- **Personal** → new screen: real email + password, straight to
  `supabase.auth.signUp()`. No RPC runs afterward — no `profiles` row is created.

On every subsequent login, `useAuth` decides which UI to show with one check: does
a `profiles` row exist for `auth.uid()`?
- Yes → company mode, current behavior, untouched.
- No → personal mode, new UI.

No new "account type" column anywhere — the *absence* of a profile row is what
personal means. This is also why personal accounts are cheap to build: nothing
about the existing schema, RLS policies, or company screens needs to change.

## 4. Data model

```sql
create table public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  due timestamptz,
  completed boolean not null default false,
  completed_at timestamptz,
  reminder_sent_at timestamptz,  -- prevents double-notifying the same due task
  created_at timestamptz not null default now()
);

alter table public.personal_tasks enable row level security;

create policy "a user can only ever touch their own personal tasks"
  on public.personal_tasks for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (owner_id, expo_push_token)
);

alter table public.push_tokens enable row level security;

create policy "a user can only manage their own push tokens"
  on public.push_tokens for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

No `org_id` column anywhere in this design — that's the enforcement mechanism for
"fully separate," not just a convention.

## 5. What a personal account actually sees

One new screen, no tabs it doesn't need:

- **My Tasks** (the whole app, essentially) — a flat list: title, optional notes,
  optional due date/time, a checkbox. No priority, no review, no checklist
  templates, no proof photos — those are all workplace concepts a personal list
  doesn't need.
- **Settings** — change password, notification permission status, sign out. Far
  shorter than the company Settings screen (no organization, no recovery-email
  step tied to admin password resets).

Reuses the existing `DueDateField` component (already fixed for both themes and
closeable). Does **not** reuse `useOrgData` — that hook is fundamentally
org-shaped (teams, members, RLS scoped by `org_id`). A new, much smaller
`usePersonalTasks` hook talks only to `personal_tasks`.

## 6. Reminder notifications

**Client side:** add `expo-notifications` + `expo-device`. On first entering
Personal mode (and again from Settings if previously denied), request
notification permission, register for an Expo push token, and upsert it into
`push_tokens`.

**Server side:** a Supabase Edge Function, invoked on a schedule (Supabase's
built-in Scheduled Triggers — a cron expression, e.g. every 5 minutes):

1. Query `personal_tasks` where `due` falls within the next window, `completed =
   false`, and `reminder_sent_at is null`.
2. For each, look up that user's row(s) in `push_tokens`.
3. POST to Expo's push API (`https://exp.host/--/api/v2/push/send`) — free, no
   account needed beyond the Expo project already in use.
4. Mark `reminder_sent_at = now()` so the same task never notifies twice.

No new paid infrastructure: Scheduled Triggers and Edge Functions are both
included on the current Supabase plan at this project's scale.

## 7. Testing

Following this project's existing pattern (`supabase/TESTS.sql` fakes
`auth.uid()` and rolls back):

- RLS check: user A cannot `select`/`insert`/`update`/`delete` user B's
  `personal_tasks` or `push_tokens` rows.
- RLS check: a company account (has a `profiles` row) can still use
  `personal_tasks` if they want to — nothing blocks a company user from *also*
  having personal tasks, since the table only cares about `auth.uid()`. Worth
  confirming this is desired, not accidental (see open question below).

No live push send in automated tests — that's manually verified on-device, same
as camera-only proof photos already are.

## 8. Explicitly out of scope for this pass

- **Company accounts moving to real email** — the owner raised this as a later
  goal. This design doesn't block it: company accounts already collect a real
  email for the owner at signup today, and `must_change_password` /
  `recovery_email` already exist for admin-provisioned accounts. Extending that
  is a separate, smaller design when the owner is ready — noted here only so this
  personal-mode work doesn't paint that direction into a corner.
- **Personal ↔ company account linking or conversion** (one login, both modes).
- **Push notifications for company/org tasks** — not requested; this pass is
  personal-only.
- Bulk-select assignees on checklist tasks — already tracked in `ROADMAP.md`
  backlog, unrelated to this feature.

## 9. Open question for the owner

Should a company account (owner/team_admin/employee) also be allowed to use
Personal mode from the same login, or is Personal strictly for people who signed
up through the separate Personal flow? The schema in §4 doesn't prevent either —
it just needs a decision so the entry-point UI (§3) can either allow or block a
company user from ever reaching the Personal signup screen while already
logged in as a company account.
