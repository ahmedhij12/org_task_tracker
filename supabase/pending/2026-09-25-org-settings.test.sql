-- Proves the control panel rules against the LIVE data, then rolls back.
-- Success = only "PASS:" notices.
begin;

create function pg_temp.as_user(p_username text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select p.id into v_id from public.profiles p join public.organizations o on o.id = p.org_id
  where p.username = p_username and o.org_code = '51880';
  if v_id is null then raise exception 'FAIL: no profile %', p_username; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  return v_id;
end; $$;

do $$
declare
  v_baghdad uuid; v_slot uuid; v_id uuid; v_remind timestamptz; v_late int; v_n int; v_q0 int; v_q1 int;
  -- A day with no oil tests on record, so the "already done" rule stays out of it.
  v_at timestamptz := ('2026-01-15 14:25'::timestamp at time zone 'Asia/Baghdad');
  v_marinated timestamptz := ('2026-01-15 12:00'::timestamp at time zone 'Asia/Baghdad');
begin
  select id into v_baghdad from public.teams where name = 'Baghdad';

  -- 0. Defaults equal today's fixed values, so nothing moved on apply.
  if (select marination_hours from public.org_settings limit 1) <> 3
     or (select oil_grace_min from public.org_settings limit 1) <> 10 then
    raise exception 'FAIL: defaults are not today''s values';
  end if;
  select minutes_late into v_late from public.oil_slot_for(v_baghdad, v_at);
  if v_late is distinct from 15 then raise exception 'FAIL: 14:25 with 10 min grace should be 15 late, got %', v_late; end if;
  raise notice 'PASS: defaults match what was live (3 h, 10 min grace → 14:25 is 15 min late)';

  -- 1. A supervisor cannot touch any of it.
  perform pg_temp.as_user('ob12');
  begin perform public.set_org_settings('{"oil_grace_min": 30}'); raise exception 'FAIL: supervisor changed settings';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: supervisor refused settings (%)', sqlerrm; end;
  begin perform public.set_oil_slot(null, '16:00'); raise exception 'FAIL: supervisor added an oil time';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: supervisor refused oil times (%)', sqlerrm; end;
  begin perform public.send_test_push_to(v_baghdad, null); raise exception 'FAIL: supervisor sent a test push';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: supervisor refused push test (%)', sqlerrm; end;

  -- 2. The admin changes the rules and the live functions follow at once.
  perform pg_temp.as_user('hijazi12');
  perform public.set_org_settings('{"marination_hours": 2.5, "oil_grace_min": 20}');
  select minutes_late into v_late from public.oil_slot_for(v_baghdad, v_at);
  if v_late is distinct from 5 then raise exception 'FAIL: with 20 min grace 14:25 should be 5 late, got %', v_late; end if;
  raise notice 'PASS: oil grace 20 → the same test is now 5 min late';
  v_id := public.submit_chicken_marination(v_baghdad, v_marinated, 3, null, null, null, null, true, true);
  select remind_at into v_remind from public.chicken_marinations where id = v_id;
  if v_remind <> v_marinated + interval '150 minutes' then raise exception 'FAIL: reminder at %, expected 2h30 later', v_remind; end if;
  raise notice 'PASS: marination 2.5 h → the reminder is set 2 h 30 min after';
  begin perform public.set_org_settings('{"marination_hours": 20}'); raise exception 'FAIL: 20 h accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: out-of-range hours refused'; end;

  -- 3. Oil times: add, refuse a duplicate, move, remove.
  v_slot := public.set_oil_slot(null, '16:00');
  begin perform public.set_oil_slot(null, '16:00'); raise exception 'FAIL: duplicate time accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: duplicate oil time refused (%)', sqlerrm; end;
  perform public.set_oil_slot(v_slot, '16:30');
  if not exists (select 1 from public.oil_slots where id = v_slot and at_time = '16:30') then raise exception 'FAIL: move failed'; end if;
  perform public.remove_oil_slot(v_slot);
  if exists (select 1 from public.oil_slots where id = v_slot) then raise exception 'FAIL: remove failed'; end if;
  raise notice 'PASS: oil time added, moved and removed';

  -- 4. Push test to a branch queues one request (rolled back, never sent).
  select count(*) into v_q0 from net.http_request_queue;
  v_n := public.send_test_push_to(v_baghdad, null);
  select count(*) into v_q1 from net.http_request_queue;
  if v_n > 0 and v_q1 <> v_q0 + 1 then raise exception 'FAIL: % devices but nothing queued', v_n; end if;
  raise notice 'PASS: push test to Baghdad → % device(s)', v_n;
end $$;

rollback;
