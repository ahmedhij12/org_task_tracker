-- Proves admin-activity locations against LIVE data, then rolls back.
begin;
\i supabase/pending/2026-09-26-activity-location.sql
create function pg_temp.req(u text, geo text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('user-agent', 'test', 'x-geo', geo)::text, true); end $$;
create function pg_temp.b64(t text) returns text language sql as $$ select replace(encode(convert_to(t, 'UTF8'), 'base64'), E'\n', '') $$;
do $$
declare g jsonb; n0 bigint := (select coalesce(max(id), 0) from public.admin_activity); v_id uuid;
begin
  -- a watched admin (the auditor) with location allowed: an opened screen keeps it, Arabic intact
  perform pg_temp.req('fatima', pg_temp.b64('{"s":"ok","lat":33.3152,"lng":44.3661,"acc":12.4,"place":"شارع الكرادة، بغداد","at":"2026-09-26T07:00:00Z","sw":402,"sh":874}'));
  perform public.log_activity('view', '/history');
  select geo into g from public.admin_activity where id > n0 order by id desc limit 1;
  if g is null or g->>'s' <> 'ok' or (g->>'lat')::numeric <> 33.3152 or (g->>'acc')::int <> 12
     or g->>'place' <> 'شارع الكرادة، بغداد' or (g->>'sw')::int <> 402 then raise exception 'FAIL: view geo %', g; end if;

  -- a change she makes keeps it too (through the trigger)
  select id into v_id from public.task_completions order by created_at desc limit 1;
  update public.task_completions set review_note = coalesce(review_note, '') || ' ' where id = v_id;
  select geo into g from public.admin_activity where id > n0 and kind = 'change' order by id desc limit 1;
  if g is null or (g->>'lng')::numeric <> 44.3661 then raise exception 'FAIL: change geo %', g; end if;

  -- location not allowed: said so, screen kept, no coordinates
  perform pg_temp.req('fatima', pg_temp.b64('{"s":"denied","sw":430,"sh":932}'));
  perform public.log_activity('view', '/report');
  select geo into g from public.admin_activity where id > n0 order by id desc limit 1;
  if g->>'s' <> 'denied' or g ? 'lat' or (g->>'sh')::int <> 932 then raise exception 'FAIL: denied geo %', g; end if;

  -- junk is dropped, the line still recorded
  perform pg_temp.req('fatima', 'not base64 at all!!');
  perform public.log_activity('view', '/junk');
  if (select geo from public.admin_activity where id > n0 order by id desc limit 1) is not null then raise exception 'FAIL: junk kept'; end if;
  if (select op from public.admin_activity where id > n0 order by id desc limit 1) <> '/junk' then raise exception 'FAIL: junk dropped the line'; end if;
  perform pg_temp.req('fatima', pg_temp.b64('{"s":"ok","lat":123,"lng":44}'));
  perform public.log_activity('view', '/bad');
  if (select geo->>'s' from public.admin_activity where id > n0 order by id desc limit 1) <> 'none' then raise exception 'FAIL: bad latitude kept'; end if;

  -- someone who is not watched still records nothing
  perform pg_temp.req('karam12', pg_temp.b64('{"s":"ok","lat":33,"lng":44}'));
  perform public.log_activity('view', '/x');
  if (select actor_name from public.admin_activity where id > n0 order by id desc limit 1) = 'Karam' then raise exception 'FAIL: supervisor recorded'; end if;
end $$;
rollback;
select 'ALL ACTIVITY-LOCATION TESTS PASSED' as result;
