-- NOT YET APPLIED (2026-09-22). Keep nagging until the job is actually done.
-- iOS will not let a web app play a louder or repeating sound, and silent mode
-- cannot be overridden. What we CAN do is send the reminder again every few
-- minutes, so the phone alerts repeatedly until the work is recorded.

alter table public.chicken_marinations
  add column if not exists reminder_count int not null default 0,
  add column if not exists last_reminded_at timestamptz;

-- How often to repeat, and how many times before giving up.
create or replace function public.reminder_repeat_minutes() returns int
language sql immutable as $$ select 3 $$;
create or replace function public.reminder_max_repeats() returns int
language sql immutable as $$ select 12 $$;   -- ~36 minutes of nagging

create or replace function public.send_due_marination_reminders()
returns int language plpgsql security definer set search_path = public as $$
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
                       else ' · مرت ' || public.marination_hours() || ' ساعات' end,
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
end; $$;

-- Oil: repeat until a test for that branch and slot is actually recorded today.
alter table public.oil_slot_pings
  add column if not exists reminder_count int not null default 0,
  add column if not exists last_reminded_at timestamptz;

create or replace function public.send_due_oil_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare v_token text; r record; v_subs jsonb; v_sent int := 0; v_local timestamp; v_day date; v_count int;
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

    -- Only within the hour after the slot, so a restart cannot fire old ones.
    continue when not (
      v_local >= (date_trunc('day', v_local) + r.at_time)
      and v_local < (date_trunc('day', v_local) + r.at_time + interval '1 hour')
    );

    -- Done: a test for this branch was recorded against this slot today.
    continue when exists (
      select 1 from public.oil_tests o
      where o.team_id = r.team_id and o.slot_time = r.at_time
        and (o.tested_at at time zone r.tz)::date = v_day
    );

    select reminder_count into v_count from public.oil_slot_pings
     where team_id = r.team_id and slot_time = r.at_time and branch_day = v_day;
    v_count := coalesce(v_count, 0);
    continue when v_count >= public.reminder_max_repeats();
    continue when exists (
      select 1 from public.oil_slot_pings
       where team_id = r.team_id and slot_time = r.at_time and branch_day = v_day
         and last_reminded_at > now() - make_interval(mins => public.reminder_repeat_minutes())
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
                  || case when v_count > 0 then ' · تذكير ' || (v_count + 1)
                          else ' · أمامك ' || public.oil_grace_minutes() || ' دقائق' end,
          'url', 'https://bdaudit.hijazionline.com/',
          'tag', 'oil-slot-' || r.team_id || '-' || r.at_time || '-' || v_count
        )
      );
      v_sent := v_sent + 1;
    end if;

    insert into public.oil_slot_pings (team_id, slot_time, branch_day, reminder_count, last_reminded_at)
    values (r.team_id, r.at_time, v_day, 1, now())
    on conflict (team_id, slot_time, branch_day)
    do update set reminder_count = public.oil_slot_pings.reminder_count + 1, last_reminded_at = now();
  end loop;

  return v_sent;
end; $$;
