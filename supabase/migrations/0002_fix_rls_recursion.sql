-- Fixes "infinite recursion detected in policy for relation profiles" (Postgres 42P17).
-- Root cause: policies looked up the caller's org_id/role/team_id via a subquery
-- on public.profiles itself, so evaluating the profiles SELECT policy required
-- re-evaluating the same policy to run that subquery — infinite loop. This broke
-- every policy on organizations/teams/profiles/tasks that referenced profiles.
--
-- Fix: SECURITY DEFINER helper functions run as the function owner (the table
-- owner here), which bypasses RLS for that one internal lookup — the standard
-- Supabase-recommended pattern for this exact problem.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

create or replace function public.my_org_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_team_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.my_org_id() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_team_id() to authenticated;

-- ── Replace every policy that queried profiles inline ──────────────────

drop policy if exists "org members can read their own org" on public.organizations;
create policy "org members can read their own org"
  on public.organizations for select
  using (id = public.my_org_id());

drop policy if exists "org members can read their org's teams" on public.teams;
create policy "org members can read their org's teams"
  on public.teams for select
  using (org_id = public.my_org_id());

drop policy if exists "org members can read profiles in their org" on public.profiles;
create policy "org members can read profiles in their org"
  on public.profiles for select
  using (org_id = public.my_org_id());

drop policy if exists "users can update their own display name" on public.profiles;
create policy "users can update their own display name"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = public.my_org_id() and role = public.my_role() and team_id is not distinct from public.my_team_id());

drop policy if exists "owner can manage roles and team assignment in their org" on public.profiles;
create policy "owner can manage roles and team assignment in their org"
  on public.profiles for update
  using (org_id = public.my_org_id() and public.my_role() = 'owner');

drop policy if exists "team members and the owner can read that team's tasks" on public.tasks;
create policy "team members and the owner can read that team's tasks"
  on public.tasks for select
  using (
    org_id = public.my_org_id()
    and (public.my_role() = 'owner' or team_id = public.my_team_id())
  );

drop policy if exists "team admin or owner can create tasks for their own team" on public.tasks;
create policy "team admin or owner can create tasks for their own team"
  on public.tasks for insert
  with check (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
    )
  );

drop policy if exists "team admin or owner can edit/delete their team's tasks" on public.tasks;
create policy "team admin or owner can edit/delete their team's tasks"
  on public.tasks for update
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
    )
  );

drop policy if exists "team admin or owner can delete their team's tasks" on public.tasks;
create policy "team admin or owner can delete their team's tasks"
  on public.tasks for delete
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'team_admin' and team_id = public.my_team_id())
    )
  );

-- storage.objects policy also queried profiles inline
drop policy if exists "org members can upload their own proof photos" on storage.objects;
create policy "org members can upload their own proof photos"
  on storage.objects for insert
  with check (
    bucket_id = 'task-proofs'
    and public.my_org_id()::text = (storage.foldername(name))[1]
  );
