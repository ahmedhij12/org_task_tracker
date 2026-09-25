-- 2026-09-26. His live-test round 8 (screenshots of 2026-09-25 evening):
--   A. Access switches per person, set in Staff by an admin (control panel
--      first — Fatima, the hygiene auditor, gets it by his choice).
--   B. Checklist deadlines: checklists sent BEFORE a branch had a deadline
--      were never matched to one, so the dashboard said "Late" and the
--      reminders fired at people who had already sent it. Plus: excuse a late
--      checklist (with a trace), remind now, and the auditor hears about
--      every checklist that comes in.
--   C. Notifications: deleted / deactivated accounts kept getting a branch's
--      reminders (nothing filtered them out); one phone per account now holds
--      for notifications too; every phone reports its notification status so
--      the push test can show who is and is not reachable, and why.
--   D. Marination: the start time is the server's clock, like the removal;
--      the branch manager (or an admin) corrects it with a reason, kept for
--      the admin and the auditor to see.
-- Additive: nothing a live screen relies on changes shape, except
-- checklist_today (only this week's new dashboard card reads it; the new app
-- ships with this file). Apply with psql -1.

-- =================================================================== A.
-- Access, per person (his design, 2026-09-26): in Staff, next to Deactivate
-- and Delete, an admin flips a person's switches — "Control panel" on for
-- Fatima, off again later. No switch touched = the role's default, which is
-- exactly what the app did before this file.
create table if not exists public.profile_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null,
  allowed boolean not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, permission)
);
alter table public.profile_permissions enable row level security;
revoke all on public.profile_permissions from anon, authenticated;

-- Every switch, in the order the Staff sheet shows them.
create or replace function public.permission_keys() returns text[]
language sql immutable as $$
  select array['control_panel', 'excuse_late', 'edit_marination_start', 'checklist_alerts'];
$$;

-- What each role has before anyone flips a switch.
create or replace function public.permission_default(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_perm
    when 'control_panel' then p_role = 'owner'
    when 'excuse_late' then p_role in ('owner', 'hygiene_auditor')
    when 'edit_marination_start' then p_role in ('owner', 'team_admin')
    when 'checklist_alerts' then p_role = 'hygiene_auditor'
    else false
  end;
$$;

-- The super admin can always do everything; a notification is a choice, not
-- a power, so that one follows his own switch like anyone else's.
create or replace function public.profile_allows(p_profile uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.is_super_admin and p_perm <> 'checklist_alerts' then true
      else coalesce(
        (select pp.allowed from public.profile_permissions pp where pp.profile_id = p.id and pp.permission = p_perm),
        public.permission_default(p.role, p_perm))
    end
      from public.profiles p where p.id = p_profile and p.deleted_at is null and p.active
  ), false);
$$;
revoke all on function public.profile_allows(uuid, text) from public, anon, authenticated;

create or replace function public.has_permission(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.profile_allows(auth.uid(), p_perm);
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k), '{}') from unnest(public.permission_keys()) k where public.has_permission(k);
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- Who may flip someone's switches: an admin, for anyone who is not an admin;
-- the super admin, for any admin too. Never your own, never the super admin's.
create or replace function public.can_set_permissions_of(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select me.role = 'owner'
       and t.id <> me.id
       and t.org_id = me.org_id
       and t.deleted_at is null
       and not t.is_super_admin
       and (t.role <> 'owner' or me.is_super_admin)
      from public.profiles me, public.profiles t
     where me.id = auth.uid() and me.deleted_at is null and me.active and t.id = p_profile
  ), false);
$$;
revoke all on function public.can_set_permissions_of(uuid) from public, anon, authenticated;

-- The switches as the Staff sheet shows them: on/off, and whether that is
-- still the role's default.
create or replace function public.permissions_of(p_profile uuid)
returns table (permission text, allowed boolean, is_default boolean)
language sql stable security definer set search_path = public as $$
  select k.perm, public.profile_allows(p_profile, k.perm),
         not exists (select 1 from public.profile_permissions pp where pp.profile_id = p_profile and pp.permission = k.perm)
    from unnest(public.permission_keys()) with ordinality as k(perm, o)
   where public.can_set_permissions_of(p_profile)
   order by k.o;
$$;
revoke all on function public.permissions_of(uuid) from public, anon;
grant execute on function public.permissions_of(uuid) to authenticated;

create or replace function public.set_person_permission(p_profile uuid, p_perm text, p_allowed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_set_permissions_of(p_profile) then
    raise exception 'you cannot change what this person can do';
  end if;
  if not (p_perm = any(public.permission_keys())) then raise exception 'unknown permission'; end if;
  if p_allowed is null then raise exception 'on or off'; end if;
  insert into public.profile_permissions (profile_id, permission, allowed, updated_by)
  values (p_profile, p_perm, p_allowed, auth.uid())
  on conflict (profile_id, permission) do update
    set allowed = excluded.allowed, updated_by = auth.uid(), updated_at = now();
end; $$;
revoke all on function public.set_person_permission(uuid, text, boolean) from public, anon;
grant execute on function public.set_person_permission(uuid, text, boolean) to authenticated;

-- The control panel's writers: "an admin" becomes "whoever has the control
-- panel". Each body is the live one (pg_get_functiondef, 2026-09-26) with only
-- the check changed.
create or replace function public.set_iqd_per_point(p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_org_id uuid;
begin
  if not public.has_permission('control_panel') then
    raise exception 'only someone with the control panel can change the point rate';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'the rate must be a positive amount';
  end if;
  select org_id into v_org_id from public.profiles where id = auth.uid();
  update public.organizations set iqd_per_point = p_rate where id = v_org_id;
end; $$;

create or replace function public.set_branch_radius(p_team_id uuid, p_radius_m integer) returns integer
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.has_permission('control_panel') then
    raise exception 'only someone with the control panel can change the check-in distance';
  end if;
  if p_radius_m is null or p_radius_m not between 5 and 2000 then
    raise exception 'distance must be between 5 and 2000 metres';
  end if;
  update public.teams set radius_m = p_radius_m
   where org_id = public.my_org_id() and (p_team_id is null or id = p_team_id);
  get diagnostics v_count = row_count;
  if p_team_id is not null and v_count = 0 then raise exception 'branch not found'; end if;
  return v_count;
end; $$;

create or replace function public.set_oil_fryer(p_team_id uuid, p_name text, p_fryer_id uuid default null, p_sort_order integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if not public.has_permission('control_panel') then raise exception 'only someone with the control panel can manage fryers'; end if;
  select org_id into v_org from public.profiles where id = auth.uid();
  if coalesce(trim(p_name), '') = '' then raise exception 'a fryer needs a name'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if p_fryer_id is null then
    insert into public.oil_fryers (org_id, team_id, name, sort_order, created_by)
    values (v_org, p_team_id, trim(p_name), coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.oil_fryers set name = trim(p_name), sort_order = coalesce(p_sort_order, sort_order)
    where id = p_fryer_id and org_id = v_org returning id into v_id;
    if v_id is null then raise exception 'fryer not found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.archive_oil_fryer(p_fryer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('control_panel') then raise exception 'only someone with the control panel can manage fryers'; end if;
  update public.oil_fryers set archived = true where id = p_fryer_id and org_id = public.my_org_id();
end; $$;

create or replace function public.set_oil_slot(p_slot_id uuid, p_at_time time) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('control_panel') then raise exception 'only someone with the control panel can change the oil test times'; end if;
  if p_at_time is null then raise exception 'pick a time'; end if;
  if p_slot_id is null then
    insert into public.oil_slots (org_id, at_time) values (public.my_org_id(), p_at_time) returning id into v_id;
  else
    update public.oil_slots set at_time = p_at_time where id = p_slot_id and org_id = public.my_org_id() returning id into v_id;
    if v_id is null then raise exception 'oil test time not found'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'there is already an oil test at that time';
end; $$;

create or replace function public.remove_oil_slot(p_slot_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('control_panel') then raise exception 'only someone with the control panel can change the oil test times'; end if;
  delete from public.oil_slots where id = p_slot_id and org_id = public.my_org_id();
  if not found then raise exception 'oil test time not found'; end if;
end; $$;

create or replace function public.set_org_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('control_panel') then
    raise exception 'only someone with the control panel can change it';
  end if;
  update public.org_settings s set
    marination_hours = coalesce((p->>'marination_hours')::numeric, s.marination_hours),
    marination_early_grace_min = coalesce((p->>'marination_early_grace_min')::int, s.marination_early_grace_min),
    marination_late_grace_min = coalesce((p->>'marination_late_grace_min')::int, s.marination_late_grace_min),
    oil_grace_min = coalesce((p->>'oil_grace_min')::int, s.oil_grace_min),
    late_checklist_penalty_iqd = coalesce((p->>'late_checklist_penalty_iqd')::int, s.late_checklist_penalty_iqd),
    marination_penalty_iqd = coalesce((p->>'marination_penalty_iqd')::int, s.marination_penalty_iqd),
    updated_at = now(),
    updated_by = auth.uid()
  where s.org_id = public.my_org_id();
end; $$;

-- =================================================================== B.
alter table public.task_completions add column if not exists late_excused_by uuid references public.profiles(id) on delete set null;
alter table public.task_completions add column if not exists late_excused_at timestamptz;
alter table public.task_completions add column if not exists late_excuse_reason text;

-- Today's supervisor checklists at a branch that no deadline has claimed yet
-- (sent before the branch had one) are matched now, in the order they came
-- in. They count as DONE, never as late: no deadline existed when they were
-- sent, so due_at / was_late are left alone.
create or replace function public.restamp_checklists(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_day date; c record; s record; n int := 0;
begin
  select coalesce(timezone, 'Asia/Baghdad') into v_tz from public.teams where id = p_team;
  if v_tz is null then return 0; end if;
  v_day := public.branch_day_of(v_tz, now());
  for c in
    select tc.id, tc.actor_id, tc.created_at
      from public.task_completions tc
      join public.tasks t on t.id = tc.task_id
      join public.checklist_templates ct on ct.id = t.template_id
     where tc.team_id = p_team and tc.action = 'completed' and tc.checklist_slot is null
       and ct.assign_to_role = 'employee' and not coalesce(t.is_audit, false)
       and public.branch_day_of(v_tz, tc.created_at) = v_day
     order by tc.created_at
  loop
    select * into s from public.checklist_slot_for(p_team, c.actor_id, c.created_at);
    continue when s.slot is null;
    update public.task_completions set checklist_slot = s.slot, checklist_day = s.branch_day where id = c.id;
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.restamp_checklists(uuid) from public, anon, authenticated;

create or replace function public.set_checklist_rule(
  p_team_id uuid, p_mode text, p_am_due time, p_pm_due time, p_day_due time, p_grace_min int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('control_panel') then
    raise exception 'only someone with the control panel can change the checklist deadlines';
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
  -- Checklists already sent today count toward the new deadlines.
  perform public.restamp_checklists(t.id) from public.teams t
   where t.org_id = public.my_org_id() and (p_team_id is null or t.id = p_team_id);
end; $$;
revoke all on function public.set_checklist_rule(uuid, text, time, time, time, int) from public, anon;
grant execute on function public.set_checklist_rule(uuid, text, time, time, time, int) to authenticated;

-- Today's deadlines, now with the record behind each one (tap to open it),
-- was_late NULL for a checklist sent before the deadline existed ("done"),
-- and whether a late one was excused.
drop function if exists public.checklist_today(uuid);
create function public.checklist_today(p_team uuid)
returns table (slot text, due_at timestamptz, grace_min int, done_at timestamptz, done_by text, was_late boolean,
               on_shift text[], completion_id uuid, excused boolean)
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
           case when c.id is null or c.due_at is null then null else c.was_late end,
           array(select pp.name from public.shifts sh join public.profiles pp on pp.id = sh.profile_id
                  where sh.team_id = p_team and sh.day = v_day and pp.deleted_at is null and pp.active
                    and ((sl.s = 'DAY' and sh.shift in ('AM', 'PM')) or sh.shift = sl.s)
                  order by pp.name),
           c.id,
           c.late_excused_at is not null
      from (values ('AM', r.am_due, 1), ('PM', r.pm_due, 2), ('DAY', r.day_due, 3)) as sl(s, t, o)
      left join lateral (
        select c2.id, c2.created_at, c2.actor_id, c2.was_late, c2.due_at, c2.late_excused_at from public.task_completions c2
         where c2.team_id = p_team and c2.checklist_day = v_day and c2.checklist_slot = sl.s and c2.action = 'completed'
         order by c2.created_at limit 1
      ) c on true
      left join public.profiles p on p.id = c.actor_id
     where sl.t is not null
     order by sl.o;
end; $$;
revoke all on function public.checklist_today(uuid) from public, anon;
grant execute on function public.checklist_today(uuid) to authenticated;

-- Excuse a late checklist: it stays marked late, with who excused it, when
-- and why (spec: a wipe leaves a trace — only the consequence goes).
create or replace function public.excuse_checklist_late(p_completion_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.task_completions;
begin
  if not public.has_permission('excuse_late') then raise exception 'you cannot excuse a late checklist'; end if;
  select * into v from public.task_completions where id = p_completion_id;
  if v.id is null or v.org_id <> public.my_org_id() then raise exception 'record not found'; end if;
  if not v.was_late then raise exception 'this checklist was not late'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'write why it is excused'; end if;
  update public.task_completions
     set late_excused_by = auth.uid(), late_excused_at = now(), late_excuse_reason = trim(p_reason)
   where id = p_completion_id;
end; $$;
revoke all on function public.excuse_checklist_late(uuid, text) from public, anon;
grant execute on function public.excuse_checklist_late(uuid, text) to authenticated;

-- ============================================================ C (pushes).
-- Who hears about one deadline: the supervisors on that shift (per day:
-- anyone on AM or PM); nobody on it = every supervisor at the branch. The
-- late warning adds the branch manager. Never a deactivated or deleted account.
create or replace function public.checklist_recipients(p_team uuid, p_day date, p_slot text, p_with_managers boolean)
returns uuid[] language sql stable security definer set search_path = public as $$
  with sups as (
    select p.id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
     where pt.team_id = p_team and p.role = 'employee' and p.deleted_at is null and p.active
  ), sched as (
    select s.profile_id as id from public.shifts s
     where s.team_id = p_team and s.day = p_day and s.profile_id in (select id from sups)
       and ((p_slot = 'DAY' and s.shift in ('AM', 'PM')) or s.shift = p_slot)
  )
  select array(
    select id from sched
    union select id from sups where not exists (select 1 from sched)
    union select p.id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id
           where p_with_managers and pt.team_id = p_team and p.role = 'team_admin' and p.deleted_at is null and p.active
  );
$$;

create or replace function public.push_to_profiles(p_profiles uuid[], p_title text, p_body text, p_tag text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs
    from public.web_push_subscriptions s join public.profiles p on p.id = s.profile_id
   where s.profile_id = any(p_profiles) and p.deleted_at is null and p.active;
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

-- "Remind them now" from a deadline on the dashboard: the admin, the auditor,
-- or that branch's manager. Returns how many phones it reached.
create or replace function public.nudge_checklist(p_team uuid, p_slot text) returns int
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_branch text; v_day date; v_to uuid[]; v_phones int;
begin
  if not (public.sees_all_branches() or (public.my_role() = 'team_admin' and p_team = any(public.my_team_ids()))) then
    raise exception 'only an admin, the auditor or this branch''s manager can send a reminder';
  end if;
  if p_slot not in ('AM', 'PM', 'DAY') then raise exception 'unknown deadline'; end if;
  select coalesce(timezone, 'Asia/Baghdad'), name into v_tz, v_branch from public.teams
   where id = p_team and org_id = public.my_org_id();
  if v_tz is null then raise exception 'branch not found'; end if;
  v_day := public.branch_day_of(v_tz, now());
  v_to := public.checklist_recipients(p_team, v_day, p_slot, false);
  select count(*) into v_phones from public.web_push_subscriptions where profile_id = any(v_to);
  perform public.push_to_profiles(v_to, 'تذكير: قائمة الفحص',
    v_branch || ' · ' || case p_slot when 'AM' then 'المناوبة الصباحية' when 'PM' then 'المناوبة المسائية' else 'قائمة اليوم' end
      || ' · أرسلها الآن',
    'checklist-nudge-' || p_team || '-' || floor(extract(epoch from now()))::text);
  return v_phones;
end; $$;
revoke all on function public.nudge_checklist(uuid, text) from public, anon;
grant execute on function public.nudge_checklist(uuid, text) to authenticated;

-- The two older reminder jobs, from their live bodies, now skipping
-- deactivated and deleted accounts (a deleted tester's phone kept getting
-- Baghdad's oil reminders — nothing filtered it out).
create or replace function public.send_due_oil_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_token text; r record; v_subs jsonb; v_sent int := 0; v_local timestamp; v_day date;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return 0; end if;

  for r in
    select t.id as team_id, t.org_id, t.name as branch, coalesce(t.timezone,'Asia/Baghdad') as tz, s.at_time
      from public.teams t
      join public.oil_slots s on s.org_id = t.org_id
  loop
    v_local := now() at time zone r.tz;
    v_day := (v_local)::date;

    continue when not (
      v_local >= (date_trunc('day', v_local) + r.at_time)
      and v_local < (date_trunc('day', v_local) + r.at_time + interval '1 hour')
    );
    continue when exists (
      select 1 from public.oil_tests o
      where o.team_id = r.team_id
        and o.slot_time = r.at_time
        and (o.tested_at at time zone r.tz)::date = v_day
    );
    continue when exists (
      select 1 from public.oil_slot_pings p
      where p.team_id = r.team_id and p.slot_time = r.at_time and p.branch_day = v_day
    );

    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s2.endpoint, 'p256dh', s2.p256dh, 'auth', s2.auth)), '[]'::jsonb)
      into v_subs
      from public.web_push_subscriptions s2
      join public.profiles p on p.id = s2.profile_id
     where s2.org_id = r.org_id
       and p.role <> 'owner'
       and p.deleted_at is null and p.active
       and exists (select 1 from public.profile_teams pt where pt.profile_id = p.id and pt.team_id = r.team_id);

    if jsonb_array_length(v_subs) > 0 then
      perform net.http_post(
        url := 'https://bd-push.ahmedhijazi09.workers.dev',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
        body := jsonb_build_object(
          'subscriptions', v_subs,
          'title', 'حان وقت فحص الدهن',
          'body', r.branch || ' · موعد الفحص ' || to_char(date_trunc('day', v_local) + r.at_time, 'HH12:MI AM')
                  || ' · أمامك ' || public.oil_grace_minutes_for(r.org_id) || ' دقائق',
          'url', 'https://bdaudit.hijazionline.com/',
          'tag', 'oil-slot-' || r.team_id || '-' || r.at_time
        )
      );
      v_sent := v_sent + 1;
    end if;

    insert into public.oil_slot_pings (team_id, slot_time, branch_day, reminder_count, last_reminded_at)
    values (r.team_id, r.at_time, v_day, 1, now())
    on conflict (team_id, slot_time, branch_day) do nothing;
  end loop;

  return v_sent;
end; $$;

create or replace function public.send_due_marination_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_token text; r record; v_subs jsonb; v_sent int := 0;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return 0; end if;

  for r in
    select m.id, m.org_id, m.team_id, m.marinated_at, m.reminder_count,
           t.name as branch, t.timezone
      from public.chicken_marinations m
      join public.teams t on t.id = m.team_id
     where m.remind_at is not null
       and m.unloaded_at is null
       and m.remind_at <= now()
       and m.reminder_count < public.reminder_max_repeats()
       and (m.last_reminded_at is null
            or m.last_reminded_at <= now() - make_interval(mins => public.reminder_repeat_minutes()))
     limit 50
  loop
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs
      from public.web_push_subscriptions s
      join public.profiles p on p.id = s.profile_id
     where s.org_id = r.org_id
       and p.role <> 'owner'
       and p.deleted_at is null and p.active
       and exists (select 1 from public.profile_teams pt where pt.profile_id = p.id and pt.team_id = r.team_id);

    if jsonb_array_length(v_subs) > 0 then
      perform net.http_post(
        url := 'https://bd-push.ahmedhijazi09.workers.dev',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
        body := jsonb_build_object(
          'subscriptions', v_subs,
          'title', 'حان وقت تفريغ الخل',
          'body', r.branch || ' · تم التخليل ' ||
                  to_char(r.marinated_at at time zone r.timezone, 'HH12:MI AM') ||
                  case when r.reminder_count > 0
                       then ' · تذكير ' || (r.reminder_count + 1)
                       else ' · مرت ' || rtrim(to_char(public.marination_hours_for(r.org_id), 'FM990.##'), '.') || ' ساعات' end,
          'url', 'https://bdaudit.hijazionline.com/',
          'tag', 'marination-' || r.id || '-' || r.reminder_count
        )
      );
      v_sent := v_sent + 1;
    end if;

    update public.chicken_marinations
       set reminder_count = reminder_count + 1,
           last_reminded_at = now(),
           reminded_at = coalesce(reminded_at, now())
     where id = r.id;
  end loop;

  return v_sent;
end; $$;

create or replace function public.send_test_push_to(p_team_id uuid, p_profile_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb; v_count int;
begin
  if not public.has_permission('control_panel') then raise exception 'only someone with the control panel can send a test'; end if;
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then raise exception 'push is not configured'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb), count(*)
    into v_subs, v_count
  from public.web_push_subscriptions s
  join public.profiles p on p.id = s.profile_id
  where p.org_id = public.my_org_id() and p.deleted_at is null and p.active
    and (
      (p_team_id is not null and exists (select 1 from public.profile_teams pt where pt.profile_id = p.id and pt.team_id = p_team_id))
      or (p_profile_ids is not null and p.id = any(p_profile_ids))
    );
  if v_count = 0 then return 0; end if;
  perform net.http_post(
    url := 'https://bd-push.ahmedhijazi09.workers.dev',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'title', 'BD Audit',
      'body', 'إشعار تجريبي — الإشعارات تعمل. Test notification — notifications are working.',
      'url', 'https://bdaudit.hijazionline.com/',
      'tag', 'test-' || floor(extract(epoch from now()))::text
    )
  );
  return v_count;
end; $$;

-- One phone per account holds for notifications too: registering this phone
-- drops the account's older phones, and a phone that moves to a new account
-- stops getting the old one's. A deactivated account registers nothing.
create or replace function public.save_web_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.profiles where id = auth.uid() and deleted_at is null and active;
  if v_org is null then raise exception 'not signed in'; end if;
  delete from public.web_push_subscriptions where profile_id = auth.uid() and endpoint <> p_endpoint;
  insert into public.web_push_subscriptions (profile_id, org_id, endpoint, p256dh, auth)
  values (auth.uid(), v_org, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set profile_id = excluded.profile_id, org_id = excluded.org_id,
    p256dh = excluded.p256dh, auth = excluded.auth;
end; $$;

-- Deactivating or deleting someone silences their phone at once.
create or replace function public.drop_push_for_inactive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.active is false and old.active is distinct from false)
     or (new.deleted_at is not null and old.deleted_at is null) then
    delete from public.web_push_subscriptions where profile_id = new.id;
    delete from public.push_tokens where owner_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists drop_push_for_inactive on public.profiles;
create trigger drop_push_for_inactive after update of active, deleted_at on public.profiles
  for each row execute function public.drop_push_for_inactive();

-- What each phone says about notifications, so the push test can show who is
-- reachable and why not (a Safari tab, blocked, an error) instead of a guess.
create table if not exists public.push_status (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  state text not null,
  detail text,
  standalone boolean,
  user_agent text,
  checked_at timestamptz not null default now()
);
alter table public.push_status enable row level security;
revoke all on public.push_status from anon, authenticated;

create or replace function public.report_push_state(p_state text, p_detail text, p_standalone boolean, p_user_agent text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then return; end if;
  insert into public.push_status (profile_id, org_id, state, detail, standalone, user_agent, checked_at)
  values (auth.uid(), v_org, left(coalesce(p_state, '?'), 30), left(p_detail, 300), p_standalone, left(p_user_agent, 300), now())
  on conflict (profile_id) do update set state = excluded.state, detail = excluded.detail,
    standalone = excluded.standalone, user_agent = excluded.user_agent, checked_at = now();
end; $$;
revoke all on function public.report_push_state(text, text, boolean, text) from public, anon;
grant execute on function public.report_push_state(text, text, boolean, text) to authenticated;

create or replace function public.push_overview()
returns table (profile_id uuid, phones int, state text, detail text, standalone boolean, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, (select count(*) from public.web_push_subscriptions s where s.profile_id = p.id)::int,
         ps.state, ps.detail, ps.standalone, ps.checked_at
    from public.profiles p left join public.push_status ps on ps.profile_id = p.id
   where p.org_id = public.my_org_id() and p.deleted_at is null and p.active
     and public.has_permission('control_panel');
$$;
revoke all on function public.push_overview() from public, anon;
grant execute on function public.push_overview() to authenticated;

-- The auditor hears about every supervisor checklist as it comes in, so she
-- knows there is one to verify (his request; whoever has the
-- 'checklist_alerts' switch). Never blocks the checklist itself.
create or replace function public.alert_checklist_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_to uuid[]; v_branch text; v_who text; v_tz text;
begin
  if new.action is distinct from 'completed' then return null; end if;
  if not exists (
    select 1 from public.tasks t join public.checklist_templates ct on ct.id = t.template_id
     where t.id = new.task_id and ct.assign_to_role = 'employee' and not coalesce(t.is_audit, false)
  ) then return null; end if;
  begin
    v_to := array(select p.id from public.profiles p
                   where p.org_id = new.org_id and p.deleted_at is null and p.active and p.id <> new.actor_id
                     and public.profile_allows(p.id, 'checklist_alerts'));
    if coalesce(array_length(v_to, 1), 0) = 0 then return null; end if;
    select name, coalesce(timezone, 'Asia/Baghdad') into v_branch, v_tz from public.teams where id = new.team_id;
    select name into v_who from public.profiles where id = new.actor_id;
    perform public.push_to_profiles(v_to, 'قائمة فحص جديدة للتحقق',
      coalesce(v_branch, '') || ' · ' || coalesce(v_who, '') || ' · ' || to_char(new.created_at at time zone v_tz, 'HH12:MI AM')
        || case when new.was_late then ' · متأخرة' else '' end,
      'checklist-new-' || new.id);
  exception when others then
    raise warning 'checklist alert: %', sqlerrm;
  end;
  return null;
end; $$;
drop trigger if exists alert_checklist_submitted on public.task_completions;
create trigger alert_checklist_submitted after insert on public.task_completions
  for each row execute function public.alert_checklist_submitted();

-- =================================================================== D.
alter table public.chicken_marinations add column if not exists original_marinated_at timestamptz;
alter table public.chicken_marinations add column if not exists start_edited_by uuid references public.profiles(id) on delete set null;
alter table public.chicken_marinations add column if not exists start_edited_at timestamptz;
alter table public.chicken_marinations add column if not exists start_edit_reason text;

create table if not exists public.marination_start_edits (
  id uuid primary key default gen_random_uuid(),
  marination_id uuid not null references public.chicken_marinations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  old_start timestamptz not null,
  new_start timestamptz not null,
  reason text not null,
  edited_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz not null default now()
);
alter table public.marination_start_edits enable row level security;
drop policy if exists "read marination edits" on public.marination_start_edits;
create policy "read marination edits" on public.marination_start_edits for select using (
  org_id = public.my_org_id() and (public.sees_all_branches() or team_id = any(public.my_team_ids()))
);
revoke all on public.marination_start_edits from anon, authenticated;
grant select on public.marination_start_edits to authenticated;

-- The start is the server's clock, the same as the removal: a time typed on
-- the phone could be set 2.5 hours back and the chicken pulled 30 minutes
-- later "on time". p_marinated_at stays in the signature so an app still
-- open on the old version keeps working; it is ignored.
create or replace function public.submit_chicken_marination(
  p_team_id uuid, p_marinated_at timestamptz, p_count_in numeric,
  p_unloaded_at timestamptz default null, p_count_out numeric default null, p_note text default null,
  p_signature_url text default null, p_is_audit boolean default false, p_remind boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid; v_remind timestamptz; v_start timestamptz := now();
        v_span interval;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_count_in is not null and (p_count_in <= 0 or p_count_in > 200) then
    raise exception 'the number of buckets looks wrong'; end if;
  v_span := make_interval(mins => round(public.marination_hours_for(v_org) * 60)::int);

  if coalesce(p_remind, false) and p_unloaded_at is null then
    v_remind := v_start + v_span;
  end if;

  -- The rule this batch is graded by is frozen on it, like a checklist's score.
  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at, original_marinated_at,
    due_at, early_grace_min, late_grace_min,
    count_in, unloaded_at, count_out, note, signature_url, remind_at)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), v_start, v_start,
    v_start + v_span,
    (select marination_early_grace_min from public.org_settings where org_id = v_org),
    (select marination_late_grace_min from public.org_settings where org_id = v_org),
    p_count_in, p_unloaded_at, p_count_out, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''), v_remind)
  returning id into v_id;
  return v_id;
end; $$;

-- The branch manager (or whoever has the switch) corrects a start time — a
-- supervisor who forgot to record the batch when it went in. A reason is
-- required; every change is kept, and the batch shows it was changed.
create or replace function public.edit_marination_start(p_id uuid, p_new_start timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.chicken_marinations; v_span interval;
begin
  select * into v from public.chicken_marinations where id = p_id;
  if v.id is null or v.org_id <> public.my_org_id() then raise exception 'record not found'; end if;
  if not (public.has_permission('edit_marination_start')
          and (public.sees_all_branches() or v.team_id = any(public.my_team_ids()))) then
    raise exception 'only the branch manager or an admin can change the start time';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'write why the start time is being changed'; end if;
  if p_new_start is null then raise exception 'pick the time it went in'; end if;
  if p_new_start > now() then raise exception 'the start time cannot be in the future'; end if;
  if v.unloaded_at is not null and p_new_start >= v.unloaded_at then
    raise exception 'the start must be before the chicken came out'; end if;
  if p_new_start < v.created_at - interval '12 hours' then
    raise exception 'that is more than 12 hours before the batch was recorded'; end if;
  v_span := coalesce(v.due_at - v.marinated_at, make_interval(mins => round(public.marination_hours_for(v.org_id) * 60)::int));

  insert into public.marination_start_edits (marination_id, org_id, team_id, old_start, new_start, reason, edited_by)
  values (p_id, v.org_id, v.team_id, v.marinated_at, p_new_start, trim(p_reason), auth.uid());

  update public.chicken_marinations set
    original_marinated_at = coalesce(original_marinated_at, marinated_at),
    marinated_at = p_new_start,
    due_at = p_new_start + v_span,
    -- Still in and a reminder was asked for: it follows the corrected time.
    remind_at = case when remind_at is not null and unloaded_at is null then p_new_start + v_span else remind_at end,
    reminder_count = case when remind_at is not null and unloaded_at is null then 0 else reminder_count end,
    last_reminded_at = case when remind_at is not null and unloaded_at is null then null else last_reminded_at end,
    start_edited_by = auth.uid(), start_edited_at = now(), start_edit_reason = trim(p_reason)
  where id = p_id;
end; $$;
revoke all on function public.edit_marination_start(uuid, timestamptz, text) from public, anon;
grant execute on function public.edit_marination_start(uuid, timestamptz, text) to authenticated;

-- ================================================ E. the activity record.
-- The super admin's record watches the new tables like the old ones.
drop trigger if exists zz_admin_activity on public.checklist_rules;
create trigger zz_admin_activity after insert or update or delete on public.checklist_rules
  for each row execute function public.log_admin_change();
drop trigger if exists zz_admin_activity on public.profile_permissions;
create trigger zz_admin_activity after insert or update or delete on public.profile_permissions
  for each row execute function public.log_admin_change();
drop trigger if exists zz_admin_activity on public.marination_start_edits;
create trigger zz_admin_activity after insert or update or delete on public.marination_start_edits
  for each row execute function public.log_admin_change();

-- ======================================================= F. one-time.
-- Silence phones of accounts already deactivated or deleted.
delete from public.web_push_subscriptions s using public.profiles p
 where p.id = s.profile_id and (p.deleted_at is not null or not p.active);
-- Today's checklists sent before their branch had a deadline now count.
select public.restamp_checklists(team_id) from public.checklist_rules;
