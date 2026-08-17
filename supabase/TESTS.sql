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
  if not exists (select 1 from public.profile_teams where profile_id = v_leader_id and team_id = v_team_id) then
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

-- ── Assignment only flows downward, and history outlives its task ───────

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_leader_id uuid;
  v_emp_id uuid;
  v_task_id uuid;
  v_doomed_task uuid;
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
    'owner6.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Chain Co', 'Owner Six', 'ownersix');

  v_leader_id := public.admin_create_user('Lead Six', 'leadsix', 'initial123', 'team_admin', v_team_id);
  v_emp_id := public.admin_create_user('Emp Six', 'empsix', 'initial123', 'employee', v_team_id);

  -- ── An owner may assign down to a team leader ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
  values (v_org_id, v_team_id, 'Owner to leader', v_leader_id, v_owner_id)
  returning id into v_task_id;
  raise notice 'PASS: an owner can assign a task to a team leader';

  -- ── Nobody may assign a task to themselves ──
  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
    values (v_org_id, v_team_id, 'Owner to self', v_owner_id, v_owner_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an owner must not be able to assign a task to themselves';
  end if;
  raise notice 'PASS: an owner cannot assign a task to themselves';

  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);

  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
    values (v_org_id, v_team_id, 'Leader to self', v_leader_id, v_leader_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to assign a task to themselves';
  end if;
  raise notice 'PASS: a team leader cannot assign a task to themselves';

  -- ── A team leader may assign down to an employee ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
  values (v_org_id, v_team_id, 'Leader to employee', v_emp_id, v_leader_id)
  returning id into v_doomed_task;
  raise notice 'PASS: a team leader can assign a task to an employee';

  -- ── A team leader may not promote work sideways to another leader ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  declare
    v_leader_b uuid;
  begin
    v_leader_b := public.admin_create_user('Lead B', 'leadb', 'initial123', 'team_admin', v_team_id);
    perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
    v_raised := false;
    begin
      insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
      values (v_org_id, v_team_id, 'Leader to leader', v_leader_b, v_leader_id);
    exception when others then
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'FAIL: a team leader must not assign work to another team leader';
    end if;
  end;
  raise notice 'PASS: a team leader cannot assign work sideways to another leader';

  -- ── An employee cannot create tasks at all ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
    values (v_org_id, v_team_id, 'Employee made this', null, v_emp_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create tasks';
  end if;
  raise notice 'PASS: an employee cannot create tasks';

  -- ── History survives the task being deleted ──
  perform public.set_task_completion(v_doomed_task, true, 'finished before deletion', array['https://x/proof.jpg']);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  delete from public.tasks where id = v_doomed_task;

  select count(*) into v_count
  from public.task_completions
  where task_title = 'Leader to employee' and action = 'completed';
  if v_count <> 1 then
    raise exception 'FAIL: deleting a task erased its history, expected 1 row, got %', v_count;
  end if;
  if (select task_id from public.task_completions where task_title = 'Leader to employee') is not null then
    raise exception 'FAIL: the history row should have been unlinked, not left dangling';
  end if;
  if (select array_length(photo_urls, 1) from public.task_completions
      where task_title = 'Leader to employee') <> 1 then
    raise exception 'FAIL: the proof photos should survive the task being deleted';
  end if;
  raise notice 'PASS: history and its photos survive the task being deleted';
end;
$$;

-- ── Checklists: templates, downward-only assignment, note-on-لا, off-duty ──

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_other_team_id uuid;
  v_leader_id uuid;
  v_emp_id uuid;
  v_other_emp_id uuid;
  v_template_id uuid;
  v_assignment_id uuid;
  v_submission_id uuid;
  v_off_duty_id uuid;
  v_raised boolean;
  v_count int;
  v_status text;
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
    'owner7.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Checklist Co', 'Owner Seven', 'ownerseven');

  v_leader_id := public.admin_create_user('Lead Seven', 'leadseven', 'initial123', 'team_admin', v_team_id);
  v_emp_id := public.admin_create_user('Emp Seven', 'empseven', 'initial123', 'employee', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_other_emp_id := public.admin_create_user('Other Seven', 'otherseven', 'initial123', 'employee', v_other_team_id);

  -- ── An employee cannot create a template ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.create_checklist_template('Hygiene', 7, true, '[{"section_title":"","question":"Clean?"}]'::jsonb);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create a checklist template';
  end if;
  raise notice 'PASS: an employee cannot create a checklist template';

  -- ── A team leader can create one, with sections ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  v_template_id := public.create_checklist_template(
    'Daily Hygiene', 7, true,
    '[
      {"section_title":"Kitchen","question":"Is the fire extinguisher valid?"},
      {"section_title":"Kitchen","question":"Are the fridges clean?"},
      {"section_title":"Bathrooms","question":"Are the bathrooms clean?"}
    ]'::jsonb
  );
  select count(*) into v_count from public.checklist_template_items where template_id = v_template_id;
  if v_count <> 3 then
    raise exception 'FAIL: expected 3 template items, got %', v_count;
  end if;
  raise notice 'PASS: a team leader can create a sectioned checklist template';

  -- ── Nobody can assign a checklist to themselves ──
  v_raised := false;
  begin
    perform public.assign_checklist(v_template_id, v_leader_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to assign a checklist to themselves';
  end if;
  raise notice 'PASS: cannot assign a checklist to yourself';

  -- ── A team leader cannot assign outside their own team ──
  v_raised := false;
  begin
    perform public.assign_checklist(v_template_id, v_other_emp_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not assign a checklist to another team''s employee';
  end if;
  raise notice 'PASS: a team leader cannot assign a checklist outside their team';

  -- ── A team leader can assign to their own employee ──
  v_assignment_id := public.assign_checklist(v_template_id, v_emp_id);
  raise notice 'PASS: a team leader can assign a checklist to their own employee';

  -- ── The assignee cannot submit with "لا" and no note, when required ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.submit_checklist(
      v_assignment_id,
      '[
        {"section_title":"Kitchen","question":"Is the fire extinguisher valid?","sort_order":0,"answer":true},
        {"section_title":"Kitchen","question":"Are the fridges clean?","sort_order":1,"answer":false}
      ]'::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a "لا" answer with no note should have been rejected';
  end if;
  raise notice 'PASS: a "لا" answer without a note is rejected when the template requires one';

  -- ── With the note, it submits and counts correctly ──
  v_submission_id := public.submit_checklist(
    v_assignment_id,
    '[
      {"section_title":"Kitchen","question":"Is the fire extinguisher valid?","sort_order":0,"answer":true},
      {"section_title":"Kitchen","question":"Are the fridges clean?","sort_order":1,"answer":false,"note":"Door seal broken"},
      {"section_title":"Bathrooms","question":"Are the bathrooms clean?","sort_order":2,"answer":true}
    ]'::jsonb,
    '[{"section_title":"Kitchen","photo_url":"https://x/fridge.jpg"}]'::jsonb
  );
  if (select yes_count from public.checklist_submissions where id = v_submission_id) <> 2
     or (select no_count from public.checklist_submissions where id = v_submission_id) <> 1 then
    raise exception 'FAIL: yes/no counts are wrong on the submission';
  end if;
  if (select count(*) from public.checklist_answers where submission_id = v_submission_id) <> 3 then
    raise exception 'FAIL: expected 3 saved answers';
  end if;
  if (select count(*) from public.checklist_section_photos where submission_id = v_submission_id) <> 1 then
    raise exception 'FAIL: expected 1 saved section photo';
  end if;
  raise notice 'PASS: a valid submission saves answers, photos, and correct yes/no counts';

  -- ── Someone else cannot submit on this assignment ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.submit_checklist(
      v_assignment_id,
      '[{"section_title":"","question":"x","sort_order":0,"answer":true}]'::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: only the assignee should be able to submit this checklist';
  end if;
  raise notice 'PASS: only the assignee can submit their checklist';

  -- ── Off-duty: a claim, not an escape — stays pending until reviewed ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_off_duty_id := public.declare_checklist_off_duty(v_assignment_id, 'On approved leave today');
  select status into v_status from public.checklist_submissions where id = v_off_duty_id;
  if v_status <> 'off_duty_pending' then
    raise exception 'FAIL: expected off_duty_pending, got %', v_status;
  end if;
  raise notice 'PASS: declaring off-duty creates a pending claim, not an immediate excuse';

  -- ── An employee cannot review their own claim ──
  v_raised := false;
  begin
    perform public.review_checklist_off_duty(v_off_duty_id, true, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to review their own off-duty claim';
  end if;
  raise notice 'PASS: an employee cannot review their own off-duty claim';

  -- ── The team leader rejects it ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  perform public.review_checklist_off_duty(v_off_duty_id, false, 'HR shows no leave on file');
  select status into v_status from public.checklist_submissions where id = v_off_duty_id;
  if v_status <> 'off_duty_rejected' then
    raise exception 'FAIL: expected off_duty_rejected, got %', v_status;
  end if;
  if (select reviewed_by from public.checklist_submissions where id = v_off_duty_id) <> v_leader_id then
    raise exception 'FAIL: reviewed_by was not recorded';
  end if;
  raise notice 'PASS: a team leader can reject an off-duty claim, with a reason recorded';

  -- ── A resolved claim cannot be reviewed twice ──
  v_raised := false;
  begin
    perform public.review_checklist_off_duty(v_off_duty_id, true, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an already-reviewed claim should not be reviewable again';
  end if;
  raise notice 'PASS: a reviewed off-duty claim cannot be reviewed again';

  -- ── Visibility: the employee sees only their own submissions ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  select count(*) into v_count from public.checklist_submissions;
  if v_count <> 2 then
    raise exception 'FAIL: the employee should see their own 2 submissions, saw %', v_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_emp_id)::text, true);
  select count(*) into v_count from public.checklist_submissions;
  if v_count <> 0 then
    raise exception 'FAIL: an employee on another team must see no submissions, saw %', v_count;
  end if;
  raise notice 'PASS: an employee sees only their own submissions';

  -- ── The owner sees everything in the org ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select count(*) into v_count from public.checklist_submissions;
  if v_count <> 2 then
    raise exception 'FAIL: the owner should see all 2 submissions, saw %', v_count;
  end if;
  select count(*) into v_count from public.checklist_answers;
  if v_count <> 3 then
    raise exception 'FAIL: the owner should see all 3 answers, saw %', v_count;
  end if;
  raise notice 'PASS: the owner sees every submission and answer in the org';

  -- ── Deleting the assignment does not delete submission history ──
  delete from public.checklist_assignments where id = v_assignment_id;
  select count(*) into v_count from public.checklist_submissions where template_name = 'Daily Hygiene';
  if v_count <> 2 then
    raise exception 'FAIL: deleting the assignment should not delete its submission history';
  end if;
  raise notice 'PASS: submission history survives the assignment being removed';
end;
$$;

-- ── Multi-team membership: a shared supervisor, two independent leaders ──

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_hygiene_team uuid;
  v_kitchen_team uuid;
  v_hygiene_leader uuid;
  v_kitchen_leader uuid;
  v_supervisor uuid;
  v_hygiene_task uuid;
  v_kitchen_task uuid;
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
    'owner8.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_hygiene_team
  from public.create_organization('Multi Co', 'Owner Eight', 'ownereight');

  insert into public.teams (org_id, name) values (v_org_id, 'Kitchen') returning id into v_kitchen_team;

  v_hygiene_leader := public.admin_create_user('Hygiene Lead', 'hygieneleader', 'initial123', 'team_admin', v_hygiene_team);
  v_kitchen_leader := public.admin_create_user('Kitchen Lead', 'kitchenleader', 'initial123', 'team_admin', v_kitchen_team);
  v_supervisor := public.admin_create_user('Fatima', 'fatima', 'initial123', 'employee', v_hygiene_team);

  -- ── The Kitchen leader adds Fatima to her second team ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_kitchen_leader)::text, true);
  perform public.add_profile_to_team(v_supervisor, v_kitchen_team);

  if (select count(*) from public.profile_teams where profile_id = v_supervisor) <> 2 then
    raise exception 'FAIL: Fatima should now be on 2 teams';
  end if;
  raise notice 'PASS: a team leader can add an existing employee to their own team';

  -- ── A leader cannot add someone to a team that is not their own ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_hygiene_leader)::text, true);
  declare
    v_third_team uuid;
  begin
    insert into public.teams (org_id, name) values (v_org_id, 'Delivery') returning id into v_third_team;
    v_raised := false;
    begin
      perform public.add_profile_to_team(v_supervisor, v_third_team);
    exception when others then
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'FAIL: a leader must not add someone to a team that is not their own';
    end if;
  end;
  raise notice 'PASS: a team leader cannot add someone to a team they do not lead';

  -- ── Each leader assigns a task to the shared supervisor on their own team ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_hygiene_leader)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
  values (v_org_id, v_hygiene_team, 'Hygiene checklist', v_supervisor, v_hygiene_leader)
  returning id into v_hygiene_task;

  perform set_config('request.jwt.claims', json_build_object('sub', v_kitchen_leader)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by)
  values (v_org_id, v_kitchen_team, 'Kitchen prep check', v_supervisor, v_kitchen_leader)
  returning id into v_kitchen_task;
  raise notice 'PASS: two independent leaders can each assign the shared supervisor work on their own team';

  -- ── The supervisor sees both, since they're both hers ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_supervisor)::text, true);
  select count(*) into v_count from public.tasks where id in (v_hygiene_task, v_kitchen_task);
  if v_count <> 2 then
    raise exception 'FAIL: the shared supervisor should see both tasks, saw %', v_count;
  end if;
  raise notice 'PASS: the shared supervisor sees work from both of her teams';

  -- ── But each leader sees ONLY what they personally assigned, per the design decision ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_hygiene_leader)::text, true);
  if not exists (select 1 from public.tasks where id = v_hygiene_task) then
    raise exception 'FAIL: the hygiene leader should see her own task';
  end if;
  if exists (select 1 from public.tasks where id = v_kitchen_task) then
    raise exception 'FAIL: the hygiene leader must not see the kitchen leader''s task for the same person';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_kitchen_leader)::text, true);
  if not exists (select 1 from public.tasks where id = v_kitchen_task) then
    raise exception 'FAIL: the kitchen leader should see her own task';
  end if;
  if exists (select 1 from public.tasks where id = v_hygiene_task) then
    raise exception 'FAIL: the kitchen leader must not see the hygiene leader''s task for the same person';
  end if;
  raise notice 'PASS: each leader sees only the work they personally assigned to the shared supervisor';

  -- ── The Kitchen leader removes Fatima from Kitchen; she keeps Hygiene ──
  perform public.remove_profile_from_team(v_supervisor, v_kitchen_team);
  if exists (select 1 from public.profile_teams where profile_id = v_supervisor and team_id = v_kitchen_team) then
    raise exception 'FAIL: Fatima should no longer be on the Kitchen team';
  end if;
  if not exists (select 1 from public.profile_teams where profile_id = v_supervisor and team_id = v_hygiene_team) then
    raise exception 'FAIL: removing one team should not remove the other';
  end if;
  raise notice 'PASS: removing one team membership leaves the other intact';
end;
$$;

rollback;
