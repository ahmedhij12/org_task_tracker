-- 2026-09-25. Checklist deadlines (his answer: "make it in the control panel
-- and I will control it") and the shift schedule deciding who sends it.
--
-- Per branch, the admin chooses:
--   per shift — an AM deadline and a PM deadline; the supervisor on that shift sends it
--   per day   — one deadline; anyone on duty sends it
-- plus a grace in minutes. No rule = no deadline (nothing changes for a branch
-- until an admin sets one), so applying this file is additive.
--
-- A restaurant day runs 05:00 to 05:00 in the branch's clock: a PM deadline of
-- 01:00 belongs to the evening before, and so does that night's PM shift.
--
-- Who is responsible for a deadline (spec section 4): the supervisor scheduled
-- on that shift; if nobody is scheduled on it, every supervisor at the branch.
-- The "late" warning also goes to the branch manager.
--
-- Each supervisor checklist is stamped when it is saved (a trigger, so the
-- live app needs no change): which deadline it answered, the deadline itself
-- (due_at) and whether it was late (was_late) — frozen on the row, so moving a
-- deadline later never rewrites history. History already shows was_late/due_at.
-- The late reason travels in the completion's note.
--
-- Apply with psql -1.

-- ---------------------------------------------------------------- the rules
create table if not exists public.checklist_rules (
  team_id uuid primary key references public.teams(id) on delete cascade,
  mode text not null check (mode in ('shift', 'day')),
  am_due time,
  pm_due time,
  day_due time,
  grace_min int not null default 30 check (grace_min between 0 and 240),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check ((mode = 'shift' and am_due is not null and pm_due is not null) or (mode = 'day' and day_due is not null))
);
alter table public.checklist_rules enable row level security;
drop policy if exists "read checklist rules" on public.checklist_rules;
create policy "read checklist rules" on public.checklist_rules for select using (
  exists (select 1 from public.teams t where t.id = checklist_rules.team_id and t.org_id = public.my_org_id())
  and (public.sees_all_branches() or team_id = any(public.my_team_ids()))
);
revoke all on public.checklist_rules from anon, authenticated;
grant select on public.checklist_rules to authenticated;

-- Set one branch's rule, or every branch's (null team). A null mode removes
-- the deadline. Admins only.
create or replace function public.set_checklist_rule(
  p_team_id uuid, p_mode text, p_am_due time, p_pm_due time, p_day_due time, p_grace_min int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'only an admin can change the checklist deadlines';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and org_id = public.my_org_id()) then
    raise exception 'branch not found';
  end if;
  if p_mode is null then
    delete from public.checklist_rules r using public.teams t
     where t.id = r.team_id and t.org_id = public.my_org_id() and (p_team_id is null or r.team_id = p_team_id);
    return;
  end if;
  if p_mode not in ('shift', 'day') then raise exception 'choose per shift or per day'; end if;
  if p_mode = 'shift' and (p_am_due is null or p_pm_due is null) then raise exception 'set both the AM and the PM deadline'; end if;
  if p_mode = 'day' and p_day_due is null then raise exception 'set the deadline'; end if;
  if p_grace_min is null or p_grace_min < 0 or p_grace_min > 240 then raise exception 'the grace is 0 to 240 minutes'; end if;
  insert into public.checklist_rules (team_id, mode, am_due, pm_due, day_due, grace_min, updated_by)
  select t.id, p_mode,
         case when p_mode = 'shift' then p_am_due end,
         case when p_mode = 'shift' then p_pm_due end,
         case when p_mode = 'day' then p_day_due end,
         p_grace_min, auth.uid()
    from public.teams t
   where t.org_id = public.my_org_id() and (p_team_id is null or t.id = p_team_id)
  on conflict (team_id) do update set
    mode = excluded.mode, am_due = excluded.am_due, pm_due = excluded.pm_due, day_due = excluded.day_due,
    grace_min = excluded.grace_min, updated_at = now(), updated_by = auth.uid();
end; $$;
revoke all on function public.set_checklist_rule(uuid, text, time, time, time, int) from public, anon;
grant execute on function public.set_checklist_rule(uuid, text, time, time, time, int) to authenticated;

-- ------------------------------------------------------------ the clock
-- The restaurant day a moment belongs to (05:00 to 05:00, branch clock).
create or replace function public.branch_day_of(p_tz text, p_at timestamptz) returns date
language sql immutable as $$
  select ((p_at at time zone coalesce(p_tz, 'Asia/Baghdad')) - interval '5 hours')::date;
$$;

-- The moment a deadline falls on for a restaurant day: a time before 05:00
-- is after midnight, so it lands on the next calendar date.
create or replace function public.checklist_due_ts(p_day date, p_time time, p_tz text) returns timestamptz
language sql immutable as $$
  select ((p_day + case when p_time < time '05:00' then 1 else 0 end) + p_time) at time zone coalesce(p_tz, 'Asia/Baghdad');
$$;

-- The stamp on each supervisor checklist.
alter table public.task_completions add column if not exists checklist_slot text;
alter table public.task_completions add column if not exists checklist_day date;
create index if not exists task_completions_checklist_slot
  on public.task_completions (team_id, checklist_day, checklist_slot) where checklist_slot is not null;

create or replace function public.checklist_slot_filled(p_team uuid, p_day date, p_slot text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_completions c
     where c.team_id = p_team and c.checklist_day = p_day and c.checklist_slot = p_slot and c.action = 'completed'
  );
$$;

-- Which deadline a checklist from this person, now, answers.
--   per day: the day's one deadline.
--   per shift: his own shift (AM/PM) from the schedule; not scheduled (or a
--   manager filling in) = the first deadline still open, so a missed AM is
--   answered late rather than hidden behind an on-time PM.
-- Nothing (no rows) when there is no rule or that deadline is already met —
-- an extra checklist has no deadline.
create or replace function public.checklist_slot_for(p_team uuid, p_actor uuid, p_at timestamptz)
returns table (slot text, branch_day date, due_at timestamptz, late boolean, grace_min int)
language plpgsql stable security definer set search_path = public as $$
declare r public.checklist_rules; v_tz text; v_day date; v_shift text; v_slot text; v_due timestamptz;
begin
  select * into r from public.checklist_rules where team_id = p_team;
  if not found then return; end if;
  select coalesce(timezone, 'Asia/Baghdad') into v_tz from public.teams where id = p_team;
  v_day := public.branch_day_of(v_tz, p_at);

  if r.mode = 'day' then
    v_slot := 'DAY';
  else
    select s.shift into v_shift from public.shifts s where s.team_id = p_team and s.profile_id = p_actor and s.day = v_day;
    if v_shift in ('AM', 'PM') then v_slot := v_shift;
    elsif not public.checklist_slot_filled(p_team, v_day, 'AM') then v_slot := 'AM';
    else v_slot := 'PM';
    end if;
  end if;
  if public.checklist_slot_filled(p_team, v_day, v_slot) then return; end if;

  v_due := public.checklist_due_ts(v_day, case v_slot when 'AM' then r.am_due when 'PM' then r.pm_due else r.day_due end, v_tz);
  return query select v_slot, v_day, v_due, p_at > v_due + make_interval(mins => r.grace_min), r.grace_min;
end; $$;

-- The app asks before saving, so a late checklist can ask for the reason.
create or replace function public.my_checklist_slot(p_team uuid)
returns table (slot text, branch_day date, due_at timestamptz, late boolean, grace_min int)
language sql stable security definer set search_path = public as $$
  select * from public.checklist_slot_for(p_team, auth.uid(), now())
   where p_team = any(public.my_team_ids());
$$;
revoke all on function public.my_checklist_slot(uuid) from public, anon;
grant execute on function public.my_checklist_slot(uuid) to authenticated;

-- Stamp every supervisor checklist as it is saved.
create or replace function public.stamp_checklist_deadline() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if new.action is distinct from 'completed' then return new; end if;
  if not exists (
    select 1 from public.tasks t join public.checklist_templates ct on ct.id = t.template_id
     where t.id = new.task_id and ct.assign_to_role = 'employee' and not coalesce(t.is_audit, false)
  ) then return new; end if;
  select * into s from public.checklist_slot_for(new.team_id, new.actor_id, coalesce(new.created_at, now()));
  if s.slot is null then return new; end if;
  new.checklist_slot := s.slot;
  new.checklist_day := s.branch_day;
  new.due_at := s.due_at;
  new.was_late := s.late;
  return new;
end; $$;
drop trigger if exists stamp_checklist_deadline on public.task_completions;
create trigger stamp_checklist_deadline before insert on public.task_completions
  for each row execute function public.stamp_checklist_deadline();

-- Today's deadlines at a branch, for the dashboards: each deadline, whether
-- it is met (by whom, when, late or not) and who is on it.
create or replace function public.checklist_today(p_team uuid)
returns table (slot text, due_at timestamptz, grace_min int, done_at timestamptz, done_by text, was_late boolean, on_shift text[])
language plpgsql stable security definer set search_path = public as $$
declare r public.checklist_rules; v_tz text; v_day date;
begin
  if not (public.sees_all_branches() or p_team = any(public.my_team_ids())) then return; end if;
  select * into r from public.checklist_rules where team_id = p_team;
  if not found then return; end if;
  select coalesce(timezone, 'Asia/Baghdad') into v_tz from public.teams where id = p_team and org_id = public.my_org_id();
  if v_tz is null then return; end if;
  v_day := public.branch_day_of(v_tz, now());
  return query
    select sl.s,
           public.checklist_due_ts(v_day, sl.t, v_tz),
           r.grace_min,
           c.created_at,
           p.name,
           c.was_late,
           array(select pp.name from public.shifts sh join public.profiles pp on pp.id = sh.profile_id
                  where sh.team_id = p_team and sh.day = v_day and pp.deleted_at is null
                    and ((sl.s = 'DAY' and sh.shift in ('AM', 'PM')) or sh.shift = sl.s)
                  order by pp.name)
      from (values ('AM', r.am_due, 1), ('PM', r.pm_due, 2), ('DAY', r.day_due, 3)) as sl(s, t, o)
      left join lateral (
        select c2.created_at, c2.actor_id, c2.was_late from public.task_completions c2
         where c2.team_id = p_team and c2.checklist_day = v_day and c2.checklist_slot = sl.s and c2.action = 'completed'
         order by c2.created_at limit 1
      ) c on true
      left join public.profiles p on p.id = c.actor_id
     where sl.t is not null
     order by sl.o;
end; $$;
revoke all on function public.checklist_today(uuid) from public, anon;
grant execute on function public.checklist_today(uuid) to authenticated;

-- --------------------------------------------------------- the schedule
-- The manager's schedule: one supervisor on one shift for a run of days, and
-- every other supervisor at the branch on the other shift ("Oday AM for 7
-- days makes Mohamad PM"). OFF changes only the chosen person.
create or replace function public.set_shift_range(p_team_id uuid, p_profile_id uuid, p_from date, p_to date, p_shift text)
returns int language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); v_today date; v_other text; d date; n int := 0;
begin
  if not (v_role = 'owner' or (v_role = 'team_admin' and p_team_id = any(public.my_team_ids()))) then
    raise exception 'only this branch''s manager or an admin can set shifts';
  end if;
  if p_shift not in ('AM', 'PM', 'OFF') then raise exception 'a shift is AM, PM or OFF'; end if;
  if not exists (
    select 1 from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
    where pt.team_id = p_team_id and pt.profile_id = p_profile_id and p.role = 'employee'
      and p.org_id = public.my_org_id() and p.deleted_at is null
  ) then
    raise exception 'that supervisor is not at this branch';
  end if;
  select (now() at time zone coalesce(timezone, 'Asia/Baghdad'))::date into v_today from public.teams where id = p_team_id;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'choose the first and the last day'; end if;
  if p_from < v_today - 1 or p_to > v_today + 31 then
    raise exception 'shifts can be set from yesterday up to a month ahead';
  end if;
  v_other := case p_shift when 'AM' then 'PM' when 'PM' then 'AM' end;

  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    insert into public.shifts (team_id, profile_id, day, shift, set_by)
    values (p_team_id, p_profile_id, d, p_shift, auth.uid())
    on conflict (team_id, profile_id, day) do update set shift = excluded.shift, set_by = auth.uid(), set_at = now();
    if v_other is not null then
      insert into public.shifts (team_id, profile_id, day, shift, set_by)
      select p_team_id, p.id, d, v_other, auth.uid()
        from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
       where pt.team_id = p_team_id and p.role = 'employee' and p.deleted_at is null and p.id <> p_profile_id
      on conflict (team_id, profile_id, day) do update set shift = excluded.shift, set_by = auth.uid(), set_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.set_shift_range(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.set_shift_range(uuid, uuid, date, date, text) to authenticated;

-- ------------------------------------------------------- the reminders
create table if not exists public.checklist_pings (
  team_id uuid not null references public.teams(id) on delete cascade,
  branch_day date not null,
  slot text not null,           -- AM / PM / DAY, or '-' for the schedule reminder
  kind text not null,           -- due / late / schedule
  sent_at timestamptz not null default now(),
  primary key (team_id, branch_day, slot, kind)
);
alter table public.checklist_pings enable row level security;
revoke all on public.checklist_pings from anon, authenticated;

-- Who hears about one deadline: the supervisors on that shift (per day:
-- anyone on AM or PM); nobody on it = every supervisor at the branch.
-- The late warning adds the branch manager.
create or replace function public.checklist_recipients(p_team uuid, p_day date, p_slot text, p_with_managers boolean)
returns uuid[] language sql stable security definer set search_path = public as $$
  with sups as (
    select p.id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
     where pt.team_id = p_team and p.role = 'employee' and p.deleted_at is null
  ), sched as (
    select s.profile_id as id from public.shifts s
     where s.team_id = p_team and s.day = p_day and s.profile_id in (select id from sups)
       and ((p_slot = 'DAY' and s.shift in ('AM', 'PM')) or s.shift = p_slot)
  )
  select array(
    select id from sched
    union select id from sups where not exists (select 1 from sched)
    union select p.id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
           where p_with_managers and pt.team_id = p_team and p.role = 'team_admin' and p.deleted_at is null
  );
$$;

create or replace function public.push_to_profiles(p_profiles uuid[], p_title text, p_body text, p_tag text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs from public.web_push_subscriptions s where s.profile_id = any(p_profiles);
  if jsonb_array_length(v_subs) = 0 then return false; end if;
  perform net.http_post(
    url := 'https://bd-push.ahmedhijazi09.workers.dev',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('subscriptions', v_subs, 'title', p_title, 'body', p_body,
                               'url', 'https://bdaudit.hijazionline.com/', 'tag', p_tag)
  );
  return true;
end; $$;
revoke all on function public.push_to_profiles(uuid[], text, text, text) from public, anon, authenticated;

-- Every 5 minutes: at a deadline that is not met, remind the people on it;
-- when the grace runs out, warn them and the branch manager. And in the
-- evening, a manager whose schedule has run out (nobody set for tomorrow) is
-- told to set it. Each message once per branch per day, and only within the
-- hour after its moment, so a restart never fires old ones.
create or replace function public.send_due_checklist_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; sl record; v_day date; v_due timestamptz; v_kind text; v_to uuid[]; v_sent int := 0;
        v_local timestamp; v_label text;
begin
  for r in
    select t.id as team_id, t.name as branch, coalesce(t.timezone, 'Asia/Baghdad') as tz,
           cr.mode, cr.am_due, cr.pm_due, cr.day_due, cr.grace_min
      from public.checklist_rules cr join public.teams t on t.id = cr.team_id
  loop
    v_day := public.branch_day_of(r.tz, now());
    for sl in select * from (values ('AM', r.am_due), ('PM', r.pm_due), ('DAY', r.day_due)) as x(s, t) where x.t is not null loop
      continue when public.checklist_slot_filled(r.team_id, v_day, sl.s);
      v_due := public.checklist_due_ts(v_day, sl.t, r.tz);
      v_kind := case
        when now() >= v_due + make_interval(mins => r.grace_min) and now() < v_due + make_interval(mins => r.grace_min) + interval '1 hour' then 'late'
        when now() >= v_due and now() < v_due + interval '1 hour' and now() < v_due + make_interval(mins => r.grace_min) then 'due'
      end;
      continue when v_kind is null;
      continue when exists (select 1 from public.checklist_pings p
                             where p.team_id = r.team_id and p.branch_day = v_day and p.slot = sl.s and p.kind = v_kind);
      v_to := public.checklist_recipients(r.team_id, v_day, sl.s, v_kind = 'late');
      v_label := case sl.s when 'AM' then 'المناوبة الصباحية' when 'PM' then 'المناوبة المسائية' else 'قائمة اليوم' end;
      if public.push_to_profiles(
           v_to,
           case v_kind when 'due' then 'حان وقت قائمة الفحص' else 'قائمة الفحص متأخرة' end,
           r.branch || ' · ' || v_label || ' · الموعد ' || to_char(v_due at time zone r.tz, 'HH12:MI AM')
             || case v_kind when 'due' then ' · أمامك ' || r.grace_min || ' دقيقة' else ' · أرسلها الآن واكتب سبب التأخير' end,
           'checklist-' || r.team_id || '-' || v_day || '-' || sl.s || '-' || v_kind) then
        v_sent := v_sent + 1;
      end if;
      insert into public.checklist_pings (team_id, branch_day, slot, kind) values (r.team_id, v_day, sl.s, v_kind)
      on conflict do nothing;
    end loop;

    -- The schedule has run out: 8 PM, nobody at the branch has a shift for tomorrow.
    continue when r.mode <> 'shift';
    v_local := now() at time zone r.tz;
    continue when not (v_local::time >= time '20:00' and v_local::time < time '21:00');
    continue when not exists (select 1 from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
                               where pt.team_id = r.team_id and p.role = 'employee' and p.deleted_at is null);
    continue when exists (select 1 from public.shifts s where s.team_id = r.team_id and s.day = v_local::date + 1);
    continue when exists (select 1 from public.checklist_pings p
                           where p.team_id = r.team_id and p.branch_day = v_local::date and p.slot = '-' and p.kind = 'schedule');
    v_to := array(select p.id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
                   where pt.team_id = r.team_id and p.role = 'team_admin' and p.deleted_at is null);
    if public.push_to_profiles(v_to, 'جدول المناوبات انتهى', r.branch || ' · لم تُحدَّد مناوبات الغد. افتح الموظفون ← الجدول',
                               'schedule-' || r.team_id || '-' || v_local::date) then
      v_sent := v_sent + 1;
    end if;
    insert into public.checklist_pings (team_id, branch_day, slot, kind) values (r.team_id, v_local::date, '-', 'schedule')
    on conflict do nothing;
  end loop;
  return v_sent;
end; $$;
revoke all on function public.send_due_checklist_reminders() from public, anon, authenticated;

select cron.unschedule('checklist-reminders') where exists (select 1 from cron.job where jobname = 'checklist-reminders');
select cron.schedule('checklist-reminders', '*/5 * * * *', 'select public.send_due_checklist_reminders()');
