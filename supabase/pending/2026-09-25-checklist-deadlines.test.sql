-- Proves checklist deadlines + the schedule against LIVE data (Karbala:
-- manager kayes11, supervisors mhmd + oday), then rolls everything back.
-- Any failure raises; the last line only prints if every check passed.
begin;
\i supabase/pending/2026-09-25-checklist-deadlines.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, ''), true); end $$;
create function pg_temp.done(p_task uuid, p_actor text, p_at timestamptz) returns public.task_completions language plpgsql as $$
declare v public.task_completions; a uuid := (select id from public.profiles where username = p_actor);
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.task_completions (task_id, org_id, team_id, task_title, actor_id, action, subject_profile_id, iqd_per_point, created_at)
  select t.id, t.org_id, t.team_id, t.title, a, 'completed', a, 25000, p_at from public.tasks t where t.id = p_task
  returning * into v;
  return v;
end $$;
do $$
declare k uuid := (select id from public.teams where name = 'Karbala');
        s uuid := (select id from public.teams where name = 'Samawah');
        oday uuid := (select id from public.profiles where username = 'oday');
        mhmd uuid := (select id from public.profiles where username = 'mhmd');
        kayes uuid := (select id from public.profiles where username = 'kayes11');
        t_oday uuid := 'cc1f8326-0a4d-4d56-9394-3e1150c0a952';
        t_mhmd uuid := '087351de-5213-445e-a939-9af768e7c70f';
        v_day date := public.branch_day_of('Asia/Baghdad', now());
        v_today date := (now() at time zone 'Asia/Baghdad')::date;
        am timestamptz; pm timestamptz; c public.task_completions; n int; arr uuid[];
begin
  -- the clock
  if public.branch_day_of('Asia/Baghdad', '2026-09-26 01:00+03') <> '2026-09-25' then raise exception 'FAIL: 1 AM belongs to the day before'; end if;
  if public.checklist_due_ts('2026-09-25', '01:00', 'Asia/Baghdad') <> '2026-09-26 01:00+03' then raise exception 'FAIL: a 1 AM deadline is after midnight'; end if;
  if public.checklist_due_ts('2026-09-25', '11:00', 'Asia/Baghdad') <> '2026-09-25 11:00+03' then raise exception 'FAIL: 11 AM deadline'; end if;

  -- only an admin sets deadlines
  perform pg_temp.as_user('kayes11');
  begin perform public.set_checklist_rule(k, 'shift', '11:00', '19:00', null, 30); raise exception 'FAIL: manager set a deadline';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('hijazi12');
  perform public.set_checklist_rule(k, 'shift', '11:00', '19:00', null, 30);
  begin perform public.set_checklist_rule(k, 'shift', '11:00', null, null, 30); raise exception 'FAIL: shift mode without PM';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- the schedule: Oday AM for 7 days makes Mohamad PM
  perform pg_temp.as_user('kayes11');
  n := public.set_shift_range(k, oday, v_today, v_today + 6, 'AM');
  if n <> 7 then raise exception 'FAIL: % days set, expected 7', n; end if;
  if (select count(*) from public.shifts where team_id = k and profile_id = mhmd and shift = 'PM' and day between v_today and v_today + 6) <> 7
    then raise exception 'FAIL: Mohamad was not put on PM'; end if;
  if (select count(*) from public.shifts where team_id = k and profile_id = oday and shift = 'AM' and day between v_today and v_today + 6) <> 7
    then raise exception 'FAIL: Oday not on AM'; end if;
  begin perform public.set_shift_range(s, (select pt.profile_id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id where pt.team_id = s and p.role = 'employee' limit 1), v_today, v_today, 'AM');
    raise exception 'FAIL: manager scheduled another branch';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.set_shift_range(k, oday, v_today, v_today + 40, 'AM'); raise exception 'FAIL: 40 days ahead';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  -- make sure the branch day has shifts too (before 5 AM it is yesterday)
  if v_day <> v_today then perform public.set_shift_range(k, oday, v_day, v_day, 'AM'); end if;

  -- who hears it
  arr := public.checklist_recipients(k, v_day, 'AM', false);
  if arr <> array[oday] then raise exception 'FAIL: AM reminder should reach only Oday, got %', arr; end if;
  arr := public.checklist_recipients(k, v_day, 'AM', true);
  if not (arr @> array[oday, kayes] and array_length(arr, 1) = 2) then raise exception 'FAIL: late AM should reach Oday + kayes11, got %', arr; end if;

  -- stamps: Oday an hour early for AM = on time; Mohamad 45 min after PM (grace 30) = late
  am := public.checklist_due_ts(v_day, '11:00', 'Asia/Baghdad');
  pm := public.checklist_due_ts(v_day, '19:00', 'Asia/Baghdad');
  c := pg_temp.done(t_oday, 'oday', am - interval '1 hour');
  if c.checklist_slot is distinct from 'AM' or c.was_late or c.due_at <> am then raise exception 'FAIL: Oday on-time AM stamp %/%/%', c.checklist_slot, c.was_late, c.due_at; end if;
  c := pg_temp.done(t_mhmd, 'mhmd', pm + interval '45 minutes');
  if c.checklist_slot is distinct from 'PM' or not c.was_late or c.due_at <> pm then raise exception 'FAIL: Mohamad late PM stamp %/%/%', c.checklist_slot, c.was_late, c.due_at; end if;
  c := pg_temp.done(t_oday, 'oday', pm + interval '50 minutes');
  if c.checklist_slot is not null or c.was_late then raise exception 'FAIL: an extra checklist got a deadline'; end if;

  perform pg_temp.as_user('kayes11');
  if (select count(*) from public.checklist_today(k)) <> 2 then raise exception 'FAIL: today should show AM + PM'; end if;
  if (select done_by from public.checklist_today(k) where slot = 'AM') is distinct from (select name from public.profiles where id = oday) then raise exception 'FAIL: AM done by'; end if;
  if not (select was_late from public.checklist_today(k) where slot = 'PM') then raise exception 'FAIL: PM late'; end if;
  perform pg_temp.as_user('mhmd');
  if (select count(*) from public.checklist_today(s)) <> 0 then raise exception 'FAIL: a supervisor read another branch'; end if;

  -- no schedule: the first open deadline, so a missed AM is answered late
  delete from public.task_completions where team_id = k and checklist_day = v_day;
  delete from public.shifts where team_id = k;
  arr := public.checklist_recipients(k, v_day, 'AM', false);
  if not (arr @> array[oday, mhmd] and array_length(arr, 1) = 2) then raise exception 'FAIL: unscheduled should reach both supervisors, got %', arr; end if;
  c := pg_temp.done(t_mhmd, 'mhmd', am + interval '2 hours');
  if c.checklist_slot is distinct from 'AM' or not c.was_late then raise exception 'FAIL: unscheduled late AM %/%', c.checklist_slot, c.was_late; end if;
  c := pg_temp.done(t_oday, 'oday', pm - interval '10 minutes');
  if c.checklist_slot is distinct from 'PM' or c.was_late then raise exception 'FAIL: unscheduled on-time PM'; end if;

  -- the manager's own checklist never answers a deadline
  delete from public.task_completions where team_id = k and checklist_day = v_day;
  c := pg_temp.done((select t.id from public.tasks t join public.checklist_templates ct on ct.id = t.template_id where t.team_id = k and t.assignee_id = kayes and ct.assign_to_role = 'team_admin' limit 1), 'kayes11', am);
  if c.checklist_slot is not null then raise exception 'FAIL: the manager''s own checklist took a deadline'; end if;
  -- but the supervisors' checklist, filled by the manager, does
  c := pg_temp.done((select t.id from public.tasks t join public.checklist_templates ct on ct.id = t.template_id where t.team_id = k and t.assignee_id = kayes and ct.assign_to_role = 'employee' limit 1), 'kayes11', am);
  if c.checklist_slot is distinct from 'AM' then raise exception 'FAIL: manager filling in did not count'; end if;

  -- per day
  perform pg_temp.as_user('hijazi12');
  perform public.set_checklist_rule(k, 'day', null, null, '12:00', 60);
  delete from public.task_completions where team_id = k and checklist_day = v_day;
  c := pg_temp.done(t_oday, 'oday', public.checklist_due_ts(v_day, '12:00', 'Asia/Baghdad') + interval '59 minutes');
  if c.checklist_slot is distinct from 'DAY' or c.was_late then raise exception 'FAIL: per day inside the 60 min grace'; end if;

  -- turning it off
  perform pg_temp.as_user('hijazi12');
  perform public.set_checklist_rule(k, null, null, null, null, null);
  if exists (select 1 from public.checklist_rules where team_id = k) then raise exception 'FAIL: turn off'; end if;
  c := pg_temp.done(t_oday, 'oday', now());
  if c.checklist_slot is not null or c.was_late then raise exception 'FAIL: no rule should stamp nothing'; end if;

  -- the reminder job runs clean
  perform pg_temp.as_user('hijazi12');
  perform public.set_checklist_rule(k, 'shift', '11:00', '19:00', null, 30);
  perform public.send_due_checklist_reminders();
end $$;
rollback;
select 'ALL CHECKLIST DEADLINE TESTS PASSED' as result;
