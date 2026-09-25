-- 2026-09-25 SECURITY HOTFIX, from the independent code review (all proved
-- against live data before and after; see the .test.sql beside this file).
--
-- C1  A NULL code passed the recovery code check (crypt() is strict, so the
--     comparison was NULL and the wrong-code branch was skipped): anyone could
--     reset a password, or verify any address, without the code.
-- C2  profiles had no guard on is_super_admin/role/active/deleted_at/...: any
--     signed-in user could PATCH themselves super admin through the API and
--     read the admin record; an admin could make anyone an admin, or point
--     the super admin's recovery email at themselves.
-- I1  Any admin could reset the super admin's password.
-- I2  No locks: parallel requests got past the 5-try limit and the rate limit.
-- I3  A read-only GET call, and timing, told which accounts had an email.
-- I4  org_settings and shifts were created after the record's triggers.
-- Plus: a reset now ends the old sessions; a failed alert no longer loses
-- the record line; log_activity details are size-capped.
-- Apply with psql -1.

-- ── C2: only the SECURITY DEFINER functions may change these ────────────
create or replace function public.guard_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Direct API writes run as authenticated/anon; the definer functions run
  -- as the table owner and are the one sanctioned way to change these.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.is_super_admin is distinct from old.is_super_admin
     or new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.deleted_at is distinct from old.deleted_at
     or new.org_id is distinct from old.org_id
     or new.username is distinct from old.username
     or new.must_change_password is distinct from old.must_change_password
     or new.recovery_email_verified_at is distinct from old.recovery_email_verified_at then
    raise exception 'that change has to go through the app';
  end if;
  if new.recovery_email is distinct from old.recovery_email then
    if new.id is distinct from auth.uid() then raise exception 'that change has to go through the app'; end if;
    -- An address typed straight into the profile was never proved, so it
    -- gets no reset codes until it is confirmed with one.
    new.recovery_email_verified_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists guard_profile_columns on public.profiles;
create trigger guard_profile_columns before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- Belt and braces: the record is read by an ADMIN who is the super admin.
alter policy "only the super admin reads admin activity" on public.admin_activity
  using (org_id = public.my_org_id() and public.my_role() = 'owner' and public.is_super_admin(auth.uid()));

-- ── I1: nobody below the super admin resets an admin's password ─────────
create or replace function public.admin_reset_password(p_target_profile_id uuid, p_new_password text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_target public.profiles;
begin
  perform public.assert_can_manage_user(p_target_profile_id);
  select * into v_target from public.profiles where id = p_target_profile_id;
  -- The super admin is the account that restores everyone else.
  if v_target.is_super_admin and p_target_profile_id is distinct from auth.uid() then
    raise exception 'only the super admin can change the super admin''s password';
  end if;
  if v_target.role = 'owner' and not public.is_super_admin(auth.uid()) then
    raise exception 'only the super admin can reset an admin''s password';
  end if;

  if coalesce(length(p_new_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = now()
  where id = p_target_profile_id;

  update public.profiles
  set must_change_password = true
  where id = p_target_profile_id;
end;
$$;

-- ── C1, I2, I3: the recovery functions ──────────────────────────────────
create or replace function public.request_recovery_email(p_email text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(p_email)); v_code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that does not look like an email address'; end if;
  -- One request at a time per person, so parallel calls cannot slip past the rate limit.
  perform pg_advisory_xact_lock(hashtext('recovery:' || auth.uid()::text));
  if not public.recovery_rate_ok(auth.uid(), 'verify_email') then
    raise exception 'please wait a minute before asking for another code';
  end if;
  v_code := public.new_recovery_code();
  -- Any earlier code for this purpose stops working.
  update public.recovery_codes set used_at = now()
   where profile_id = auth.uid() and purpose = 'verify_email' and used_at is null;
  insert into public.recovery_codes (profile_id, purpose, email, code_hash, expires_at)
  values (auth.uid(), 'verify_email', v_email, crypt(v_code, gen_salt('bf', 8)), now() + interval '15 minutes');
  perform public.send_app_email(v_email, 'BD Audit — ' || v_code || ' is your code', public.recovery_email_html(v_code, false));
end; $$;

drop function if exists public.confirm_recovery_email(text);
create function public.confirm_recovery_email(p_code text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_row public.recovery_codes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- FOR UPDATE: parallel tries queue up, so each one is counted.
  select * into v_row from public.recovery_codes
   where profile_id = auth.uid() and purpose = 'verify_email' and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if v_row.id is null or v_row.attempts >= 5 then return null; end if;
  -- A NULL or malformed code must fail: crypt(NULL) is NULL, and "NULL <> x"
  -- is not true, which used to let a missing code through.
  if p_code is null or trim(p_code) !~ '^[0-9]{6}$'
     or crypt(trim(p_code), v_row.code_hash) is distinct from v_row.code_hash then
    update public.recovery_codes set attempts = attempts + 1 where id = v_row.id;
    return null;
  end if;
  update public.recovery_codes set used_at = now() where id = v_row.id;
  update public.profiles set recovery_email = v_row.email, recovery_email_verified_at = now() where id = auth.uid();
  return v_row.email;
end; $$;

-- Never says whether the account exists or has an email — not by its answer,
-- not by erroring on a read-only (GET) call, and not by taking longer.
create or replace function public.request_password_reset(p_org_code text, p_username text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_email text; v_code text;
begin
  if current_setting('transaction_read_only') = 'on' then return; end if;
  v_id := public.profile_for_login(p_org_code, p_username);
  if v_id is not null then
    perform pg_advisory_xact_lock(hashtext('recovery:' || v_id::text));
    select recovery_email into v_email from public.profiles
     where id = v_id and recovery_email is not null and recovery_email_verified_at is not null;
  end if;
  if v_email is null or not public.recovery_rate_ok(v_id, 'reset_password') then
    perform crypt('000000', gen_salt('bf', 8));  -- the same work as the real path
    return;
  end if;
  v_code := public.new_recovery_code();
  update public.recovery_codes set used_at = now()
   where profile_id = v_id and purpose = 'reset_password' and used_at is null;
  insert into public.recovery_codes (profile_id, purpose, email, code_hash, expires_at)
  values (v_id, 'reset_password', v_email, crypt(v_code, gen_salt('bf', 8)), now() + interval '15 minutes');
  begin
    perform public.send_app_email(v_email, 'BD Audit — ' || v_code || ' resets your password', public.recovery_email_html(v_code, true));
  exception when others then
    raise warning 'recovery email not sent: %', sqlerrm;
  end;
end; $$;

drop function if exists public.reset_password_with_code(text, text, text, text);
create function public.reset_password_with_code(p_org_code text, p_username text, p_code text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_row public.recovery_codes;
begin
  if current_setting('transaction_read_only') = 'on' then return false; end if;
  if length(coalesce(p_new_password, '')) < 6 then raise exception 'password must be at least 6 characters'; end if;
  v_id := public.profile_for_login(p_org_code, p_username);
  if v_id is not null then
    select * into v_row from public.recovery_codes
     where profile_id = v_id and purpose = 'reset_password' and used_at is null and expires_at > now()
     order by created_at desc limit 1 for update;
  end if;
  if v_row.id is null or v_row.attempts >= 5 then return false; end if;
  if p_code is null or trim(p_code) !~ '^[0-9]{6}$'
     or crypt(trim(p_code), v_row.code_hash) is distinct from v_row.code_hash then
    update public.recovery_codes set attempts = attempts + 1 where id = v_row.id;
    return false;
  end if;
  update public.recovery_codes set used_at = now() where id = v_row.id;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now() where id = v_id;
  update public.profiles set must_change_password = false where id = v_id;
  -- Whoever held the old password is signed out everywhere.
  delete from auth.sessions where user_id = v_id;
  delete from auth.refresh_tokens where user_id = v_id::text;
  return true;
end; $$;

revoke all on function public.confirm_recovery_email(text) from public, anon;
grant execute on function public.confirm_recovery_email(text) to authenticated;
revoke all on function public.request_password_reset(text, text), public.reset_password_with_code(text, text, text, text) from public;
grant execute on function public.request_password_reset(text, text), public.reset_password_with_code(text, text, text, text) to anon, authenticated;

-- ── The admin record: its own alert block, capped details, new tables ────
create or replace function public.log_admin_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin record;
  v_before jsonb;
  v_after jsonb;
  v_alert text;
begin
  select * into v_admin from public.watched_admin();
  if v_admin.id is null then return null; end if;

  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_before = v_after then return null; end if;

  -- Recording must never break the admin's own action (or give it away).
  begin
    insert into public.admin_activity
      (org_id, actor_id, actor_name, kind, table_name, op, row_id, before, after, ip, user_agent)
    values
      (v_admin.org_id, v_admin.id, v_admin.name, 'change', tg_table_name, lower(tg_op),
       coalesce(v_after->>'id', v_before->>'id'), v_before, v_after,
       public.request_ip(), public.request_user_agent());
  exception when others then
    raise warning 'admin_activity: % (%)', sqlerrm, tg_table_name;
    return null;
  end;

  -- The alerts, in their own block: a failed alert keeps the record line.
  v_alert := case
    when tg_table_name = 'profiles' and tg_op = 'UPDATE'
         and v_before->>'deleted_at' is null and v_after->>'deleted_at' is not null
      then v_admin.name || ' deleted ' || coalesce(v_before->>'name', 'someone')
    when tg_table_name = 'profiles' and tg_op = 'UPDATE'
         and (v_before->>'active')::boolean and not (v_after->>'active')::boolean
      then v_admin.name || ' deactivated ' || coalesce(v_after->>'name', 'someone')
    when tg_table_name = 'profiles' and tg_op = 'DELETE'
      then v_admin.name || ' deleted ' || coalesce(v_before->>'name', 'someone')
    when tg_table_name = 'teams' and tg_op = 'DELETE'
      then v_admin.name || ' deleted the branch ' || coalesce(v_before->>'name', '')
    when tg_table_name in ('task_completions', 'oil_tests', 'chicken_marinations') and tg_op = 'DELETE'
      then v_admin.name || ' deleted a record (' || replace(tg_table_name, '_', ' ') || ')'
    when tg_table_name = 'checklist_templates' and tg_op = 'DELETE'
      then v_admin.name || ' deleted the checklist ' || coalesce(v_before->>'name', '')
    else null
  end;
  if v_alert is not null then
    begin
      perform public.alert_super_admin(v_admin.org_id, v_alert);
    exception when others then
      raise warning 'admin_activity alert: %', sqlerrm;
    end;
  end if;
  return null;
end; $$;
revoke all on function public.log_admin_change() from public, anon, authenticated;

create or replace function public.log_activity(p_kind text, p_what text, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin record;
begin
  if p_kind not in ('sign_in', 'view', 'export') then return; end if;
  select * into v_admin from public.watched_admin();
  if v_admin.id is null then return; end if;
  insert into public.admin_activity
    (org_id, actor_id, actor_name, kind, op, detail, ip, user_agent)
  values
    (v_admin.org_id, v_admin.id, v_admin.name, p_kind, left(p_what, 200),
     case when pg_column_size(p_detail) > 2000 then null else p_detail end,
     public.request_ip(), public.request_user_agent());
exception when others then
  raise warning 'admin_activity: %', sqlerrm;
end; $$;

drop trigger if exists zz_admin_activity on public.org_settings;
create trigger zz_admin_activity after insert or update or delete on public.org_settings
  for each row execute function public.log_admin_change();
drop trigger if exists zz_admin_activity on public.shifts;
create trigger zz_admin_activity after insert or update or delete on public.shifts
  for each row execute function public.log_admin_change();
