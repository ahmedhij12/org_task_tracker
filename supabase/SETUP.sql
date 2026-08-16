-- OrgTasks — full setup script. Safe to run repeatedly: it drops
-- everything belonging to this app first, then rebuilds it from scratch in
-- its final, correct form. This replaces the old numbered migration files
-- (0000-0005) — just run THIS one file whenever the schema needs to be
-- (re)applied during testing. Also wipes all data and test auth accounts,
-- so you always start from a clean slate.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

-- ── Clean slate ─────────────────────────────────────────────────────

drop table if exists public.tasks cascade;
drop table if exists public.profiles cascade;
drop table if exists public.teams cascade;
drop table if exists public.organizations cascade;
drop table if exists public.login_lookup_attempts cascade;
drop table if exists public.org_lookup_attempts cascade;

drop function if exists public.my_org_id() cascade;
drop function if exists public.my_role() cascade;
drop function if exists public.my_team_id() cascade;
drop function if exists public.generate_org_code(text) cascade;
drop function if exists public.get_org_by_code(text) cascade;
drop function if exists public.create_organization(text, text, text, text) cascade;
drop function if exists public.join_organization(text, uuid, text, text, text) cascade;
drop function if exists public.get_login_email(text, text) cascade;
drop function if exists public.create_team(text, uuid) cascade;
drop function if exists public.set_task_completion(uuid, boolean, text, text) cascade;

drop policy if exists "org members can upload their own proof photos" on storage.objects;
drop policy if exists "anyone can read proof photos (bucket is public)" on storage.objects;
delete from storage.objects where bucket_id = 'task-proofs';
delete from storage.buckets where id = 'task-proofs';

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
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  title text,
  username text,
  role text not null check (role in ('owner', 'team_admin', 'employee')),
  created_at timestamptz not null default now()
);

create unique index profiles_org_username_unique_idx
  on public.profiles (org_id, lower(username));

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
  proof_photo_url text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete cascade
);

create index tasks_team_id_idx on public.tasks(team_id);
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

create table public.org_lookup_attempts (
  id bigint generated always as identity primary key,
  org_code text not null,
  attempted_at timestamptz not null default now()
);

create index org_lookup_attempts_idx on public.org_lookup_attempts (org_code, attempted_at);

alter table public.organizations enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
-- No policies on these two on purpose — only the SECURITY DEFINER
-- functions (running as owner) can touch them, never clients directly.
alter table public.login_lookup_attempts enable row level security;
alter table public.org_lookup_attempts enable row level security;

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

create function public.my_team_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid();
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
  with check (id = auth.uid() and org_id = public.my_org_id() and role = public.my_role() and team_id is not distinct from public.my_team_id());

create policy "owner can manage roles and team assignment in their org"
  on public.profiles for update
  using (org_id = public.my_org_id() and public.my_role() = 'owner');

create policy "team members and the owner can read that team's tasks"
  on public.tasks for select
  using (
    org_id = public.my_org_id()
    and (public.my_role() = 'owner' or team_id = public.my_team_id())
  );

create policy "team admin or owner can create tasks for their own team"
  on public.tasks for insert
  with check (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
    )
  );

create policy "team admin or owner can edit their team's tasks"
  on public.tasks for update
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
    )
  );

create policy "team admin or owner can delete their team's tasks"
  on public.tasks for delete
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
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

create function public.get_org_by_code(p_org_code text)
returns table (org_id uuid, org_name text, team_id uuid, team_name text, admin_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_code text := upper(p_org_code);
  v_recent int;
begin
  select count(*) into v_recent
  from public.org_lookup_attempts
  where org_code = v_org_code and attempted_at > now() - interval '15 minutes';

  if v_recent >= 20 then
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;

  insert into public.org_lookup_attempts (org_code) values (v_org_code);

  return query
    select o.id, o.name, t.id, t.name,
      (select p.name from public.profiles p where p.team_id = t.id and p.role = 'team_admin' limit 1)
    from public.organizations o
    join public.teams t on t.org_id = o.id
    where o.org_code = v_org_code
    order by t.created_at asc;
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

  insert into public.profiles (id, org_id, team_id, name, title, username, role)
  values (auth.uid(), v_org_id, v_team_id, p_owner_name, 'Owner', p_username, 'owner');

  return query select v_org_id, v_org_code, v_team_id;
end;
$$;

create function public.join_organization(p_org_code text, p_team_id uuid, p_name text, p_username text, p_title text default null)
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

  select o.id into v_org_id from public.organizations o where o.org_code = upper(p_org_code);

  if v_org_id is null then
    raise exception 'organization not found';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.org_id = v_org_id) then
    raise exception 'team not found in this organization';
  end if;
  if exists (select 1 from public.profiles where org_id = v_org_id and lower(username) = lower(p_username)) then
    raise exception 'that username is already taken in this organization';
  end if;

  insert into public.profiles (id, org_id, team_id, name, title, username, role)
  values (auth.uid(), v_org_id, p_team_id, p_name, p_title, p_username, 'employee');

  return query select v_org_id, p_team_id, 'employee'::text;
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

  select u.email into v_email
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  join auth.users u on u.id = p.id
  where o.org_code = v_org_code
    and lower(p.username) = v_username
  limit 1;

  return v_email;
end;
$$;

create function public.create_team(p_name text, p_admin_profile_id uuid default null)
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

create function public.set_task_completion(
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

grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.get_org_by_code(text) to authenticated;
grant execute on function public.join_organization(text, uuid, text, text, text) to authenticated;
grant execute on function public.get_login_email(text, text) to anon, authenticated;
grant execute on function public.create_team(text, uuid) to authenticated;
grant execute on function public.set_task_completion(uuid, boolean, text, text) to authenticated;

-- ── Storage bucket for proof photos ───────────────────────────────────

insert into storage.buckets (id, name, public) values ('task-proofs', 'task-proofs', true);

create policy "org members can upload their own proof photos"
  on storage.objects for insert
  with check (
    bucket_id = 'task-proofs'
    and public.my_org_id()::text = (storage.foldername(name))[1]
  );

create policy "anyone can read proof photos (bucket is public)"
  on storage.objects for select
  using (bucket_id = 'task-proofs');
