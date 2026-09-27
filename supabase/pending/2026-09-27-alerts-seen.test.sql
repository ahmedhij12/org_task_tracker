-- Proves alerts-seen against LIVE data, then rolls everything back.
-- Any failure raises; the last line only prints if every check passed.
begin;
\i supabase/pending/2026-09-27-alerts-seen.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, ''), true); end $$;
do $$
declare v timestamptz; n int; ok boolean;
        fatima uuid := (select id from public.profiles where username = 'fatima');
begin
  -- The hygiene auditor marks what she saw; a later "until" moves it forward,
  -- an earlier one never moves it back, a future one stops at now.
  perform pg_temp.as_user('fatima');
  v := public.mark_alerts_seen('checklists', '2026-09-26 12:00+03');
  if v <> '2026-09-26 12:00+03'::timestamptz then raise exception 'FAIL: first mark, got %', v; end if;
  v := public.mark_alerts_seen('checklists', '2026-09-20 12:00+03');
  if v <> '2026-09-26 12:00+03'::timestamptz then raise exception 'FAIL: an older mark moved it back, got %', v; end if;
  v := public.mark_alerts_seen('checklists', now() + interval '3 days');
  if v > now() then raise exception 'FAIL: a future mark was stored, got %', v; end if;
  v := public.mark_alerts_seen('oil_change', null);
  if v is null then raise exception 'FAIL: oil mark with no until should use now'; end if;
  if (select count(*) from public.alerts_seen where profile_id = fatima) <> 2 then raise exception 'FAIL: Fatima should have 2 marks'; end if;

  -- The super admin and the other admin can too; each mark is their own.
  perform pg_temp.as_user('hijazi12');
  perform public.mark_alerts_seen('oil_change', '2026-09-27 10:00+03');
  perform pg_temp.as_user('moh');
  perform public.mark_alerts_seen('checklists', '2026-09-27 09:00+03');
  if (select seen_at from public.alerts_seen where profile_id = fatima and kind = 'checklists') > now() then
    raise exception 'FAIL: another person changed Fatima''s mark'; end if;

  -- A supervisor and a branch manager cannot; nor an unknown alert.
  perform pg_temp.as_user('karam12');
  ok := false; begin perform public.mark_alerts_seen('checklists', now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a supervisor marked alerts as seen'; end if;
  perform pg_temp.as_user('kayes11');
  ok := false; begin perform public.mark_alerts_seen('oil_change', now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a branch manager marked alerts as seen'; end if;
  perform pg_temp.as_user('fatima');
  ok := false; begin perform public.mark_alerts_seen('anything', now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: an unknown alert kind was accepted'; end if;
end $$;

-- Through the API role: you read only your own marks and cannot write directly.
select pg_temp.as_user('fatima');
set local role authenticated;
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.alerts_seen;
  if n <> 2 then raise exception 'FAIL: Fatima should read only her own 2 marks, read %', n; end if;
  ok := false; begin update public.alerts_seen set seen_at = now(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a direct update was allowed'; end if;
  ok := false; begin insert into public.alerts_seen values (auth.uid(), 'checklists', now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a direct insert was allowed'; end if;
end $$;
reset role;
rollback;
select 'ALL ALERTS-SEEN TESTS PASSED' as result;
