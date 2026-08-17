-- OrgTasks — full setup script. Safe to run repeatedly: it drops
-- everything belonging to this app first, then rebuilds it from scratch in
-- its final, correct form. This replaces the old numbered migration files
-- (0000-0005) — just run THIS one file whenever the schema needs to be
-- (re)applied during testing. Also wipes all data and test auth accounts,
-- so you always start from a clean slate.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

-- ── Clean slate ─────────────────────────────────────────────────────

drop table if exists public.profile_teams cascade;
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

drop function if exists public.my_org_id() cascade;
drop function if exists public.my_role() cascade;
-- my_team_id() (singular) is gone — team membership is now many-to-many via
-- profile_teams, replaced by my_team_ids() below.
drop function if exists public.my_team_id() cascade;
drop function if exists public.my_team_ids() cascade;
drop function if exists public.add_profile_to_team(uuid, uuid) cascade;
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
drop function if exists public.admin_create_user(text, text, text, text, uuid, text) cascade;
drop function if exists public.assert_can_manage_user(uuid) cascade;
drop function if exists public.admin_reset_password(uuid, text) cascade;
drop function if exists public.admin_set_user_active(uuid, boolean) cascade;
drop function if exists public.clear_must_change_password() cascade;
-- Both signatures: the old one took a single photo url, the new one an array.
drop function if exists public.set_task_completion(uuid, boolean, text, text) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text[]) cascade;
drop function if exists public.create_checklist_template(text, int, boolean, jsonb) cascade;
drop function if exists public.assign_checklist(uuid, uuid) cascade;
drop function if exists public.unassign_checklist(uuid) cascade;
drop function if exists public.submit_checklist(uuid, jsonb, jsonb) cascade;
drop function if exists public.declare_checklist_off_duty(uuid, text) cascade;
drop function if exists public.review_checklist_off_duty(uuid, boolean, text) cascade;

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
  created_at timestamptz not null default now()
);

create unique index profiles_org_username_unique_idx
  on public.profiles (org_id, lower(username));

-- A person can belong to more than one team (e.g. a supervisor who covers
-- both the hygiene and kitchen checklists, each run by a different leader).
-- In practice a team leader has exactly one row here — that's a usage
-- pattern, not a restriction the schema enforces.
create table public.profile_teams (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (profile_id, team_id)
);

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
  -- Replaces the old single proof_photo_url.
  proof_photo_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade
);

-- Append-only audit log. tasks holds only the CURRENT state, which is wiped
-- when a task is reopened; this keeps every completion and reopen forever so
-- the org can look back at who did what, when, and with what proof.
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
  action text not null check (action in ('completed', 'reopened')),
  note text,
  photo_urls text[] not null default '{}',
  -- Snapshot of the deadline at that moment, so later edits to the task's due
  -- date cannot rewrite history.
  due_at timestamptz,
  -- Completed after the deadline had already passed.
  was_late boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Checklists ─────────────────────────────────────────────────────
-- A repeating inspection form (e.g. the daily hygiene sheet). Reused across
-- however many supervisors it's assigned to, rather than one task per person.

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- How long after a submission before it's due again. No calendar/shift
  -- concept on purpose — a supervisor working a double just sees it come
  -- back mid-shift, instead of being falsely marked late for a shift swap.
  cooldown_hours int not null default 7 check (cooldown_hours > 0),
  -- A note is required to explain a "لا" answer; never required on "نعم".
  -- Photos are always optional, whatever this is set to.
  requires_note_on_no boolean not null default true,
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
  question text not null
);

create table public.checklist_assignments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  -- A leader can pause someone's assignment without losing their submission
  -- history, the same way a task isn't deleted just to stop assigning it.
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (template_id, assignee_id)
);

create table public.checklist_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.checklist_assignments(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  -- Snapshot, so renaming the template later doesn't rewrite old submissions.
  template_name text not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (
    status in ('completed', 'off_duty_pending', 'off_duty_approved', 'off_duty_rejected')
  ),
  off_duty_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  yes_count int not null default 0,
  no_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.checklist_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.checklist_submissions(id) on delete cascade,
  section_title text not null default '',
  -- Snapshot of the question text at the moment it was answered.
  question text not null,
  sort_order int not null,
  answer boolean not null,
  note text
);

create table public.checklist_section_photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.checklist_submissions(id) on delete cascade,
  section_title text not null default '',
  photo_url text not null,
  created_at timestamptz not null default now()
);

create index checklist_template_items_template_idx on public.checklist_template_items(template_id, sort_order);
create index checklist_assignments_assignee_idx on public.checklist_assignments(assignee_id) where active;
create index checklist_assignments_template_idx on public.checklist_assignments(template_id);
create index checklist_submissions_assignment_idx on public.checklist_submissions(assignment_id, created_at desc);
create index checklist_submissions_org_idx on public.checklist_submissions(org_id, created_at desc);
create index checklist_submissions_team_idx on public.checklist_submissions(team_id, created_at desc);
create index checklist_submissions_actor_idx on public.checklist_submissions(actor_id, created_at desc);
create index checklist_submissions_pending_idx on public.checklist_submissions(org_id) where status = 'off_duty_pending';
create index checklist_answers_submission_idx on public.checklist_answers(submission_id, sort_order);
create index checklist_section_photos_submission_idx on public.checklist_section_photos(submission_id);

create index tasks_team_id_idx on public.tasks(team_id);
create index task_completions_org_idx on public.task_completions(org_id, created_at desc);
create index task_completions_team_idx on public.task_completions(team_id, created_at desc);
create index task_completions_actor_idx on public.task_completions(actor_id, created_at desc);
create index task_completions_task_idx on public.task_completions(task_id, created_at desc);
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
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_assignments enable row level security;
alter table public.checklist_submissions enable row level security;
alter table public.checklist_answers enable row level security;
alter table public.checklist_section_photos enable row level security;
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

-- Work is handed down, never sideways or to yourself: an owner may assign to
-- team leaders and employees, a team leader only to employees on their own
-- team. Nobody can assign themselves a task and then sign off on their own
-- work. assignee_id null means "anyone on the team", which stays allowed.
--
-- The assignee-membership check (assignee_id must actually belong to this
-- task's team) closes a gap that predates multi-team: role_of() alone never
-- verified the assignee was really on the team the task claims, for either
-- the owner or the team leader branch.
create policy "team admin or owner can create tasks for their own team"
  on public.tasks for insert
  with check (
    org_id = public.my_org_id()
    and assignee_id is distinct from auth.uid()
    and (
      assignee_id is null
      or team_id = any(select pt.team_id from public.profile_teams pt where pt.profile_id = assignee_id)
    )
    and (
      (
        public.my_role() = 'owner'
        and (assignee_id is null or public.role_of(assignee_id) in ('team_admin', 'employee'))
      )
      or (
        public.my_role() = 'team_admin'
        and team_id = any(public.my_team_ids())
        and (assignee_id is null or public.role_of(assignee_id) = 'employee')
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
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()))
    )
  )
  with check (
    org_id = public.my_org_id()
    and assignee_id is distinct from auth.uid()
    and (
      assignee_id is null
      or team_id = any(select pt.team_id from public.profile_teams pt where pt.profile_id = assignee_id)
    )
    and (
      (
        public.my_role() = 'owner'
        and (assignee_id is null or public.role_of(assignee_id) in ('team_admin', 'employee'))
      )
      or (
        public.my_role() = 'team_admin'
        and team_id = any(public.my_team_ids())
        and (assignee_id is null or public.role_of(assignee_id) = 'employee')
      )
    )
  );

create policy "team admin or owner can delete their team's tasks"
  on public.tasks for delete
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()))
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

-- Same three levels as everywhere else: the owner sees the whole org, a team
-- leader their own team, an employee only what's assigned to them.
create policy "checklist assignments are scoped to the reader's role"
  on public.checklist_assignments for select
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()))
      or assignee_id = auth.uid()
    )
  );

create policy "checklist submissions are scoped to the reader's role"
  on public.checklist_submissions for select
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()))
      or actor_id = auth.uid()
    )
  );

create policy "checklist answers follow their submission's visibility"
  on public.checklist_answers for select
  using (
    exists (
      select 1 from public.checklist_submissions s
      where s.id = submission_id
        and s.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and s.team_id = any(public.my_team_ids()))
          or s.actor_id = auth.uid()
        )
    )
  );

create policy "checklist photos follow their submission's visibility"
  on public.checklist_section_photos for select
  using (
    exists (
      select 1 from public.checklist_submissions s
      where s.id = submission_id
        and s.org_id = public.my_org_id()
        and (
          public.my_role() = 'owner'
          or (public.my_role() = 'team_admin' and s.team_id = any(public.my_team_ids()))
          or s.actor_id = auth.uid()
        )
    )
  );

create policy "history is scoped to the reader's role"
  on public.task_completions for select
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = any(public.my_team_ids()))
      or actor_id = auth.uid()
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
  p_title text default null
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
  if p_role not in ('employee', 'team_admin') then
    raise exception 'role must be employee or team_admin';
  end if;

  if v_caller_role = 'team_admin' then
    if p_role <> 'employee' then
      raise exception 'a team leader can only create employees';
    end if;
    if p_team_id is null or not (p_team_id = any(v_caller_teams)) then
      raise exception 'a team leader can only create users on their own team';
    end if;
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org
  ) then
    raise exception 'team not found in this organization';
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
  v_email := v_username || '.' || v_org_code || '@users.orgtasks.internal';

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
    insert into public.profile_teams (profile_id, team_id, added_by)
    values (v_new_id, p_team_id, auth.uid());
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
  v_target_teams uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id into v_target_org
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
  if v_caller_role = 'team_admin' and v_caller_teams && v_target_teams then
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
create function public.add_profile_to_team(p_profile_id uuid, p_team_id uuid)
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

  insert into public.profile_teams (profile_id, team_id, added_by)
  values (p_profile_id, p_team_id, auth.uid())
  on conflict (profile_id, team_id) do nothing;
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

create function public.set_task_completion(
  p_task_id uuid,
  p_completed boolean,
  p_note text default null,
  p_photo_urls text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_my_profile_id uuid := auth.uid();
  v_my_teams uuid[];
  v_my_role text;
  v_photos text[] := coalesce(p_photo_urls, '{}');
  v_was_late boolean := false;
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

  -- Enforced here and not only in the UI: a task that requires proof cannot
  -- be closed without at least one photo, no matter what calls this.
  if p_completed and v_task.requires_proof and coalesce(array_length(v_photos, 1), 0) < 1 then
    raise exception 'this task needs at least one photo before it can be marked done';
  end if;

  if p_completed then
    v_was_late := v_task.due is not null and now() > v_task.due;
  end if;

  update public.tasks
  set completed = p_completed,
      completed_by = case when p_completed then v_my_profile_id else null end,
      completed_at = case when p_completed then now() else null end,
      proof_note = case when p_completed then p_note else null end,
      proof_photo_urls = case when p_completed then v_photos else '{}' end
  where id = p_task_id;

  -- Every open and close is recorded, so reopening a task never erases the
  -- fact that it was completed, by whom, or with what proof.
  insert into public.task_completions (
    task_id, org_id, team_id, task_title, actor_id, action,
    note, photo_urls, due_at, was_late
  ) values (
    v_task.id, v_task.org_id, v_task.team_id, v_task.title, v_my_profile_id,
    case when p_completed then 'completed' else 'reopened' end,
    case when p_completed then p_note else null end,
    case when p_completed then v_photos else '{}' end,
    v_task.due,
    v_was_late
  );
end;
$$;

-- ── Checklist RPCs ────────────────────────────────────────────────

-- p_items: [{ "section_title": "...", "question": "..." }, ...] in display
-- order. section_title "" means no section, matching a flat template.
create function public.create_checklist_template(
  p_name text,
  p_cooldown_hours int,
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

  if v_caller_role not in ('owner', 'team_admin') then
    raise exception 'only an admin or team leader can create a checklist template';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a checklist name is required';
  end if;
  if coalesce(p_cooldown_hours, 0) < 1 then
    raise exception 'cooldown hours must be at least 1';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'a checklist needs at least one question';
  end if;

  insert into public.checklist_templates (org_id, name, cooldown_hours, requires_note_on_no, created_by)
  values (v_caller_org, trim(p_name), p_cooldown_hours, p_requires_note_on_no, auth.uid())
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

-- Assignment only flows downward, same rule as task assignment: an owner may
-- assign to anyone, a team leader only to an employee on their own team.
create function public.assign_checklist(
  p_template_id uuid,
  p_assignee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_assignee_org uuid;
  v_assignee_teams uuid[];
  v_assignee_role text;
  v_assignment_team uuid;
  v_assignment_id uuid;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  if not exists (select 1 from public.checklist_templates t where t.id = p_template_id and t.org_id = v_caller_org) then
    raise exception 'checklist template not found in this organization';
  end if;

  select p.org_id, p.role into v_assignee_org, v_assignee_role
  from public.profiles p where p.id = p_assignee_id;
  select coalesce(array_agg(team_id), '{}') into v_assignee_teams
  from public.profile_teams where profile_id = p_assignee_id;

  if v_assignee_org is distinct from v_caller_org then
    raise exception 'that person is not in your organization';
  end if;
  if p_assignee_id = auth.uid() then
    raise exception 'you cannot assign a checklist to yourself';
  end if;

  if v_caller_role = 'owner' then
    if v_assignee_role not in ('team_admin', 'employee') then
      raise exception 'a checklist can only be assigned to a team leader or employee';
    end if;
    -- Only a single, unambiguous team gets recorded on the assignment; a
    -- person on several teams (or none) still gets assigned fine, it's just
    -- visible to the owner and to her alone rather than to a specific leader.
    if array_length(v_assignee_teams, 1) = 1 then
      v_assignment_team := v_assignee_teams[1];
    end if;
  elsif v_caller_role = 'team_admin' then
    if array_length(v_caller_teams, 1) is null then
      raise exception 'you are not on a team';
    end if;
    v_assignment_team := v_caller_teams[1];
    if v_assignee_role <> 'employee' or not (v_assignment_team = any(v_assignee_teams)) then
      raise exception 'a team leader can only assign checklists to their own employees';
    end if;
  else
    raise exception 'only an admin or team leader can assign checklists';
  end if;

  insert into public.checklist_assignments (template_id, org_id, team_id, assignee_id, created_by)
  values (p_template_id, v_caller_org, v_assignment_team, p_assignee_id, auth.uid())
  on conflict (template_id, assignee_id) do update set active = true
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

create function public.unassign_checklist(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_assignment public.checklist_assignments;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select * into v_assignment from public.checklist_assignments where id = p_assignment_id;
  if v_assignment.id is null or v_assignment.org_id is distinct from v_caller_org then
    raise exception 'assignment not found';
  end if;
  if v_caller_role = 'owner'
     or (v_caller_role = 'team_admin' and v_assignment.team_id = any(v_caller_teams)) then
    update public.checklist_assignments set active = false where id = p_assignment_id;
  else
    raise exception 'only an admin or the team''s leader can remove this assignment';
  end if;
end;
$$;

-- p_answers: [{ "section_title": "...", "question": "...", "sort_order": 0,
--               "answer": true|false, "note": "..." }, ...]
-- p_section_photos: [{ "section_title": "...", "photo_url": "..." }, ...]
create function public.submit_checklist(
  p_assignment_id uuid,
  p_answers jsonb,
  p_section_photos jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.checklist_assignments;
  v_template public.checklist_templates;
  v_submission_id uuid;
  v_answer jsonb;
  v_photo jsonb;
  v_yes int := 0;
  v_no int := 0;
begin
  select * into v_assignment from public.checklist_assignments where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'checklist assignment not found';
  end if;
  if v_assignment.assignee_id is distinct from auth.uid() then
    raise exception 'this checklist is not assigned to you';
  end if;
  if not v_assignment.active then
    raise exception 'this checklist assignment is no longer active';
  end if;

  select * into v_template from public.checklist_templates where id = v_assignment.template_id;

  if jsonb_array_length(p_answers) < 1 then
    raise exception 'at least one answer is required';
  end if;

  -- Enforced here, not just in the UI: a "لا" answer needs its note whenever
  -- the template requires one, and the check can't be skipped by the client.
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

  insert into public.checklist_submissions (
    assignment_id, org_id, team_id, template_name, actor_id, status, yes_count, no_count
  ) values (
    v_assignment.id, v_assignment.org_id, v_assignment.team_id, v_template.name,
    auth.uid(), 'completed', v_yes, v_no
  )
  returning id into v_submission_id;

  for v_answer in select * from jsonb_array_elements(p_answers)
  loop
    insert into public.checklist_answers (submission_id, section_title, question, sort_order, answer, note)
    values (
      v_submission_id,
      coalesce(v_answer ->> 'section_title', ''),
      v_answer ->> 'question',
      coalesce((v_answer ->> 'sort_order')::int, 0),
      (v_answer ->> 'answer')::boolean,
      nullif(trim(coalesce(v_answer ->> 'note', '')), '')
    );
  end loop;

  for v_photo in select * from jsonb_array_elements(p_section_photos)
  loop
    insert into public.checklist_section_photos (submission_id, section_title, photo_url)
    values (v_submission_id, coalesce(v_photo ->> 'section_title', ''), v_photo ->> 'photo_url');
  end loop;

  return v_submission_id;
end;
$$;

-- A claim, not an escape: this does not clear the assignment. It sits as
-- off_duty_pending until an admin or the team's leader reviews it. Only a
-- rejection makes the checklist immediately due again; an approval behaves
-- like a normal completion for cooldown purposes.
create function public.declare_checklist_off_duty(
  p_assignment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.checklist_assignments;
  v_template_name text;
  v_submission_id uuid;
begin
  select * into v_assignment from public.checklist_assignments where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'checklist assignment not found';
  end if;
  if v_assignment.assignee_id is distinct from auth.uid() then
    raise exception 'this checklist is not assigned to you';
  end if;
  if not v_assignment.active then
    raise exception 'this checklist assignment is no longer active';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select name into v_template_name from public.checklist_templates where id = v_assignment.template_id;

  insert into public.checklist_submissions (
    assignment_id, org_id, team_id, template_name, actor_id, status, off_duty_reason
  ) values (
    v_assignment.id, v_assignment.org_id, v_assignment.team_id, v_template_name,
    auth.uid(), 'off_duty_pending', trim(p_reason)
  )
  returning id into v_submission_id;

  return v_submission_id;
end;
$$;

create function public.review_checklist_off_duty(
  p_submission_id uuid,
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
  v_submission public.checklist_submissions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select * into v_submission from public.checklist_submissions where id = p_submission_id;
  if v_submission.id is null or v_submission.org_id is distinct from v_caller_org then
    raise exception 'submission not found';
  end if;
  if v_submission.status <> 'off_duty_pending' then
    raise exception 'this off-duty claim has already been reviewed';
  end if;
  if not (
    v_caller_role = 'owner'
    or (v_caller_role = 'team_admin' and v_submission.team_id = any(v_caller_teams))
  ) then
    raise exception 'only an admin or the team''s leader can review this';
  end if;

  update public.checklist_submissions
  set status = case when p_approve then 'off_duty_approved' else 'off_duty_rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_submission_id;
end;
$$;

grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.get_login_email(text, text) to anon, authenticated;
grant execute on function public.create_team(text) to authenticated;
grant execute on function public.admin_create_user(text, text, text, text, uuid, text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.add_profile_to_team(uuid, uuid) to authenticated;
grant execute on function public.remove_profile_from_team(uuid, uuid) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.set_task_completion(uuid, boolean, text, text[]) to authenticated;
grant execute on function public.create_checklist_template(text, int, boolean, jsonb) to authenticated;
grant execute on function public.assign_checklist(uuid, uuid) to authenticated;
grant execute on function public.unassign_checklist(uuid) to authenticated;
grant execute on function public.submit_checklist(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.declare_checklist_off_duty(uuid, text) to authenticated;
grant execute on function public.review_checklist_off_duty(uuid, boolean, text) to authenticated;
-- assert_can_manage_user is deliberately NOT granted: it is an internal
-- helper called only from the other SECURITY DEFINER functions.

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
