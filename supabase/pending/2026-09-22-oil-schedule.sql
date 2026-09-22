-- NOT YET APPLIED (2026-09-22). Fixed oil-test times with reminders and a
-- late rule. Three tests a day at 2:00 PM, 7:00 PM and 1:00 AM branch time.
-- Ten minutes' grace; after that the test is late and needs an explanation.

-- The slots. A table (not constants) so the times can be changed later.
create table if not exists public.oil_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  at_time time not null,
  unique (org_id, at_time)
);
alter table public.oil_slots enable row level security;

drop policy if exists "read oil slots" on public.oil_slots;
create policy "read oil slots" on public.oil_slots for select
  using (org_id = public.my_org_id());

-- Grace before a test counts as late.
create or replace function public.oil_grace_minutes() returns int
language sql immutable as $$ select 10 $$;

-- Seed 14:00, 19:00, 01:00 for every existing org.
insert into public.oil_slots (org_id, at_time)
select o.id, x.t from public.organizations o
cross join (values (time '14:00'), (time '19:00'), (time '01:00')) as x(t)
on conflict (org_id, at_time) do nothing;

-- Which test belongs to which slot, and how late it was.
alter table public.oil_tests
  add column if not exists slot_time time,
  add column if not exists minutes_late int,
  add column if not exists late_reason text;

comment on column public.oil_tests.minutes_late is
  'Minutes after the scheduled slot (past the grace). Null when the test was on time or not tied to a slot.';

-- One reminder per branch per slot per branch-day.
create table if not exists public.oil_slot_pings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  slot_time time not null,
  branch_day date not null,
  sent_at timestamptz not null default now(),
  unique (team_id, slot_time, branch_day)
);
alter table public.oil_slot_pings enable row level security;

-- For a moment in a branch's own zone: the slot it belongs to and the lateness.
create or replace function public.oil_slot_for(
  p_team_id uuid, p_at timestamptz
) returns table (slot_time time, minutes_late int)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_local timestamp; v_best time; v_diff int; v_best_diff int;
begin
  select timezone into v_tz from public.teams where id = p_team_id;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_local := p_at at time zone v_tz;

  -- The most recent slot at or before this moment (looking back a day too, so
  -- a 1:00 AM slot still matches a test done at 1:05 AM).
  select s.at_time,
         extract(epoch from (v_local - (date_trunc('day', v_local) + s.at_time)))::int / 60
    into v_best, v_best_diff
  from public.oil_slots s
  join public.teams t on t.id = p_team_id and t.org_id = s.org_id
  where (date_trunc('day', v_local) + s.at_time) <= v_local
  order by (date_trunc('day', v_local) + s.at_time) desc
  limit 1;

  if v_best is null then
    return query select null::time, null::int;
    return;
  end if;

  -- Only tie a test to a slot if it is within the same working window (8h),
  -- otherwise it is just an extra test, not a late one.
  if v_best_diff > 8 * 60 then
    return query select null::time, null::int;
    return;
  end if;

  v_diff := greatest(0, v_best_diff - public.oil_grace_minutes());
  return query select v_best, nullif(v_diff, 0);
end; $$;

grant execute on function public.oil_slot_for(uuid, timestamptz) to authenticated;

-- Submit with slot/lateness worked out server-side, and an explanation required
-- when it is late.
create or replace function public.submit_oil_test(
  p_fryer_id uuid, p_tpm numeric, p_temp_c numeric, p_filtered boolean,
  p_photo_url text, p_signature_url text default null, p_note text default null,
  p_is_audit boolean default false, p_late_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_fryer public.oil_fryers;
        v_grade text; v_id uuid; v_slot time; v_late int;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  select * into v_fryer from public.oil_fryers where id = p_fryer_id and org_id = v_org and not archived;
  if v_fryer.id is null then raise exception 'fryer not found'; end if;
  if not (v_role = 'owner' or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;

  select s.slot_time, s.minutes_late into v_slot, v_late
    from public.oil_slot_for(v_fryer.team_id, now()) s;

  -- An auditor's spot check is never "late"; it is not part of the schedule.
  if p_is_audit then v_slot := null; v_late := null; end if;

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

grant execute on function public.submit_oil_test(uuid, numeric, numeric, boolean, text, text, text, boolean, text) to authenticated;

-- The earlier overload must go or PostgREST resolves to it and skips the slot work.
drop function if exists public.submit_oil_test(uuid, numeric, numeric, boolean, text, text, text, boolean);

-- Sweep: "it's time to test the oil" to each branch's staff at each slot.
-- Arabic first — the people receiving these read Arabic.
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

    -- Due once the slot time has passed today, and only within the hour after
    -- (so a restart does not fire yesterday's reminders).
    continue when not (
      v_local >= (date_trunc('day', v_local) + r.at_time)
      and v_local < (date_trunc('day', v_local) + r.at_time + interval '1 hour')
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

    insert into public.oil_slot_pings (team_id, slot_time, branch_day)
    values (r.team_id, r.at_time, v_day)
    on conflict do nothing;
  end loop;

  return v_sent;
end; $$;
