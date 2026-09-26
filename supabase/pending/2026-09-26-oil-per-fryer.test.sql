-- Proves oil-per-fryer against LIVE data, then rolls everything back.
-- Any failure raises; the last line only prints if every check passed.
-- The one row it adds is a GOOD reading (no red-oil push) on a day before
-- oil tests began, and it is rolled back with the rest.
begin;
\i supabase/pending/2026-09-26-oil-per-fryer.sql
do $$
declare b uuid := (select id from public.teams where name = 'Baghdad');
        kfc uuid := (select id from public.oil_fryers where name = 'شواية الكنتاكي' and team_id = (select id from public.teams where name = 'Baghdad'));
        fnk uuid := (select id from public.oil_fryers where name = 'شواية الفنكر' and team_id = (select id from public.teams where name = 'Baghdad'));
        karam uuid := (select id from public.profiles where username = 'karam12');
        r record; n int; names text;
begin
  if kfc is null or fnk is null then raise exception 'FAIL: Baghdad fryers not found'; end if;

  -- ------------------------------------------------ A. his real 25 Sep, 7 PM slot
  -- KFC tested 7:13 PM took the slot; Fanker tested 7:19 PM was an "extra".
  select * into r from public.oil_slot_for(b, '2026-09-25 19:19:00+03', fnk);
  if r.slot_time is distinct from '19:00'::time or r.minutes_late is distinct from 9 then
    raise exception 'FAIL: Fanker at 7:19 should be the 7 PM slot, 9 min late — got % / %', r.slot_time, r.minutes_late; end if;
  select * into r from public.oil_slot_for(b, '2026-09-25 19:19:00+03', kfc);
  if r.slot_time is not null then raise exception 'FAIL: KFC already did 7 PM — a second test is an extra'; end if;
  -- An app that has not reloaded (no fryer) keeps the old branch-wide answer.
  select * into r from public.oil_slot_for(b, '2026-09-25 19:19:00+03');
  if r.slot_time is not null then raise exception 'FAIL: no fryer should keep the branch-wide answer'; end if;
  select count(*), string_agg(name, ',') into n, names from public.oil_fryers_untested(b, '19:00', '2026-09-25');
  if n <> 1 or names <> 'شواية الفنكر' then raise exception 'FAIL: 7 PM on 25 Sep: only Fanker untested, got % (%)', n, names; end if;
  select count(*), string_agg(name, ',') into n, names from public.oil_fryers_untested(b, '14:00', '2026-09-25');
  if n <> 1 or names <> 'شواية الكنتاكي' then raise exception 'FAIL: 2 PM on 25 Sep: only KFC untested, got % (%)', n, names; end if;

  -- ------------------------------------------------ B. a clean day, step by step
  select count(*) into n from public.oil_fryers_untested(b, '19:00', '2026-09-20');
  if n <> 2 then raise exception 'FAIL: nothing tested on 20 Sep → both fryers untested (archived Falafel not counted), got %', n; end if;
  -- Early: 30 min before the slot counts for it, not late.
  select * into r from public.oil_slot_for(b, '2026-09-20 18:30:00+03', fnk);
  if r.slot_time is distinct from '19:00'::time or r.minutes_late is not null then raise exception 'FAIL: early test should count for 7 PM, on time'; end if;

  insert into public.oil_tests (org_id, team_id, fryer_id, actor_id, is_audit, tpm, temp_c, filtered, grade, photo_url, slot_time, minutes_late, tested_at, created_at)
  select t.org_id, b, kfc, karam, false, 10, 170, false, 'good', 'test', '19:00', null, '2026-09-20 19:02:00+03', '2026-09-20 19:02:00+03'
    from public.teams t where t.id = b;

  select * into r from public.oil_slot_for(b, '2026-09-20 19:25:00+03', fnk);
  if r.slot_time is distinct from '19:00'::time or r.minutes_late is distinct from 15 then
    raise exception 'FAIL: KFC done does not close Fanker — Fanker at 7:25 is 15 min late, got % / %', r.slot_time, r.minutes_late; end if;
  select * into r from public.oil_slot_for(b, '2026-09-20 19:25:00+03', kfc);
  if r.slot_time is not null then raise exception 'FAIL: KFC is done for 7 PM'; end if;
  select count(*), string_agg(name, ',') into n, names from public.oil_fryers_untested(b, '19:00', '2026-09-20');
  if n <> 1 or names <> 'شواية الفنكر' then raise exception 'FAIL: reminder should name only Fanker, got % (%)', n, names; end if;
  -- The next slot is untouched by this one.
  select count(*) into n from public.oil_fryers_untested(b, '01:00', '2026-09-20');
  if n <> 2 then raise exception 'FAIL: 1 AM slot should still list both, got %', n; end if;

  -- ------------------------------------------------ C. the app can call the new signature, the reminder helper stays private
  if not has_function_privilege('authenticated', 'public.oil_slot_for(uuid, timestamptz, uuid)', 'execute') then
    raise exception 'FAIL: the app cannot call oil_slot_for'; end if;
  if has_function_privilege('anon', 'public.oil_fryers_untested(uuid, time, date)', 'execute') then
    raise exception 'FAIL: oil_fryers_untested should not be callable from outside'; end if;
end $$;
rollback;
select 'ALL OIL-PER-FRYER TESTS PASSED' as result;
