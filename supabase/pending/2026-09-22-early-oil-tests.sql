-- NOT YET APPLIED (2026-09-22). An oil test done shortly BEFORE a scheduled
-- time counts as that slot's test.
--
-- Someone finishing the 1:00 AM check at 12:20 AM has done the job; the app
-- should record it against the 1:00 AM slot, treat it as on time, and not
-- nag them an hour later. Same for the 2:00 PM and 7:00 PM slots.

-- How early a test may be and still count for the upcoming slot.
create or replace function public.oil_early_window_minutes() returns int
language sql immutable as $$ select 60 $$;

create or replace function public.oil_slot_for(
  p_team_id uuid, p_at timestamptz
) returns table (slot_time time, minutes_late int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_local timestamp;
  v_next time; v_next_in int;
  v_prev time; v_prev_diff int;
begin
  select timezone into v_tz from public.teams where id = p_team_id;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_local := p_at at time zone v_tz;

  -- 1) A slot coming up soon: the work is done early, so it counts for that
  --    slot and is never late. Checked first so it wins over a stale old slot.
  select s.at_time,
         (extract(epoch from ((date_trunc('day', v_local) + s.at_time) - v_local))::int / 60)
    into v_next, v_next_in
  from public.oil_slots s
  join public.teams t on t.id = p_team_id and t.org_id = s.org_id
  where (date_trunc('day', v_local) + s.at_time) > v_local
  order by (date_trunc('day', v_local) + s.at_time) asc
  limit 1;

  if v_next is not null and v_next_in <= public.oil_early_window_minutes() then
    return query select v_next, null::int;
    return;
  end if;

  -- 2) Otherwise the most recent slot already passed, with the late rule.
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

  return query select v_prev, nullif(greatest(0, v_prev_diff - public.oil_grace_minutes()), 0);
end; $$;

grant execute on function public.oil_slot_for(uuid, timestamptz) to authenticated;

-- The reminder must not fire for a slot that has already been tested.
create or replace function public.send_due_oil_reminders()
returns int language plpgsql security definer set search_path = public as $$
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
                  || ' · أمامك ' || public.oil_grace_minutes() || ' دقائق',
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
