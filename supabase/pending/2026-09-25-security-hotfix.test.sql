-- Tries every attack from the code review against LIVE data, then rolls back.
-- Success = only PASS lines.
begin;
\i supabase/pending/2026-09-25-security-hotfix.sql
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = u), 'role', 'authenticated')::text, true); end $$;

-- C1: a NULL or junk code never passes.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare v_id uuid := (select id from public.profiles where username = 'qa_supervisor');
begin
  insert into public.recovery_codes (profile_id, purpose, email, code_hash, expires_at)
  values (v_id, 'reset_password', 'x@example.com', extensions.crypt('123456', extensions.gen_salt('bf', 8)), now() + interval '15 minutes');
  if public.reset_password_with_code('51880', 'qa_supervisor', null, 'pwned123') then raise exception 'FAIL: NULL code reset a password'; end if;
  if public.reset_password_with_code('51880', 'qa_supervisor', 'abc', 'pwned123') then raise exception 'FAIL: junk code accepted'; end if;
  if (select attempts from public.recovery_codes where profile_id = v_id and used_at is null) <> 2 then raise exception 'FAIL: bad tries not counted'; end if;
  if not public.reset_password_with_code('51880', 'qa_supervisor', '123456', 'rightpw1') then raise exception 'FAIL: right code refused'; end if;
  raise notice 'PASS: NULL and junk codes fail and are counted; the right code still works';
end $$;
do $$
declare v_id uuid := (select id from public.profiles where username = 'qa_supervisor');
begin
  perform pg_temp.as_user('qa_supervisor');
  insert into public.recovery_codes (profile_id, purpose, email, code_hash, expires_at)
  values (v_id, 'verify_email', 'evil@example.com', extensions.crypt('123456', extensions.gen_salt('bf', 8)), now() + interval '15 minutes');
  if public.confirm_recovery_email(null) is not null then raise exception 'FAIL: NULL code verified an email'; end if;
  raise notice 'PASS: a NULL code verifies nothing';
end $$;

-- C2: nobody promotes themselves or others through the API.
do $$ begin perform pg_temp.as_user('qa_supervisor'); end $$;
set local role authenticated;
do $$ begin
  begin update public.profiles set is_super_admin = true where id = auth.uid(); raise exception 'FAIL: supervisor made himself super admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: supervisor cannot make himself super admin (%)', sqlerrm; end;
  update public.profiles set name = name where id = auth.uid();
  raise notice 'PASS: a person can still edit his own display fields';
  update public.profiles set recovery_email = 'typed@example.com' where id = auth.uid();
  if (select recovery_email_verified_at from public.profiles where id = auth.uid()) is not null then raise exception 'FAIL: typed address counted as verified'; end if;
  raise notice 'PASS: an address typed straight in is never verified';
end $$;
reset role;
do $$ begin perform pg_temp.as_user('qa_admin'); end $$;
set local role authenticated;
do $$ begin
  begin update public.profiles set is_super_admin = true where id = auth.uid(); raise exception 'FAIL: admin made himself super admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: an admin cannot make himself super admin'; end;
  begin update public.profiles set role = 'owner' where username = 'qa_supervisor'; raise exception 'FAIL: admin promoted someone';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: an admin cannot promote anyone by hand'; end;
  begin update public.profiles set recovery_email = 'mine@example.com' where username = 'hijazi12'; raise exception 'FAIL: admin redirected the super admin''s email';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: an admin cannot touch the super admin''s recovery email'; end;
  if (select count(*) from public.admin_activity) <> 0 then raise exception 'FAIL: admin reads the record'; end if;
  raise notice 'PASS: an admin still reads nothing of the record';
end $$;
reset role;

-- I1: only the super admin resets an admin or himself.
do $$ begin
  perform pg_temp.as_user('qa_admin');
  begin perform public.admin_reset_password((select id from public.profiles where username = 'hijazi12'), 'takeover1'); raise exception 'FAIL: admin reset the super admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: an admin cannot reset the super admin (%)', sqlerrm; end;
  begin perform public.admin_reset_password((select id from public.profiles where username = 'fatima'), 'takeover1'); raise exception 'FAIL: admin reset an admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: an admin cannot reset another admin'; end;
  perform public.admin_reset_password((select id from public.profiles where username = 'qa_supervisor'), 'newpass9');
  raise notice 'PASS: an admin still resets a supervisor';
  perform pg_temp.as_user('hijazi12');
  perform public.admin_reset_password((select id from public.profiles where username = 'qa_admin'), 'newpass9');
  raise notice 'PASS: the super admin resets an admin';
end $$;

-- I4: a watched admin's control-panel change is now recorded.
do $$ declare v_n int; begin
  perform pg_temp.as_user('qa_admin');
  perform public.set_org_settings('{"oil_grace_min": 11}');
  select count(*) into v_n from public.admin_activity where table_name = 'org_settings';
  if v_n = 0 then raise exception 'FAIL: control panel change not recorded'; end if;
  raise notice 'PASS: control panel changes are recorded';
end $$;
rollback;
