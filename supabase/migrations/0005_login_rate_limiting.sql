-- Fixes 3 issues found by security review of 0004:
--
-- 1. AUTH-ENUMERATION / INFO-DISCLOSURE: get_login_email() is callable by
--    anonymous users (it has to be — you're not signed in yet when you're
--    signing in) and returns a real email address for any guessed
--    (org_code, username) pair. With org codes now just 5 digits (100,000
--    possibilities), that guess space is small enough to brute-force in
--    practice, not just in theory. Same shape of problem exists in
--    get_org_by_code() (discloses org/team names to any authenticated
--    caller who guesses a code), just slightly less severe since it
--    requires an account. Fix: rate-limit both, in two dimensions —
--    per org_code (caps sweeping many usernames against one guessed org)
--    and per username (caps sweeping many org codes with one guessed
--    username, e.g. "admin"). This can't fully close a determined,
--    distributed attacker (Postgres can't see the real client IP behind
--    Supabase's connection pooler), but it raises the cost enormously for
--    the realistic case, without needing new infrastructure.
--
-- 2. LOGIC ERROR: generate_org_code() only checks for a collision before
--    handing the code back — it does not guard the actual insert. Two
--    concurrent create_organization() calls can both pass that check with
--    the same code moments apart, and the loser gets a raw Postgres
--    unique-violation error instead of a clean retry. Fix: wrap the
--    insert itself in a retry loop that catches unique_violation.
--
-- Paste into Supabase Studio -> SQL Editor -> New query -> Run.

create table if not exists public.login_lookup_attempts (
  id bigint generated always as identity primary key,
  org_code text not null,
  username text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists login_lookup_attempts_org_idx on public.login_lookup_attempts (org_code, attempted_at);
create index if not exists login_lookup_attempts_username_idx on public.login_lookup_attempts (username, attempted_at);

create table if not exists public.org_lookup_attempts (
  id bigint generated always as identity primary key,
  org_code text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists org_lookup_attempts_idx on public.org_lookup_attempts (org_code, attempted_at);

-- No policies defined on purpose: with RLS on and zero policies, only the
-- table owner (and SECURITY DEFINER functions, which run as the owner) can
-- touch these — clients never get direct access, only through the RPCs.
alter table public.login_lookup_attempts enable row level security;
alter table public.org_lookup_attempts enable row level security;

create or replace function public.get_login_email(p_org_code text, p_username text)
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

create or replace function public.get_org_by_code(p_org_code text)
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

grant execute on function public.get_login_email(text, text) to anon, authenticated;
grant execute on function public.get_org_by_code(text) to authenticated;

-- Fix 2: retry the whole generate+insert cycle on a genuine collision at
-- insert time, instead of trusting the pre-check alone.
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
      exit; -- insert succeeded, stop retrying
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not generate a unique Organization ID, please try again.';
      end if;
      -- loop again with a freshly generated code
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

grant execute on function public.create_organization(text, text, text, text) to authenticated;
