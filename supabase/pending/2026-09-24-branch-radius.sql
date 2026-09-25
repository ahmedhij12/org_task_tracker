-- 2026-09-24, Control panel phase 1. Change a branch's check-in distance
-- WITHOUT moving its pin (set_team_location needs a lat/lng, so the distance
-- could only change by re-saving the map). p_team_id null = every branch in
-- the caller's org — the control panel's "set all".
-- The distance only ever FLAGS a record signed outside it; nothing is blocked.
create or replace function public.set_branch_radius(p_team_id uuid, p_radius_m int)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'only an admin can change the check-in distance';
  end if;
  if p_radius_m is null or p_radius_m not between 5 and 2000 then
    raise exception 'distance must be between 5 and 2000 metres';
  end if;

  update public.teams
     set radius_m = p_radius_m
   where org_id = public.my_org_id()
     and (p_team_id is null or id = p_team_id);
  get diagnostics v_count = row_count;

  if p_team_id is not null and v_count = 0 then
    raise exception 'branch not found';
  end if;
  return v_count;
end; $$;

grant execute on function public.set_branch_radius(uuid, int) to authenticated;
