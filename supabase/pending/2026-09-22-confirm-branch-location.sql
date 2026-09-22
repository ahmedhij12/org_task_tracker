-- NOT YET APPLIED (2026-09-22). The branch's location is confirmed by the
-- first staff member who opens the app AT the branch — their GPS is accurate
-- there, unlike an admin guessing a pin from head office.
--
-- Guards, so this can't go wrong later:
--   * only someone assigned to that branch (or the owner) may set it;
--   * it is set ONCE — a later staff member cannot move the branch;
--   * a poor GPS fix is refused, so a bad reading never becomes permanent;
--   * who set it and how accurate it was are recorded, and the owner can
--     always re-pin it on the map afterwards.

alter table public.teams
  add column if not exists location_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists location_set_at timestamptz,
  add column if not exists location_accuracy_m double precision;

comment on column public.teams.location_set_by is
  'Who confirmed the branch location from inside the branch. Null when the owner pinned it on the map.';

-- The worst GPS fix we will accept as a branch location.
create or replace function public.max_location_accuracy_m() returns int
language sql immutable as $$ select 100 $$;

create or replace function public.confirm_branch_location(
  p_team_id uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision
) returns void language plpgsql security definer set search_path = public as $$
declare v_team public.teams; v_role text;
begin
  select * into v_team from public.teams where id = p_team_id and org_id = public.my_org_id();
  if v_team.id is null then raise exception 'branch not found'; end if;

  select role into v_role from public.profiles where id = auth.uid();

  -- Must actually work at this branch (the owner sets it from the map instead).
  if v_role <> 'owner' and not exists (
    select 1 from public.profile_teams pt where pt.profile_id = auth.uid() and pt.team_id = p_team_id
  ) then
    raise exception 'you are not assigned to this branch';
  end if;

  -- Set once. Moving a branch afterwards is the owner's job, on the map.
  if v_team.lat is not null and v_role <> 'owner' then
    raise exception 'this branch already has a location';
  end if;

  if p_lat is null or p_lng is null then raise exception 'no location received'; end if;
  if p_accuracy_m is not null and p_accuracy_m > public.max_location_accuracy_m() then
    raise exception 'the location is not accurate enough — try again outside or near a window';
  end if;

  update public.teams
     set lat = p_lat,
         lng = p_lng,
         location_set_by = auth.uid(),
         location_set_at = now(),
         location_accuracy_m = p_accuracy_m
   where id = p_team_id;
end; $$;

grant execute on function public.confirm_branch_location(uuid, double precision, double precision, double precision) to authenticated;

-- Which of my branches still need a location (drives the prompt on sign-in).
create or replace function public.my_branches_needing_location()
returns table (team_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name
  from public.teams t
  join public.profile_teams pt on pt.team_id = t.id
  where pt.profile_id = auth.uid()
    and t.org_id = public.my_org_id()
    and t.lat is null;
$$;

grant execute on function public.my_branches_needing_location() to authenticated;
