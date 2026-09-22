-- NOT YET APPLIED (2026-09-22). Each branch carries its own timezone so a
-- record always displays at the time it happened AT THE BRANCH, whatever
-- timezone the viewer is in. Defaults to Baghdad (UTC+3, no DST).
alter table public.teams add column if not exists timezone text not null default 'Asia/Baghdad';

comment on column public.teams.timezone is
  'IANA timezone of this branch. Times are shown in the branch''s zone, not the viewer''s, so shift times and the marination clock read correctly from anywhere.';

-- Owner can set it.
create or replace function public.set_team_timezone(p_team_id uuid, p_timezone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can change a branch timezone'; end if;
  if p_timezone is null or now() at time zone p_timezone is null then
    raise exception 'unknown timezone';
  end if;
  update public.teams set timezone = p_timezone
  where id = p_team_id and org_id = public.my_org_id();
end; $$;

grant execute on function public.set_team_timezone(uuid, text) to authenticated;
