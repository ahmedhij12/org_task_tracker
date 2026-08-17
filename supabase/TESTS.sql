-- OrgTasks — automated database tests.
--
-- Paste this whole file into Supabase Studio -> SQL Editor -> New query -> Run,
-- AFTER running SETUP.sql. Everything runs inside a transaction that is rolled
-- back at the end, so it never changes real data.
--
-- Success looks like a list of "PASS:" notices and "Success. No rows returned".
-- Any failed assertion aborts the whole run with an ERROR naming the check
-- that failed.
--
-- How it fakes a signed-in user: auth.uid() reads the request.jwt.claims
-- setting, so set_config('request.jwt.claims', '{"sub":"<uuid>"}', true) makes
-- every SECURITY DEFINER function behave as if that user is the caller.

begin;

-- ── Schema: the columns and helpers the app depends on ──────────────────

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'must_change_password'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.must_change_password column is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'active'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.active column is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'recovery_email'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.recovery_email column is missing';
  end if;
  raise notice 'PASS: profiles has must_change_password, active, recovery_email';

  if to_regprocedure('public.my_active()') is null then
    raise exception 'FAIL: public.my_active() is missing';
  end if;
  if to_regprocedure('public.my_must_change_password()') is null then
    raise exception 'FAIL: public.my_must_change_password() is missing';
  end if;
  raise notice 'PASS: my_active() and my_must_change_password() exist';

  -- An owner signs themselves up with a password they chose, so they are
  -- active and are NOT forced to change anything.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  select org_id, org_code into v_org_id, v_org_code
  from public.create_organization('Test Org', 'Test Owner', 'testowner');

  if not (select active from public.profiles where id = v_owner_id) then
    raise exception 'FAIL: a newly created owner should be active';
  end if;
  if (select must_change_password from public.profiles where id = v_owner_id) then
    raise exception 'FAIL: an owner who chose their own password should not be forced to change it';
  end if;
  raise notice 'PASS: owner defaults are active=true, must_change_password=false';
end;
$$;

-- ── admin_create_user: who may create whom, and does the account work ───

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_team_b_id uuid;
  v_leader_id uuid;
  v_emp_id uuid;
  v_email text;
  v_raised boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner2.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Acme', 'Owner Two', 'ownertwo');

  v_leader_id := public.admin_create_user(
    p_name => 'Leader One',
    p_username => 'leader1',
    p_password => 'initial123',
    p_role => 'team_admin',
    p_team_id => v_team_id,
    p_title => 'Shift Lead'
  );

  if (select role from public.profiles where id = v_leader_id) <> 'team_admin' then
    raise exception 'FAIL: created leader should have role team_admin';
  end if;
  if not (select must_change_password from public.profiles where id = v_leader_id) then
    raise exception 'FAIL: an admin-created account must be forced to change its password';
  end if;
  if not (select active from public.profiles where id = v_leader_id) then
    raise exception 'FAIL: a newly created account should be active';
  end if;
  if (select team_id from public.profiles where id = v_leader_id) is distinct from v_team_id then
    raise exception 'FAIL: created leader is on the wrong team';
  end if;
  raise notice 'PASS: owner can create a team leader with forced password change';

  select email into v_email from auth.users where id = v_leader_id;
  if v_email <> 'leader1.' || v_org_code || '@users.orgtasks.internal' then
    raise exception 'FAIL: synthetic email is wrong, got %', v_email;
  end if;
  if not exists (
    select 1 from auth.users
    where id = v_leader_id
      and encrypted_password = extensions.crypt('initial123', encrypted_password)
  ) then
    raise exception 'FAIL: the stored password hash does not verify against the given password';
  end if;
  if not exists (select 1 from auth.identities where user_id = v_leader_id and provider = 'email') then
    raise exception 'FAIL: no auth.identities row was created, GoTrue login will fail';
  end if;
  raise notice 'PASS: auth.users + auth.identities rows are correct and the password verifies';

  if public.get_login_email(v_org_code, 'leader1') is distinct from v_email then
    raise exception 'FAIL: get_login_email did not resolve the admin-created account';
  end if;
  raise notice 'PASS: get_login_email resolves an admin-created account';

  v_raised := false;
  begin
    perform public.admin_create_user('Dup', 'leader1', 'initial123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: duplicate username should have been rejected';
  end if;
  raise notice 'PASS: duplicate username is rejected';

  v_raised := false;
  begin
    perform public.admin_create_user('Shorty', 'shorty', '123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a password under 6 characters should have been rejected';
  end if;
  raise notice 'PASS: short password is rejected';

  v_raised := false;
  begin
    perform public.admin_create_user('Sneaky', 'sneaky', 'initial123', 'owner', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: creating an owner through admin_create_user should be rejected';
  end if;
  raise notice 'PASS: cannot create an owner through admin_create_user';

  insert into public.teams (org_id, name) values (v_org_id, 'Team B') returning id into v_team_b_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);

  v_emp_id := public.admin_create_user('Emp One', 'emp1', 'initial123', 'employee', v_team_id);
  if (select role from public.profiles where id = v_emp_id) <> 'employee' then
    raise exception 'FAIL: team leader should be able to create an employee on their own team';
  end if;
  raise notice 'PASS: a team leader can create an employee on their own team';

  v_raised := false;
  begin
    perform public.admin_create_user('Rival', 'rival', 'initial123', 'team_admin', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to create another team leader';
  end if;
  raise notice 'PASS: a team leader cannot create another team leader';

  v_raised := false;
  begin
    perform public.admin_create_user('Outsider', 'outsider', 'initial123', 'employee', v_team_b_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to create a user on another team';
  end if;
  raise notice 'PASS: a team leader cannot create a user on another team';

  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_create_user('Nope', 'nope', 'initial123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create accounts';
  end if;
  raise notice 'PASS: an employee cannot create accounts';
end;
$$;

-- ── Password reset, deactivation, and clearing the forced-change flag ───

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_emp_id uuid;
  v_other_team_id uuid;
  v_other_emp_id uuid;
  v_leader_id uuid;
  v_raised boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner3.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Reset Co', 'Owner Three', 'ownerthree');

  v_emp_id := public.admin_create_user('Emp', 'emp', 'initial123', 'employee', v_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  perform public.clear_must_change_password();
  if (select must_change_password from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: clear_must_change_password did not clear the flag';
  end if;
  raise notice 'PASS: clear_must_change_password clears the caller''s own flag';

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  perform public.admin_reset_password(v_emp_id, 'brandnew123');

  if not exists (
    select 1 from auth.users
    where id = v_emp_id
      and encrypted_password = extensions.crypt('brandnew123', encrypted_password)
  ) then
    raise exception 'FAIL: the new password does not verify after an admin reset';
  end if;
  if not (select must_change_password from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: an admin reset must re-force a password change';
  end if;
  raise notice 'PASS: admin_reset_password sets a working password and re-forces a change';

  v_raised := false;
  begin
    perform public.admin_reset_password(v_emp_id, '12');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a reset password under 6 characters should have been rejected';
  end if;
  raise notice 'PASS: admin_reset_password rejects a short password';

  perform public.admin_set_user_active(v_emp_id, false);
  if (select active from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: admin_set_user_active(false) did not deactivate the profile';
  end if;
  if public.get_login_email(v_org_code, 'emp') is not null then
    raise exception 'FAIL: a deactivated user must not resolve to a login email';
  end if;
  if (select banned_until from auth.users where id = v_emp_id) is null then
    raise exception 'FAIL: a deactivated user should also be banned at the auth level';
  end if;
  raise notice 'PASS: deactivation blocks login lookup and bans the auth user';

  perform public.admin_set_user_active(v_emp_id, true);
  if public.get_login_email(v_org_code, 'emp') is null then
    raise exception 'FAIL: a reactivated user should resolve to a login email again';
  end if;
  if (select banned_until from auth.users where id = v_emp_id) is not null then
    raise exception 'FAIL: reactivating should clear the auth-level ban';
  end if;
  raise notice 'PASS: reactivation restores login and clears the ban';

  -- The owner must never be deactivatable, or an org could be locked out.
  v_raised := false;
  begin
    perform public.admin_set_user_active(v_owner_id, false);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: the organization owner must not be deactivatable';
  end if;
  raise notice 'PASS: the owner cannot be deactivated';

  v_leader_id := public.admin_create_user('Lead', 'lead', 'initial123', 'team_admin', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_other_emp_id := public.admin_create_user('Other', 'other', 'initial123', 'employee', v_other_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_reset_password(v_other_emp_id, 'hacked123');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not reset a password outside their team';
  end if;
  raise notice 'PASS: a team leader cannot reset a password outside their own team';

  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_reset_password(v_leader_id, 'hacked123');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to reset anyone''s password';
  end if;
  raise notice 'PASS: an employee cannot reset passwords';
end;
$$;

-- ── Self-service join is gone; create_team takes only a name ────────────

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_new_team_id uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner4.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Teams Co', 'Owner Four', 'ownerfour');

  if to_regprocedure('public.join_organization(text, uuid, text, text, text)') is not null then
    raise exception 'FAIL: join_organization should have been removed';
  end if;
  raise notice 'PASS: join_organization has been removed';

  if to_regprocedure('public.create_team(text, uuid)') is not null then
    raise exception 'FAIL: the old two-argument create_team should have been removed';
  end if;
  v_new_team_id := public.create_team('Night Shift');
  if (select name from public.teams where id = v_new_team_id) <> 'Night Shift' then
    raise exception 'FAIL: create_team did not create the team';
  end if;
  if (select org_id from public.teams where id = v_new_team_id) is distinct from v_org_id then
    raise exception 'FAIL: create_team put the team in the wrong org';
  end if;
  raise notice 'PASS: create_team(p_name) creates a team in the caller''s org';
end;
$$;

-- ── Proof photos are enforced, and history is written and scoped ────────

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_other_team_id uuid;
  v_emp_id uuid;
  v_other_emp_id uuid;
  v_proof_task uuid;
  v_plain_task uuid;
  v_late_task uuid;
  v_raised boolean;
  v_count int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner5.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Proof Co', 'Owner Five', 'ownerfive');

  v_emp_id := public.admin_create_user('Worker', 'worker', 'initial123', 'employee', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Far Team') returning id into v_other_team_id;
  v_other_emp_id := public.admin_create_user('Faraway', 'faraway', 'initial123', 'employee', v_other_team_id);

  insert into public.tasks (org_id, team_id, title, requires_proof, assignee_id, created_by, due)
  values (v_org_id, v_team_id, 'Needs a photo', true, v_emp_id, v_owner_id, now() + interval '1 day')
  returning id into v_proof_task;

  insert into public.tasks (org_id, team_id, title, requires_proof, assignee_id, created_by)
  values (v_org_id, v_team_id, 'No proof needed', false, v_emp_id, v_owner_id)
  returning id into v_plain_task;

  insert into public.tasks (org_id, team_id, title, requires_proof, assignee_id, created_by, due)
  values (v_org_id, v_team_id, 'Overdue one', false, v_emp_id, v_owner_id, now() - interval '2 days')
  returning id into v_late_task;

  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);

  -- ── A proof task cannot be closed with no photos, note or not ──
  v_raised := false;
  begin
    perform public.set_task_completion(v_proof_task, true, 'I did it, trust me', '{}');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a task requiring proof was closed with no photos';
  end if;
  if (select completed from public.tasks where id = v_proof_task) then
    raise exception 'FAIL: the proof task should still be open';
  end if;
  raise notice 'PASS: a task requiring proof cannot be completed without a photo';

  -- ── With photos it closes, and all of them are kept ──
  perform public.set_task_completion(
    v_proof_task, true, 'Done properly',
    array['https://x/one.jpg', 'https://x/two.jpg', 'https://x/three.jpg']
  );
  if not (select completed from public.tasks where id = v_proof_task) then
    raise exception 'FAIL: the proof task should be completed';
  end if;
  if (select array_length(proof_photo_urls, 1) from public.tasks where id = v_proof_task) <> 3 then
    raise exception 'FAIL: all three photos should have been stored on the task';
  end if;
  raise notice 'PASS: multiple photos are stored on the task';

  -- ── A task without requires_proof still closes with no photos ──
  perform public.set_task_completion(v_plain_task, true, 'no photo needed', '{}');
  if not (select completed from public.tasks where id = v_plain_task) then
    raise exception 'FAIL: a task not requiring proof should close without photos';
  end if;
  raise notice 'PASS: a task not requiring proof closes without photos';

  -- ── Completing after the deadline is recorded as late ──
  perform public.set_task_completion(v_late_task, true, 'sorry, late', '{}');
  if not (select was_late from public.task_completions
          where task_id = v_late_task and action = 'completed') then
    raise exception 'FAIL: completing an overdue task should be flagged late';
  end if;
  if (select was_late from public.task_completions
      where task_id = v_plain_task and action = 'completed') then
    raise exception 'FAIL: a task with no deadline must not be flagged late';
  end if;
  raise notice 'PASS: late completion is flagged, on-time is not';

  -- ── Reopening keeps the history but clears the live proof ──
  perform public.set_task_completion(v_proof_task, false, null, '{}');
  if (select completed from public.tasks where id = v_proof_task) then
    raise exception 'FAIL: the task should be reopened';
  end if;
  if (select coalesce(array_length(proof_photo_urls, 1), 0)
      from public.tasks where id = v_proof_task) <> 0 then
    raise exception 'FAIL: reopening should clear the live proof photos';
  end if;
  select count(*) into v_count from public.task_completions where task_id = v_proof_task;
  if v_count <> 2 then
    raise exception 'FAIL: expected a completed and a reopened row in history, got %', v_count;
  end if;
  if (select array_length(photo_urls, 1) from public.task_completions
      where task_id = v_proof_task and action = 'completed') <> 3 then
    raise exception 'FAIL: history must keep the photos even after the task is reopened';
  end if;
  raise notice 'PASS: reopening clears live proof but history keeps everything';

  -- ── An employee sees only their own history ──
  select count(*) into v_count from public.task_completions;
  if v_count <> 4 then
    raise exception 'FAIL: the employee should see their own 4 history rows, saw %', v_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_emp_id)::text, true);
  select count(*) into v_count from public.task_completions;
  if v_count <> 0 then
    raise exception 'FAIL: an employee on another team must see no history, saw %', v_count;
  end if;
  raise notice 'PASS: an employee sees only their own history';

  -- ── The owner sees everything in the org ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select count(*) into v_count from public.task_completions;
  if v_count <> 4 then
    raise exception 'FAIL: the owner should see all 4 history rows, saw %', v_count;
  end if;
  raise notice 'PASS: the owner sees the whole org history';

  -- ── History cannot be forged or edited by a client ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    insert into public.task_completions (
      task_id, org_id, team_id, task_title, actor_id, action
    ) values (v_plain_task, v_org_id, v_team_id, 'forged', v_emp_id, 'completed');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a client must not be able to insert history rows directly';
  end if;
  raise notice 'PASS: history is append-only through the RPC, not writable by clients';
end;
$$;

rollback;
