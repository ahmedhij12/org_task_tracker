-- NOT YET APPLIED (2026-09-22). Tighten the "at the branch" circle to 15 m.
-- Records outside it are flagged with the distance, never blocked, because
-- GPS indoors is often only accurate to 20-50 m.
alter table public.teams alter column radius_m set default 15;
update public.teams set radius_m = 15 where radius_m = 40;
alter table public.teams drop constraint if exists teams_radius_range;
alter table public.teams add constraint teams_radius_range check (radius_m between 5 and 2000) not valid;
