-- Adds a username to profiles and a way to sign in with
-- Organization ID + Username + Password instead of retyping an email.
-- Supabase Auth only signs in by email, so a SECURITY DEFINER RPC resolves
-- (org_code, username) -> email server-side, then the client calls the
-- normal signInWithPassword with that email.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run.

-- create_organization/join_organization are gaining a new required parameter
-- (p_username), which Postgres treats as a distinct overload rather than a
-- replacement — drop the old signatures first so the client can't accidentally
-- call a stale version that skips setting a username.
drop function if exists public.create_organization(text, text, text);
drop function if exists public.join_organization(text, uuid, text, text);

alter table public.profiles add column username text;

-- Case-insensitive uniqueness per org (two different orgs can each have
-- their own "ahmed" without colliding).
create unique index profiles_org_username_unique_idx
  on public.profiles (org_id, lower(username));

create or replace function public.get_login_email(p_org_code text, p_username text)
returns text
language sql stable security definer set search_path = public as $$
  select u.email
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  join auth.users u on u.id = p.id
  where o.org_code = upper(p_org_code)
    and lower(p.username) = lower(p_username)
  limit 1;
$$;

grant execute on function public.get_login_email(text, text) to anon, authenticated;

-- Update create_organization / join_organization to also store a username.

create or replace function public.create_organization(p_org_name text, p_owner_name text, p_username text, p_team_name text default 'Main Team')
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

  insert into public.profiles (id, org_id, team_id, name, title, username, role)
  values (auth.uid(), v_org_id, v_team_id, p_owner_name, 'Owner', p_username, 'owner');

  return query select v_org_id, v_org_code, v_team_id;
end;
$$;

create or replace function public.join_organization(p_org_code text, p_team_id uuid, p_name text, p_username text, p_title text default null)
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
  if exists (select 1 from public.profiles where org_id = v_org_id and lower(username) = lower(p_username)) then
    raise exception 'that username is already taken in this organization';
  end if;

  insert into public.profiles (id, org_id, team_id, name, title, username, role)
  values (auth.uid(), v_org_id, p_team_id, p_name, p_title, p_username, 'employee');

  return query select v_org_id, p_team_id, 'employee'::text;
end;
$$;

grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.join_organization(text, uuid, text, text, text) to authenticated;
