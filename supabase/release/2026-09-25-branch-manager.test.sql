-- Proves the branch-manager release step against LIVE data, then rolls back.
begin;
\i supabase/release/2026-09-25-branch-manager.sql

create function pg_temp.as_profile(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end; $$;

do $$
declare v_mgr uuid; v_team uuid; v_sup_tpl uuid; v_n int; v_fryer uuid; v_test uuid; v_slot time; v_late int; v_done uuid;
begin
  -- 1. Every branch manager now holds the supervisors' checklist at his branch.
  select count(*) into v_n
  from public.profiles p join public.profile_teams pt on pt.profile_id = p.id
  join public.checklist_templates ct on ct.org_id = p.org_id and ct.assign_to_role = 'employee' and not ct.archived
  where p.role = 'team_admin' and p.deleted_at is null
    and not exists (select 1 from public.tasks t where t.assignee_id = p.id and t.team_id = pt.team_id and t.template_id = ct.id);
  if v_n <> 0 then raise exception 'FAIL: % manager/branch pairs still lack the supervisors'' checklist', v_n; end if;
  select count(*) into v_n from public.tasks t join public.profiles p on p.id = t.assignee_id
  join public.checklist_templates ct on ct.id = t.template_id
  where p.role = 'team_admin' and ct.assign_to_role = 'employee';
  raise notice 'PASS: every branch manager holds the supervisors'' checklist (% tasks)', v_n;

  -- 2. A manager's oil test is untimed.
  select p.id, pt.team_id into v_mgr, v_team from public.profiles p join public.profile_teams pt on pt.profile_id = p.id
  where p.role = 'team_admin' and p.deleted_at is null and p.active limit 1;
  select id into v_fryer from public.oil_fryers where team_id = v_team and not archived limit 1;
  if v_fryer is not null then
    perform pg_temp.as_profile(v_mgr);
    v_test := public.submit_oil_test(v_fryer, 15, 170, false, 'https://example.invalid/test.jpg');
    select slot_time, minutes_late into v_slot, v_late from public.oil_tests where id = v_test;
    if v_slot is not null or v_late is not null then raise exception 'FAIL: manager test got slot % late %', v_slot, v_late; end if;
    raise notice 'PASS: a branch manager''s oil test is untimed';
  else
    raise notice 'NOTE: the manager''s branch has no fryer; untimed oil not exercised';
  end if;

  -- 3. A manager can no longer verify; the admin still can.
  select id into v_done from public.task_completions where action = 'completed' and team_id = v_team order by created_at desc limit 1;
  if v_done is not null then
    perform pg_temp.as_profile(v_mgr);
    begin
      perform public.review_task_completion(v_done, null);
      raise exception 'FAIL: a manager verified';
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      raise notice 'PASS: a branch manager cannot verify (%)', sqlerrm;
    end;
    perform pg_temp.as_profile((select id from public.profiles where username = 'hijazi12'));
    perform public.review_task_completion(v_done, null);
    raise notice 'PASS: the admin still verifies';
  end if;
end $$;
rollback;
