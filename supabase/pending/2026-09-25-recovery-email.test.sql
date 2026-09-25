-- Proves the recovery-email flow against LIVE data, then rolls back (the
-- queued emails roll back too — nothing is sent). Success = only PASS lines.
begin;
create function pg_temp.as_profile(p_id uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true); end; $$;

do $$
declare v_sup uuid := (select id from public.profiles where username = 'qa_supervisor');
        v_q0 int; v_q1 int; v_email text; v_pw_before text; v_pw_after text;
begin
  perform pg_temp.as_profile(v_sup);
  select count(*) into v_q0 from net.http_request_queue;
  perform public.request_recovery_email('QA.Test@Example.com');
  select count(*) into v_q1 from net.http_request_queue;
  if v_q1 <> v_q0 + 1 then raise exception 'FAIL: no email queued'; end if;
  raise notice 'PASS: asking to add an email queues one code email';

  begin perform public.request_recovery_email('qa.test@example.com'); raise exception 'FAIL: no rate limit';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: a second code within a minute is refused (%)', sqlerrm; end;

  -- We cannot read the mailed code; set a known one on the pending row.
  update public.recovery_codes set code_hash = extensions.crypt('123456', extensions.gen_salt('bf', 8))
   where profile_id = v_sup and purpose = 'verify_email' and used_at is null;
  if public.confirm_recovery_email('000000') is not null then raise exception 'FAIL: wrong code accepted'; end if;
  if (select attempts from public.recovery_codes where profile_id = v_sup and purpose = 'verify_email' and used_at is null) <> 1 then
    raise exception 'FAIL: the wrong try was not counted';
  end if;
  raise notice 'PASS: a wrong code is refused and the try is counted';
  v_email := public.confirm_recovery_email('123456');
  if v_email <> 'qa.test@example.com' or (select recovery_email_verified_at from public.profiles where id = v_sup) is null then
    raise exception 'FAIL: email not verified';
  end if;
  raise notice 'PASS: the right code verifies the email (stored lower-case: %)', v_email;
  if (select email from auth.users where id = v_sup) not like '%@users.rungs.internal' then raise exception 'FAIL: the sign-in address changed'; end if;
  raise notice 'PASS: the sign-in address is untouched';
end $$;

-- Forgot password, as nobody (anon).
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform public.request_password_reset('51880', 'no_such_user_xyz');
  raise notice 'PASS: an unknown user gets the same silent answer';
  perform public.request_password_reset('51880', 'qa_supervisor');
  raise notice 'PASS: a reset request for a verified account is accepted';
  begin perform public.send_app_email('x@example.com', 's', 'h'); raise exception 'FAIL: anon can send email';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS: anon cannot send arbitrary email (%)', sqlerrm; end;
end $$;
reset role;

do $$
declare v_sup uuid := (select id from public.profiles where username = 'qa_supervisor'); v_pw text; i int;
begin
  if not exists (select 1 from public.recovery_codes where profile_id = v_sup and purpose = 'reset_password' and used_at is null) then
    raise exception 'FAIL: no reset code was created';
  end if;
  update public.recovery_codes set code_hash = extensions.crypt('654321', extensions.gen_salt('bf', 8))
   where profile_id = v_sup and purpose = 'reset_password' and used_at is null;
  select encrypted_password into v_pw from auth.users where id = v_sup;
  -- Five wrong tries kill the code, even if the sixth is right.
  for i in 1..5 loop
    if public.reset_password_with_code('51880', 'qa_supervisor', '111111', 'newpass1') then raise exception 'FAIL: wrong code accepted'; end if;
  end loop;
  if public.reset_password_with_code('51880', 'qa_supervisor', '654321', 'newpass1') then raise exception 'FAIL: code survived 5 wrong tries'; end if;
  raise notice 'PASS: five wrong tries kill the code, even for the right one';
  -- A fresh code works and changes the password.
  update public.recovery_codes set attempts = 0 where profile_id = v_sup and purpose = 'reset_password' and used_at is null;
  if not public.reset_password_with_code('51880', 'qa_supervisor', '654321', 'newpass1') then raise exception 'FAIL: right code refused'; end if;
  if (select encrypted_password from auth.users where id = v_sup) = v_pw then raise exception 'FAIL: password unchanged'; end if;
  if (select encrypted_password from auth.users where id = v_sup) <> extensions.crypt('newpass1', (select encrypted_password from auth.users where id = v_sup)) then
    raise exception 'FAIL: new password does not match';
  end if;
  raise notice 'PASS: the right code sets the new password';
  if public.reset_password_with_code('51880', 'qa_supervisor', '654321', 'again12') then raise exception 'FAIL: code reused'; end if;
  raise notice 'PASS: a used code cannot be used again';
end $$;
rollback;
