-- Proves the late-checklist decisions against LIVE data, then rolls back.
-- Any failure raises; the last line only prints if every check passed.
begin;
\i supabase/pending/2026-09-26-late-decisions.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, ''), true); end $$;
create function pg_temp.sent(p_actor text, p_late boolean) returns uuid language plpgsql as $$
declare v uuid; a uuid := (select id from public.profiles where username = p_actor);
        b uuid := (select id from public.teams where name = 'Baghdad');
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.task_completions (task_id, org_id, team_id, task_title, actor_id, action, subject_profile_id, iqd_per_point, note)
  select t.id, t.org_id, b, t.title, a, 'completed', a, 25000, 'traffic'
    from public.tasks t join public.checklist_templates ct on ct.id = t.template_id
   where ct.assign_to_role = 'employee' and t.org_id = (select org_id from public.profiles where id = a)
   limit 1
  returning id into v;
  update public.task_completions set was_late = p_late, checklist_slot = 'AM', due_at = now() - interval '2 hours',
         late_outcome = null, late_penalty_iqd = null, reviewed_by = null, reviewed_at = null
   where id = v;
  return v;
end $$;
do $$
declare c1 uuid; c2 uuid; c3 uuid; c4 uuid; r record; n int;
        karam uuid := (select id from public.profiles where username = 'karam12');
        fatima uuid := (select id from public.profiles where username = 'fatima');
begin
  c1 := pg_temp.sent('karam12', true);
  c2 := pg_temp.sent('karam12', true);
  c3 := pg_temp.sent('karam12', true);
  c4 := pg_temp.sent('karam12', false);
  update public.org_settings set late_checklist_penalty_iqd = 0;

  -- a supervisor cannot decide
  perform pg_temp.as_user('karam12');
  begin perform public.decide_late_checklist(c1, 'none'); raise exception 'FAIL: supervisor decided';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  perform pg_temp.as_user('fatima');
  -- no amount set yet -> a penalty is refused, nothing saved
  begin perform public.decide_late_checklist(c1, 'penalty'); raise exception 'FAIL: penalty with no amount';
  exception when others then if sqlerrm not like '%control panel%' then raise; end if; end;
  if (select late_outcome from public.task_completions where id = c1) is not null then raise exception 'FAIL: refused penalty saved'; end if;
  -- an on-time checklist cannot be "decided"
  begin perform public.decide_late_checklist(c4, 'none'); raise exception 'FAIL: decided an on-time one';
  exception when others then if sqlerrm not like '%not late%' then raise; end if; end;
  begin perform public.decide_late_checklist(c1, 'fine'); raise exception 'FAIL: unknown outcome';
  exception when others then if sqlerrm not like '%unknown%' then raise; end if; end;

  perform set_config('request.jwt.claims', '', true);
  update public.org_settings set late_checklist_penalty_iqd = 25000;
  perform pg_temp.as_user('fatima');
  perform public.decide_late_checklist(c1, 'penalty', 'second time this week');
  select * into r from public.task_completions where id = c1;
  if r.late_outcome <> 'penalty' or r.late_penalty_iqd <> 25000 or r.reviewed_by <> fatima or r.reviewed_at is null
     or r.review_note <> 'second time this week' then raise exception 'FAIL: penalty row %', row_to_json(r); end if;
  -- the amount is stamped: changing the setting later leaves it alone
  perform set_config('request.jwt.claims', '', true);
  update public.org_settings set late_checklist_penalty_iqd = 50000;
  if (select late_penalty_iqd from public.task_completions where id = c1) <> 25000 then raise exception 'FAIL: amount not stamped'; end if;
  perform pg_temp.as_user('fatima');
  begin perform public.decide_late_checklist(c1, 'none'); raise exception 'FAIL: decided twice';
  exception when others then if sqlerrm not like '%already decided%' then raise; end if; end;

  -- warning: saved, verified, and a push queued for him only
  perform public.decide_late_checklist(c2, 'warning');
  select * into r from public.task_completions where id = c2;
  if r.late_outcome <> 'warning' or r.late_penalty_iqd is not null or r.reviewed_by <> fatima then raise exception 'FAIL: warning row'; end if;
  -- verify as before
  perform public.decide_late_checklist(c3, 'none');
  if (select late_outcome from public.task_completions where id = c3) <> 'none' then raise exception 'FAIL: none row'; end if;

  -- the report: Karam carries the one 25,000 penalty, no audit money
  perform pg_temp.as_user('hijazi12');
  select * into r from public.get_current_branch_summary() s where s.subject_profile_id = karam;
  if r is null then raise exception 'FAIL: Karam missing from the live report'; end if;
  if r.late_penalty_iqd <> 25000 or r.total_points <> 0 or r.iqd_amount <> 0 then raise exception 'FAIL: live report %', row_to_json(r); end if;
  select count(*) into n from public.get_current_branch_summary() s where s.late_penalty_iqd > 0 and s.subject_profile_id <> karam;
  if n <> 0 then raise exception 'FAIL: penalties on someone else'; end if;
  perform pg_temp.as_user('fatima');
  if not exists (select 1 from public.get_current_branch_summary() s where s.subject_profile_id = karam) then
    raise exception 'FAIL: auditor cannot read the report'; end if;
  perform pg_temp.as_user('karam12');
  begin perform public.get_current_branch_summary(); raise exception 'FAIL: supervisor read the report';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
rollback;
select 'ALL LATE-DECISION TESTS PASSED' as result;
