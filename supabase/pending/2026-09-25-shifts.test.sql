-- Proves shifts against LIVE data (Test Branch only), then rolls back.
begin;
\i supabase/pending/2026-09-25-shifts.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, true); end $$;
do $$
declare v_team uuid := (select id from public.teams where name = 'Test Branch');
        v_sup uuid := (select id from public.profiles where username = 'qa_supervisor');
        v_other uuid := (select id from public.teams where name = 'Baghdad');
begin
  perform pg_temp.as_user('qa_manager');
  perform public.set_shift(v_team, v_sup, current_date, 'AM');
  perform public.set_shift(v_team, v_sup, current_date + 1, 'OFF');
  perform public.set_shift(v_team, v_sup, current_date, 'PM');
  if (select shift from public.shifts where team_id = v_team and profile_id = v_sup and day = current_date) <> 'PM' then raise exception 'FAIL: change did not stick'; end if;
  raise notice 'PASS: the manager sets and changes his supervisor''s shifts';
  perform public.set_shift(v_team, v_sup, current_date + 1, null);
  if exists (select 1 from public.shifts where team_id = v_team and profile_id = v_sup and day = current_date + 1) then raise exception 'FAIL: clear failed'; end if;
  raise notice 'PASS: a shift can be cleared';
  begin perform public.set_shift(v_other, (select pt.profile_id from public.profile_teams pt join public.profiles p on p.id = pt.profile_id where pt.team_id = v_other and p.role = 'employee' limit 1), current_date, 'AM');
    raise exception 'FAIL: manager set another branch'; exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: not another branch (%)', sqlerrm; end;
  begin perform public.set_shift(v_team, v_sup, current_date + 30, 'AM'); raise exception 'FAIL: 30 days ahead';
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: not a month ahead (%)', sqlerrm; end;
  perform pg_temp.as_user('qa_supervisor');
  begin perform public.set_shift(v_team, v_sup, current_date, 'OFF'); raise exception 'FAIL: supervisor set his own shift';
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: a supervisor cannot set shifts (%)', sqlerrm; end;
end $$;
do $$ begin perform pg_temp.as_user('qa_supervisor'); end $$;
set local role authenticated;
do $$ begin
  if (select count(*) from public.shifts) <> 1 then raise exception 'FAIL: supervisor sees % shift rows', (select count(*) from public.shifts); end if;
  raise notice 'PASS: the supervisor sees his branch''s shifts';
end $$;
reset role;
rollback;
