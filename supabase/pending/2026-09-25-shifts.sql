-- 2026-09-25. Shifts (spec section 3): the branch manager sets each of his
-- supervisors to AM, PM or OFF, one day at a time or a week ahead. This is
-- what makes the warnings fair — a man who is off is never warned.
-- Additive: nothing reads it until the app update and the warnings.
-- Apply with psql -1.

create table if not exists public.shifts (
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  shift text not null check (shift in ('AM', 'PM', 'OFF')),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (team_id, profile_id, day)
);
create index if not exists shifts_team_day on public.shifts (team_id, day);

alter table public.shifts enable row level security;
drop policy if exists "read shifts" on public.shifts;
-- Admins and the hygiene auditor read every branch; everyone else their own.
create policy "read shifts" on public.shifts for select using (
  exists (select 1 from public.teams t where t.id = shifts.team_id and t.org_id = public.my_org_id())
  and (public.sees_all_branches() or team_id = any(public.my_team_ids()))
);
revoke all on public.shifts from anon, authenticated;
grant select on public.shifts to authenticated;

-- Set (or, with a null shift, clear) one supervisor's shift on one day.
-- The branch's own manager or an admin; only for that branch's supervisors;
-- from yesterday up to two weeks ahead, in the branch's own calendar.
create or replace function public.set_shift(p_team_id uuid, p_profile_id uuid, p_day date, p_shift text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); v_today date;
begin
  if not (v_role = 'owner' or (v_role = 'team_admin' and p_team_id = any(public.my_team_ids()))) then
    raise exception 'only this branch''s manager or an admin can set shifts';
  end if;
  if not exists (
    select 1 from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
    where pt.team_id = p_team_id and pt.profile_id = p_profile_id and p.role = 'employee'
      and p.org_id = public.my_org_id() and p.deleted_at is null
  ) then
    raise exception 'that supervisor is not at this branch';
  end if;
  select (now() at time zone coalesce(timezone, 'Asia/Baghdad'))::date into v_today from public.teams where id = p_team_id;
  if p_day < v_today - 1 or p_day > v_today + 14 then
    raise exception 'shifts can be set from yesterday up to two weeks ahead';
  end if;
  if p_shift is null then
    delete from public.shifts where team_id = p_team_id and profile_id = p_profile_id and day = p_day;
    return;
  end if;
  if p_shift not in ('AM', 'PM', 'OFF') then raise exception 'a shift is AM, PM or OFF'; end if;
  insert into public.shifts (team_id, profile_id, day, shift, set_by)
  values (p_team_id, p_profile_id, p_day, p_shift, auth.uid())
  on conflict (team_id, profile_id, day) do update set shift = excluded.shift, set_by = auth.uid(), set_at = now();
end; $$;
revoke all on function public.set_shift(uuid, uuid, date, text) from public, anon;
grant execute on function public.set_shift(uuid, uuid, date, text) to authenticated;
