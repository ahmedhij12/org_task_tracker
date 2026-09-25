-- 2026-09-25. The control panel's company-wide rules, moved out of fixed
-- values into one row per organisation that the admins edit in the app.
--
-- Every default equals what is live today (marination 3 h, oil grace 10 min,
-- marination late grace 5 min), so applying this changes nothing a branch
-- sees until someone edits a value. The early grace is new: 5 min, so
-- chicken pulled more than 5 minutes before its time now reads "early".
--
-- The four live functions that used the fixed values are re-created below
-- from their LIVE definitions (pg_get_functiondef, 2026-09-25) with only
-- those calls changed. Apply with psql -1.

create table if not exists public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  marination_hours numeric(4,2) not null default 3 check (marination_hours between 0.5 and 12),
  -- Out before (hours - early grace) = pulled early: under-marinated, a warning.
  marination_early_grace_min int not null default 5 check (marination_early_grace_min between 0 and 120),
  -- Out after (hours + late grace) = late: forgotten in the vinegar.
  marination_late_grace_min int not null default 5 check (marination_late_grace_min between 0 and 240),
  oil_grace_min int not null default 10 check (oil_grace_min between 0 and 180),
  -- Flat penalty amounts. A penalty freezes its amount when it is created, so
  -- changing these never touches penalties already given.
  late_checklist_penalty_iqd int not null default 0 check (late_checklist_penalty_iqd >= 0),
  marination_penalty_iqd int not null default 0 check (marination_penalty_iqd >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.org_settings (org_id) select id from public.organizations on conflict do nothing;

alter table public.org_settings enable row level security;
drop policy if exists "org members read their settings" on public.org_settings;
create policy "org members read their settings" on public.org_settings
  for select using (org_id = public.my_org_id());
revoke all on public.org_settings from anon, authenticated;
grant select on public.org_settings to authenticated;

-- A new organisation gets its settings row too.
create or replace function public.seed_org_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_settings (org_id) values (new.id) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists seed_org_settings on public.organizations;
create trigger seed_org_settings after insert on public.organizations
  for each row execute function public.seed_org_settings();

create or replace function public.marination_hours_for(p_org uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select marination_hours from public.org_settings where org_id = p_org), 3);
$$;
create or replace function public.oil_grace_minutes_for(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select oil_grace_min from public.org_settings where org_id = p_org), 10);
$$;

-- The admin edits the rules. Only the keys present in p are changed.
create or replace function public.set_org_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'only an admin can change the control panel';
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
revoke all on function public.set_org_settings(jsonb) from public, anon;
grant execute on function public.set_org_settings(jsonb) to authenticated;

-- Oil test times: add (null id), move, or remove. Company-wide; every branch
-- follows in its own time zone. Past tests keep the slot time they were
-- recorded against, so removing a time never rewrites history.
create or replace function public.set_oil_slot(p_slot_id uuid, p_at_time time) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'only an admin can change the oil test times'; end if;
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
  if public.my_role() is distinct from 'owner' then raise exception 'only an admin can change the oil test times'; end if;
  delete from public.oil_slots where id = p_slot_id and org_id = public.my_org_id();
  if not found then raise exception 'oil test time not found'; end if;
end; $$;
revoke all on function public.set_oil_slot(uuid, time) from public, anon;
revoke all on function public.remove_oil_slot(uuid) from public, anon;
grant execute on function public.set_oil_slot(uuid, time), public.remove_oil_slot(uuid) to authenticated;

-- Push test from the control panel: to everyone at one branch, or to chosen
-- people. Returns how many devices it went to (0 = nobody has notifications on).
create or replace function public.send_test_push_to(p_team_id uuid, p_profile_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb; v_count int;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'only an admin can send a test'; end if;
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then raise exception 'push is not configured'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb), count(*)
    into v_subs, v_count
  from public.web_push_subscriptions s
  join public.profiles p on p.id = s.profile_id
  where p.org_id = public.my_org_id() and p.deleted_at is null
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
revoke all on function public.send_test_push_to(uuid, uuid[]) from public, anon;
grant execute on function public.send_test_push_to(uuid, uuid[]) to authenticated;

-- ── The live functions, now reading the settings ────────────────────────

CREATE OR REPLACE FUNCTION public.oil_slot_for(p_team_id uuid, p_at timestamp with time zone)
 RETURNS TABLE(slot_time time without time zone, minutes_late integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text; v_org uuid; v_local timestamp; v_day date;
  v_next time; v_next_in int;
  v_prev time; v_prev_diff int;
  v_slot time; v_late int;
begin
  select timezone, org_id into v_tz, v_org from public.teams where id = p_team_id;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_local := p_at at time zone v_tz;
  v_day := v_local::date;

  -- A slot coming up soon: the work is being done early, so it counts for it.
  select s.at_time,
         (extract(epoch from ((date_trunc('day', v_local) + s.at_time) - v_local))::int / 60)
    into v_next, v_next_in
  from public.oil_slots s
  join public.teams t on t.id = p_team_id and t.org_id = s.org_id
  where (date_trunc('day', v_local) + s.at_time) > v_local
  order by (date_trunc('day', v_local) + s.at_time) asc
  limit 1;

  if v_next is not null and v_next_in <= public.oil_early_window_minutes() then
    v_slot := v_next; v_late := null;
  else
    -- Otherwise the most recent slot that already passed, with the late rule.
    select s.at_time,
           extract(epoch from (v_local - (date_trunc('day', v_local) + s.at_time)))::int / 60
      into v_prev, v_prev_diff
    from public.oil_slots s
    join public.teams t on t.id = p_team_id and t.org_id = s.org_id
    where (date_trunc('day', v_local) + s.at_time) <= v_local
    order by (date_trunc('day', v_local) + s.at_time) desc
    limit 1;

    if v_prev is null or v_prev_diff > 8 * 60 then
      return query select null::time, null::int;
      return;
    end if;
    v_slot := v_prev;
    v_late := nullif(greatest(0, v_prev_diff - public.oil_grace_minutes_for(v_org)), 0);
  end if;

  -- Already covered today (possibly by an early test): this one is an extra.
  if exists (
    select 1 from public.oil_tests o
    where o.team_id = p_team_id
      and o.slot_time = v_slot
      and (o.tested_at at time zone v_tz)::date = v_day
  ) then
    return query select null::time, null::int;
    return;
  end if;

  return query select v_slot, v_late;
end; $function$;

CREATE OR REPLACE FUNCTION public.send_due_marination_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and m.unloaded_at is null                      -- stops the moment it is emptied
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
          -- A fresh tag each time, or iOS replaces the banner silently instead
          -- of alerting again.
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
end; $function$;

CREATE OR REPLACE FUNCTION public.send_due_oil_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Already done — including a test taken early, which is recorded against
    -- this slot. Nothing to remind about.
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
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_chicken_marination(p_team_id uuid, p_marinated_at timestamp with time zone, p_count_in numeric, p_unloaded_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_count_out numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_signature_url text DEFAULT NULL::text, p_is_audit boolean DEFAULT false, p_remind boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid; v_remind timestamptz;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_marinated_at is null then raise exception 'the marination time is required'; end if;

  -- Only worth reminding when the batch is still in (no unload recorded yet).
  if coalesce(p_remind, false) and p_unloaded_at is null then
    v_remind := p_marinated_at + make_interval(mins => round(public.marination_hours_for(v_org) * 60)::int);
  end if;

  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at,
    count_in, unloaded_at, count_out, note, signature_url, remind_at)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), p_marinated_at,
    p_count_in, p_unloaded_at, p_count_out, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''), v_remind)
  returning id into v_id;
  return v_id;
end; $function$;
