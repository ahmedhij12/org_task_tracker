-- NOT YET APPLIED (2026-09-26). Oil: every fryer is tracked on its own.
-- His report: Baghdad has two fryers and only one was ever marked late or
-- reminded; other branches will have 3 to 6.
-- Before: a slot counted as done for the whole BRANCH once any one fryer was
-- tested in it. The second fryer's test became an "extra check" (never late,
-- no reason asked) and the reminder stopped once any fryer was done.
-- Now: the times stay per branch (the org's oil_slots), but each fryer has its
-- own on-time/late for each slot, and the one reminder per slot waits for
-- every fryer and names the ones not yet tested. Past tests stay as recorded.
-- Goes out WITH the web build that passes p_fryer_id to oil_slot_for.

-- The fryer is optional so an app that has not reloaded yet keeps the old
-- per-branch answer instead of failing.
drop function if exists public.oil_slot_for(uuid, timestamptz);
create function public.oil_slot_for(p_team_id uuid, p_at timestamptz, p_fryer_id uuid default null)
returns table (slot_time time, minutes_late int)
language plpgsql stable security definer set search_path = public as $$
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

  -- This fryer already tested for this slot today (possibly early): an extra.
  if exists (
    select 1 from public.oil_tests o
    where o.team_id = p_team_id
      and (p_fryer_id is null or o.fryer_id = p_fryer_id)
      and o.slot_time = v_slot
      and (o.tested_at at time zone v_tz)::date = v_day
  ) then
    return query select null::time, null::int;
    return;
  end if;

  return query select v_slot, v_late;
end; $$;
grant execute on function public.oil_slot_for(uuid, timestamptz, uuid) to authenticated;

-- The branch's working fryers with no scheduled test for this slot on this
-- branch day, in list order. An auditor's or manager's test carries no slot,
-- so it does not count.
create or replace function public.oil_fryers_untested(p_team_id uuid, p_slot time, p_day date)
returns setof public.oil_fryers
language sql stable security definer set search_path = public as $$
  select f.* from public.oil_fryers f
  join public.teams t on t.id = f.team_id
  where f.team_id = p_team_id and not f.archived
    and not exists (
      select 1 from public.oil_tests o
      where o.fryer_id = f.id and o.slot_time = p_slot
        and (o.tested_at at time zone coalesce(t.timezone, 'Asia/Baghdad'))::date = p_day)
  order by f.sort_order, f.created_at;
$$;
revoke execute on function public.oil_fryers_untested(uuid, time, date) from public, anon, authenticated;

create or replace function public.submit_oil_test(p_fryer_id uuid, p_tpm numeric, p_temp_c numeric, p_filtered boolean, p_photo_url text, p_signature_url text default null, p_note text default null, p_is_audit boolean default false, p_late_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_fryer public.oil_fryers;
        v_grade text; v_id uuid; v_slot time; v_late int;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  select * into v_fryer from public.oil_fryers where id = p_fryer_id and org_id = v_org and not archived;
  if v_fryer.id is null then raise exception 'fryer not found'; end if;
  if not (v_role in ('owner', 'hygiene_auditor') or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;

  select s.slot_time, s.minutes_late into v_slot, v_late
    from public.oil_slot_for(v_fryer.team_id, now(), v_fryer.id) s;

  -- An auditor's spot check is never "late"; it is not part of the schedule.
  -- Nor is a branch manager's: he tests any time, outside the supervisors'
  -- slots, so his test neither closes a slot nor runs late (2026-09-25).
  if p_is_audit or v_role = 'team_admin' then v_slot := null; v_late := null; end if;

  if v_late is not null and coalesce(trim(p_late_reason), '') = '' then
    raise exception 'this test is late — please explain why';
  end if;

  v_grade := case when p_tpm >= 22 then 'change' when p_tpm >= 20 then 'watch' else 'good' end;

  insert into public.oil_tests (org_id, team_id, fryer_id, actor_id, is_audit, tpm, temp_c,
    filtered, grade, photo_url, signature_url, note, slot_time, minutes_late, late_reason)
  values (v_org, v_fryer.team_id, p_fryer_id, auth.uid(), coalesce(p_is_audit, false), p_tpm, p_temp_c,
    coalesce(p_filtered, false), v_grade, p_photo_url, nullif(trim(p_signature_url), ''), nullif(trim(p_note), ''),
    v_slot, v_late, nullif(trim(p_late_reason), ''))
  returning id into v_id;
  return v_id;
end; $$;

-- Still ONE reminder per branch per slot (his rule: oil is not nagged), but it
-- is held back only when EVERY fryer is done, and it names the ones left —
-- up to three by name, more as a count.
create or replace function public.send_due_oil_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare v_token text; r record; v_subs jsonb; v_sent int := 0; v_local timestamp; v_day date;
        v_names text; v_left int;
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
    select string_agg(u.name, '، ' order by u.sort_order, u.created_at), count(*)
      into v_names, v_left
      from public.oil_fryers_untested(r.team_id, r.at_time, v_day) u;
    continue when v_left = 0;
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
                  || ' · أمامك ' || public.oil_grace_minutes_for(r.org_id) || ' دقائق'
                  || ' · لم تُفحص: ' || case when v_left <= 3 then v_names else v_left || ' قلايات' end,
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

notify pgrst, 'reload schema';
