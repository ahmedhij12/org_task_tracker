-- Proves the hygiene auditor role against LIVE data, then rolls back — the
-- test account it creates never exists outside this transaction.
begin;
\i supabase/pending/2026-09-25-hygiene-auditor.sql

create function pg_temp.as_profile(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end; $$;

create temp table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated;

do $$
declare v_hyg uuid; v_mgr uuid; v_mgr_team uuid;
begin
  perform pg_temp.as_profile((select id from public.profiles where username = 'hijazi12'));
  perform public.admin_create_user('Test Hygiene', 'hygtest', 'secret123', 'hygiene_auditor', null, null, null);
  select id into v_hyg from public.profiles where username = 'hygtest';
  if v_hyg is null or (select role from public.profiles where id = v_hyg) <> 'hygiene_auditor' then
    raise exception 'FAIL: the admin could not create a hygiene auditor';
  end if;
  insert into t_ids values ('hyg', v_hyg);
  raise notice 'PASS: an admin creates a hygiene auditor';

  select p.id, pt.team_id into v_mgr, v_mgr_team from public.profiles p join public.profile_teams pt on pt.profile_id = p.id
  where p.role = 'team_admin' and p.deleted_at is null limit 1;
  perform pg_temp.as_profile(v_mgr);
  begin
    perform public.admin_create_user('X', 'hygtest2', 'secret123', 'hygiene_auditor', v_mgr_team, null, null);
    raise exception 'FAIL: a branch manager created a hygiene auditor';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: a branch manager cannot create one (%)', sqlerrm;
  end;
end $$;

-- As her, through RLS like the real app.
do $$ begin perform pg_temp.as_profile((select id from t_ids where k = 'hyg')); end $$;
set local role authenticated;
do $$
declare v_all int; v_seen int; v_branches int; v_task uuid; v_hyg uuid := (select id from t_ids where k = 'hyg');
begin
  select count(distinct team_id) into v_branches from public.oil_tests;
  if v_branches < 2 then raise exception 'FAIL: she sees oil tests of % branch(es)', v_branches; end if;
  select count(*) into v_seen from public.task_completions;
  if v_seen = 0 then raise exception 'FAIL: she sees no history'; end if;
  raise notice 'PASS: she reads every branch (oil tests from % branches, % history rows)', v_branches, v_seen;

  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review, is_audit)
  select public.my_org_id(), (select id from public.teams where name = 'Baghdad'), 'Daily Hygiene Checklist', v_hyg, v_hyg,
         (select id from public.checklist_templates where name like '% — Audit' limit 1), 0, 'medium', false, true
  returning id into v_task;
  raise notice 'PASS: she creates her own audit task';

  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, priority, requires_review, is_audit)
    select public.my_org_id(), (select id from public.teams where name = 'Baghdad'), 'sneaky', null, v_hyg, 'medium', false, false;
    raise exception 'FAIL: she created an ordinary task';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: she cannot hand out ordinary tasks (%)', sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_hyg uuid := (select id from t_ids where k = 'hyg'); v_fryer uuid; v_n int;
begin
  perform pg_temp.as_profile(v_hyg);
  -- What she may do.
  select id into v_fryer from public.oil_fryers where not archived and team_id = (select id from public.teams where name = 'Karbala') limit 1;
  perform public.submit_oil_test(v_fryer, 14, 170, false, 'https://example.invalid/t.jpg', null, null, true, null);
  raise notice 'PASS: she tests oil at any branch';
  perform public.get_current_branch_summary();
  raise notice 'PASS: she reads the branch summary';
  -- What she may not.
  begin perform public.set_org_settings('{"oil_grace_min": 30}'); raise exception 'FAIL: control panel';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: no control panel (%)', sqlerrm; end;
  begin perform public.create_team('Nope'); raise exception 'FAIL: branches';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: no branches (%)', sqlerrm; end;
  begin perform public.admin_create_user('N', 'nope1', 'secret123', 'employee', null, null, null); raise exception 'FAIL: staff';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: no staff (%)', sqlerrm; end;
  -- And the super admin sees it all.
  perform public.log_activity('view', '/history', null);
  select count(*) into v_n from public.admin_activity where actor_id = v_hyg;
  if v_n = 0 then raise exception 'FAIL: her actions were not recorded'; end if;
  raise notice 'PASS: everything she did is recorded (% lines)', v_n;
end $$;

rollback;
