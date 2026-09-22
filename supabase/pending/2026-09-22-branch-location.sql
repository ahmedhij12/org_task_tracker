-- NOT YET APPLIED (2026-09-22). A branch's location, pinned on a map by the
-- admin when the branch is created (the admin is at head office, not at the
-- branch, so this is a map pin — never "use my current location").
-- A radius gives the supervisor room: GPS drifts indoors, so being within
-- ~40 m of the pin counts as being at the branch.
alter table public.teams add column if not exists lat double precision;
alter table public.teams add column if not exists lng double precision;
alter table public.teams add column if not exists radius_m int not null default 40;

alter table public.teams add constraint teams_lat_range check (lat is null or lat between -90 and 90) not valid;
alter table public.teams add constraint teams_lng_range check (lng is null or lng between -180 and 180) not valid;
alter table public.teams add constraint teams_radius_range check (radius_m between 10 and 2000) not valid;

comment on column public.teams.radius_m is
  'How far from the pin still counts as "at the branch". Records outside it are flagged with the distance, never blocked — GPS indoors is unreliable.';

-- Owner sets or moves the pin.
create or replace function public.set_team_location(
  p_team_id uuid, p_lat double precision, p_lng double precision, p_radius_m int default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can set a branch location'; end if;
  if p_lat is null or p_lng is null then raise exception 'pin the branch on the map first'; end if;
  update public.teams
     set lat = p_lat, lng = p_lng,
         radius_m = coalesce(p_radius_m, radius_m)
   where id = p_team_id and org_id = public.my_org_id();
  if not found then raise exception 'branch not found'; end if;
end; $$;

grant execute on function public.set_team_location(uuid, double precision, double precision, int) to authenticated;

-- Straight-line metres between two points (haversine), for "how far from the
-- branch was this signed".
create or replace function public.meters_between(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision
) returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;
