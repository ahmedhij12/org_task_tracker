-- Rungs — automated database tests.
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
--
-- That's enough for testing an RPC's own internal authorization logic (a
-- plpgsql "if ... raise exception" reading auth.uid()), but NOT for testing
-- raw table access governed by RLS policies: the SQL Editor connects as the
-- table owner, which Postgres exempts from row-level security entirely,
-- regardless of what request.jwt.claims says. A handful of blocks below test
-- actual RLS enforcement (visibility of task/checklist history, whether a
-- raw insert is rejected) — those add `set role authenticated;` before the
-- assertions and `reset role;` after, so the check runs as the same
-- unprivileged role the real app connects as. Without that, every one of
-- those checks would silently "pass" by seeing every row regardless of
-- policy — found the hard way when "an employee sees only their own
-- history" reported seeing someone else's row.

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

-- ── Schema: report_periods exists with the right shape ───────────────────
do $$
declare
  v_has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_periods' and column_name = 'period_month'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: report_periods.period_month is missing';
  end if;
  raise notice 'PASS: report_periods has period_month';
end $$;

-- ── Schema: point_weight and signature_url exist with the right shape ────
do $$
declare
  v_default numeric;
  v_has_col boolean;
  v_raised boolean;
begin
  select column_default::numeric into v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'checklist_template_items' and column_name = 'point_weight';
  if v_default is distinct from 0.25 then
    raise exception 'FAIL: checklist_template_items.point_weight should default to 0.25, got %', v_default;
  end if;
  raise notice 'PASS: checklist_template_items.point_weight defaults to 0.25';

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'checklist_template_items'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%point_weight%>=%0%'
  ) then
    raise exception 'FAIL: checklist_template_items should have a point_weight >= 0 check constraint';
  end if;
  raise notice 'PASS: checklist_template_items rejects a negative point_weight (check constraint present)';

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_completions' and column_name = 'signature_url'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: task_completions.signature_url is missing';
  end if;
  raise notice 'PASS: task_completions.signature_url exists';
end $$;

-- ── Monthly close: picks the org's first elapsed month, then catches up ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_admin_id uuid;
  v_period_id uuid;
  v_period_month date;
  v_count int;
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
    'close-month-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Close Month Co', 'Owner', 'closemonthowner');

  v_admin_id := public.admin_create_user('Team Admin', 'closemonthadmin', 'initial123', 'team_admin', v_team_id);

  -- Backdate the org so June/July 2026 are already-elapsed months to close,
  -- regardless of what "now" actually is when this test runs.
  update public.organizations set created_at = '2026-06-10'::timestamptz where id = v_org_id;

  set role authenticated;

  -- ── A team_admin cannot close the month ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  v_raised := false;
  begin
    perform public.close_next_month();
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team_admin must not be able to close the month';
  end if;
  raise notice 'PASS: a team_admin cannot close the month';

  -- ── The owner's first close picks June 2026 (the org's creation month) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-06-01'::date then
    raise exception 'FAIL: expected the first close to be June 2026, got %', v_period_month;
  end if;
  raise notice 'PASS: the first close picks the org''s creation month';

  -- ── A second call catches up to July, not a repeat of June ──
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-07-01'::date then
    raise exception 'FAIL: expected the second close to be July 2026, got %', v_period_month;
  end if;
  raise notice 'PASS: a second close catches up to the next oldest unclosed month';

  -- ── The current, still-in-progress month is never closeable ──
  select count(*) into v_count from public.report_periods
  where org_id = v_org_id and period_month = date_trunc('month', now())::date;
  if v_count <> 0 then
    raise exception 'FAIL: the current in-progress month must never be closed';
  end if;
  raise notice 'PASS: the current in-progress month is never closed';

  reset role;
end $$;

-- ── get_period_report attributes points to the SUBJECT's branch, not the
-- completion's own team_id (the auditor and subject can be on different
-- teams — this is the exact gotcha already documented on task_completions) ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_hq_team_id uuid;      -- the auditor's own team, where the audit TASK lives
  v_branch_team_id uuid;  -- the subject's real branch
  v_auditor_id uuid;
  v_subject_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_period_id uuid;
  v_period_month date;
  v_points numeric;
  v_branch_name text;
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
    'period-report-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_hq_team_id
  from public.create_organization('Period Report Co', 'Owner', 'periodreportowner');

  insert into public.teams (org_id, name) values (v_org_id, 'Zubair Branch') returning id into v_branch_team_id;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_auditor_id := public.admin_create_user('Hygiene Mgr', 'periodauditor', 'initial123', 'team_admin', v_hq_team_id);
  v_subject_id := public.admin_create_user('Zubair Supervisor', 'periodsubject', 'initial123', 'employee', v_branch_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_hq_team_id, 'Zubair Hygiene Audit', v_auditor_id, v_auditor_id, true, 'medium', false)
  returning id into v_task_id;

  v_completion_id := public.set_task_completion(
    v_task_id, true, 'good visit', '{}', null, '[]'::jsonb, v_subject_id, 'morning', -2
  );

  -- Backdate the org and the completion into a fully-elapsed month so it
  -- can actually be closed and reported on. Neither organizations nor
  -- task_completions has an UPDATE policy (both are SELECT-only under RLS),
  -- so this must run with RLS bypassed (as the superuser role), not as
  -- 'authenticated' — otherwise it silently updates zero rows.
  reset role;
  update public.organizations set created_at = '2026-06-10'::timestamptz where id = v_org_id;
  update public.task_completions set created_at = '2026-06-15'::timestamptz where id = v_completion_id;
  set role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-06-01'::date then
    raise exception 'FAIL: expected to close June 2026, got %', v_period_month;
  end if;

  select total_points, branch_name into v_points, v_branch_name
  from public.get_period_report(v_period_id)
  where subject_profile_id = v_subject_id;

  if v_points is distinct from -2::numeric then
    raise exception 'FAIL: expected -2 total points for the subject, got %', v_points;
  end if;
  if v_branch_name is distinct from 'Zubair Branch' then
    raise exception 'FAIL: report must attribute points to the SUBJECT''s branch (Zubair), not the auditor''s team; got %', v_branch_name;
  end if;
  raise notice 'PASS: get_period_report attributes points via profile_teams on the subject, not task_completions.team_id';

  reset role;
end $$;

-- ── get_current_branch_summary: only this month, attributed by branch ───
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_hq_team_id uuid;
  v_branch_team_id uuid;
  v_auditor_id uuid;
  v_subject_id uuid;
  v_task_id uuid;
  v_current_completion_id uuid;
  v_old_completion_id uuid;
  v_points numeric;
  v_branch_name text;
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
    'branch-summary-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_hq_team_id
  from public.create_organization('Branch Summary Co', 'Owner', 'branchsummaryowner');

  insert into public.teams (org_id, name) values (v_org_id, 'Olympic Branch') returning id into v_branch_team_id;

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_auditor_id := public.admin_create_user('Hygiene Mgr', 'summaryauditor', 'initial123', 'team_admin', v_hq_team_id);
  v_subject_id := public.admin_create_user('Olympic Supervisor', 'summarysubject', 'initial123', 'employee', v_branch_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_hq_team_id, 'Olympic Hygiene Audit', v_auditor_id, v_auditor_id, true, 'medium', false)
  returning id into v_task_id;

  -- This month: must show up.
  v_current_completion_id := public.set_task_completion(
    v_task_id, true, 'this month', '{}', null, '[]'::jsonb, v_subject_id, 'morning', 1.5
  );

  -- Backdated to last month: must NOT show up.
  v_old_completion_id := public.set_task_completion(
    v_task_id, true, 'last month', '{}', null, '[]'::jsonb, v_subject_id, 'evening', -3
  );
  -- task_completions has no UPDATE policy (SELECT-only under RLS), so this
  -- backdating must run with RLS bypassed, not as 'authenticated' —
  -- otherwise it silently updates zero rows (see Task 3's report test).
  reset role;
  update public.task_completions
    set created_at = date_trunc('month', now()) - interval '1 day'
    where id = v_old_completion_id;
  set role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  select total_points, branch_name into v_points, v_branch_name
  from public.get_current_branch_summary()
  where subject_profile_id = v_subject_id;

  if v_points is distinct from 1.5::numeric then
    raise exception 'FAIL: expected only this month''s 1.5 points, got % (did last month leak in?)', v_points;
  end if;
  if v_branch_name is distinct from 'Olympic Branch' then
    raise exception 'FAIL: expected Olympic Branch, got %', v_branch_name;
  end if;
  raise notice 'PASS: get_current_branch_summary includes only the current month, attributed to the subject''s branch';

  reset role;
end $$;

-- ── Task 5: brand_id/brand_name on get_current_branch_summary and
-- get_period_report — left-joined so a null-brand subject still appears ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_brand_id uuid;
  v_emp_with_brand uuid;
  v_emp_no_brand uuid;
  v_task_id uuid;
  v_period_id uuid;
  v_period_month date;
  v_returned_brand_name text;
  v_null_brand_count int;
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
    'brandreport-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('BrandReport Org', 'BrandReport Owner', 'brandreportowner');
  v_brand_id := public.create_brand('360');
  perform public.set_branch_brands(v_team_id, array[v_brand_id]);
  v_emp_with_brand := public.admin_create_user('With Brand', 'brandreportwith', 'initial123', 'employee', v_team_id, null, v_brand_id);
  v_emp_no_brand := public.admin_create_user('No Brand', 'brandreportwithout', 'initial123', 'employee', v_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Brand Report Audit', v_owner_id, v_owner_id, true, 'medium', false)
  returning id into v_task_id;

  perform public.set_task_completion(v_task_id, true, null, '{}', null, '[]'::jsonb, v_emp_with_brand, 'morning', -1);
  perform public.set_task_completion(v_task_id, true, null, '{}', null, '[]'::jsonb, v_emp_no_brand, 'morning', -1);

  select brand_name into v_returned_brand_name
  from public.get_current_branch_summary()
  where subject_profile_id = v_emp_with_brand;
  if v_returned_brand_name is distinct from '360' then
    raise exception 'FAIL: expected brand_name ''360'', got %', coalesce(v_returned_brand_name, '<null>');
  end if;
  raise notice 'PASS: get_current_branch_summary returns the right brand_name';

  select count(*) into v_null_brand_count
  from public.get_current_branch_summary()
  where subject_profile_id = v_emp_no_brand and brand_id is null;
  if v_null_brand_count <> 1 then
    raise exception 'FAIL: a null-brand subject should still appear, with brand_id null';
  end if;
  raise notice 'PASS: a null-brand subject still appears in get_current_branch_summary';

  -- The brief's own "Produces" line claims brand_id/brand_name on BOTH RPCs,
  -- but the test as originally written only ever called
  -- get_current_branch_summary — get_period_report was never exercised.
  -- Close the org's creation month into a real report_periods row (same
  -- backdating pattern as the "attributes points to the SUBJECT's branch"
  -- test above) and re-run the same two assertions against get_period_report.
  update public.organizations set created_at = '2026-06-10'::timestamptz where id = v_org_id;
  update public.task_completions set created_at = '2026-06-15'::timestamptz
    where task_id = v_task_id and subject_profile_id in (v_emp_with_brand, v_emp_no_brand);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select period_id, period_month into v_period_id, v_period_month from public.close_next_month();
  if v_period_month is distinct from '2026-06-01'::date then
    raise exception 'FAIL: expected to close June 2026, got %', v_period_month;
  end if;

  select brand_name into v_returned_brand_name
  from public.get_period_report(v_period_id)
  where subject_profile_id = v_emp_with_brand;
  if v_returned_brand_name is distinct from '360' then
    raise exception 'FAIL: expected brand_name ''360'' from get_period_report, got %', coalesce(v_returned_brand_name, '<null>');
  end if;
  raise notice 'PASS: get_period_report returns the right brand_name';

  select count(*) into v_null_brand_count
  from public.get_period_report(v_period_id)
  where subject_profile_id = v_emp_no_brand and brand_id is null;
  if v_null_brand_count <> 1 then
    raise exception 'FAIL: a null-brand subject should still appear in get_period_report, with brand_id null';
  end if;
  raise notice 'PASS: a null-brand subject still appears in get_period_report';
end $$;

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
  if v_email <> 'leader1.' || v_org_code || '@users.rungs.internal' then
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

  declare
    v_admin2_id uuid;
  begin
    v_admin2_id := public.admin_create_user('Second Admin', 'admintwo', 'initial123', 'owner', null);
    if (select role from public.profiles where id = v_admin2_id) <> 'owner' then
      raise exception 'FAIL: an admin should be able to create another admin';
    end if;
    if not (select must_change_password from public.profiles where id = v_admin2_id) then
      raise exception 'FAIL: an admin-created admin account must still be forced to change its password';
    end if;
  end;
  raise notice 'PASS: an admin can create another admin via admin_create_user';

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
    perform public.admin_create_user('Escalate', 'escalate', 'initial123', 'owner', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a branch manager must not be able to create an admin';
  end if;
  raise notice 'PASS: a branch manager cannot create an admin';

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

  -- ── Everything from here down depends on RLS actually being enforced.
  --    The SQL Editor connects as the table owner, which Postgres exempts
  --    from RLS entirely — auth.uid()/my_role() would still read the right
  --    impersonated values, but every row would stay visible regardless of
  --    policy, silently passing checks that prove nothing. SET ROLE switches
  --    the real Postgres role so RLS is actually exercised, the same way
  --    the app's own connection (as `authenticated`) is. ──
  set role authenticated;

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

  reset role;
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

  -- Every insert below is testing RLS directly (not an RPC's own logic), so
  -- it needs the real Postgres role, not just the owner-bypassed one the SQL
  -- Editor connects as — see the note in the "Proof photos" block above.
  set role authenticated;

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

  reset role;
end;
$$;

-- ── Checklists: a task with a template, note-on-لا, off-duty, review ─────
-- A checklist is not a separate model any more (Option B merge): creating
-- one is creating a row in public.tasks with template_id/cooldown_hours set,
-- and filling one out is set_task_completion with p_answers attached. This
-- block runs on the real Postgres role throughout — see the "Proof photos"
-- block for why SET ROLE (not just impersonated claims) is required.

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
  v_task_id uuid;
  v_completion_id uuid;
  v_off_duty_id uuid;
  v_raised boolean;
  v_count int;
  v_status text;
  v_reviewed_by uuid;
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

  set role authenticated;

  -- ── An employee cannot create a template ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.create_checklist_template('Hygiene', true, '[{"section_title":"","question":"Clean?"}]'::jsonb);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create a checklist template';
  end if;
  raise notice 'PASS: an employee cannot create a checklist template';

  -- ── A team leader can create one, with sections. Cooldown is not a
  -- template property any more — it lives on the task that uses it ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  v_template_id := public.create_checklist_template(
    'Daily Hygiene', true,
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

  -- ── A checklist is just a task with a template attached: creating one
  -- goes through the exact same downward-only insert policy as any other
  -- task, already proven generically in the "Assignment only flows
  -- downward" block above — here we only prove the template/cooldown wiring ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
  values (v_org_id, v_team_id, 'Daily Hygiene', v_emp_id, v_leader_id, v_template_id, 7, 'high', true)
  returning id into v_task_id;
  raise notice 'PASS: a checklist is created as an ordinary task with template_id and cooldown_hours set';

  -- ── The database itself refuses a high-priority task with review off ──
  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, priority, requires_review)
    values (v_org_id, v_team_id, 'Bad', v_emp_id, v_leader_id, 'high', false);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a high-priority task must always require review, enforced by a CHECK constraint';
  end if;
  raise notice 'PASS: the priority <-> requires_review relationship is enforced at the database level';

  -- ── The assignee cannot submit with "لا" and no note, when required ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(
      v_task_id, true, null, '{}',
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
  v_completion_id := public.set_task_completion(
    v_task_id, true, null, '{}',
    '[
      {"section_title":"Kitchen","question":"Is the fire extinguisher valid?","sort_order":0,"answer":true},
      {"section_title":"Kitchen","question":"Are the fridges clean?","sort_order":1,"answer":false,"note":"Door seal broken"},
      {"section_title":"Bathrooms","question":"Are the bathrooms clean?","sort_order":2,"answer":true}
    ]'::jsonb,
    '[{"section_title":"Kitchen","photo_url":"https://x/fridge.jpg"}]'::jsonb
  );
  if (select yes_count from public.task_completions where id = v_completion_id) <> 2
     or (select no_count from public.task_completions where id = v_completion_id) <> 1 then
    raise exception 'FAIL: yes/no counts are wrong on the completion';
  end if;
  if (select count(*) from public.checklist_answers where task_completion_id = v_completion_id) <> 3 then
    raise exception 'FAIL: expected 3 saved answers';
  end if;
  if (select count(*) from public.checklist_section_photos where task_completion_id = v_completion_id) <> 1 then
    raise exception 'FAIL: expected 1 saved section photo';
  end if;
  if (select reviewed_by from public.task_completions where id = v_completion_id) is not null then
    raise exception 'FAIL: a completion should start unreviewed even though the task requires review';
  end if;
  raise notice 'PASS: a valid submission saves answers, photos, correct yes/no counts, and starts unreviewed';

  -- ── Someone else cannot submit on this task ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(
      v_task_id, true, null, '{}',
      '[{"section_title":"","question":"x","sort_order":0,"answer":true}]'::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: only the assignee should be able to submit this checklist';
  end if;
  raise notice 'PASS: only the assignee can submit their checklist';

  -- ── An employee cannot mark their own completion reviewed ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.review_task_completion(v_completion_id, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to review their own completion';
  end if;
  raise notice 'PASS: an employee cannot review their own completion';

  -- ── The team leader reviews it, since this task is high priority ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  perform public.review_task_completion(v_completion_id, 'Checked in person');
  select reviewed_by into v_reviewed_by from public.task_completions where id = v_completion_id;
  if v_reviewed_by <> v_leader_id then
    raise exception 'FAIL: reviewed_by was not recorded';
  end if;
  raise notice 'PASS: a team leader can review a completion and it is recorded';

  -- ── Off-duty: a claim, not an escape — stays pending until reviewed ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_off_duty_id := public.declare_task_off_duty(v_task_id, 'On approved leave today');
  select status into v_status from public.task_completions where id = v_off_duty_id;
  if v_status <> 'off_duty_pending' then
    raise exception 'FAIL: expected off_duty_pending, got %', v_status;
  end if;
  raise notice 'PASS: declaring off-duty creates a pending claim, not an immediate excuse';

  -- ── An employee cannot review their own claim ──
  v_raised := false;
  begin
    perform public.review_off_duty(v_off_duty_id, true, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to review their own off-duty claim';
  end if;
  raise notice 'PASS: an employee cannot review their own off-duty claim';

  -- ── The team leader rejects it ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  perform public.review_off_duty(v_off_duty_id, false, 'HR shows no leave on file');
  select status into v_status from public.task_completions where id = v_off_duty_id;
  if v_status <> 'off_duty_rejected' then
    raise exception 'FAIL: expected off_duty_rejected, got %', v_status;
  end if;
  if (select reviewed_by from public.task_completions where id = v_off_duty_id) <> v_leader_id then
    raise exception 'FAIL: reviewed_by was not recorded';
  end if;
  raise notice 'PASS: a team leader can reject an off-duty claim, with a reason recorded';

  -- ── A resolved claim cannot be reviewed twice ──
  v_raised := false;
  begin
    perform public.review_off_duty(v_off_duty_id, true, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an already-reviewed claim should not be reviewable again';
  end if;
  raise notice 'PASS: a reviewed off-duty claim cannot be reviewed again';

  -- ── Visibility: the employee sees only their own completions/answers ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  select count(*) into v_count from public.task_completions where task_id = v_task_id;
  if v_count <> 2 then
    raise exception 'FAIL: the employee should see their own 2 completions on this task, saw %', v_count;
  end if;
  select count(*) into v_count from public.checklist_answers where task_completion_id = v_completion_id;
  if v_count <> 3 then
    raise exception 'FAIL: the employee should see their own 3 answers, saw %', v_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_emp_id)::text, true);
  select count(*) into v_count from public.task_completions where task_id = v_task_id;
  if v_count <> 0 then
    raise exception 'FAIL: an employee on another team must see no completions for this task, saw %', v_count;
  end if;
  select count(*) into v_count from public.checklist_answers where task_completion_id = v_completion_id;
  if v_count <> 0 then
    raise exception 'FAIL: an employee on another team must see no answers for this task, saw %', v_count;
  end if;
  raise notice 'PASS: an employee sees only their own completions and answers';

  -- ── The owner sees everything in the org ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select count(*) into v_count from public.task_completions where task_id = v_task_id;
  if v_count <> 2 then
    raise exception 'FAIL: the owner should see both completions, saw %', v_count;
  end if;
  raise notice 'PASS: the owner sees every completion on the checklist task';

  reset role;

  -- ── Deleting the task does not delete its completion history ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  delete from public.tasks where id = v_task_id;
  select count(*) into v_count from public.task_completions where task_title = 'Daily Hygiene';
  if v_count <> 2 then
    raise exception 'FAIL: deleting the task should not delete its completion history';
  end if;
  if exists (select 1 from public.task_completions where task_title = 'Daily Hygiene' and task_id is not null) then
    raise exception 'FAIL: task_id should be cleared to null on the orphaned history rows';
  end if;
  raise notice 'PASS: completion history survives the task being deleted';
end;
$$;

-- ── update_checklist_template: editing an existing template in place ─────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_other_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_other_org_id uuid;
  v_team_id uuid;
  v_leader_id uuid;
  v_emp_id uuid;
  v_template_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_raised boolean;
  v_count int;
  v_weight numeric;
  v_snapshot_question text;
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
    'update-template-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_other_owner_id, 'authenticated', 'authenticated',
    'update-template-other-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Template Edit Co', 'Owner', 'templateeditowner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_owner_id)::text, true);
  select org_id into v_other_org_id
  from public.create_organization('Other Template Co', 'Other Owner', 'otherteditowner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_leader_id := public.admin_create_user('Lead', 'templateeditlead', 'initial123', 'team_admin', v_team_id);
  v_emp_id := public.admin_create_user('Emp', 'templateeditemp', 'initial123', 'employee', v_team_id);

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_template_id := public.create_checklist_template(
    'Daily Hygiene — Audit', true,
    '[{"section_title":"Kitchen","question":"Is the fire extinguisher valid?"}]'::jsonb
  );

  -- ── A branch manager cannot edit a checklist template ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  v_raised := false;
  begin
    perform public.update_checklist_template(
      v_template_id, 'Daily Hygiene — Audit', true,
      '[{"section_title":"Kitchen","question":"Is the fire extinguisher valid?","point_weight":0.5}]'::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a branch manager must not be able to edit a checklist template';
  end if;
  raise notice 'PASS: a branch manager cannot edit a checklist template';

  -- ── An admin from a different org cannot edit this one ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_owner_id)::text, true);
  v_raised := false;
  begin
    perform public.update_checklist_template(
      v_template_id, 'Hijacked', true, '[{"section_title":"","question":"x"}]'::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an admin must not be able to edit another organization''s template';
  end if;
  raise notice 'PASS: an admin cannot edit a template belonging to a different organization';

  -- ── A real submission exists against the original question text, before
  -- any edit — so we can prove editing later leaves it alone ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, priority, requires_review)
  values (v_org_id, v_team_id, 'Daily Hygiene', v_emp_id, v_owner_id, v_template_id, 'medium', false)
  returning id into v_task_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_completion_id := public.set_task_completion(
    v_task_id, true, null, '{}',
    '[{"section_title":"Kitchen","question":"Is the fire extinguisher valid?","sort_order":0,"answer":true}]'::jsonb
  );

  -- ── The admin adds a question, reorders, and raises a point weight ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  perform public.update_checklist_template(
    v_template_id, 'Daily Hygiene — Audit', true,
    '[
      {"section_title":"Kitchen","question":"Are the fridges clean?","point_weight":1},
      {"section_title":"Kitchen","question":"Is the fire extinguisher valid?","point_weight":0.5}
    ]'::jsonb
  );
  select count(*) into v_count from public.checklist_template_items where template_id = v_template_id;
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 items after the edit, got %', v_count;
  end if;
  select point_weight into v_weight from public.checklist_template_items
    where template_id = v_template_id and question = 'Is the fire extinguisher valid?';
  if v_weight is distinct from 0.5::numeric then
    raise exception 'FAIL: point_weight was not updated, got %', v_weight;
  end if;
  raise notice 'PASS: an admin can add a question and change point weights on an existing template';

  -- ── The earlier submission''s answer snapshot is untouched ──
  select question into v_snapshot_question from public.checklist_answers
    where task_completion_id = v_completion_id;
  if v_snapshot_question is distinct from 'Is the fire extinguisher valid?' then
    raise exception 'FAIL: editing the template must not rewrite a past answer''s question snapshot';
  end if;
  raise notice 'PASS: editing a template leaves past completions'' answer snapshots untouched';

  reset role;
end $$;

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

  -- This whole block is exactly the scenario the "each leader sees only
  -- their own" design decision has to hold up under, so it runs on the real
  -- Postgres role throughout — see the note in the "Proof photos" block.
  set role authenticated;

  select public.create_team('Kitchen') into v_kitchen_team;

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
  declare
    v_third_team uuid;
  begin
    -- create_team requires the owner, so this fixture team is created as her
    -- before switching to the hygiene leader for the actual assertion.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
    select public.create_team('Delivery') into v_third_team;
    perform set_config('request.jwt.claims', json_build_object('sub', v_hygiene_leader)::text, true);
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

  reset role;
end;
$$;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_visible_count int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated',
     'personal-test-c@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated',
     'personal-test-d@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set role authenticated;

  insert into public.push_tokens (owner_id, expo_push_token, platform)
  values (v_user_a, 'ExponentPushToken[test-a]', 'ios');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  set role authenticated;

  select count(*) into v_visible_count from public.push_tokens where owner_id = v_user_a;
  if v_visible_count <> 0 then
    raise exception 'FAIL: a different user can see someone else''s push token';
  end if;
  raise notice 'PASS: a different user cannot see this push token';

  reset role;
end $$;

-- ── Audit model: an admin's own task where the subject is chosen per
-- submission, not fixed at assignment ────────────────────────────────────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_other_team_id uuid;
  v_auditor_id uuid;      -- team_admin performing the audit (hygiene manager)
  v_other_admin_id uuid;  -- a different team_admin, unrelated to this audit
  v_subject_id uuid;      -- the employee/supervisor being audited
  v_stranger_id uuid;     -- unrelated employee, no relation to any of this
  v_template_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_raised boolean;
  v_visible_count int;
  -- A "No" answer (with its required note, since this template requires
  -- one) on the sole question, at the schema's default point_weight of
  -- 0.25 — the real thing this test now exercises: points_awarded should
  -- come from this, not from whatever the client passes as p_points
  -- (deprecated, ignored — see set_task_completion).
  v_subject_ans jsonb := '[{"section_title":"","question":"Oil changed on schedule?","sort_order":0,"answer":false,"note":"Overdue by two days"}]'::jsonb;
  v_row public.task_completions;
  v_adj public.points_adjustments;
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
    'audit-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Audit Co', 'Owner Audit', 'owneraudit');

  v_auditor_id := public.admin_create_user('Hygiene Mgr', 'hygienemgr', 'initial123', 'team_admin', v_team_id);
  v_subject_id := public.admin_create_user('Supervisor One', 'superone', 'initial123', 'employee', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_other_admin_id := public.admin_create_user('Other Mgr', 'othermgr', 'initial123', 'team_admin', v_other_team_id);
  v_stranger_id := public.admin_create_user('Stranger', 'stranger1', 'initial123', 'employee', v_other_team_id);

  set role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  v_template_id := public.create_checklist_template(
    'Oil Test', true, '[{"section_title":"","question":"Oil changed on schedule?"}]'::jsonb
  );

  -- The auditor's own recurring copy: assigned to himself, is_audit = true.
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Oil Test Audit', v_auditor_id, v_auditor_id, v_template_id, true, 'medium', false)
  returning id into v_task_id;

  -- ── The owner (not just a branch manager) can also self-assign their own
  -- audit task — the RLS owner branch originally only allowed assignee_id
  -- to be null or a team_admin/employee, which excluded the owner assigning
  -- to themselves; found and fixed while building the audit report ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Owner Oil Test Audit', v_owner_id, v_owner_id, v_template_id, true, 'medium', false);
  raise notice 'PASS: an admin can self-assign their own audit task';

  -- ── Same check, but for an owner who belongs to ZERO teams — the real
  -- state of this project's live org after "Main Team" was deleted earlier
  -- today. create_organization's own owner still gets auto-added to its
  -- default team ("purely for continuity/display"), which would have
  -- masked this: the check above only proves self-assignment works when
  -- the owner happens to belong to some team, not when they belong to none.
  -- profile_teams has no delete policy for a regular user (membership only
  -- changes through the add/remove RPCs, which bypass RLS) — reset role to
  -- do this as the table owner, same as any other privileged test setup.
  reset role;
  delete from public.profile_teams where profile_id = v_owner_id;
  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Teamless Owner Audit', v_owner_id, v_owner_id, v_template_id, true, 'medium', false);
  raise notice 'PASS: an admin with zero team memberships can still self-assign their own audit task';

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);

  -- ── An employee cannot submit an audit, even one assigned to them ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Misassigned audit', v_subject_id, v_auditor_id, v_template_id, true, 'medium', false)
  returning id into v_completion_id; -- reusing the var; this is a task id, not a completion id here
  perform set_config('request.jwt.claims', json_build_object('sub', v_subject_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(v_completion_id, true, null, '{}', v_subject_ans, '[]'::jsonb, v_auditor_id, 'morning', -1);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to submit an audit';
  end if;
  raise notice 'PASS: an employee cannot submit an audit';

  -- ── The auditor cannot name himself as the subject ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(v_task_id, true, null, '{}', v_subject_ans, '[]'::jsonb, v_auditor_id, 'morning', -1);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an auditor must not be able to audit himself';
  end if;
  raise notice 'PASS: an auditor cannot audit himself';

  -- ── A real submission: subject, shift and a penalty all stick ──
  v_completion_id := public.set_task_completion(
    v_task_id, true, null, '{}', v_subject_ans, '[]'::jsonb, v_subject_id, 'morning', -1
  );
  select * into v_row from public.task_completions where id = v_completion_id;
  if v_row.subject_profile_id is distinct from v_subject_id then
    raise exception 'FAIL: subject_profile_id was not recorded as the chosen subject';
  end if;
  if v_row.shift is distinct from 'morning' or v_row.points_awarded is distinct from -0.25::numeric then
    raise exception 'FAIL: shift/points were not recorded on the audit completion, got points=%', v_row.points_awarded;
  end if;
  raise notice 'PASS: an audit submission computes its penalty server-side from the answer''s point_weight';

  -- ── The audited supervisor can see their own result ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_subject_id)::text, true);
  select count(*) into v_visible_count from public.task_completions where id = v_completion_id;
  if v_visible_count <> 1 then
    raise exception 'FAIL: the audited supervisor should see their own audit result';
  end if;
  select count(*) into v_visible_count from public.checklist_answers where task_completion_id = v_completion_id;
  if v_visible_count <> 1 then
    raise exception 'FAIL: the audited supervisor should see the answers behind their own audit result';
  end if;
  raise notice 'PASS: the audited supervisor sees their own result and its answers';

  -- ── An unrelated employee sees nothing ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_id)::text, true);
  select count(*) into v_visible_count from public.task_completions where id = v_completion_id;
  if v_visible_count <> 0 then
    raise exception 'FAIL: an unrelated employee must not see someone else''s audit result';
  end if;
  raise notice 'PASS: an unrelated employee cannot see this audit result';

  -- ── Adjusting points: the auditor who performed it can revise it later,
  -- and both the old and new value stay visible in the trail ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  perform public.adjust_completion_points(v_completion_id, -0.125, 'clean visit next time, halving the penalty');
  select * into v_row from public.task_completions where id = v_completion_id;
  if v_row.points_awarded is distinct from -0.125::numeric then
    raise exception 'FAIL: points_awarded should reflect the adjustment';
  end if;
  select * into v_adj from public.points_adjustments where task_completion_id = v_completion_id;
  if v_adj.previous_points is distinct from -0.25::numeric or v_adj.new_points is distinct from -0.125::numeric then
    raise exception 'FAIL: the adjustment trail should record both the old and new value';
  end if;
  raise notice 'PASS: the auditor can adjust their own audit''s points, and the old value stays in the trail';

  -- ── A different, unrelated team_admin cannot adjust someone else's audit ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_admin_id)::text, true);
  v_raised := false;
  begin
    perform public.adjust_completion_points(v_completion_id, 0, 'trying to meddle');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an unrelated team_admin must not be able to adjust someone else''s audit points';
  end if;
  raise notice 'PASS: an unrelated team_admin cannot adjust someone else''s audit points';

  -- ── The owner can adjust any audit in the org ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  perform public.adjust_completion_points(v_completion_id, 0, 'owner override, visit was fine after all');
  select points_awarded into v_row.points_awarded from public.task_completions where id = v_completion_id;
  if v_row.points_awarded is distinct from 0::numeric then
    raise exception 'FAIL: the owner should be able to adjust any audit''s points';
  end if;
  raise notice 'PASS: the owner can adjust any audit''s points';

  -- ── Adjusting an ordinary (non-audit) completion is refused: there is no
  -- subject distinct from the actor, so there is nothing to adjust ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, priority, requires_review)
  values (v_org_id, v_team_id, 'An ordinary task', v_subject_id, v_auditor_id, 'medium', false)
  returning id into v_task_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_subject_id)::text, true);
  v_completion_id := public.set_task_completion(v_task_id, true, null, '{}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_raised := false;
  begin
    perform public.adjust_completion_points(v_completion_id, 1, 'should not be possible');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: adjusting points on an ordinary, non-audit completion should be refused';
  end if;
  raise notice 'PASS: an ordinary completion has no audit subject and cannot have its points adjusted';

  reset role;
end $$;

-- ── Audit scoring: a real mix of weights, and p_points is truly ignored ──
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_auditor_id uuid;
  v_subject_id uuid;
  v_template_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_row public.task_completions;
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
    'audit-scoring-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Audit Scoring Co', 'Owner', 'auditscoreowner');

  v_auditor_id := public.admin_create_user('Auditor', 'auditscoreauditor', 'initial123', 'team_admin', v_team_id);
  v_subject_id := public.admin_create_user('Subject', 'auditscoresubject', 'initial123', 'employee', v_team_id);

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_template_id := public.create_checklist_template(
    'Scoring Audit', false,
    '[
      {"section_title":"","question":"Q1"},
      {"section_title":"","question":"Q2"},
      {"section_title":"","question":"Q3"}
    ]'::jsonb
  );
  -- Distinct weights per question: a "No" on the important one should cost
  -- noticeably more than an ordinary one.
  perform public.update_checklist_template(
    v_template_id, 'Scoring Audit', false,
    '[
      {"section_title":"","question":"Q1","point_weight":0.25},
      {"section_title":"","question":"Q2","point_weight":1},
      {"section_title":"","question":"Q3","point_weight":0.25}
    ]'::jsonb
  );

  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Scoring Audit', v_auditor_id, v_owner_id, v_template_id, true, 'medium', false)
  returning id into v_task_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_auditor_id)::text, true);
  -- Q1 yes (0), Q2 no (-1), Q3 no (-0.25) = -1.25. p_points is passed as
  -- 999 specifically to prove it's ignored, not merely capped or averaged.
  v_completion_id := public.set_task_completion(
    p_task_id => v_task_id, p_completed => true, p_note => null, p_photo_urls => '{}',
    p_answers => '[
      {"section_title":"","question":"Q1","sort_order":0,"answer":true},
      {"section_title":"","question":"Q2","sort_order":1,"answer":false},
      {"section_title":"","question":"Q3","sort_order":2,"answer":false}
    ]'::jsonb,
    p_section_photos => '[]'::jsonb,
    p_subject_profile_id => v_subject_id, p_shift => 'evening', p_points => 999,
    p_signature_url => 'https://x/signature.png'
  );
  select * into v_row from public.task_completions where id = v_completion_id;
  if v_row.points_awarded is distinct from -1.25::numeric then
    raise exception 'FAIL: expected -1.25 (0 + -1 + -0.25), got %, p_points was not actually ignored', v_row.points_awarded;
  end if;
  raise notice 'PASS: scoring sums each "No" answer''s own point_weight, and a client-supplied p_points is fully ignored';

  if v_row.signature_url is distinct from 'https://x/signature.png' then
    raise exception 'FAIL: signature_url was not recorded on the audit completion';
  end if;
  raise notice 'PASS: the auditor''s signature is recorded on the completion';

  reset role;
end $$;

-- ── Fixed-time schedule: scheduled_times, task_occurrences, occurrence-aware
-- completion ───────────────────────────────────────────────────────────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_other_team_id uuid;
  v_emp_id uuid;
  v_stranger_id uuid;
  v_task_id uuid;
  v_generated int;
  v_occ_count int;
  v_occ_count_total int;
  v_occ_a uuid;
  v_occ_b uuid;
  v_completion_id uuid;
  v_row public.task_occurrences;
  v_completion public.task_completions;
  v_raised boolean;
  v_visible_count int;
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
    'schedule-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Schedule Co', 'Owner Schedule', 'ownersched');

  v_emp_id := public.admin_create_user('Supervisor Two', 'supertwo', 'initial123', 'employee', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_stranger_id := public.admin_create_user('Stranger Two', 'stranger2', 'initial123', 'employee', v_other_team_id);

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  -- ── A task cannot mix a fixed schedule with a cooldown ──
  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, scheduled_times, cooldown_hours, template_id)
    values (v_org_id, v_team_id, 'Bad', v_emp_id, v_owner_id, '{12:00,16:00}'::time[], 24,
      (select public.create_checklist_template('x', true, '[{"section_title":"","question":"q"}]'::jsonb)));
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: scheduled_times and cooldown_hours should be mutually exclusive';
  end if;
  raise notice 'PASS: a task cannot have both scheduled_times and cooldown_hours';

  -- ── A real 2x-daily task, assigned to the supervisor ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, scheduled_times, priority, requires_review)
  values (v_org_id, v_team_id, 'Oil Test', v_emp_id, v_owner_id, '{12:00,16:00}'::time[], 'medium', false)
  returning id into v_task_id;

  -- ── Generating occurrences creates exactly one row per scheduled time ──
  -- Scoped to *today's* rows specifically: past 21:00 Baghdad time,
  -- generate_task_occurrences() also creates tomorrow's rows (see its own
  -- comment in SETUP.sql), so a plain count-by-task_id is time-of-day
  -- dependent and flakes overnight. Today's date, in Baghdad time, is what
  -- this assertion actually means to check.
  v_generated := public.generate_task_occurrences();
  select count(*) into v_occ_count
  from public.task_occurrences
  where task_id = v_task_id
    and (scheduled_for at time zone 'Asia/Baghdad')::date = (now() at time zone 'Asia/Baghdad')::date;
  if v_occ_count <> 2 then
    raise exception 'FAIL: expected 2 occurrences (12:00 and 16:00), got %', v_occ_count;
  end if;
  raise notice 'PASS: generating occurrences creates one row per scheduled time';

  -- ── Running it again does not duplicate occurrences ── Compared against
  -- the total row count (today + tomorrow, whichever this ran as), not a
  -- hardcoded number — see the comment above on why that's time-of-day
  -- dependent.
  select count(*) into v_occ_count_total from public.task_occurrences where task_id = v_task_id;
  perform public.generate_task_occurrences();
  select count(*) into v_occ_count from public.task_occurrences where task_id = v_task_id;
  if v_occ_count <> v_occ_count_total then
    raise exception 'FAIL: re-running the generator should not create duplicate occurrences, had %, got %', v_occ_count_total, v_occ_count;
  end if;
  raise notice 'PASS: the generator is idempotent — re-running it creates no duplicates';

  select id into v_occ_a from public.task_occurrences where task_id = v_task_id order by scheduled_for asc limit 1;
  select id into v_occ_b from public.task_occurrences where task_id = v_task_id order by scheduled_for desc limit 1;

  -- ── The occupant of a scheduled task cannot complete it without saying
  -- which occurrence ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(v_task_id, true, null, '{}');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: completing a scheduled task with no occurrence should be rejected';
  end if;
  raise notice 'PASS: a scheduled task cannot be completed without naming an occurrence';

  -- ── Backdate one occurrence so completing it proves the "late" path is
  -- keyed on the occurrence's own time, not tasks.due (which is null here) ──
  update public.task_occurrences set scheduled_for = now() - interval '1 hour' where id = v_occ_a;

  -- ── A real completion links the occurrence and records lateness against
  -- its own scheduled_for ──
  v_completion_id := public.set_task_completion(
    v_task_id, true, null, '{}', null, '[]'::jsonb, null, null, null, v_occ_a
  );
  select * into v_row from public.task_occurrences where id = v_occ_a;
  if v_row.completion_id is distinct from v_completion_id then
    raise exception 'FAIL: the occurrence should be linked to the new completion';
  end if;
  select * into v_completion from public.task_completions where id = v_completion_id;
  if v_completion.was_late is distinct from true then
    raise exception 'FAIL: completing a backdated occurrence should be recorded as late';
  end if;
  if v_completion.due_at is distinct from v_row.scheduled_for then
    raise exception 'FAIL: due_at should snapshot the occurrence''s scheduled_for, not tasks.due';
  end if;
  raise notice 'PASS: completing an occurrence links it and records lateness against its own time';

  -- ── The same occurrence cannot be completed twice ──
  v_raised := false;
  begin
    perform public.set_task_completion(v_task_id, true, null, '{}', null, '[]'::jsonb, null, null, null, v_occ_a);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an already-completed occurrence should not be completable again';
  end if;
  raise notice 'PASS: an occurrence cannot be completed twice';

  -- ── The other, still-open occurrence for the same task is unaffected ──
  select completion_id into v_row.completion_id from public.task_occurrences where id = v_occ_b;
  if v_row.completion_id is not null then
    raise exception 'FAIL: completing one occurrence should not touch a sibling occurrence';
  end if;
  raise notice 'PASS: completing one occurrence leaves its sibling untouched';

  -- ── Occurrence visibility mirrors the task's: an unrelated employee on a
  -- different team sees nothing ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_id)::text, true);
  select count(*) into v_visible_count from public.task_occurrences where task_id = v_task_id;
  if v_visible_count <> 0 then
    raise exception 'FAIL: an unrelated employee must not see this task''s occurrences';
  end if;
  raise notice 'PASS: occurrence visibility follows the task — an unrelated employee sees none';

  reset role;
end $$;

-- ── Form module: structured fields for oil test / hood cleaning / chicken
-- marination — real values, not yes/no questions ─────────────────────────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_other_team_id uuid;
  v_emp_id uuid;
  v_stranger_id uuid;
  v_template_id uuid;
  v_task_id uuid;
  v_completion_id uuid;
  v_field_count int;
  v_field_tpm uuid;
  v_field_fryer uuid;
  v_field_filtration uuid;
  v_raised boolean;
  v_visible_count int;
  v_value text;
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
    'form-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Form Co', 'Owner Form', 'ownerform');

  v_emp_id := public.admin_create_user('Supervisor Three', 'superthree', 'initial123', 'employee', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_stranger_id := public.admin_create_user('Stranger Three', 'stranger3', 'initial123', 'employee', v_other_team_id);

  set role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);

  -- ── An employee cannot create a form template ──
  v_raised := false;
  begin
    perform public.create_form_template('Oil Test', '[{"label":"TPM %","field_type":"number"}]'::jsonb);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create a form template';
  end if;
  raise notice 'PASS: an employee cannot create a form template';

  -- ── The owner creates a real, mixed-field-type template ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  v_template_id := public.create_form_template(
    'Oil Test',
    '[
      {"label":"Fryer","field_type":"select","options":["Fanker","KFC"]},
      {"label":"TPM %","field_type":"number","unit":"%"},
      {"label":"Filtration","field_type":"select","options":["OK","Replace"]},
      {"label":"Checked By","field_type":"text","required":false}
    ]'::jsonb
  );
  select count(*) into v_field_count from public.form_template_fields where template_id = v_template_id;
  if v_field_count <> 4 then
    raise exception 'FAIL: expected 4 fields, got %', v_field_count;
  end if;
  select id into v_field_fryer from public.form_template_fields where template_id = v_template_id and label = 'Fryer';
  select id into v_field_tpm from public.form_template_fields where template_id = v_template_id and label = 'TPM %';
  select id into v_field_filtration from public.form_template_fields where template_id = v_template_id and label = 'Filtration';
  raise notice 'PASS: a mixed-field-type form template is created correctly';

  -- ── A select field with no options is rejected ──
  v_raised := false;
  begin
    perform public.create_form_template('Bad', '[{"label":"x","field_type":"select"}]'::jsonb);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a select field with no options should be rejected';
  end if;
  raise notice 'PASS: a select field with no options is rejected';

  -- ── A task cannot be both a checklist and a form ──
  v_raised := false;
  begin
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, form_template_id, template_id)
    values (
      v_org_id, v_team_id, 'Bad', v_emp_id, v_owner_id, v_template_id,
      (select public.create_checklist_template('x', true, '[{"section_title":"","question":"q"}]'::jsonb))
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a task should not be able to have both template_id and form_template_id';
  end if;
  raise notice 'PASS: a task cannot be both a checklist and a form';

  -- ── A real form task, assigned to the supervisor ──
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, form_template_id, priority, requires_review)
  values (v_org_id, v_team_id, 'Oil Test', v_emp_id, v_owner_id, v_template_id, 'medium', false)
  returning id into v_task_id;

  -- ── Missing a required field is rejected ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.set_task_completion(
      v_task_id, true, null, '{}', null, '[]'::jsonb, null, null, null, null,
      json_build_array(json_build_object('field_id', v_field_tpm, 'value', '18'))::jsonb
    );
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a submission missing a required field should be rejected';
  end if;
  raise notice 'PASS: a form submission missing a required field is rejected';

  -- ── A complete submission (the optional field left out entirely) saves
  -- real values, not yes/no ──
  v_completion_id := public.set_task_completion(
    v_task_id, true, null, '{}', null, '[]'::jsonb, null, null, null, null,
    json_build_array(
      json_build_object('field_id', v_field_fryer, 'value', 'Fanker'),
      json_build_object('field_id', v_field_tpm, 'value', '18.5'),
      json_build_object('field_id', v_field_filtration, 'value', 'OK')
    )::jsonb
  );
  select count(*) into v_field_count from public.form_answers where task_completion_id = v_completion_id;
  if v_field_count <> 3 then
    raise exception 'FAIL: expected 3 saved form answers, got %', v_field_count;
  end if;
  select value into v_value from public.form_answers where task_completion_id = v_completion_id and field_id = v_field_tpm;
  if v_value is distinct from '18.5' then
    raise exception 'FAIL: expected the real TPM value ''18.5'', got %', coalesce(v_value, '<null>');
  end if;
  raise notice 'PASS: a valid form submission saves the real field values, not yes/no';

  -- ── An unrelated employee cannot see these form answers ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_id)::text, true);
  select count(*) into v_visible_count from public.form_answers where task_completion_id = v_completion_id;
  if v_visible_count <> 0 then
    raise exception 'FAIL: an unrelated employee must not see this submission''s form answers';
  end if;
  raise notice 'PASS: an unrelated employee cannot see this submission''s form answers';

  reset role;
end $$;

-- ── Brands schema foundation ─────────────────────────────────────────
do $$
declare
  v_has_table boolean;
  v_has_col boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'brands'
  ) into v_has_table;
  if not v_has_table then
    raise exception 'FAIL: public.brands table is missing';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'branch_brands'
  ) into v_has_table;
  if not v_has_table then
    raise exception 'FAIL: public.branch_brands table is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_teams'
      and column_name = 'brand_id'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profile_teams.brand_id column is missing';
  end if;
  raise notice 'PASS: brands, branch_brands, profile_teams.brand_id exist';
end $$;

-- ── create_brand: owner-only, unique per org ────────────────────────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_leader_id uuid;
  v_brand_id uuid;
  v_owner2_id uuid := gen_random_uuid();
  v_org2_id uuid;
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
    'brand-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Brand Test Org', 'Brand Owner', 'brandowner');
  v_leader_id := public.admin_create_user('Leader', 'brandleader', 'initial123', 'team_admin', v_team_id);

  -- owner creates a brand
  v_brand_id := public.create_brand('360');
  if v_brand_id is null then
    raise exception 'FAIL: create_brand should return the new brand''s id';
  end if;
  if not exists (select 1 from public.brands where id = v_brand_id and name = '360' and org_id = v_org_id) then
    raise exception 'FAIL: the new brand row was not saved correctly';
  end if;
  raise notice 'PASS: an owner can create a brand';

  -- a team_admin is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  begin
    perform public.create_brand('AA Chicken');
    raise exception 'FAIL: a team_admin should not be able to create a brand';
  exception when others then
    if sqlerrm !~ 'only.*admin' then raise; end if;
  end;
  raise notice 'PASS: a team_admin cannot create a brand';

  -- duplicate name in the same org is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.create_brand('360');
    raise exception 'FAIL: a duplicate brand name in the same org should be rejected';
  exception when others then
    if sqlerrm !~ 'already exists' then raise; end if;
  end;
  raise notice 'PASS: a duplicate brand name in the same org is rejected';

  -- the same name in a different org is fine — needs its own fresh owner,
  -- since create_organization refuses a caller who already has a profile
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner2_id, 'authenticated', 'authenticated',
    'brand-owner2.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner2_id)::text, true);
  select org_id into v_org2_id
  from public.create_organization('Other Brand Org', 'Other Owner', 'otherbrandowner');
  perform public.create_brand('360');
  if not exists (select 1 from public.brands where name = '360' and org_id = v_org2_id) then
    raise exception 'FAIL: the same brand name should be allowed in a different org';
  end if;
  raise notice 'PASS: the same brand name is allowed across different orgs';
end $$;

-- ── set_branch_brands: owner-only, delete-and-reinsert ──────────────
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_leader_id uuid;
  v_brand_360 uuid;
  v_brand_aa uuid;
  v_brand_center uuid;
  v_count int;
  v_other_owner_id uuid := gen_random_uuid();
  v_other_org_id uuid;
  v_other_brand_id uuid;
  v_third_owner_id uuid := gen_random_uuid();
  v_other_team_id uuid;
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
    'setbrands-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('SetBrands Org', 'SetBrands Owner', 'setbrandsowner');
  v_leader_id := public.admin_create_user('Leader', 'setbrandsleader', 'initial123', 'team_admin', v_team_id);

  v_brand_360 := public.create_brand('360');
  v_brand_aa := public.create_brand('AA Chicken');
  v_brand_center := public.create_brand('Center');

  -- owner sets the branch's brands
  perform public.set_branch_brands(v_team_id, array[v_brand_360, v_brand_aa]);
  select count(*) into v_count from public.branch_brands where branch_id = v_team_id;
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 branch_brands rows, got %', v_count;
  end if;
  raise notice 'PASS: an owner can set a branch''s brands';

  -- calling again fully replaces the set
  perform public.set_branch_brands(v_team_id, array[v_brand_center]);
  select count(*) into v_count from public.branch_brands where branch_id = v_team_id;
  if v_count <> 1 or not exists (select 1 from public.branch_brands where branch_id = v_team_id and brand_id = v_brand_center) then
    raise exception 'FAIL: set_branch_brands should replace the full set, not add to it';
  end if;
  raise notice 'PASS: set_branch_brands replaces the full set';

  -- a team_admin is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  begin
    perform public.set_branch_brands(v_team_id, array[v_brand_360]);
    raise exception 'FAIL: a team_admin should not be able to set a branch''s brands';
  exception when others then
    if sqlerrm !~ 'only.*admin' then raise; end if;
  end;
  raise notice 'PASS: a team_admin cannot set a branch''s brands';

  -- a brand from a different org is rejected — needs its own fresh owner
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_other_owner_id, 'authenticated', 'authenticated',
    'setbrands-other-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_owner_id)::text, true);
  select org_id into v_other_org_id
  from public.create_organization('SetBrands Other Org', 'Other Owner', 'setbrandsotherowner');
  v_other_brand_id := public.create_brand('Foreign Brand');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.set_branch_brands(v_team_id, array[v_other_brand_id]);
    raise exception 'FAIL: a brand from another organization should be rejected';
  exception when others then
    if sqlerrm !~ 'not belong' then raise; end if;
  end;
  raise notice 'PASS: a brand from another organization is rejected';

  -- a branch from a different org is rejected — needs its own fresh owner
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_third_owner_id, 'authenticated', 'authenticated',
    'setbrands-third-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_third_owner_id)::text, true);
  select team_id into v_other_team_id
  from public.create_organization('SetBrands Third Org', 'Third Owner', 'setbrandsthirdowner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.set_branch_brands(v_other_team_id, array[v_brand_360]);
    raise exception 'FAIL: a branch from another organization should be rejected';
  exception when others then
    if sqlerrm !~ 'does not belong' then raise; end if;
  end;
  raise notice 'PASS: a branch from another organization is rejected';
end $$;

-- ── Brand validation on admin_create_user and add_profile_to_team ───────

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_team2_id uuid;
  v_brand_360 uuid;
  v_brand_aa uuid;
  v_emp_id uuid;
  v_leader_id uuid;
  v_saved_brand uuid;
  v_row_count int;
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
    'brandval-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('BrandVal Org', 'BrandVal Owner', 'brandvalowner');
  v_brand_360 := public.create_brand('360');
  v_brand_aa := public.create_brand('AA Chicken');
  perform public.set_branch_brands(v_team_id, array[v_brand_360]);
  insert into public.teams (org_id, name) values (v_org_id, 'Second Branch') returning id into v_team2_id;

  -- admin_create_user with a valid (team, brand) pair
  v_emp_id := public.admin_create_user('Supervisor', 'brandvalemp', 'initial123', 'employee', v_team_id, null, v_brand_360);
  select brand_id into v_saved_brand from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  if v_saved_brand is distinct from v_brand_360 then
    raise exception 'FAIL: admin_create_user should save the supervisor''s brand';
  end if;
  raise notice 'PASS: admin_create_user saves a valid brand for a supervisor';

  -- a brand for a team_admin is rejected
  begin
    perform public.admin_create_user('Manager', 'brandvalmgr', 'initial123', 'team_admin', v_team_id, null, v_brand_360);
    raise exception 'FAIL: a brand should be rejected for a team_admin';
  exception when others then
    if sqlerrm !~ 'brand' then raise; end if;
  end;
  raise notice 'PASS: admin_create_user rejects a brand for a non-employee role';

  -- a brand not enabled at that branch is rejected
  begin
    perform public.admin_create_user('Supervisor2', 'brandvalemp2', 'initial123', 'employee', v_team_id, null, v_brand_aa);
    raise exception 'FAIL: a brand not enabled at the branch should be rejected';
  exception when others then
    if sqlerrm !~ 'does not operate' then raise; end if;
  end;
  raise notice 'PASS: admin_create_user rejects a brand not enabled at that branch';

  -- add_profile_to_team upserts the brand on an existing membership
  perform public.set_branch_brands(v_team_id, array[v_brand_360, v_brand_aa]);
  perform public.add_profile_to_team(v_emp_id, v_team_id, v_brand_aa);
  select count(*) into v_row_count from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  select brand_id into v_saved_brand from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  if v_row_count <> 1 or v_saved_brand is distinct from v_brand_aa then
    raise exception 'FAIL: add_profile_to_team should update the existing row''s brand in place, got % rows / brand %', v_row_count, v_saved_brand;
  end if;
  raise notice 'PASS: add_profile_to_team upserts the brand on an existing membership';

  -- add_profile_to_team rejects a brand for a team_admin
  v_leader_id := public.admin_create_user('Leader2', 'brandvalleader', 'initial123', 'team_admin', v_team2_id);
  begin
    perform public.add_profile_to_team(v_leader_id, v_team_id, v_brand_360);
    raise exception 'FAIL: add_profile_to_team should reject a brand for a team_admin';
  exception when others then
    if sqlerrm !~ 'brand' then raise; end if;
  end;
  raise notice 'PASS: add_profile_to_team rejects a brand for a non-employee role';
end $$;

rollback;
