-- Proves the admin activity record against the LIVE data, then rolls back:
-- nothing persists, and the queued phone alerts are rolled back with it
-- (pg_net only sends what was committed). Success = only "PASS:" notices.
begin;

create function pg_temp.as_user(p_username text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select p.id into v_id
  from public.profiles p join public.organizations o on o.id = p.org_id
  where p.username = p_username and o.org_code = '51880';
  if v_id is null then raise exception 'FAIL: no profile %', p_username; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  -- What PostgREST sets for a real request from an iPhone behind a proxy.
  perform set_config('request.headers',
    '{"x-forwarded-for":"37.238.10.20, 172.70.1.1","user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"}', true);
  return v_id;
end; $$;

do $$
declare
  v_fatima uuid;
  v_hijazi uuid;
  v_ob uuid;
  v_org uuid;
  v_start bigint;
  v_n int;
  v_row public.admin_activity;
  v_queue_before int;
  v_queue_after int;
begin
  select coalesce(max(id), 0) into v_start from public.admin_activity;

  -- 1. A watched admin's change is recorded, with before/after, IP and device.
  v_fatima := pg_temp.as_user('fatima');
  select org_id into v_org from public.profiles where id = v_fatima;
  update public.organizations set iqd_per_point = iqd_per_point + 1 where id = v_org;
  select * into v_row from public.admin_activity where id > v_start and table_name = 'organizations' order by id desc limit 1;
  if v_row.id is null then raise exception 'FAIL: Fatima''s change was not recorded'; end if;
  if v_row.actor_id <> v_fatima or v_row.kind <> 'change' or v_row.op <> 'update' then
    raise exception 'FAIL: wrong actor/kind/op: % % %', v_row.actor_id, v_row.kind, v_row.op;
  end if;
  if (v_row.after->>'iqd_per_point')::numeric <> (v_row.before->>'iqd_per_point')::numeric + 1 then
    raise exception 'FAIL: before/after not kept';
  end if;
  if v_row.ip is distinct from '37.238.10.20' then raise exception 'FAIL: ip was %', v_row.ip; end if;
  if v_row.user_agent not like '%iPhone%' then raise exception 'FAIL: device not kept'; end if;
  raise notice 'PASS: admin change recorded with before/after, IP % and device', v_row.ip;

  -- 2. The app's calls are recorded for her.
  perform public.log_activity('view', '/history', null);
  perform public.log_activity('sign_in', 'open', null);
  select count(*) into v_n from public.admin_activity where id > v_start and actor_id = v_fatima and kind in ('view', 'sign_in');
  if v_n <> 2 then raise exception 'FAIL: expected 2 app entries, got %', v_n; end if;
  raise notice 'PASS: screen view and app open recorded';

  -- 3. A serious action queues an alert to the super admin (rolled back below).
  select count(*) into v_queue_before from net.http_request_queue;
  select id into v_ob from public.profiles where username = 'ob12';
  update public.profiles set active = false where id = v_ob;
  select count(*) into v_queue_after from net.http_request_queue;
  if exists (select 1 from public.web_push_subscriptions s join public.profiles p on p.id = s.profile_id where p.is_super_admin) then
    if v_queue_after <> v_queue_before + 1 then raise exception 'FAIL: no alert queued for a deactivation'; end if;
    raise notice 'PASS: deactivating someone queues an alert to the super admin';
  else
    raise notice 'NOTE: the super admin has no push subscription, so no alert could be queued';
  end if;
  if not exists (select 1 from public.admin_activity where id > v_start and table_name = 'profiles' and row_id = v_ob::text) then
    raise exception 'FAIL: the deactivation was not recorded';
  end if;
  raise notice 'PASS: deactivation recorded with the full before-copy';

  -- 4. The super admin himself is never recorded.
  v_hijazi := pg_temp.as_user('hijazi12');
  select max(id) into v_start from public.admin_activity;
  update public.organizations set iqd_per_point = iqd_per_point + 1 where id = v_org;
  perform public.log_activity('view', '/history', null);
  if exists (select 1 from public.admin_activity where id > v_start) then raise exception 'FAIL: the super admin was recorded'; end if;
  raise notice 'PASS: the super admin is not recorded';

  -- 5. A supervisor is never recorded either.
  perform pg_temp.as_user('ob12');
  perform public.log_activity('view', '/history', null);
  if exists (select 1 from public.admin_activity where id > v_start) then raise exception 'FAIL: a supervisor was recorded'; end if;
  raise notice 'PASS: a supervisor is not recorded';
end $$;

-- 6. Who can read and who can tamper — as the real app role, so RLS applies.
do $$ begin perform pg_temp.as_user('fatima'); end $$;
set local role authenticated;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.admin_activity;
  if v_n <> 0 then raise exception 'FAIL: an admin can read % lines', v_n; end if;
  raise notice 'PASS: an admin sees nothing';
  begin
    insert into public.admin_activity (org_id, kind) values (public.my_org_id(), 'view');
    raise exception 'FAIL: an admin wrote a line';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: an admin cannot write a line (%)', sqlerrm;
  end;
  begin
    delete from public.admin_activity;
    raise exception 'FAIL: delete was allowed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: an admin cannot delete lines (%)', sqlerrm;
  end;
end $$;
reset role;

do $$ begin perform pg_temp.as_user('hijazi12'); end $$;
set local role authenticated;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.admin_activity;
  if v_n = 0 then raise exception 'FAIL: the super admin cannot read the record'; end if;
  raise notice 'PASS: the super admin reads the record (% lines in this test)', v_n;
  begin
    delete from public.admin_activity;
    raise exception 'FAIL: even the super admin should not delete through the app';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: nobody deletes lines through the app (%)', sqlerrm;
  end;
end $$;
reset role;

rollback;
