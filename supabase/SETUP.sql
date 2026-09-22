-- Rungs — full setup script. Safe to run repeatedly: it drops
-- everything belonging to this app first, then rebuilds it from scratch in
-- its final, correct form. This replaces the old numbered migration files
-- (0000-0005) — just run THIS one file whenever the schema needs to be
-- (re)applied during testing. Also wipes all data and test auth accounts,
-- so you always start from a clean slate.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

-- ── Clean slate ─────────────────────────────────────────────────────

drop table if exists public.branch_brands cascade;
drop table if exists public.brands cascade;
drop table if exists public.profile_teams cascade;
drop table if exists public.task_occurrences cascade;
drop table if exists public.points_adjustments cascade;
drop table if exists public.report_periods cascade;
drop table if exists public.checklist_section_photos cascade;
drop table if exists public.checklist_answers cascade;
drop table if exists public.checklist_submissions cascade;
drop table if exists public.checklist_assignments cascade;
drop table if exists public.checklist_template_items cascade;
drop table if exists public.checklist_templates cascade;
drop table if exists public.task_completions cascade;
drop table if exists public.tasks cascade;
drop table if exists public.profiles cascade;
drop table if exists public.teams cascade;
drop table if exists public.organizations cascade;
drop table if exists public.login_lookup_attempts cascade;
drop table if exists public.org_lookup_attempts cascade;
drop table if exists public.push_tokens cascade;
-- Personal-account mode was removed 2026-09-12 (org-only now); this drop
-- stays so a database from before that change gets cleaned up on rebuild.
drop table if exists public.personal_tasks cascade;

drop function if exists public.my_org_id() cascade;
drop function if exists public.my_role() cascade;
-- my_team_id() (singular) is gone — team membership is now many-to-many via
-- profile_teams, replaced by my_team_ids() below.
drop function if exists public.my_team_id() cascade;
drop function if exists public.my_team_ids() cascade;
-- Both signatures: the old one had no brand parameter, the new one does.
drop function if exists public.add_profile_to_team(uuid, uuid) cascade;
drop function if exists public.add_profile_to_team(uuid, uuid, uuid) cascade;
drop function if exists public.remove_profile_from_team(uuid, uuid) cascade;
drop function if exists public.my_active() cascade;
drop function if exists public.my_must_change_password() cascade;
drop function if exists public.role_of(uuid) cascade;
drop function if exists public.generate_org_code(text) cascade;
drop function if exists public.get_org_by_code(text) cascade;
drop function if exists public.create_organization(text, text, text, text) cascade;
-- Self-service join is gone (accounts are provisioned by an admin now), but
-- the drop stays so re-running this script removes it from older databases.
drop function if exists public.join_organization(text, uuid, text, text, text) cascade;
drop function if exists public.get_login_email(text, text) cascade;
-- Both signatures: the old one took an admin to promote, the new one doesn't.
drop function if exists public.create_team(text, uuid) cascade;
drop function if exists public.create_team(text) cascade;
drop function if exists public.create_brand(text) cascade;
drop function if exists public.set_branch_brands(uuid, uuid[]) cascade;
drop function if exists public.close_next_month() cascade;
drop function if exists public.set_iqd_per_point(numeric) cascade;
drop function if exists public.admin_delete_user(uuid) cascade;
drop function if exists public.update_my_profile(text, text, text) cascade;
drop function if exists public.sync_mirrored_templates(uuid) cascade;
drop function if exists public.stamp_completion_iqd_rate() cascade;
drop function if exists public.get_period_report(uuid) cascade;
drop function if exists public.get_current_branch_summary() cascade;
-- Both signatures: the old one had no brand parameter, the new one does.
drop function if exists public.admin_create_user(text, text, text, text, uuid, text) cascade;
drop function if exists public.admin_create_user(text, text, text, text, uuid, text, uuid) cascade;
drop function if exists public.assert_can_manage_user(uuid) cascade;
drop function if exists public.admin_reset_password(uuid, text) cascade;
drop function if exists public.admin_set_user_active(uuid, boolean) cascade;
drop function if exists public.clear_must_change_password() cascade;
-- Both signatures: the old one took a single photo url, the new one an array.
-- Every prior signature of set_task_completion, so re-running this script
-- cleans up whichever version an older database still has.
drop function if exists public.set_task_completion(uuid, boolean, text, text) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[]) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid, jsonb) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid, jsonb, text) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid, jsonb, text, jsonb) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid, jsonb, text, jsonb, text) cascade;
drop function if exists public.ensure_supervisor_daily_task() cascade;
drop function if exists public.ensure_role_checklist_tasks() cascade;
drop function if exists public.set_template_audience(uuid, text) cascade;
drop function if exists public.adjust_completion_points(uuid, numeric, text) cascade;
drop function if exists public.generate_task_occurrences() cascade;
drop function if exists public.create_checklist_template(text, int, boolean, jsonb) cascade;
drop function if exists public.create_checklist_template(text, boolean, jsonb) cascade;
drop function if exists public.create_form_template(text, jsonb) cascade;
-- Checklists are no longer a separate assignable thing — a checklist is a
-- task with template_id set, created the same way any task is.
drop function if exists public.assign_checklist(uuid, uuid) cascade;
drop function if exists public.unassign_checklist(uuid) cascade;
drop function if exists public.submit_checklist(uuid, jsonb, jsonb) cascade;
drop function if exists public.declare_checklist_off_duty(uuid, text) cascade;
drop function if exists public.declare_task_off_duty(uuid, text) cascade;
drop function if exists public.review_checklist_off_duty(uuid, boolean, text) cascade;
drop function if exists public.review_off_duty(uuid, boolean, text) cascade;
drop function if exists public.review_task_completion(uuid, text) cascade;

-- Supabase blocks direct DELETE on storage tables (its own protect_delete()
-- trigger — "Use the Storage API instead"), so the bucket and any old test
-- photos in it are left alone; bucket creation below is made idempotent
-- with ON CONFLICT instead of trying to delete-then-recreate it.
drop policy if exists "org members can upload their own proof photos" on storage.objects;
drop policy if exists "anyone can read proof photos (bucket is public)" on storage.objects;

delete from auth.users;

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text unique not null,
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- What one penalty point is worth in IQD. Owner-editable in Settings via
  -- set_iqd_per_point; a change only applies from then on, because every
  -- audit stamps the rate in force at submission onto its own row (see
  -- task_completions.iqd_per_point).
  iqd_per_point numeric not null default 25000 check (iqd_per_point > 0),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  title text,
  username text,
  role text not null check (role in ('owner', 'team_admin', 'employee')),
  -- Set true whenever an admin creates the account or resets the password, so
  -- the app can force a change before letting them in. An owner who chose
  -- their own password at signup starts false.
  must_change_password boolean not null default false,
  -- Deactivated accounts cannot sign in; see admin_set_user_active.
  active boolean not null default true,
  -- Optional, added by the user later, purely so password reset can email
  -- them. NOT the auth email — the auth email stays synthetic.
  recovery_email text,
  -- Set by admin_delete_user. A deleted person is gone from Staff and every
  -- picker and can never sign in again (username cleared, auth banned), but
  -- the row stays so their past audits keep their name in History/reports.
  deleted_at timestamptz,
  -- Self-service profile extras, set via update_my_profile: a photo (in the
  -- task-proofs bucket) and the company ID code used at check-in/out.
  avatar_url text,
  employee_code text,
  created_at timestamptz not null default now()
);

create unique index profiles_org_username_unique_idx
  on public.profiles (org_id, lower(username));

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

-- A branch (team) can run more than one brand (e.g. "360", "AA Chicken",
-- "Center"). A supervisor's profile_teams row names both the branch and,
-- optionally, which brand within it they cover — see brand_id below.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.branch_brands (
  branch_id uuid not null references public.teams(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  primary key (branch_id, brand_id)
);

-- A person can belong to more than one team (e.g. a supervisor who covers
-- both the hygiene and kitchen checklists, each run by a different leader).
-- In practice a team leader has exactly one row here — that's a usage
-- pattern, not a restriction the schema enforces.
create table public.profile_teams (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  brand_id uuid references public.brands(id) on delete set null,
  primary key (profile_id, team_id)
);

-- ── Checklist templates ─────────────────────────────────────────────
-- A repeating inspection form (e.g. the daily hygiene sheet), authored once
-- and reused by attaching it to however many tasks need it. A "checklist" is
-- not a separate concept from a task — it's a task with template_id set;
-- see the tasks table below.

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- A note is required to explain a "لا" answer; never required on "نعم".
  -- Photos are always optional, whatever this is set to.
  requires_note_on_no boolean not null default true,
  -- Who fills this template every day: 'employee' (supervisors) or
  -- 'team_admin' (branch managers); null for an audit or an ad-hoc
  -- checklist. Setting it (set_template_audience) gives every current and
  -- future member of that role their own copy in each of their branches
  -- (see ensure_role_checklist_tasks), and a submission must carry a live
  -- selfie and the device's location (enforced in set_task_completion).
  -- It's also what the Checklists tab reviews.
  assign_to_role text check (assign_to_role in ('employee', 'team_admin')),
  -- When set, this template's questions (sections, order, wording) are
  -- replaced with the source template's every time the source is edited,
  -- so the supervisors' daily checklist always asks exactly what the admin's
  -- audit asks. Point weights are not copied: they only matter to an audit.
  mirrors_template_id uuid references public.checklist_templates(id) on delete set null,
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  -- '' means no section (a flat template, like the manager checklist).
  section_title text not null default '',
  sort_order int not null,
  question text not null,
  -- How many points a "No" answer costs (0 for "Yes"). Set once per question
  -- on the template, editable only by an owner. 0.25 is an ordinary
  -- question; a more serious one gets a higher weight so a single "No"
  -- costs more. Only meaningful on an is_audit task's completion — see
  -- set_task_completion's scoring branch.
  point_weight numeric not null default 0.25 check (point_weight >= 0)
);

create index checklist_template_items_template_idx on public.checklist_template_items(template_id, sort_order);

-- A separate module from checklist_templates on purpose. Checklists are a
-- flat list of yes/no questions; oil test, hood cleaning, and chicken
-- marination are real logs — a TPM% reading, a fryer number, a filtration
-- status, a time — and forcing a number into a yes/no question with the
-- actual value typed into a note field would make it unthresholdable and
-- unchartable. Each submission of a form task is one row in a continuous
-- log (task_completions, already append-only) — exactly what the source
-- Excel sheets already look like, one row per date/time. The specific
-- templates (oil test, hood cleaning, chicken marination) are separate,
-- later work; this is just the general field-typed module they'll sit on.
create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.form_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates(id) on delete cascade,
  sort_order int not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'time', 'select')),
  -- Only meaningful (and required) when field_type = 'select', e.g.
  -- '["OK","Replace"]' for filtration status or '["Good","Bad"]" for a
  -- condition rating. Null for every other field type.
  options jsonb,
  -- Free-form display unit shown next to the value — '%', 'L', '°C' — purely
  -- cosmetic, never parsed or validated against.
  unit text,
  required boolean not null default true,
  check (field_type <> 'select' or (options is not null and jsonb_array_length(options) > 0))
);

create index form_template_fields_template_idx on public.form_template_fields(template_id, sort_order);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  notes text,
  due timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  assignee_id uuid references public.profiles(id) on delete set null,
  requires_proof boolean not null default false,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  proof_note text,
  -- Several photos per completion, all taken with the camera at the time.
  proof_photo_urls text[] not null default '{}',
  -- Null means an ordinary task. Set means this task is a checklist: filling
  -- it out means answering every question on the template, not just ticking
  -- a box, and cooldown_hours makes it a repeating assignment rather than a
  -- one-off — a supervisor working a double just sees it come back mid-shift
  -- instead of being falsely marked late for a shift swap. No calendar/shift
  -- concept on purpose.
  template_id uuid references public.checklist_templates(id) on delete set null,
  -- A form task (oil test, hood cleaning, chicken marination — see
  -- form_templates) instead of a checklist. A task is at most one of these,
  -- never both — enforced below.
  form_template_id uuid references public.form_templates(id) on delete set null,
  cooldown_hours int,
  -- Fixed clock times this task is due each day, e.g. '{12:00,16:00,22:00}'
  -- for a 3x-daily oil check — entirely the admin's choice, no fixed pattern
  -- assumed. Mutually exclusive with cooldown_hours: a task is either "due
  -- again N hours after it was last done" or "due at these times every day,"
  -- never both. See task_occurrences for how a time turns into something
  -- someone can actually complete and get reminded about.
  scheduled_times time[],
  -- Whether a leader/owner has to sign off before this counts as truly done.
  -- Driven by priority at creation time: low never needs review, high always
  -- does, medium is the creator's choice — enforced below, not just in the UI.
  requires_review boolean not null default false,
  -- True for an admin's own audit task: the actor is judging someone else,
  -- chosen fresh at each submission (see set_task_completion) rather than
  -- fixed at task creation. Uses its own checklist template, separate from
  -- a supervisor's routine copy of the same subject (e.g. hygiene) — they
  -- started identical but are edited independently from here on, so a
  -- point-weight change to the audit version never touches the plain one.
  -- An ordinary task (the far more common case) leaves this false.
  is_audit boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  check (template_id is not null or cooldown_hours is null),
  check (priority <> 'low' or requires_review = false),
  check (priority <> 'high' or requires_review = true),
  check (scheduled_times is null or cooldown_hours is null),
  check (template_id is null or form_template_id is null)
);

-- Append-only audit log. tasks holds only the CURRENT state, which is wiped
-- when a task is reopened; this keeps every completion and reopen forever so
-- the org can look back at who did what, when, and with what proof — and, for
-- a checklist task, every answer given each time it was filled out.
create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  -- Nullable, and set null rather than cascade, so deleting a task cannot
  -- erase the record that it was done, by whom, or with what proof. The
  -- snapshot columns below keep the row readable once the task is gone.
  task_id uuid references public.tasks(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  -- Kept even if the task is later renamed or deleted-and-recreated.
  task_title text not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  -- off_duty is a checklist-only claim ("I'm not on duty today"), distinct
  -- from actually completing the task — see status below.
  action text not null check (action in ('completed', 'reopened', 'off_duty')),
  -- Only meaningful when action = 'off_duty'; null otherwise.
  status text check (status in ('off_duty_pending', 'off_duty_approved', 'off_duty_rejected')),
  off_duty_reason text,
  note text,
  photo_urls text[] not null default '{}',
  -- Snapshot of the deadline at that moment, so later edits to the task's due
  -- date cannot rewrite history.
  due_at timestamptz,
  -- Completed after the deadline had already passed.
  was_late boolean not null default false,
  -- Only meaningful for a checklist task's 'completed' rows.
  yes_count int,
  no_count int,
  -- The unified review gate: for a 'completed' row, set only when the task
  -- required review and a leader/owner has signed off. For an 'off_duty' row,
  -- always required regardless of the task's own requires_review — whether
  -- someone was really off is an attendance question, not a work-quality one.
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  -- Who this completion is ABOUT. Equal to actor_id for an ordinary task (the
  -- actor did their own work). Differs only when the source task is_audit —
  -- an admin auditing a supervisor — in which case it's whoever the admin
  -- chose at submission time. Always set (never null) so every downstream
  -- query — visibility, scoring, reports — has one column to key on
  -- regardless of which kind of task produced the row.
  subject_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Only meaningful on an is_audit completion.
  shift text check (shift in ('morning', 'evening')),
  -- Penalty (negative) or bonus (positive), in fractional points. For a
  -- template-based audit, computed server-side from the checklist answers'
  -- point_weight, never trusted from the client; for an audit with no
  -- template, taken directly from the auditor (nothing structured to
  -- compute from) — see set_task_completion's scoring block. IQD is
  -- points * iqd_per_point below. Only ever set on an is_audit
  -- completion; adjustable later, see points_adjustments.
  points_awarded numeric,
  -- The org's IQD-per-point rate at the moment this row was inserted,
  -- stamped by the task_completions_stamp_iqd_rate trigger (never trusted
  -- from the caller). Changing the org's rate later never rewrites an
  -- audit that already happened.
  iqd_per_point numeric not null,
  -- Audit quality out of 100, computed server-side at submission for a
  -- template-based audit: the share of the answered (Yes/No, never N/A)
  -- questions' point_weight that passed, so a failed high-weight item costs
  -- more than a failed trivial one. Falls back to a plain yes/(yes+no)
  -- count if every answered item happens to weigh 0. Deliberately NOT
  -- touched by points_adjustments — it grades the visit, not the penalty.
  score numeric check (score between 0 and 100),
  -- Audit-only: where the auditor's device was when they signed, as
  -- reported by the phone's GPS (the server can't verify it, so it's
  -- evidence, not proof). accuracy is the device's own radius in metres.
  signed_lat double precision check (signed_lat between -90 and 90),
  signed_lng double precision check (signed_lng between -180 and 180),
  signed_accuracy_m double precision,
  -- Street/area name the device resolved at signing, for display only.
  signed_address text,
  -- A supervisor-daily checklist's live front-camera selfie, uploaded to
  -- task-proofs before the call. Required for that template, see
  -- checklist_templates.assign_to_role.
  selfie_url text,
  -- The auditor's signature, captured at submission — only meaningful on an
  -- is_audit completion. Uploaded to the same task-proofs bucket as photos.
  signature_url text,
  created_at timestamptz not null default now(),
  check (action = 'off_duty' or status is null),
  check (action <> 'off_duty' or status is not null)
);

-- Append-only trail for points_awarded changes. task_completions.points_awarded
-- always holds the current effective value; this table is the "it was 1, an
-- admin changed it to 0.5, here's why" history that must never be erased by
-- an edit — the whole point is that both values stay visible.
create table public.points_adjustments (
  id uuid primary key default gen_random_uuid(),
  task_completion_id uuid not null references public.task_completions(id) on delete cascade,
  previous_points numeric,
  new_points numeric not null,
  adjusted_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

-- Same append-only philosophy as points_adjustments, but for a whole
-- closed period's total for one supervisor at once (an owner reviewing the
-- month end-to-end deciding "reduce this person's total"), rather than one
-- audit visit at a time. get_period_report applies the latest row per
-- (period_id, subject_profile_id) on top of the natural sum from
-- task_completions — nothing here is itself a source of truth, same as
-- report_periods never snapshotting the underlying numbers.
create table public.period_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.report_periods(id) on delete cascade,
  subject_profile_id uuid not null references public.profiles(id) on delete cascade,
  previous_points numeric,
  new_points numeric not null,
  -- The org's rate when this override was made, so the IQD the owner typed
  -- is exactly what the report shows, even if the rate changes later.
  iqd_per_point numeric not null,
  -- The effective IQD total right before this override (the underlying
  -- audits may span several rates, so previous_points alone can't recover it).
  previous_iqd numeric,
  adjusted_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

create index period_adjustments_lookup_idx on public.period_adjustments(period_id, subject_profile_id, created_at);

-- One row per scheduled instance of a task with scheduled_times — the "16:00
-- oil check for 2026-09-15" that someone can actually be reminded about and
-- complete, as opposed to the bare '{12:00,16:00,22:00}' template on the task
-- itself. Generated ahead of time by generate_task_occurrences() (run on a
-- schedule — see that function), not computed on the fly, so a reminder job
-- has concrete rows to scan and a completion has something concrete to point
-- at. All times assume Asia/Baghdad (UTC+3, no DST) — the company operates
-- from Iraq; revisit if that ever stops being true for every org here.
create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  scheduled_for timestamptz not null,
  -- Set once someone completes this exact occurrence. Left null forever if
  -- it's missed outright — "missed" is derived (scheduled_for has passed and
  -- this is still null), not a status stored here.
  completion_id uuid references public.task_completions(id) on delete set null,
  -- So the "your check is due soon" push fires once per occurrence, not once
  -- per cron run between now and scheduled_for.
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, scheduled_for)
);

create table public.checklist_answers (
  id uuid primary key default gen_random_uuid(),
  task_completion_id uuid not null references public.task_completions(id) on delete cascade,
  section_title text not null default '',
  -- Snapshot of the question text at the moment it was answered.
  question text not null,
  sort_order int not null,
  -- null means the auditor marked this N/A (e.g. a kitchen-equipment
  -- question at a brand with no kitchen) — excluded from yes/no counts and
  -- from scoring, see set_task_completion, not just "no" with no penalty.
  answer boolean,
  note text
);

create table public.checklist_section_photos (
  id uuid primary key default gen_random_uuid(),
  task_completion_id uuid not null references public.task_completions(id) on delete cascade,
  section_title text not null default '',
  photo_url text not null,
  created_at timestamptz not null default now()
);

-- One row per field per submission — the form-module equivalent of
-- checklist_answers. Every value is stored as text regardless of the
-- field's type; parsing/formatting a number or time back out is a display
-- concern for whatever reads this, keyed off form_template_fields.field_type,
-- not something worth a column per type here.
create table public.form_answers (
  id uuid primary key default gen_random_uuid(),
  task_completion_id uuid not null references public.task_completions(id) on delete cascade,
  field_id uuid not null references public.form_template_fields(id) on delete cascade,
  -- Snapshot of the field's label at the moment it was answered, same reason
  -- checklist_answers snapshots question text: a later edit to the template
  -- must not rewrite what a past submission actually asked.
  label text not null,
  sort_order int not null,
  value text
);

create index checklist_answers_completion_idx on public.checklist_answers(task_completion_id, sort_order);
create index checklist_section_photos_completion_idx on public.checklist_section_photos(task_completion_id);
create index form_answers_completion_idx on public.form_answers(task_completion_id, sort_order);

create index tasks_team_id_idx on public.tasks(team_id);
create index tasks_template_id_idx on public.tasks(template_id) where template_id is not null;
create index tasks_form_template_id_idx on public.tasks(form_template_id) where form_template_id is not null;
create index task_completions_org_idx on public.task_completions(org_id, created_at desc);
create index task_completions_team_idx on public.task_completions(team_id, created_at desc);
create index task_completions_actor_idx on public.task_completions(actor_id, created_at desc);
create index task_completions_task_idx on public.task_completions(task_id, created_at desc);
create index task_completions_needs_review_idx
  on public.task_completions(org_id, created_at desc)
  where reviewed_by is null and (status = 'off_duty_pending' or action = 'completed');
-- Every audit-report query starts from "everything about this supervisor" —
-- the subject, not the auditor, is what a report groups by.
create index task_completions_subject_idx on public.task_completions(subject_profile_id, created_at desc);
create index points_adjustments_completion_idx on public.points_adjustments(task_completion_id, created_at);
-- What the reminder job scans: every occurrence not yet completed, soonest
-- first. Partial on completion_id is null so a job with millions of settled
-- rows behind it still only ever touches the open ones.
create index task_occurrences_due_idx on public.task_occurrences(scheduled_for) where completion_id is null;
create index task_occurrences_task_idx on public.task_occurrences(task_id, scheduled_for);
create index tasks_org_id_idx on public.tasks(org_id);
create index tasks_assignee_id_idx on public.tasks(assignee_id);
create index profiles_org_id_idx on public.profiles(org_id);
create index teams_org_id_idx on public.teams(org_id);

create table public.login_lookup_attempts (
  id bigint generated always as identity primary key,
  org_code text not null,
  username text not null,
  attempted_at timestamptz not null default now()
);

create index login_lookup_attempts_org_idx on public.login_lookup_attempts (org_code, attempted_at);
create index login_lookup_attempts_username_idx on public.login_lookup_attempts (username, attempted_at);

alter table public.organizations enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_teams enable row level security;
alter table public.brands enable row level security;
alter table public.branch_brands enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_answers enable row level security;
alter table public.checklist_section_photos enable row level security;
alter table public.points_adjustments enable row level security;
alter table public.period_adjustments enable row level security;
alter table public.report_periods enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.form_templates enable row level security;
alter table public.form_template_fields enable row level security;
alter table public.form_answers enable row level security;
-- No policy on this one on purpose — only the SECURITY DEFINER function
-- (running as owner) can touch it, never clients directly.
alter table public.login_lookup_attempts enable row level security;

-- ── Helper functions (avoid RLS self-recursion — see my_org_id etc.) ──

create function public.my_org_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create function public.my_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Every team the caller belongs to. A team leader has exactly one row here
-- in practice; an employee can have several.
create function public.my_team_ids()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(team_id), '{}') from public.profile_teams where profile_id = auth.uid();
$$;

create function public.my_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select active from public.profiles where id = auth.uid();
$$;

create function public.my_must_change_password()
returns boolean
language sql stable security definer set search_path = public as $$
  select must_change_password from public.profiles where id = auth.uid();
$$;

-- Reads another member's role without tripping RLS recursion on profiles.
-- Used to keep task assignment flowing downward only.
create function public.role_of(p_profile_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = p_profile_id;
$$;

-- ── RLS policies ────────────────────────────────────────────────────

create policy "org members can read their own org"
  on public.organizations for select
  using (id = public.my_org_id());

create policy "org members can read their org's teams"
  on public.teams for select
  using (org_id = public.my_org_id());

-- Mutations all go through SECURITY DEFINER RPCs (Task 2/3), which bypass
-- RLS as the table owner — same pattern as checklist_templates/teams — so
-- only SELECT policies are needed here.
create policy "org members can read their org's brands"
  on public.brands for select
  using (org_id = public.my_org_id());

create policy "org members can read their org's branch brands"
  on public.branch_brands for select
  using (
    exists (
      select 1 from public.teams t
      where t.id = branch_id and t.org_id = public.my_org_id()
    )
  );

create policy "org members can read profiles in their org"
  on public.profiles for select
  using (org_id = public.my_org_id());

create policy "users can update their own display name"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and org_id = public.my_org_id()
    and role = public.my_role()
    -- Users may edit their own name/title/recovery_email, but never
    -- reactivate themselves or skip a forced password change. Those two only
    -- move through the SECURITY DEFINER admin RPCs. Team membership isn't a
    -- profiles column at all anymore — see profile_teams.
    and active = public.my_active()
    and must_change_password = public.my_must_change_password()
  );

-- Membership itself is only ever written through add/remove_profile_to_team
-- (SECURITY DEFINER), never directly — this is read-only for clients.
create policy "org members can read their org's team memberships"
  on public.profile_teams for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.org_id = public.my_org_id()
    )
  );

create policy "owner can manage roles and team assignment in their org"
  on public.profiles for update
  using (org_id = public.my_org_id() and public.my_role() = 'owner');

-- A multi-team employee sees tasks from every team she's on, not just one.
create policy "team members and the owner can read that team's tasks"
  on public.tasks for select
  using (
    org_id = public.my_org_id()
    and (public.my_role() = 'owner' or team_id = any(public.my_team_ids()))
  );

-- Same visibility as the task itself — an occurrence is just "this task, due
-- at this specific time," never shown to anyone who couldn't already see the
-- task. No direct insert/update policy: only generate_task_occurrences() and
-- set_task_completion (both SECURITY DEFINER) ever write these rows.
create policy "occurrences follow their task's visibility"
  on public.task_occurrences for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.org_id = public.my_org_id()
        and (public.my_role() = 'owner' or t.team_id = any(public.my_team_ids()))
    )
  );

-- Work is handed down, never sideways or to yourself: an owner may assign to
-- team leaders and employees, a team leader only to employees on their own
-- team. Nobody can assign themselves a task and then sign off on their own
-- work. assignee_id null means "anyone on the team", which stays allowed.
--
-- is_audit is the one exception to self-assignment: it's the admin's own
-- recurring "go audit someone" task, and its whole point is judging someone
-- else — the "signing off on your own work" risk this rule exists for
-- doesn't apply, and set_task_completion separately guarantees the real
-- subject can never be the auditor (see "you cannot audit yourself" there).
--
-- The assignee-membership check (assignee_id must actually belong to this
-- task's team) closes a gap that predates multi-team: role_of() alone never
-- verified the assignee was really on the team the task claims, for either
-- the owner or the team leader branch.
create policy "team admin or owner can create tasks for their own team"
  on public.tasks for insert
  with check (
    org_id = public.my_org_id()
    and (is_audit or assignee_id is distinct from auth.uid())
    and (
      assignee_id is null
      or team_id = any(select pt.team_id from public.profile_teams pt where pt.profile_id = assignee_id)
      -- An audit's team_id is just a nominal anchor (the actual audited
      -- branch is chosen per-submission, not at task creation) — an owner
      -- in particular may belong to zero teams by design, so this
      -- membership check would otherwise make self-assigning impossible.
      or (is_audit and assignee_id = auth.uid())
    )
    and (
      (
        public.my_role() = 'owner'
        and (
          assignee_id is null
          or public.role_of(assignee_id) in ('team_admin', 'employee')
          or (is_audit and assignee_id = auth.uid())
        )
      )
    )
  );

-- The with check mirrors the insert rule, otherwise a task could be created
-- for an employee and then edited to point at yourself.
create policy "team admin or owner can edit their team's tasks"
  on public.tasks for update
  using (
    org_id = public.my_org_id()
    and (
      -- Only the admin creates, edits or deletes work; managers and
      -- supervisors just do it.
      public.my_role() = 'owner'
    )
  )
  with check (
    org_id = public.my_org_id()
    and (is_audit or assignee_id is distinct from auth.uid())
    and (
      assignee_id is null
      or team_id = any(select pt.team_id from public.profile_teams pt where pt.profile_id = assignee_id)
      -- An audit's team_id is just a nominal anchor (the actual audited
      -- branch is chosen per-submission, not at task creation) — an owner
      -- in particular may belong to zero teams by design, so this
      -- membership check would otherwise make self-assigning impossible.
      or (is_audit and assignee_id = auth.uid())
    )
    and (
      (
        public.my_role() = 'owner'
        and (
          assignee_id is null
          or public.role_of(assignee_id) in ('team_admin', 'employee')
          or (is_audit and assignee_id = auth.uid())
        )
      )
      or (
        public.my_role() = 'team_admin'
        and team_id = any(public.my_team_ids())
        and (
          assignee_id is null
          or public.role_of(assignee_id) = 'employee'
          or (is_audit and assignee_id = auth.uid())
        )
      )
    )
  );

create policy "team admin or owner can delete their team's tasks"
  on public.tasks for delete
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
    )
  );

-- History visibility, exactly three levels: the owner sees the whole org, a
-- team leader sees their own team, an employee sees only what they did.
-- Read-only for everyone — rows are written solely by set_task_completion,
-- which runs as SECURITY DEFINER, so nobody can forge or edit history.
-- Checklist mutations all go through SECURITY DEFINER RPCs (below), which
-- bypass RLS as the table owner — so only SELECT policies are needed here,
-- the same pattern already used for organizations/teams/profiles.

create policy "org members can read their org's checklist templates"
  on public.checklist_templates for select
  using (org_id = public.my_org_id());

create policy "org members can read their org's template items"
  on public.checklist_template_items for select
  using (
    exists (
      select 1 from public.checklist_templates t
      where t.id = template_id and t.org_id = public.my_org_id()
    )
  );

create policy "org members can read their org's form templates"
  on public.form_templates for select
  using (org_id = public.my_org_id());

create policy "org members can read their org's form template fields"
  on public.form_template_fields for select
  using (
    exists (
      select 1 from public.form_templates t
      where t.id = template_id and t.org_id = public.my_org_id()
    )
  );

-- checklist_answers/checklist_section_photos follow whatever task_completions
-- visibility already is (owner/team leader/actor/subject, defined below) —
-- they're just the detail rows for a 'completed' history entry.
create policy "checklist answers follow their completion's visibility"
  on public.checklist_answers for select
  using (
    exists (
      select 1 from public.task_completions tc
      where tc.id = task_completion_id
        and tc.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and tc.team_id = any(public.my_team_ids()) and tc.subject_profile_id = tc.actor_id)
          or tc.actor_id = auth.uid()
          or tc.subject_profile_id = auth.uid()
          or (
            public.my_role() = 'team_admin'
            and exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = tc.subject_profile_id and pt.team_id = any(public.my_team_ids())
            )
          )
        )
    )
  );

create policy "checklist photos follow their completion's visibility"
  on public.checklist_section_photos for select
  using (
    exists (
      select 1 from public.task_completions tc
      where tc.id = task_completion_id
        and tc.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and tc.team_id = any(public.my_team_ids()) and tc.subject_profile_id = tc.actor_id)
          or tc.actor_id = auth.uid()
          or tc.subject_profile_id = auth.uid()
          or (
            public.my_role() = 'team_admin'
            and exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = tc.subject_profile_id and pt.team_id = any(public.my_team_ids())
            )
          )
        )
    )
  );

-- Same visibility as its completion — the form-module equivalent of the two
-- checklist policies above.
create policy "form answers follow their completion's visibility"
  on public.form_answers for select
  using (
    exists (
      select 1 from public.task_completions tc
      where tc.id = task_completion_id
        and tc.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and tc.team_id = any(public.my_team_ids()) and tc.subject_profile_id = tc.actor_id)
          or tc.actor_id = auth.uid()
          or tc.subject_profile_id = auth.uid()
          or (
            public.my_role() = 'team_admin'
            and exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = tc.subject_profile_id and pt.team_id = any(public.my_team_ids())
            )
          )
        )
    )
  );

-- Widened for audits: the completion's own team_id (the auditor's task,
-- unrelated to who was audited) is not enough to show the audited supervisor
-- their own result, or their leader that result — both are keyed off
-- subject_profile_id instead, via profile_teams for the leader's case since a
-- team_admin's own team membership doesn't say anything about the subject's.
create policy "history is scoped to the reader's role"
  on public.task_completions for select
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      -- A branch's own work, but not audits: an audit's team_id is the
      -- admin's audit task's branch, not the audited person's, so audits
      -- reach a manager only through the subject clause below.
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()) and subject_profile_id = actor_id)
      or actor_id = auth.uid()
      or subject_profile_id = auth.uid()
      or (
        public.my_role() = 'team_admin'
        and exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = subject_profile_id and pt.team_id = any(public.my_team_ids())
        )
      )
    )
  );

-- Same visibility as the completion it adjusts — whoever can see the audit
-- result can see every points change made to it, not just the current value.
create policy "points adjustments follow their completion's visibility"
  on public.points_adjustments for select
  using (
    exists (
      select 1 from public.task_completions tc
      where tc.id = task_completion_id
        and tc.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and tc.team_id = any(public.my_team_ids()) and tc.subject_profile_id = tc.actor_id)
          or tc.actor_id = auth.uid()
          or tc.subject_profile_id = auth.uid()
          or (
            public.my_role() = 'team_admin'
            and exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = tc.subject_profile_id and pt.team_id = any(public.my_team_ids())
            )
          )
        )
    )
  );

-- Only the owner sees closed periods — closing a month and reading its
-- report is an org-wide action, same restriction as adjusting any audit.
create policy "report periods are visible only to the org owner"
  on public.report_periods for select
  using (org_id = public.my_org_id() and public.my_role() = 'owner');

-- Same restriction as the report itself: only the owner can see a period's
-- adjustment trail.
create policy "period adjustments are visible only to the org owner"
  on public.period_adjustments for select
  using (
    public.my_role() = 'owner'
    and exists (
      select 1 from public.report_periods rp
      where rp.id = period_id and rp.org_id = public.my_org_id()
    )
  );

-- ── RPCs ────────────────────────────────────────────────────────────

create function public.generate_org_code(p_name text)
returns text
language plpgsql
as $$
declare
  candidate text;
  n int := 0;
begin
  loop
    candidate := lpad(floor(random() * 100000)::text, 5, '0');
    exit when not exists (select 1 from public.organizations where org_code = candidate);
    n := n + 1;
    exit when n > 50;
  end loop;
  return candidate;
end;
$$;

create function public.create_organization(p_org_name text, p_owner_name text, p_username text, p_team_name text default 'Main Team')
returns table (org_id uuid, org_code text, team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'this account already belongs to an organization';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_org_code := public.generate_org_code(p_org_name);
    begin
      insert into public.organizations (org_code, name, owner_id)
      values (v_org_code, p_org_name, auth.uid())
      returning id into v_org_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not generate a unique Organization ID, please try again.';
      end if;
    end;
  end loop;

  insert into public.teams (org_id, name)
  values (v_org_id, p_team_name)
  returning id into v_team_id;

  insert into public.profiles (id, org_id, name, title, username, role)
  values (auth.uid(), v_org_id, p_owner_name, 'Owner', p_username, 'owner');

  -- Purely for continuity/display — the owner's authority is role-based and
  -- org-wide, never gated by team membership.
  insert into public.profile_teams (profile_id, team_id, added_by)
  values (auth.uid(), v_team_id, auth.uid());

  return query select v_org_id, v_org_code, v_team_id;
end;
$$;

-- Creates a user account on behalf of an admin or team leader. The new
-- employee is not present, so there is no client session to call
-- supabase.auth.signUp() from — this writes the auth.users row itself,
-- hashing the password with the same bcrypt GoTrue verifies against, so the
-- account signs in through the normal password flow.
--
-- search_path includes extensions because Supabase installs pgcrypto
-- (crypt, gen_salt) there, not in public.
create function public.admin_create_user(
  p_name text,
  p_username text,
  p_password text,
  p_role text default 'employee',
  p_team_id uuid default null,
  p_title text default null,
  p_brand_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_org_code text;
  v_new_id uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  if v_caller_role is null then
    raise exception 'not authenticated';
  end if;
  if v_caller_role not in ('owner', 'team_admin') then
    raise exception 'only an admin or team leader can create users';
  end if;
  if p_role not in ('employee', 'team_admin', 'owner') then
    raise exception 'role must be employee, team_admin, or owner';
  end if;
  -- Only an existing admin may create another admin — never a branch
  -- manager, even though the branch-manager branch below would already
  -- catch this (p_role must be 'employee' there). Kept as its own explicit
  -- check because this is a privilege-escalation boundary, not incidental.
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'only an admin can create another admin';
  end if;

  if v_caller_role = 'team_admin' then
    if p_role <> 'employee' then
      raise exception 'a branch manager can only create supervisors';
    end if;
    if p_team_id is null or not (p_team_id = any(v_caller_teams)) then
      raise exception 'a branch manager can only create users on their own branch';
    end if;
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org
  ) then
    raise exception 'team not found in this organization';
  end if;

  if p_brand_id is not null then
    if p_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if p_team_id is null or not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  if v_username = '' then
    raise exception 'a username is required';
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.org_id = v_caller_org and lower(p.username) = v_username
  ) then
    raise exception 'that username is already taken in this organization';
  end if;

  select o.org_code into v_org_code
  from public.organizations o where o.id = v_caller_org;

  -- Globally unique: org_code is unique across orgs, username is unique
  -- within an org. Never a real mailbox — see recovery_email for that.
  v_email := v_username || '.' || v_org_code || '@users.rungs.internal';

  -- confirmed_at is a generated column and must not be inserted into. The
  -- token columns must be '' rather than NULL: GoTrue scans them into
  -- non-nullable Go strings and errors out on NULL at login.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf', 10)),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- GoTrue's password grant checks identities as well as users; without this
  -- row the account exists but cannot sign in.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_new_id::text, v_new_id,
    jsonb_build_object(
      'sub', v_new_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  );

  insert into public.profiles (
    id, org_id, name, title, username, role,
    must_change_password, active
  ) values (
    v_new_id, v_caller_org, p_name,
    nullif(trim(coalesce(p_title, '')), ''), v_username, p_role,
    true, true
  );

  if p_team_id is not null then
    insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
    values (v_new_id, p_team_id, auth.uid(), p_brand_id);
  end if;

  return v_new_id;
end;
$$;

-- Shared authorization check for the admin user-management RPCs: the caller
-- must be the org owner (any member) or a team leader acting on someone on
-- their own team. Returns silently when allowed, raises when not.
create function public.assert_can_manage_user(p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_target_org uuid;
  v_target_role text;
  v_target_teams uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id, p.role into v_target_org, v_target_role
  from public.profiles p where p.id = p_target_profile_id;
  select coalesce(array_agg(team_id), '{}') into v_target_teams
  from public.profile_teams where profile_id = p_target_profile_id;

  if v_target_org is null then
    raise exception 'user not found';
  end if;
  if v_target_org is distinct from v_caller_org then
    raise exception 'that user is not in your organization';
  end if;
  if v_caller_role = 'owner' then
    return;
  end if;
  -- A multi-team employee is manageable by any leader she shares a team with.
  -- A branch manager manages the supervisors on their branch, never a peer manager or the owner.
  if v_caller_role = 'team_admin' and v_target_role = 'employee' and v_caller_teams && v_target_teams then
    return;
  end if;
  raise exception 'only an admin or the user''s team leader can manage this account';
end;
$$;

-- Sets a new password for another user without knowing the old one, and
-- re-forces a password change so the user picks their own again.
create function public.admin_reset_password(
  p_target_profile_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_can_manage_user(p_target_profile_id);

  if coalesce(length(p_new_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = now()
  where id = p_target_profile_id;

  update public.profiles
  set must_change_password = true
  where id = p_target_profile_id;
end;
$$;

-- Deactivating also bans the auth user and drops their sessions, so an
-- already-signed-in device is cut off at its next token refresh rather than
-- lingering until the account is touched again.
create function public.admin_set_user_active(
  p_target_profile_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_can_manage_user(p_target_profile_id);

  if p_target_profile_id = auth.uid() then
    raise exception 'you cannot deactivate your own account';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = p_target_profile_id and p.role = 'owner'
  ) then
    raise exception 'the organization owner cannot be deactivated';
  end if;

  update public.profiles
  set active = p_active
  where id = p_target_profile_id;

  if p_active then
    update auth.users set banned_until = null, updated_at = now()
    where id = p_target_profile_id;
  else
    update auth.users set banned_until = 'infinity'::timestamptz, updated_at = now()
    where id = p_target_profile_id;
    delete from auth.sessions where user_id = p_target_profile_id;
    delete from auth.refresh_tokens where user_id = p_target_profile_id::text;
  end if;
end;
$$;

-- Owner-only "delete" for a staff member who has already been
-- deactivated. Soft by design: audits, scores and penalties recorded on
-- them stay intact (task_completions cascades on profile delete, so a hard
-- delete would silently rewrite history). Frees their username for reuse.
create function public.admin_delete_user(p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
begin
  if public.role_of(auth.uid()) is distinct from 'owner' then
    raise exception 'only the org owner can delete staff';
  end if;
  select * into v_target from public.profiles where id = p_target_profile_id;
  if v_target.id is null or v_target.org_id is distinct from public.my_org_id() then
    raise exception 'not found';
  end if;
  if v_target.role = 'owner' then
    raise exception 'the organization owner cannot be deleted';
  end if;
  if v_target.active then
    raise exception 'deactivate this account before deleting it';
  end if;

  update public.profiles
  set deleted_at = now(), username = null, recovery_email = null
  where id = p_target_profile_id;

  -- The synthetic auth email is built from the username, so it has to move
  -- too, or the freed username couldn't be given to anyone new.
  update auth.users
  set banned_until = 'infinity'::timestamptz,
      email = 'deleted.' || p_target_profile_id || '@users.rungs.internal',
      updated_at = now()
  where id = p_target_profile_id;
  update auth.identities
  set identity_data = identity_data || jsonb_build_object('email', 'deleted.' || p_target_profile_id || '@users.rungs.internal')
  where user_id = p_target_profile_id;
  delete from auth.sessions where user_id = p_target_profile_id;
  delete from auth.refresh_tokens where user_id = p_target_profile_id::text;
end;
$$;

-- Called by the client right after supabase.auth.updateUser({ password })
-- succeeds on the forced-change screen.
create function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
end;
$$;

-- Adds a person to a further team, on top of whatever they already belong
-- to. Same downward-only rule as everywhere else: an owner may add anyone
-- (team leader or employee) to any team in the org; a team leader may only
-- add an employee, and only to their own team.
create function public.add_profile_to_team(p_profile_id uuid, p_team_id uuid, p_brand_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_target_org uuid;
  v_target_role text;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id, p.role into v_target_org, v_target_role
  from public.profiles p where p.id = p_profile_id;

  if v_target_org is null or v_target_org is distinct from v_caller_org then
    raise exception 'that person is not in your organization';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org) then
    raise exception 'team not found in this organization';
  end if;

  if v_caller_role = 'owner' then
    if v_target_role not in ('team_admin', 'employee') then
      raise exception 'only a team leader or employee can be added to a team';
    end if;
  elsif v_caller_role = 'team_admin' then
    if v_target_role <> 'employee' then
      raise exception 'a team leader can only add employees to a team';
    end if;
    if not (p_team_id = any(v_caller_teams)) then
      raise exception 'a team leader can only add someone to their own team';
    end if;
  else
    raise exception 'only an admin or team leader can change team membership';
  end if;

  if p_brand_id is not null then
    if v_target_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
  values (p_profile_id, p_team_id, auth.uid(), p_brand_id)
  on conflict (profile_id, team_id) do update set brand_id = excluded.brand_id;
end;
$$;

-- Same authorization as add_profile_to_team. Removing someone's only team is
-- allowed — an employee with no team at all is already a supported case
-- ("works alone").
create function public.remove_profile_from_team(p_profile_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_target_org uuid;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id into v_target_org from public.profiles p where p.id = p_profile_id;
  if v_target_org is null or v_target_org is distinct from v_caller_org then
    raise exception 'that person is not in your organization';
  end if;

  if not (v_caller_role = 'owner' or (v_caller_role = 'team_admin' and p_team_id = any(v_caller_teams))) then
    raise exception 'only an admin or that team''s leader can remove this membership';
  end if;

  delete from public.profile_teams where profile_id = p_profile_id and team_id = p_team_id;
end;
$$;

create function public.get_login_email(p_org_code text, p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_code text := upper(p_org_code);
  v_username text := lower(p_username);
  v_by_org int;
  v_by_username int;
  v_email text;
begin
  select count(*) into v_by_org
  from public.login_lookup_attempts
  where org_code = v_org_code and attempted_at > now() - interval '15 minutes';

  select count(*) into v_by_username
  from public.login_lookup_attempts
  where username = v_username and attempted_at > now() - interval '15 minutes';

  if v_by_org >= 20 or v_by_username >= 10 then
    raise exception 'Too many sign-in attempts. Please wait a few minutes and try again.';
  end if;

  insert into public.login_lookup_attempts (org_code, username) values (v_org_code, v_username);

  -- A deactivated account must not even resolve to an email, so a banned
  -- user cannot start a sign-in at all.
  select u.email into v_email
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  join auth.users u on u.id = p.id
  where o.org_code = v_org_code
    and lower(p.username) = v_username
    and coalesce(p.active, true)
  limit 1;

  return v_email;
end;
$$;

-- Team leaders are now created directly through admin_create_user with
-- p_role => 'team_admin', so this no longer promotes an existing profile.
create function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_team_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can create teams';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a team name is required';
  end if;

  insert into public.teams (org_id, name)
  values (v_org_id, trim(p_name))
  returning id into v_team_id;

  return v_team_id;
end;
$$;

create function public.create_brand(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_name text := trim(coalesce(p_name, ''));
  v_brand_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only an admin can create a brand';
  end if;
  if v_name = '' then
    raise exception 'a brand name is required';
  end if;
  if exists (select 1 from public.brands b where b.org_id = v_org_id and lower(b.name) = lower(v_name)) then
    raise exception 'a brand named "%" already exists', v_name;
  end if;

  insert into public.brands (org_id, name)
  values (v_org_id, v_name)
  returning id into v_brand_id;

  return v_brand_id;
end;
$$;

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

  select date_trunc('month', o.created_at at time zone 'Asia/Baghdad')::date into v_org_created_month
  from public.organizations o where o.id = v_org_id;

  select max(rp.period_month) into v_last_closed
  from public.report_periods rp where rp.org_id = v_org_id;

  v_next_month := coalesce((v_last_closed + interval '1 month')::date, v_org_created_month);

  -- "Fully elapsed" is judged in Baghdad wall-clock time, same convention as
  -- generate_task_occurrences() — not UTC, or a month could close up to 3
  -- hours early/late.
  if v_next_month + interval '1 month' > (now() at time zone 'Asia/Baghdad') then
    return; -- that month hasn't fully elapsed yet — nothing to close
  end if;

  insert into public.report_periods (org_id, period_month, closed_by)
  values (v_org_id, v_next_month, auth.uid())
  returning id into v_new_period_id;

  return query select v_new_period_id, v_next_month;
end;
$$;

-- One row per (subject, branch) for a closed period. Joins the subject's
-- branch via profile_teams — NOT task_completions.team_id, which is the
-- audit TASK's team and can differ from who's actually being audited (see
-- the auditor/subject model). If a subject belongs to more than one branch
-- (allowed for employees, rare for supervisors), their totals appear once
-- per branch — a known, accepted edge case.
--
-- total_points/iqd_amount are the EFFECTIVE values: the natural sum from
-- task_completions, overridden by the latest period_adjustments row for
-- that subject if one exists (an owner's end-of-month "reduce this
-- person's total" call, separate from adjusting any one audit visit).
-- raw_points/raw_iqd_amount are always the untouched natural sum, so the
-- UI can show "original" alongside "current (adjusted)" the same way an
-- individual audit's points_adjustments trail does.
create function public.get_period_report(p_period_id uuid)
returns table (
  branch_id uuid,
  branch_name text,
  brand_id uuid,
  brand_name text,
  subject_profile_id uuid,
  subject_name text,
  total_points numeric,
  iqd_amount numeric,
  raw_points numeric,
  raw_iqd_amount numeric
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
    b.id,
    b.name,
    tc.subject_profile_id,
    sp.name,
    coalesce(pa.new_points, sum(tc.points_awarded)),
    coalesce(pa.new_points * pa.iqd_per_point, sum(tc.points_awarded * tc.iqd_per_point)),
    sum(tc.points_awarded),
    sum(tc.points_awarded * tc.iqd_per_point)
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  left join public.brands b on b.id = pt.brand_id
  left join lateral (
    select pa2.new_points, pa2.iqd_per_point from public.period_adjustments pa2
    where pa2.period_id = p_period_id and pa2.subject_profile_id = tc.subject_profile_id
    order by pa2.created_at desc
    limit 1
  ) pa on true
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and (tc.created_at at time zone 'Asia/Baghdad') >= v_month
    and (tc.created_at at time zone 'Asia/Baghdad') < (v_month + interval '1 month')
  group by t.id, t.name, b.id, b.name, tc.subject_profile_id, sp.name, pa.new_points, pa.iqd_per_point
  order by t.name, b.name nulls last, sp.name;
end;
$$;

-- Same shape and attribution rule as get_period_report, but for the
-- calendar month containing "now" (which is never closeable) — powers the
-- Dashboard's live, current-month rollup.
create function public.get_current_branch_summary()
returns table (
  branch_id uuid,
  branch_name text,
  brand_id uuid,
  brand_name text,
  subject_profile_id uuid,
  subject_name text,
  total_points numeric,
  iqd_amount numeric,
  -- Sum and count of this month's audit scores (see task_completions.score),
  -- so the client can average across a whole branch correctly rather than
  -- averaging per-supervisor averages.
  score_sum numeric,
  score_count int
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

  v_month_start := date_trunc('month', now() at time zone 'Asia/Baghdad')::date;

  return query
  select
    t.id,
    t.name,
    b.id,
    b.name,
    tc.subject_profile_id,
    sp.name,
    sum(tc.points_awarded),
    sum(tc.points_awarded * tc.iqd_per_point),
    sum(tc.score),
    count(tc.score)::int
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  left join public.brands b on b.id = pt.brand_id
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and (tc.created_at at time zone 'Asia/Baghdad') >= v_month_start
  group by t.id, t.name, b.id, b.name, tc.subject_profile_id, sp.name
  order by t.name, b.name nulls last, sp.name;
end;
$$;

-- Materializes today's (and, once past 21:00 Baghdad time, tomorrow's —
-- see the comment below) task_occurrences rows for every scheduled_times
-- task, so there's always something concrete for a reminder job to scan and
-- a completion to point at. Meant to run every few minutes via pg_cron; the
-- unique(task_id, scheduled_for) constraint plus "on conflict do nothing"
-- makes repeated runs a no-op, so the exact cadence isn't safety-critical.
--
-- Runs as owner (SECURITY DEFINER) because it has to see every org's tasks
-- at once — there is no single caller whose RLS this could run under.
create function public.generate_task_occurrences()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with due_days as (
    -- Today always; tomorrow too once it's late enough in the day that a
    -- midnight-crossing reminder window (a task due at 00:05, checked by a
    -- job that runs every few minutes) needs tomorrow's row to already
    -- exist. 21:00 gives a 3-hour margin before midnight, comfortably wider
    -- than any reminder window this is ever paired with.
    select (now() at time zone 'Asia/Baghdad')::date as d
    union all
    select (now() at time zone 'Asia/Baghdad')::date + 1
    where extract(hour from (now() at time zone 'Asia/Baghdad')) >= 21
  ),
  wanted as (
    select t.id as task_id, (dd.d + s.t) at time zone 'Asia/Baghdad' as scheduled_for
    from public.tasks t
    cross join due_days dd
    cross join lateral unnest(t.scheduled_times) as s(t)
    where t.scheduled_times is not null
  )
  insert into public.task_occurrences (task_id, scheduled_for)
  select task_id, scheduled_for from wanted
  on conflict (task_id, scheduled_for) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- p_answers/p_section_photos only apply when the task is a checklist
-- (template_id set) — null/empty otherwise, and ignored either way if the
-- task has no template. p_answers shape:
-- [{ "section_title": "...", "question": "...", "sort_order": 0,
--    "answer": true|false, "note": "..." }, ...]
-- p_section_photos: [{ "section_title": "...", "photo_url": "..." }, ...]
create function public.set_task_completion(
  p_task_id uuid,
  p_completed boolean,
  p_note text default null,
  p_photo_urls text[] default '{}',
  p_answers jsonb default null,
  p_section_photos jsonb default '[]',
  -- Audit-only: who this submission is about and their shift. Ignored (and
  -- never trusted from the client) on an ordinary, non-audit task — see the
  -- is_audit branch below for what's actually enforced.
  p_subject_profile_id uuid default null,
  p_shift text default null,
  -- Trusted directly ONLY for an audit with no checklist template (there's
  -- no structured answer data to compute a penalty from otherwise). A
  -- template-based audit computes its own penalty server-side from
  -- p_answers joined to checklist_template_items.point_weight and ignores
  -- this entirely — see the is_audit scoring block below.
  p_points numeric default null,
  -- Required when the task has scheduled_times: which specific occurrence
  -- this submission is for. The UI always knows this already — it's showing
  -- "your 16:00 check," not a bare task — so there is no ambiguous "closest
  -- occurrence" guessing to get wrong here.
  p_occurrence_id uuid default null,
  -- Only applies to a form task (form_template_id set). Shape:
  -- [{ "field_id": "...", "value": "..." }, ...]. p_answers/p_section_photos
  -- above are the checklist module's; this is the form module's, kept
  -- separate because the two shapes don't overlap (yes/no+note vs. a
  -- typed field value) and conflating them would just make both harder
  -- to validate correctly.
  p_form_values jsonb default null,
  -- Audit-only: the auditor's signature, uploaded to task-proofs the same
  -- way photos are, before this call.
  p_signature_url text default null,
  -- { "lat": .., "lng": .., "accuracy": .., "address": ".." } from the device
  -- at submission — an audit's signing spot, or a supervisor checklist's.
  p_location jsonb default null,
  -- Supervisor-daily checklist only: the live selfie's public URL.
  p_selfie_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_template public.checklist_templates;
  v_occurrence public.task_occurrences;
  v_my_profile_id uuid := auth.uid();
  v_my_teams uuid[];
  v_my_role text;
  v_photos text[] := coalesce(p_photo_urls, '{}');
  v_was_late boolean := false;
  v_completion_id uuid;
  v_answer jsonb;
  v_photo jsonb;
  v_yes int;
  v_no int;
  v_score numeric;
  v_field public.form_template_fields;
  v_value jsonb;
  v_provided_field_ids uuid[];
  v_subject_id uuid;
  v_shift text;
  v_points numeric;
  v_signature_url text;
begin
  select p.role into v_my_role from public.profiles p where p.id = v_my_profile_id;
  v_my_teams := public.my_team_ids();

  select * into v_task from public.tasks where id = p_task_id;

  if v_task.id is null then
    raise exception 'task not found';
  end if;
  -- The owner is not on a team but still oversees every task in the org. A
  -- multi-team employee can complete a task on any team she belongs to.
  if v_my_role <> 'owner' and not (v_task.team_id = any(v_my_teams)) then
    raise exception 'not your team''s task';
  end if;
  if v_task.assignee_id is not null
     and v_task.assignee_id is distinct from v_my_profile_id
     and v_my_role = 'employee' then
    raise exception 'this task is not assigned to you';
  end if;

  -- A scheduled task can only ever be completed against a specific,
  -- still-open occurrence of itself — reopening doesn't need one, since
  -- clearing a stale completion isn't "doing" any particular time slot.
  if v_task.scheduled_times is not null and p_completed then
    if p_occurrence_id is null then
      raise exception 'this task has fixed times — which one is this for?';
    end if;
    select * into v_occurrence from public.task_occurrences where id = p_occurrence_id;
    if v_occurrence.id is null or v_occurrence.task_id is distinct from v_task.id then
      raise exception 'occurrence not found for this task';
    end if;
    if v_occurrence.completion_id is not null then
      raise exception 'this occurrence has already been completed';
    end if;
  end if;

  -- An audit task always names a subject different from the actor, decided
  -- fresh at each submission — never trust p_subject_profile_id on anything
  -- else, and always fall back to "the actor did their own work" instead.
  -- Reopening isn't an audit event even on an is_audit task (nobody is being
  -- judged by clearing a stale completion), so it falls back the same way.
  v_subject_id := v_my_profile_id;
  if v_task.is_audit and p_completed then
    if v_my_role = 'employee' then
      raise exception 'only an admin or team leader can submit an audit';
    end if;
    if p_subject_profile_id is null then
      raise exception 'an audit needs a subject — who was this visit about?';
    end if;
    if p_subject_profile_id = v_my_profile_id then
      raise exception 'you cannot audit yourself';
    end if;
    if not exists (
      select 1 from public.profiles where id = p_subject_profile_id and org_id = v_task.org_id
    ) then
      raise exception 'subject not found in this organization';
    end if;
    v_subject_id := p_subject_profile_id;
    v_shift := p_shift;
    -- Fallback for an audit with no checklist template at all — there's no
    -- structured answer data to compute a penalty from, so the auditor's
    -- own direct judgment is trusted here, same as always. A template-
    -- based audit overwrites this unconditionally below (see the scoring
    -- block), ignoring whatever was passed here.
    v_points := p_points;
    v_signature_url := p_signature_url;
  end if;

  -- Enforced here and not only in the UI: a task that requires proof cannot
  -- be closed without at least one photo, no matter what calls this.
  if p_completed and v_task.requires_proof and coalesce(array_length(v_photos, 1), 0) < 1 then
    raise exception 'this task needs at least one photo before it can be marked done';
  end if;

  if p_completed and v_task.template_id is not null then
    select * into v_template from public.checklist_templates where id = v_task.template_id;
    if p_answers is null or jsonb_array_length(p_answers) < 1 then
      raise exception 'at least one answer is required';
    end if;
    -- N/A exists only for an auditor (a question may not apply at a given
    -- brand); anyone filling their own checklist answers every one Yes or No.
    if not v_task.is_audit and exists (
      select 1 from jsonb_array_elements(p_answers) a where (a ->> 'answer') is null
    ) then
      raise exception 'answer every question with Yes or No';
    end if;
    -- Proof the supervisor was really there, enforced here not just in the UI.
    if v_template.assign_to_role is not null and not v_task.is_audit then
      if coalesce(trim(p_selfie_url), '') = '' then
        raise exception 'a selfie is required to submit this checklist';
      end if;
      if (p_location ->> 'lat') is null or (p_location ->> 'lng') is null then
        raise exception 'your location is required to submit this checklist';
      end if;
      -- Signed like an audit: the supervisor/manager signs their own checklist.
      if coalesce(trim(p_signature_url), '') = '' then
        raise exception 'a signature is required to submit this checklist';
      end if;
      v_signature_url := p_signature_url;
    end if;
    -- Enforced here, not just in the UI: a "لا" answer needs its note
    -- whenever the template requires one, and the check can't be skipped by
    -- the client.
    if v_template.requires_note_on_no then
      for v_answer in select * from jsonb_array_elements(p_answers)
      loop
        if (v_answer ->> 'answer')::boolean = false
           and coalesce(trim(v_answer ->> 'note'), '') = '' then
          raise exception 'a note is required to explain a "لا" answer';
        end if;
      end loop;
    end if;
    select
      count(*) filter (where (a ->> 'answer')::boolean = true),
      count(*) filter (where (a ->> 'answer')::boolean = false)
    into v_yes, v_no
    from jsonb_array_elements(p_answers) a;

    -- The penalty is computed here, not taken from the client (p_points is
    -- deprecated — see its declaration above): sum each "No" answer's own
    -- question's point_weight (0 for "Yes" and for N/A — a null answer must
    -- fall to the else-0 branch, not the point_weight one: "is false" is
    -- the only test that's true for false and false for both true AND
    -- null, unlike a plain boolean check where "when null" never matches
    -- and silently falls through to the penalty branch instead). Matched
    -- by question text + section, the same identity checklist_answers
    -- already snapshots by — there's no item id round-trip through the
    -- client today.
    if v_task.is_audit then
      select coalesce(sum(
        case when (a ->> 'answer')::boolean is false then (
          select it.point_weight from public.checklist_template_items it
          where it.template_id = v_task.template_id
            and it.question = (a ->> 'question')
            and it.section_title = coalesce(a ->> 'section_title', '')
        ) else 0 end
      ), 0) * -1
      into v_points
      from jsonb_array_elements(p_answers) a;

      -- Score out of 100 — see task_completions.score.
      select case
        when sum(w) filter (where ans is not null) > 0
          then round(100 * coalesce(sum(w) filter (where ans), 0) / sum(w) filter (where ans is not null), 1)
        when count(*) filter (where ans is not null) > 0
          then round(100.0 * count(*) filter (where ans) / count(*) filter (where ans is not null), 1)
      end
      into v_score
      from (
        select (a ->> 'answer')::boolean as ans, coalesce((
          select it.point_weight from public.checklist_template_items it
          where it.template_id = v_task.template_id
            and it.question = (a ->> 'question')
            and it.section_title = coalesce(a ->> 'section_title', '')
        ), 0) as w
        from jsonb_array_elements(p_answers) a
      ) scored;
    end if;
  end if;

  -- Every required field on the template must actually be present and
  -- non-empty in the submission — enforced here, not just in the UI, same
  -- as the checklist's note-on-لا rule above.
  if p_completed and v_task.form_template_id is not null then
    if p_form_values is null or jsonb_array_length(p_form_values) < 1 then
      raise exception 'at least one field value is required';
    end if;
    select array_agg((v ->> 'field_id')::uuid) into v_provided_field_ids
    from jsonb_array_elements(p_form_values) v;
    for v_field in
      select * from public.form_template_fields where template_id = v_task.form_template_id
    loop
      if v_field.required and not (v_field.id = any(coalesce(v_provided_field_ids, '{}'))) then
        raise exception 'the field "%" is required', v_field.label;
      end if;
    end loop;
    for v_value in select * from jsonb_array_elements(p_form_values)
    loop
      if coalesce(trim(v_value ->> 'value'), '') = '' and exists (
        select 1 from public.form_template_fields f
        where f.id = (v_value ->> 'field_id')::uuid and f.required
      ) then
        raise exception 'a value is required for every required field';
      end if;
    end loop;
  end if;

  if p_completed then
    -- due_at/was_late always mean "against what deadline" — for a scheduled
    -- task that's the occurrence's own time, not tasks.due (which a
    -- scheduled_times task never sets; the two are mutually exclusive in
    -- spirit even though the column itself allows it).
    if v_occurrence.id is not null then
      v_was_late := now() > v_occurrence.scheduled_for;
    else
      v_was_late := v_task.due is not null and now() > v_task.due;
    end if;
  end if;

  update public.tasks
  set completed = p_completed,
      completed_by = case when p_completed then v_my_profile_id else null end,
      completed_at = case when p_completed then now() else null end,
      proof_note = case when p_completed then p_note else null end,
      proof_photo_urls = case when p_completed then v_photos else '{}' end
  where id = p_task_id;

  -- Every open and close is recorded, so reopening a task never erases the
  -- fact that it was completed, by whom, or with what proof. reviewed_by
  -- starts null on a 'completed' row and stays null forever unless the task
  -- requires review — the "needs review" list filters on exactly that, so a
  -- task that never needed review is simply never in it.
  insert into public.task_completions (
    task_id, org_id, team_id, task_title, actor_id, action,
    note, photo_urls, due_at, was_late, yes_count, no_count,
    subject_profile_id, shift, points_awarded, signature_url, score,
    signed_lat, signed_lng, signed_accuracy_m, signed_address, selfie_url
  ) values (
    v_task.id, v_task.org_id, v_task.team_id, v_task.title, v_my_profile_id,
    case when p_completed then 'completed' else 'reopened' end,
    case when p_completed then p_note else null end,
    case when p_completed then v_photos else '{}' end,
    coalesce(v_occurrence.scheduled_for, v_task.due),
    v_was_late,
    case when p_completed then v_yes else null end,
    case when p_completed then v_no else null end,
    v_subject_id, v_shift, v_points, v_signature_url, v_score,
    case when p_completed then (p_location ->> 'lat')::double precision end,
    case when p_completed then (p_location ->> 'lng')::double precision end,
    case when p_completed then (p_location ->> 'accuracy')::double precision end,
    case when p_completed then left(nullif(trim(p_location ->> 'address'), ''), 300) end,
    case when p_completed and v_task.template_id is not null then nullif(trim(p_selfie_url), '') end
  )
  returning id into v_completion_id;

  if v_occurrence.id is not null then
    update public.task_occurrences set completion_id = v_completion_id where id = v_occurrence.id;
  end if;

  if p_completed and v_task.template_id is not null then
    for v_answer in select * from jsonb_array_elements(p_answers)
    loop
      insert into public.checklist_answers (task_completion_id, section_title, question, sort_order, answer, note)
      values (
        v_completion_id,
        coalesce(v_answer ->> 'section_title', ''),
        v_answer ->> 'question',
        coalesce((v_answer ->> 'sort_order')::int, 0),
        (v_answer ->> 'answer')::boolean,
        nullif(trim(coalesce(v_answer ->> 'note', '')), '')
      );
    end loop;

    for v_photo in select * from jsonb_array_elements(coalesce(p_section_photos, '[]'))
    loop
      insert into public.checklist_section_photos (task_completion_id, section_title, photo_url)
      values (v_completion_id, coalesce(v_photo ->> 'section_title', ''), v_photo ->> 'photo_url');
    end loop;
  end if;

  if p_completed and v_task.form_template_id is not null then
    for v_value in select * from jsonb_array_elements(p_form_values)
    loop
      select * into v_field from public.form_template_fields where id = (v_value ->> 'field_id')::uuid;
      insert into public.form_answers (task_completion_id, field_id, label, sort_order, value)
      values (v_completion_id, v_field.id, v_field.label, v_field.sort_order, nullif(trim(coalesce(v_value ->> 'value', '')), ''));
    end loop;
  end if;

  return v_completion_id;
end;
$$;

-- A claim, not an escape: this does not clear or complete the task. It sits
-- as off_duty_pending until an admin or the team's leader reviews it. Only a
-- rejection makes the checklist immediately due again; an approval behaves
-- like a normal completion for cooldown purposes. Checklist-only — a plain
-- task has no template_id and no cooldown, so "off duty" doesn't apply.
create function public.declare_task_off_duty(
  p_task_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_completion_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if v_task.template_id is null then
    raise exception 'only a checklist task can be declared off duty';
  end if;
  if v_task.assignee_id is distinct from auth.uid() then
    raise exception 'this task is not assigned to you';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  insert into public.task_completions (
    task_id, org_id, team_id, task_title, actor_id, action, status, off_duty_reason,
    subject_profile_id
  ) values (
    v_task.id, v_task.org_id, v_task.team_id, v_task.title,
    auth.uid(), 'off_duty', 'off_duty_pending', trim(p_reason),
    auth.uid()
  )
  returning id into v_completion_id;

  return v_completion_id;
end;
$$;

-- Approve/reject an off-duty claim. Attendance, not work quality, so this is
-- always required regardless of the task's own requires_review setting.
create function public.review_off_duty(
  p_completion_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_completion public.task_completions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select * into v_completion from public.task_completions where id = p_completion_id;
  if v_completion.id is null or v_completion.org_id is distinct from v_caller_org then
    raise exception 'not found';
  end if;
  if v_completion.action <> 'off_duty' or v_completion.status <> 'off_duty_pending' then
    raise exception 'this off-duty claim has already been reviewed';
  end if;
  if not (
    v_caller_role = 'owner'
    or (v_caller_role = 'team_admin' and v_completion.team_id = any(v_caller_teams))
  ) then
    raise exception 'only an admin or the team''s leader can review this';
  end if;
  if v_caller_role = 'team_admin' and v_completion.actor_id = auth.uid() then
    raise exception 'your own checklist is verified by the admin';
  end if;

  update public.task_completions
  set status = case when p_approve then 'off_duty_approved' else 'off_duty_rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_completion_id;
end;
$$;

-- Changes the penalty/bonus on an audit completion after the fact — e.g.
-- halving a past penalty because the next visit went well. Never overwrites
-- silently: every call appends a row to points_adjustments recording both
-- the old and new value, so "it was 1, changed to 0.5" stays visible forever,
-- while task_completions.points_awarded always holds the current value for
-- anything that just needs the live total (reports, the supervisor's score).
--
-- Ownership check keyed on actor_id, matching "each leader sees only what
-- they personally assigned" elsewhere: an owner can adjust any audit in the
-- org, a team_admin only their own past audits (the one they performed and
-- graded), never someone else's. subject_profile_id <> actor_id is what
-- marks a completion as an audit result at all — task_id can be null after
-- the source task is deleted, so this can't check tasks.is_audit instead.
create function public.adjust_completion_points(
  p_completion_id uuid,
  p_new_points numeric,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_completion public.task_completions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  select * into v_completion from public.task_completions where id = p_completion_id;
  if v_completion.id is null or v_completion.org_id is distinct from v_caller_org then
    raise exception 'not found';
  end if;
  if v_completion.subject_profile_id = v_completion.actor_id then
    raise exception 'this completion has no audit subject — nothing to adjust';
  end if;
  -- Money is the admin's alone: branch managers and supervisors only view.
  if v_caller_role is distinct from 'owner' then
    raise exception 'only the admin can adjust audit points';
  end if;

  insert into public.points_adjustments (task_completion_id, previous_points, new_points, adjusted_by, reason)
  values (p_completion_id, v_completion.points_awarded, p_new_points, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));

  update public.task_completions set points_awarded = p_new_points where id = p_completion_id;
end;
$$;

-- Overrides a whole closed period's total for one supervisor at once —
-- the owner's end-of-month "reduce this person's total" call, as opposed
-- to adjust_completion_points which revises one audit visit. Nothing here
-- touches task_completions: get_period_report applies the latest row on
-- top of the natural sum at read time, same "never snapshot, always
-- recompute" philosophy as report_periods itself. previous_points always
-- records the effective value at the moment of this call (the natural sum,
-- or the prior override if one already existed), so the trail stays
-- readable even across repeated adjustments.
create function public.adjust_period_points(
  p_period_id uuid,
  p_subject_profile_id uuid,
  p_new_points numeric,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_org_id uuid;
  v_period_org_id uuid;
  v_previous numeric;
  v_previous_iqd numeric;
  v_rate numeric;
begin
  select p.role, p.org_id into v_role, v_org_id
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can adjust a period''s totals';
  end if;

  select org_id into v_period_org_id from public.report_periods where id = p_period_id;
  if v_period_org_id is distinct from v_org_id then
    raise exception 'that report period does not belong to your organization';
  end if;

  select coalesce(
    (select pa.new_points from public.period_adjustments pa
     where pa.period_id = p_period_id and pa.subject_profile_id = p_subject_profile_id
     order by pa.created_at desc limit 1),
    (select sum(tc.points_awarded) from public.task_completions tc, public.report_periods rp
     where rp.id = p_period_id and tc.org_id = v_org_id and tc.subject_profile_id = p_subject_profile_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= rp.period_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (rp.period_month + interval '1 month'))
  ) into v_previous;

  select coalesce(
    (select pa.new_points * pa.iqd_per_point from public.period_adjustments pa
     where pa.period_id = p_period_id and pa.subject_profile_id = p_subject_profile_id
     order by pa.created_at desc limit 1),
    (select sum(tc.points_awarded * tc.iqd_per_point) from public.task_completions tc, public.report_periods rp
     where rp.id = p_period_id and tc.org_id = v_org_id and tc.subject_profile_id = p_subject_profile_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= rp.period_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (rp.period_month + interval '1 month'))
  ) into v_previous_iqd;

  select iqd_per_point into v_rate from public.organizations where id = v_org_id;

  insert into public.period_adjustments (period_id, subject_profile_id, previous_points, new_points, iqd_per_point, previous_iqd, adjusted_by, reason)
  values (p_period_id, p_subject_profile_id, v_previous, p_new_points, v_rate, v_previous_iqd, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

-- Anyone added to a branch gets their own copy of every daily checklist
-- meant for their role there (checklist_templates.assign_to_role), so a
-- brand-new account has something to fill on day one without anyone
-- assigning it by hand. A trigger (not code in admin_create_user) so every
-- path that adds a branch membership is covered. Cooldown 0: ready again
-- the moment it's submitted.
create function public.ensure_role_checklist_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_template public.checklist_templates;
begin
  select * into v_profile from public.profiles where id = new.profile_id;
  for v_template in
    select * from public.checklist_templates
    where org_id = v_profile.org_id and assign_to_role = v_profile.role and not archived
  loop
    if not exists (
      select 1 from public.tasks
      where assignee_id = new.profile_id and team_id = new.team_id and template_id = v_template.id
    ) then
      insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
      values (v_profile.org_id, new.team_id, v_template.name, new.profile_id,
              coalesce(new.added_by, v_template.created_by), v_template.id, 0, 'medium', true);
    end if;
  end loop;
  return new;
end;
$$;

create trigger profile_teams_role_checklists
  after insert on public.profile_teams
  for each row execute function public.ensure_role_checklist_tasks();

-- Owner-only: decides who fills a checklist template daily — 'employee'
-- (supervisors), 'team_admin' (branch managers) or null (nobody). Everyone
-- in that role gets their own copy in each of their branches right away;
-- copies held by anyone no longer in the audience are removed (their past
-- submissions stay: completions keep a snapshot and outlive their task).
create function public.set_template_audience(p_template_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.checklist_templates;
begin
  if public.role_of(auth.uid()) is distinct from 'owner' then
    raise exception 'only the org owner can choose who fills a checklist';
  end if;
  select * into v_template from public.checklist_templates where id = p_template_id;
  if v_template.id is null or v_template.org_id is distinct from public.my_org_id() then
    raise exception 'checklist template not found';
  end if;
  if p_role is not null and p_role not in ('employee', 'team_admin') then
    raise exception 'a checklist can be for supervisors or branch managers';
  end if;
  if p_role is not null and exists (select 1 from public.tasks where template_id = p_template_id and is_audit) then
    raise exception 'this is an audit checklist — it stays with the admin';
  end if;

  update public.checklist_templates set assign_to_role = p_role where id = p_template_id;

  delete from public.tasks t
  where t.template_id = p_template_id and not t.is_audit
    and (p_role is null or not exists (select 1 from public.profiles p where p.id = t.assignee_id and p.role = p_role));

  if p_role is not null then
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
    select p.org_id, pt.team_id, v_template.name, p.id, auth.uid(), p_template_id, 0, 'medium', true
    from public.profile_teams pt
    join public.profiles p on p.id = pt.profile_id
    where p.org_id = v_template.org_id and p.role = p_role and p.deleted_at is null
      and not exists (
        select 1 from public.tasks t where t.assignee_id = p.id and t.team_id = pt.team_id and t.template_id = p_template_id
      );
  end if;
end;
$$;

-- Stamps the org's current IQD-per-point rate onto every new completion,
-- overwriting anything the caller passed, so an audit keeps the rate it
-- was scored at no matter how the rate changes later.
create function public.stamp_completion_iqd_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select o.iqd_per_point into new.iqd_per_point from public.organizations o where o.id = new.org_id;
  return new;
end;
$$;

create trigger task_completions_stamp_iqd_rate
  before insert on public.task_completions
  for each row execute function public.stamp_completion_iqd_rate();

-- Owner-only: sets what one point is worth in IQD from now on. Past audits
-- and period overrides keep the rate stamped on them.
create function public.set_iqd_per_point(p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_org_id uuid;
begin
  select p.role, p.org_id into v_role, v_org_id
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can change the point rate';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'the rate must be a positive amount';
  end if;

  update public.organizations set iqd_per_point = p_rate where id = v_org_id;
end;
$$;

-- For each subject audited at least once, how many consecutive months —
-- counting backward from the current live month through closed periods,
-- most recent first — have an EFFECTIVE total below zero (period
-- adjustments applied, same as get_period_report). Stops at the first
-- month that's zero/positive, or the first month with no audit at all
-- (silence isn't evidence of a problem, so it breaks the streak rather
-- than being skipped). Powers the Dashboard's "needs attention" flag —
-- this is a real management signal (repeated poor performance), not just
-- a single bad day.
create function public.get_supervisor_streaks()
returns table (subject_profile_id uuid, negative_streak int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
  v_org_id uuid;
begin
  select p.role, p.org_id into v_role, v_org_id from public.profiles p where p.id = auth.uid();
  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can view performance trends';
  end if;

  return query
  with month_defs as (
    select 0 as rnk, date_trunc('month', now() at time zone 'Asia/Baghdad')::date as month_start, null::uuid as period_id
    union all
    select (row_number() over (order by rp.period_month desc))::int, rp.period_month, rp.id
    from public.report_periods rp where rp.org_id = v_org_id
  ),
  subjects as (
    select distinct tc.subject_profile_id
    from public.task_completions tc
    where tc.org_id = v_org_id and tc.points_awarded is not null
  ),
  grid as (
    select s.subject_profile_id, md.rnk, md.month_start, md.period_id
    from subjects s cross join month_defs md
  ),
  totals as (
    select
      g.subject_profile_id,
      g.rnk,
      count(tc.id) as n,
      coalesce(pa.new_points, sum(tc.points_awarded)) as total
    from grid g
    left join public.task_completions tc
      on tc.org_id = v_org_id
      and tc.subject_profile_id = g.subject_profile_id
      and tc.points_awarded is not null
      and (tc.created_at at time zone 'Asia/Baghdad') >= g.month_start
      and (tc.created_at at time zone 'Asia/Baghdad') < (g.month_start + interval '1 month')
    left join lateral (
      select pa2.new_points from public.period_adjustments pa2
      where pa2.period_id = g.period_id and pa2.subject_profile_id = g.subject_profile_id
      order by pa2.created_at desc limit 1
    ) pa on true
    group by g.subject_profile_id, g.rnk, pa.new_points
  ),
  flagged as (
    select totals.subject_profile_id, totals.rnk, (totals.n > 0 and totals.total < 0) as ok
    from totals
  ),
  first_fail as (
    select flagged.subject_profile_id, min(flagged.rnk) as fail_rnk
    from flagged
    where not flagged.ok
    group by flagged.subject_profile_id
  )
  select s.subject_profile_id, coalesce(ff.fail_rnk, (select max(month_defs.rnk) + 1 from month_defs))
  from subjects s
  left join first_fail ff on ff.subject_profile_id = s.subject_profile_id;
end;
$$;

-- Signs off on a normal completion — the priority-driven "a leader has to
-- look at this before it's really done" rule. No approve/reject dimension
-- like off-duty has: the work happened, this just marks that someone with
-- authority saw it.
create function public.review_task_completion(
  p_completion_id uuid,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_completion public.task_completions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select * into v_completion from public.task_completions where id = p_completion_id;
  if v_completion.id is null or v_completion.org_id is distinct from v_caller_org then
    raise exception 'not found';
  end if;
  if v_completion.action <> 'completed' then
    raise exception 'only a completed task can be reviewed this way';
  end if;
  if not (
    v_caller_role = 'owner'
    or (v_caller_role = 'team_admin' and v_completion.team_id = any(v_caller_teams))
  ) then
    raise exception 'only an admin or the team''s leader can review this';
  end if;
  if v_caller_role = 'team_admin' and v_completion.actor_id = auth.uid() then
    raise exception 'your own checklist is verified by the admin';
  end if;

  update public.task_completions
  set reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_completion_id;
end;
$$;

-- ── Checklist RPCs ────────────────────────────────────────────────

-- p_items: [{ "section_title": "...", "question": "..." }, ...] in display
-- order. section_title "" means no section, matching a flat template.
-- Cooldown lives on the task that uses this template, not the template
-- itself — the same template can back tasks with different repeat rates.
create function public.create_checklist_template(
  p_name text,
  p_requires_note_on_no boolean,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_id uuid;
  v_item jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role <> 'owner' then
    raise exception 'only the admin can create a checklist template';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a checklist name is required';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'a checklist needs at least one question';
  end if;

  insert into public.checklist_templates (org_id, name, requires_note_on_no, created_by)
  values (v_caller_org, trim(p_name), p_requires_note_on_no, auth.uid())
  returning id into v_template_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.checklist_template_items (template_id, section_title, sort_order, question)
    values (
      v_template_id,
      coalesce(v_item ->> 'section_title', ''),
      v_i,
      v_item ->> 'question'
    );
    v_i := v_i + 1;
  end loop;

  return v_template_id;
end;
$$;

-- Owner-only: lets the admin add, remove, reorder questions and edit each
-- question's point_weight and section_title (zone) on an existing checklist
-- template. Existing checklist_answers rows are historical snapshots
-- (question text already copied at answer time), so a delete-and-reinsert
-- of the items never touches past completions.
-- Copies a template's questions onto every template that mirrors it (see
-- checklist_templates.mirrors_template_id). Past submissions are untouched:
-- answers snapshot their own question text.
create function public.sync_mirrored_templates(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mirror uuid;
begin
  for v_mirror in select id from public.checklist_templates where mirrors_template_id = p_source_id
  loop
    delete from public.checklist_template_items where template_id = v_mirror;
    insert into public.checklist_template_items (template_id, section_title, sort_order, question, point_weight)
    select v_mirror, section_title, sort_order, question, 0
    from public.checklist_template_items where template_id = p_source_id;
  end loop;
end;
$$;

-- A user editing their own profile: display name, photo, company ID code.
-- Blank code/photo clears it; a blank name is refused.
create function public.update_my_profile(p_name text, p_employee_code text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'your name cannot be empty';
  end if;
  update public.profiles
  set name = left(trim(p_name), 80),
      employee_code = left(nullif(trim(p_employee_code), ''), 40),
      avatar_url = nullif(trim(p_avatar_url), '')
  where id = auth.uid();
end;
$$;

create function public.update_checklist_template(
  p_template_id uuid,
  p_name text,
  p_requires_note_on_no boolean,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_org uuid;
  v_item jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role <> 'owner' then
    raise exception 'only an admin can edit a checklist template';
  end if;

  select org_id into v_template_org from public.checklist_templates where id = p_template_id;
  if v_template_org is null then
    raise exception 'checklist template not found';
  end if;
  if v_template_org <> v_caller_org then
    raise exception 'that checklist template does not belong to your organization';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'a checklist name is required';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'a checklist needs at least one question';
  end if;

  update public.checklist_templates
  set name = trim(p_name), requires_note_on_no = p_requires_note_on_no
  where id = p_template_id;

  delete from public.checklist_template_items where template_id = p_template_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.checklist_template_items (template_id, section_title, sort_order, question, point_weight)
    values (
      p_template_id,
      coalesce(v_item ->> 'section_title', ''),
      v_i,
      v_item ->> 'question',
      coalesce((v_item ->> 'point_weight')::numeric, 0.25)
    );
    v_i := v_i + 1;
  end loop;

  -- Keep any mirroring template (the supervisors' daily copy) asking the
  -- same questions.
  perform public.sync_mirrored_templates(p_template_id);
end;
$$;

create function public.set_branch_brands(p_branch_id uuid, p_brand_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_branch_org uuid;
  v_foreign_count int;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role is distinct from 'owner' then
    raise exception 'only an admin can set a branch''s brands';
  end if;

  select org_id into v_branch_org from public.teams where id = p_branch_id;
  if v_branch_org is null then
    raise exception 'branch not found';
  end if;
  if v_branch_org is distinct from v_caller_org then
    raise exception 'that branch does not belong to your organization';
  end if;

  select count(*) into v_foreign_count
  from unnest(coalesce(p_brand_ids, '{}')) bid
  where not exists (select 1 from public.brands b where b.id = bid and b.org_id = v_caller_org);
  if v_foreign_count > 0 then
    raise exception 'one or more brands do not belong to your organization';
  end if;

  delete from public.branch_brands where branch_id = p_branch_id;

  insert into public.branch_brands (branch_id, brand_id)
  select p_branch_id, bid from unnest(coalesce(p_brand_ids, '{}')) bid;

  -- A brand no longer configured for this branch can't stay assigned to any
  -- supervisor there — otherwise profile_teams.brand_id silently points at a
  -- brand the branch no longer offers (Dashboard/Report keep attributing
  -- them to it, ManageUserSheet's chip goes stale, and the audit picker in
  -- FillChecklistSheet can no longer find them under any real brand).
  update public.profile_teams
  set brand_id = null
  where team_id = p_branch_id
    and brand_id is not null
    and brand_id <> all(coalesce(p_brand_ids, '{}'));
end;
$$;

-- p_fields shape: [{ "label": "...", "field_type": "text"|"number"|"date"|
-- "time"|"select", "options": ["OK","Replace"] (select only, else omit/null),
-- "unit": "%" (optional, cosmetic), "required": true|false (default true) }]
create function public.create_form_template(
  p_name text,
  p_fields jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_id uuid;
  v_field jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role <> 'owner' then
    raise exception 'only the admin can create a form template';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a form name is required';
  end if;
  if jsonb_array_length(p_fields) < 1 then
    raise exception 'a form needs at least one field';
  end if;

  insert into public.form_templates (org_id, name, created_by)
  values (v_caller_org, trim(p_name), auth.uid())
  returning id into v_template_id;

  for v_field in select * from jsonb_array_elements(p_fields)
  loop
    insert into public.form_template_fields (template_id, sort_order, label, field_type, options, unit, required)
    values (
      v_template_id,
      v_i,
      v_field ->> 'label',
      v_field ->> 'field_type',
      v_field -> 'options',
      v_field ->> 'unit',
      coalesce((v_field ->> 'required')::boolean, true)
    );
    v_i := v_i + 1;
  end loop;

  return v_template_id;
end;
$$;

grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.get_login_email(text, text) to anon, authenticated;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.create_brand(text) to authenticated;
grant execute on function public.set_branch_brands(uuid, uuid[]) to authenticated;
grant execute on function public.close_next_month() to authenticated;
grant execute on function public.get_period_report(uuid) to authenticated;
grant execute on function public.get_current_branch_summary() to authenticated;
grant execute on function public.set_iqd_per_point(numeric) to authenticated;
grant execute on function public.admin_create_user(text, text, text, text, uuid, text, uuid) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.set_template_audience(uuid, text) to authenticated;
grant execute on function public.add_profile_to_team(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_profile_from_team(uuid, uuid) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.set_task_completion(uuid, boolean, text, text[], jsonb, jsonb, uuid, text, numeric, uuid, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.adjust_completion_points(uuid, numeric, text) to authenticated;
-- Not granted to authenticated: this runs on a schedule (pg_cron) as a
-- superuser-ish role, never called by a client directly.
grant execute on function public.create_checklist_template(text, boolean, jsonb) to authenticated;
grant execute on function public.create_form_template(text, jsonb) to authenticated;
grant execute on function public.declare_task_off_duty(uuid, text) to authenticated;
grant execute on function public.review_off_duty(uuid, boolean, text) to authenticated;
grant execute on function public.review_task_completion(uuid, text) to authenticated;
-- assert_can_manage_user is deliberately NOT granted: it is an internal
-- helper called only from the other SECURITY DEFINER functions.

-- ── Table privileges ─────────────────────────────────────────────────
-- Postgres checks table privileges BEFORE row-level security, so without
-- these every RLS policy above is unreachable and each read fails with
-- 42501 "permission denied for table ..." no matter how correct the policy.
--
-- This used to be invisible: older Supabase projects bootstrapped with
-- GRANT ALL ON ALL TABLES to the Data API roles, so the script inherited
-- privileges it never asked for. Newer projects have "Automatically expose
-- new tables" off at creation, which grants nothing — the tables this script
-- creates then land with only REFERENCES/TRIGGER/TRUNCATE, sign-up writes
-- fine through the SECURITY DEFINER RPCs, and the app is left unable to read
-- back the row it just created. Diagnosed 2026-09-12 on a fresh project.
--
-- anon deliberately gets no DML: nothing before sign-in touches a table
-- directly, only get_login_email(), which is SECURITY DEFINER and granted
-- above.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- So a table added after this script runs cannot silently repeat the outage.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- ── Realtime ─────────────────────────────────────────────────────────
-- OrgDataProvider subscribes to postgres_changes on public.tasks, filtered by
-- org_id. A table only emits changes if it belongs to the supabase_realtime
-- publication, and a fresh project's publication is empty — so without this
-- the subscription connects, reports success, and then never fires once:
-- tasks quietly stop live-updating across devices with no error anywhere.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- That subscription filters on org_id, which is not the primary key. Under the
-- default replica identity a DELETE writes only the PK to the WAL, so the
-- filter cannot match and the event is dropped — a task deleted on one device
-- would linger on every other one until someone forced a refresh.
alter table public.tasks replica identity full;

-- No UI reads this table yet, but a future "your occurrences" screen will
-- want live updates the same way tasks does — added proactively so that
-- screen doesn't rediscover this same missing-publication trap later.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_occurrences'
  ) then
    alter publication supabase_realtime add table public.task_occurrences;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_completions'
  ) then
    alter publication supabase_realtime add table public.task_completions;
  end if;
end $$;
alter table public.task_occurrences replica identity full;

-- ── Storage bucket for proof photos ───────────────────────────────────

insert into storage.buckets (id, name, public) values ('task-proofs', 'task-proofs', true)
on conflict (id) do nothing;

create policy "org members can upload their own proof photos"
  on storage.objects for insert
  with check (
    bucket_id = 'task-proofs'
    and public.my_org_id()::text = (storage.foldername(name))[1]
  );

create policy "anyone can read proof photos (bucket is public)"
  on storage.objects for select
  using (bucket_id = 'task-proofs');

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

-- ════════════════════════════════════════════════════════════════════
-- Oil-tester feature (fryers + oil tests). Applied to live 2026-09-22.
-- ════════════════════════════════════════════════════════════════════
-- ── Fryers ──────────────────────────────────────────────────────────
-- A fryer/station at a branch that gets oil-tested (شواية الكنتاكي …).
-- Owner-managed; each row belongs to one branch so a branch sees its own.
create table if not exists public.oil_fryers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists oil_fryers_branch_idx on public.oil_fryers(team_id) where not archived;

-- ── Oil tests ───────────────────────────────────────────────────────
-- One reading of one fryer. grade is derived from tpm at write time so the
-- report never has to recompute the rule: <20 good, 20–<22 watch, >=22 change.
create table if not exists public.oil_tests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  fryer_id uuid not null references public.oil_fryers(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  -- true when an auditor did it on a branch visit, false for the daily one a
  -- supervisor/manager runs. Auditor red results are recorded, never penalised.
  is_audit boolean not null default false,
  tpm numeric not null check (tpm >= 0 and tpm <= 100),
  temp_c numeric check (temp_c >= 0 and temp_c <= 400),
  filtered boolean not null default false,
  grade text not null check (grade in ('good', 'watch', 'change')),
  photo_url text not null,
  signature_url text,
  note text,
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists oil_tests_branch_day_idx on public.oil_tests(team_id, tested_at);
create index if not exists oil_tests_fryer_idx on public.oil_tests(fryer_id, tested_at);

alter table public.oil_fryers enable row level security;
alter table public.oil_tests enable row level security;

-- Read: anyone in the org sees fryers/tests for a branch they belong to; the
-- owner sees all. No direct insert/update/delete — RPCs below own writes.
drop policy if exists "read fryers" on public.oil_fryers;
create policy "read fryers" on public.oil_fryers for select
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or team_id = any(public.my_team_ids())));

drop policy if exists "read oil tests" on public.oil_tests;
create policy "read oil tests" on public.oil_tests for select
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or team_id = any(public.my_team_ids())));

-- Owner adds/edits/archives a fryer.
create or replace function public.set_oil_fryer(
  p_team_id uuid, p_name text, p_fryer_id uuid default null, p_sort_order int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can manage fryers'; end if;
  select org_id into v_org from public.profiles where id = auth.uid();
  if coalesce(trim(p_name), '') = '' then raise exception 'a fryer needs a name'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if p_fryer_id is null then
    insert into public.oil_fryers (org_id, team_id, name, sort_order, created_by)
    values (v_org, p_team_id, trim(p_name), coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.oil_fryers set name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_fryer_id and org_id = v_org returning id into v_id;
    if v_id is null then raise exception 'fryer not found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.archive_oil_fryer(p_fryer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can manage fryers'; end if;
  update public.oil_fryers set archived = true
  where id = p_fryer_id and org_id = public.my_org_id();
end; $$;

-- Anyone who belongs to the fryer's branch (or the owner/auditor) records a test.
create or replace function public.submit_oil_test(
  p_fryer_id uuid, p_tpm numeric, p_temp_c numeric, p_filtered boolean,
  p_photo_url text, p_signature_url text default null, p_note text default null,
  p_is_audit boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_fryer public.oil_fryers; v_grade text; v_id uuid;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  select * into v_fryer from public.oil_fryers where id = p_fryer_id and org_id = v_org and not archived;
  if v_fryer.id is null then raise exception 'fryer not found'; end if;
  if not (v_role = 'owner' or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;
  v_grade := case when p_tpm >= 22 then 'change' when p_tpm >= 20 then 'watch' else 'good' end;
  insert into public.oil_tests (org_id, team_id, fryer_id, actor_id, is_audit, tpm, temp_c,
    filtered, grade, photo_url, signature_url, note)
  values (v_org, v_fryer.team_id, p_fryer_id, auth.uid(), coalesce(p_is_audit, false), p_tpm, p_temp_c,
    coalesce(p_filtered, false), v_grade, p_photo_url, nullif(trim(p_signature_url), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.set_oil_fryer(uuid, text, uuid, int) to authenticated;
grant execute on function public.archive_oil_fryer(uuid) to authenticated;
grant execute on function public.submit_oil_test(uuid, numeric, numeric, boolean, text, text, text, boolean) to authenticated;

-- Realtime so a new test shows for the admin without a refresh.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='oil_tests') then
    alter publication supabase_realtime add table public.oil_tests;
  end if;
end $$;
