-- Proves round 8 against LIVE data, then rolls everything back.
-- Any failure raises; the last line only prints if every check passed.
begin;
\i supabase/pending/2026-09-26-round-8.sql
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
declare b uuid := (select id from public.teams where name = 'Baghdad');
        k uuid := (select id from public.teams where name = 'Karbala');
        oday uuid := (select id from public.profiles where username = 'oday');
        mhmd uuid := (select id from public.profiles where username = 'mhmd');
        karam uuid := (select id from public.profiles where username = 'karam12');
        t_oday uuid := 'cc1f8326-0a4d-4d56-9394-3e1150c0a952';
        v_day date := public.branch_day_of('Asia/Baghdad', now());
        c public.task_completions; m public.chicken_marinations; n int; q0 bigint; v_id uuid; perms text[];
begin
  -- ------------------------------------------------ A. access switches
  perform pg_temp.as_user('hijazi12');
  if (select count(*) from public.permissions_of((select id from public.profiles where username = 'fatima'))) <> 4 then
    raise exception 'FAIL: Fatima should show 4 switches'; end if;
  perform pg_temp.as_user('fatima');
  if public.has_permission('control_panel') then raise exception 'FAIL: auditor has the control panel before the switch'; end if;
  begin perform public.set_org_settings('{"oil_grace_min": 10}'); raise exception 'FAIL: auditor changed settings without the switch';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perms := public.my_permissions();
  if not (perms @> array['excuse_late', 'checklist_alerts']) or 'control_panel' = any(perms) then raise exception 'FAIL: auditor defaults %', perms; end if;
  if (select count(*) from public.permissions_of((select id from public.profiles where username = 'oday'))) <> 0 then
    raise exception 'FAIL: the auditor can see someone''s switches'; end if;
  -- an ordinary admin gives her the control panel
  perform pg_temp.as_user('moh');
  perform public.set_person_permission((select id from public.profiles where username = 'fatima'), 'control_panel', true);
  begin perform public.set_person_permission((select id from public.profiles where username = 'moh'), 'excuse_late', false); raise exception 'FAIL: changed own switches';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.set_person_permission((select id from public.profiles where username = 'hijazi12'), 'control_panel', false); raise exception 'FAIL: touched the super admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('fatima');
  if not public.has_permission('control_panel') then raise exception 'FAIL: switch did not give the auditor the control panel'; end if;
  perform public.set_org_settings('{"oil_grace_min": 10}');
  perform pg_temp.as_user('kayes11');
  begin perform public.set_person_permission((select id from public.profiles where username = 'oday'), 'control_panel', true); raise exception 'FAIL: a manager flipped a switch';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if public.has_permission('control_panel') then raise exception 'FAIL: manager has the control panel'; end if;
  if not public.has_permission('edit_marination_start') then raise exception 'FAIL: manager cannot correct a start time'; end if;
  -- only the super admin changes an admin's switches
  perform pg_temp.as_user('hijazi12');
  perform public.set_person_permission((select id from public.profiles where username = 'moh'), 'control_panel', false);
  perform pg_temp.as_user('moh');
  if public.has_permission('control_panel') then raise exception 'FAIL: super admin could not take an admin''s control panel'; end if;
  begin perform public.set_iqd_per_point(25000); raise exception 'FAIL: admin without the switch changed the point rate';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('hijazi12');
  perform public.set_person_permission((select id from public.profiles where username = 'moh'), 'control_panel', true);
  if public.has_permission('checklist_alerts') then raise exception 'FAIL: super admin gets checklist alerts by default'; end if;

  -- ------------------------------------------------ B. deadlines (Baghdad)
  -- The one-time restamp at the end of the file ran already: Obaida (AM) and
  -- Karam (PM) sent theirs before the deadline existed → done, not late.
  perform pg_temp.as_user('hijazi12');
  if (select count(*) from public.checklist_today(b) where done_at is not null) <> 2 then
    raise exception 'FAIL: Baghdad should show both checklists done, got %', (select json_agg(x) from public.checklist_today(b) x); end if;
  if exists (select 1 from public.checklist_today(b) where was_late is not null) then raise exception 'FAIL: pre-deadline checklists judged late'; end if;
  if (select completion_id from public.checklist_today(b) where slot = 'AM') is null then raise exception 'FAIL: no record behind the AM deadline'; end if;
  -- no more reminders for a met deadline
  if public.checklist_slot_filled(b, v_day, 'PM') is not true then raise exception 'FAIL: PM not filled'; end if;

  -- Karbala: setting its deadline claims today's checklists already sent
  perform public.set_checklist_rule(k, 'shift', '09:00', '18:00', null, 30);
  if (select count(*) from public.checklist_today(k) where done_at is not null) <> 2 then
    raise exception 'FAIL: Karbala restamp %', (select json_agg(x) from public.checklist_today(k) x); end if;

  -- excuse a late one
  delete from public.task_completions where team_id = k and checklist_day = v_day;
  c := pg_temp.done(t_oday, 'oday', public.checklist_due_ts(v_day, '18:00', 'Asia/Baghdad') + interval '2 hours');
  if not c.was_late then raise exception 'FAIL: expected a late PM'; end if;
  perform pg_temp.as_user('mhmd');
  begin perform public.excuse_checklist_late(c.id, 'x'); raise exception 'FAIL: supervisor excused';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('fatima');
  begin perform public.excuse_checklist_late(c.id, '  '); raise exception 'FAIL: excused without a reason';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.excuse_checklist_late(c.id, 'power cut');
  if (select late_excuse_reason from public.task_completions where id = c.id) is distinct from 'power cut' then raise exception 'FAIL: excuse not kept'; end if;
  if not (select was_late from public.task_completions where id = c.id) then raise exception 'FAIL: excusing erased the lateness'; end if;
  if not (select excused from public.checklist_today(k) where slot = 'PM') then raise exception 'FAIL: dashboard does not show excused'; end if;

  -- remind now: manager of the branch yes, another branch's manager no
  perform pg_temp.as_user('kayes11');
  n := public.nudge_checklist(k, 'AM');
  perform pg_temp.as_user('hamdan');
  begin perform public.nudge_checklist(k, 'AM'); raise exception 'FAIL: another branch''s manager nudged';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- the auditor hears about a new checklist (a push is queued)
  q0 := (select count(*) from net.http_request_queue);
  c := pg_temp.done(t_oday, 'oday', now());
  if (select count(*) from net.http_request_queue) <= q0 and exists (
       select 1 from public.web_push_subscriptions s join public.profiles p on p.id = s.profile_id where p.role = 'hygiene_auditor') then
    raise exception 'FAIL: no alert queued for the auditor'; end if;

  -- ------------------------------------------------------ C. notifications
  if exists (select 1 from public.web_push_subscriptions s join public.profiles p on p.id = s.profile_id
              where p.deleted_at is not null or not p.active) then raise exception 'FAIL: removed accounts still registered'; end if;
  perform pg_temp.as_user('oday');
  perform public.save_web_push_subscription('https://example.invalid/test-endpoint', 'k', 'a');
  if (select count(*) from public.web_push_subscriptions where profile_id = oday) <> 1 then raise exception 'FAIL: one phone per account'; end if;
  perform public.report_push_state('granted', null, true, 'test');
  perform pg_temp.as_user('fatima');
  if (select count(*) from public.push_overview()) = 0 then raise exception 'FAIL: overview empty for the control panel'; end if;
  perform pg_temp.as_user('mhmd');
  if (select count(*) from public.push_overview()) <> 0 then raise exception 'FAIL: supervisor read the overview'; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set active = false where id = karam;
  if exists (select 1 from public.web_push_subscriptions where profile_id = karam) then raise exception 'FAIL: deactivating kept the phone'; end if;
  perform public.send_due_oil_reminders();
  perform public.send_due_marination_reminders();
  perform public.send_due_checklist_reminders();

  -- ------------------------------------------------------- D. marination
  perform pg_temp.as_user('mhmd');
  v_id := public.submit_chicken_marination(k, now() - interval '2 hours 30 minutes', 3, null, null, null, null, false, true);
  select * into m from public.chicken_marinations where id = v_id;
  if abs(extract(epoch from m.marinated_at - now())) > 5 then raise exception 'FAIL: start time not the server clock (%)', m.marinated_at; end if;
  if m.original_marinated_at is distinct from m.marinated_at then raise exception 'FAIL: original not kept'; end if;
  begin perform public.edit_marination_start(v_id, now() - interval '20 minutes', 'x'); raise exception 'FAIL: supervisor edited the start';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('fatima');
  begin perform public.edit_marination_start(v_id, now() - interval '20 minutes', 'x'); raise exception 'FAIL: auditor edited without the switch';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.as_user('kayes11');
  begin perform public.edit_marination_start(v_id, now() + interval '5 minutes', 'x'); raise exception 'FAIL: future start';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.edit_marination_start(v_id, now() - interval '20 minutes', ' '); raise exception 'FAIL: no reason';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.edit_marination_start(v_id, now() - interval '20 minutes', 'he forgot to record it');
  select * into m from public.chicken_marinations where id = v_id;
  if abs(extract(epoch from m.marinated_at - (now() - interval '20 minutes'))) > 5 then raise exception 'FAIL: start not moved'; end if;
  if m.due_at - m.marinated_at <> interval '3 hours' then raise exception 'FAIL: due not moved with it (%)', m.due_at - m.marinated_at; end if;
  if m.start_edit_reason is distinct from 'he forgot to record it' or m.start_edited_by is distinct from (select id from public.profiles where username = 'kayes11') then raise exception 'FAIL: edit not recorded'; end if;
  if (select count(*) from public.marination_start_edits where marination_id = v_id) <> 1 then raise exception 'FAIL: edit log'; end if;
  if m.remind_at is distinct from m.due_at then raise exception 'FAIL: reminder did not follow'; end if;
end $$;
rollback;
select 'ALL ROUND 8 TESTS PASSED' as result;
