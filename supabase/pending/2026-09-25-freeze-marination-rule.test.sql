begin;
\i supabase/pending/2026-09-25-freeze-marination-rule.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, true); end $$;
do $$
declare v_id uuid; v_team uuid := (select id from public.teams where name = 'Test Branch'); v_row public.chicken_marinations; v_task uuid;
begin
  if exists (select 1 from public.chicken_marinations where due_at is null) then raise exception 'FAIL: rows left unfrozen'; end if;
  raise notice 'PASS: every existing batch has its rule frozen';
  perform pg_temp.as_user('hijazi12');
  perform public.set_org_settings('{"marination_hours": 4, "marination_early_grace_min": 7, "marination_late_grace_min": 30}');
  perform pg_temp.as_user('qa_supervisor');
  v_id := public.submit_chicken_marination(v_team, now(), 2, null, null, null, null, false, false);
  select * into v_row from public.chicken_marinations where id = v_id;
  if v_row.due_at <> v_row.marinated_at + interval '4 hours' or v_row.early_grace_min <> 7 or v_row.late_grace_min <> 30 then
    raise exception 'FAIL: new batch froze % % %', v_row.due_at - v_row.marinated_at, v_row.early_grace_min, v_row.late_grace_min;
  end if;
  raise notice 'PASS: a new batch freezes today''s rule (4 h, 7 / 30 min)';
  -- I8: the hygiene auditor cannot reopen a supervisor's checklist.
  perform pg_temp.as_user('qa_hygiene');
  select id into v_task from public.tasks where assignee_id = (select id from public.profiles where username = 'qa_supervisor') limit 1;
  begin perform public.set_task_completion(v_task, false); raise exception 'FAIL: hygiene reopened a supervisor task';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: she cannot reopen a supervisor''s work (%)', sqlerrm; end;
end $$;
rollback;
