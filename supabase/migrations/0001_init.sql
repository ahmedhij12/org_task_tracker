-- OrgTasks schema: organizations -> teams -> profiles (owner/team_admin/employee) -> tasks
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

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
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  title text, -- job title e.g. "IT", "Accountant" — separate from the permission role below
  role text not null check (role in ('owner', 'team_admin', 'employee')),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  notes text,
  due timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  assignee_id uuid references public.profiles(id) on delete set null, -- null = whole team
  requires_proof boolean not null default false,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  proof_note text,
  proof_photo_url text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade
);

create index tasks_team_id_idx on public.tasks(team_id);
create index tasks_org_id_idx on public.tasks(org_id);
create index tasks_assignee_id_idx on public.tasks(assignee_id);
create index profiles_org_id_idx on public.profiles(org_id);
create index teams_org_id_idx on public.teams(org_id);

alter table public.organizations enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;

-- ── Read policies (writes happen through the RPCs below, not raw INSERT/UPDATE
--    from the client, so a joiner can't forge their own role/org/team) ──────

create policy "org members can read their own org"
  on public.organizations for select
  using (id = (select org_id from public.profiles where id = auth.uid()));

create policy "org members can read their org's teams"
  on public.teams for select
  using (org_id = (select org_id from public.profiles where id = auth.uid()));

create policy "org members can read profiles in their org"
  on public.profiles for select
  using (org_id = (select org_id from public.profiles p2 where p2.id = auth.uid()));

create policy "users can update their own display name"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = (select org_id from public.profiles p2 where p2.id = auth.uid()) and role = (select role from public.profiles p2 where p2.id = auth.uid()) and team_id is not distinct from (select team_id from public.profiles p2 where p2.id = auth.uid()));

create policy "owner can manage roles and team assignment in their org"
  on public.profiles for update
  using (
    org_id = (select org_id from public.profiles p2 where p2.id = auth.uid())
    and (select role from public.profiles p2 where p2.id = auth.uid()) = 'owner'
  );

create policy "team members and the owner can read that team's tasks"
  on public.tasks for select
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) = 'owner'
      or team_id = (select team_id from public.profiles where id = auth.uid())
    )
  );

create policy "team admin or owner can create tasks for their own team"
  on public.tasks for insert
  with check (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) = 'owner'
      or (
        (select role from public.profiles where id = auth.uid()) = 'team_admin'
        and team_id = (select team_id from public.profiles where id = auth.uid())
      )
    )
  );

create policy "team admin or owner can edit/delete their team's tasks"
  on public.tasks for update
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) = 'owner'
      or (
        (select role from public.profiles where id = auth.uid()) = 'team_admin'
        and team_id = (select team_id from public.profiles where id = auth.uid())
      )
    )
  );

create policy "team admin or owner can delete their team's tasks"
  on public.tasks for delete
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) = 'owner'
      or (
        (select role from public.profiles where id = auth.uid()) = 'team_admin'
        and team_id = (select team_id from public.profiles where id = auth.uid())
      )
    )
  );

-- ── RPCs (security definer, pinned search_path) ──────────────────────
-- All writes that establish identity/authority go through these instead of
-- raw table access, so a client can never assign itself 'owner' or another
-- team's data by crafting an insert directly.

create or replace function public.generate_org_code(p_name text)
returns text
language plpgsql
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := upper(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  base := left(nullif(base, ''), 4);
  if base is null then base := 'ORG'; end if;
  loop
    candidate := base || lpad(floor(random() * 9000 + 1000)::text, 4, '0');
    exit when not exists (select 1 from public.organizations where org_code = candidate);
    n := n + 1;
    exit when n > 20; -- practically unreachable, safety valve
  end loop;
  return candidate;
end;
$$;

create or replace function public.create_organization(p_org_name text, p_owner_name text, p_team_name text default 'Main Team')
returns table (org_id uuid, org_code text, team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'this account already belongs to an organization';
  end if;

  v_org_code := public.generate_org_code(p_org_name);

  insert into public.organizations (org_code, name, owner_id)
  values (v_org_code, p_org_name, auth.uid())
  returning id into v_org_id;

  insert into public.teams (org_id, name)
  values (v_org_id, p_team_name)
  returning id into v_team_id;

  insert into public.profiles (id, org_id, team_id, name, title, role)
  values (auth.uid(), v_org_id, v_team_id, p_owner_name, 'Owner', 'owner');

  return query select v_org_id, v_org_code, v_team_id;
end;
$$;

-- Lets a not-yet-joined user look up an org + its teams (with each team's
-- admin name, so the join screen can offer a "team leader" picker) by code.
create or replace function public.get_org_by_code(p_org_code text)
returns table (org_id uuid, org_name text, team_id uuid, team_name text, admin_name text)
language sql
security definer
set search_path = public
as $$
  select o.id, o.name, t.id, t.name,
    (select p.name from public.profiles p where p.team_id = t.id and p.role = 'team_admin' limit 1)
  from public.organizations o
  join public.teams t on t.org_id = o.id
  where o.org_code = upper(p_org_code)
  order by t.created_at asc;
$$;

create or replace function public.join_organization(p_org_code text, p_team_id uuid, p_name text, p_title text default null)
returns table (org_id uuid, team_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'this account already belongs to an organization';
  end if;

  select o.id into v_org_id
  from public.organizations o
  where o.org_code = upper(p_org_code);

  if v_org_id is null then
    raise exception 'organization not found';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.org_id = v_org_id) then
    raise exception 'team not found in this organization';
  end if;

  insert into public.profiles (id, org_id, team_id, name, title, role)
  values (auth.uid(), v_org_id, p_team_id, p_name, p_title, 'employee');

  return query select v_org_id, p_team_id, 'employee'::text;
end;
$$;

-- Owner-only: add a new team and optionally promote an existing member to
-- be its team_admin in the same step.
create or replace function public.create_team(p_name text, p_admin_profile_id uuid default null)
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
  select org_id, role into v_org_id, v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can create teams';
  end if;

  insert into public.teams (org_id, name) values (v_org_id, p_name) returning id into v_team_id;

  if p_admin_profile_id is not null then
    update public.profiles
    set role = 'team_admin', team_id = v_team_id
    where id = p_admin_profile_id and org_id = v_org_id;
  end if;

  return v_team_id;
end;
$$;

-- Employee (or anyone on the task's team, for whole-team tasks) marks a task
-- complete/incomplete with optional proof. Runs as security definer so we can
-- verify authority server-side instead of trusting the client.
create or replace function public.set_task_completion(
  p_task_id uuid,
  p_completed boolean,
  p_note text default null,
  p_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_my_profile_id uuid := auth.uid();
  v_my_team_id uuid;
begin
  select team_id into v_my_team_id from public.profiles where id = v_my_profile_id;
  select * into v_task from public.tasks where id = p_task_id;

  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if v_task.team_id is distinct from v_my_team_id then
    raise exception 'not your team''s task';
  end if;
  if v_task.assignee_id is not null and v_task.assignee_id is distinct from v_my_profile_id then
    raise exception 'this task is not assigned to you';
  end if;

  update public.tasks
  set completed = p_completed,
      completed_by = case when p_completed then v_my_profile_id else null end,
      completed_at = case when p_completed then now() else null end,
      proof_note = case when p_completed then p_note else null end,
      proof_photo_url = case when p_completed then p_photo_url else null end
  where id = p_task_id;
end;
$$;

grant execute on function public.create_organization(text, text, text) to authenticated;
grant execute on function public.get_org_by_code(text) to authenticated;
grant execute on function public.join_organization(text, uuid, text, text) to authenticated;
grant execute on function public.create_team(text, uuid) to authenticated;
grant execute on function public.set_task_completion(uuid, boolean, text, text) to authenticated;

-- ── Storage bucket for proof photos ───────────────────────────────────

insert into storage.buckets (id, name, public)
values ('task-proofs', 'task-proofs', true)
on conflict (id) do nothing;

create policy "org members can upload their own proof photos"
  on storage.objects for insert
  with check (
    bucket_id = 'task-proofs'
    and (select org_id::text from public.profiles where id = auth.uid()) = (storage.foldername(name))[1]
  );

create policy "anyone can read proof photos (bucket is public)"
  on storage.objects for select
  using (bucket_id = 'task-proofs');
