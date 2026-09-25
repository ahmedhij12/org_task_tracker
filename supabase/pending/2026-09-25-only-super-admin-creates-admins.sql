-- 2026-09-25. Only the super admin creates admins; only an admin creates a
-- hygiene auditor. Re-created from the LIVE admin_create_user. Apply with psql -1.

CREATE OR REPLACE FUNCTION public.admin_create_user(p_name text, p_username text, p_password text, p_role text DEFAULT 'employee'::text, p_team_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_org_code text;
  v_new_id uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  if v_caller_role is null then
    raise exception 'not authenticated';
  end if;
  if v_caller_role not in ('owner', 'team_admin') then
    raise exception 'only an admin or team leader can create users';
  end if;
  if p_role not in ('employee', 'team_admin', 'owner', 'hygiene_auditor') then
    raise exception 'role must be employee, team_admin, hygiene_auditor, or owner';
  end if;
  -- Only an existing admin may create another admin — never a branch
  -- manager, even though the branch-manager branch below would already
  -- catch this (p_role must be 'employee' there). Kept as its own explicit
  -- check because this is a privilege-escalation boundary, not incidental.
  -- Only the super admin creates admins (spec 2026-09-24, "who creates whom").
  if p_role = 'owner' and not public.is_super_admin(auth.uid()) then
    raise exception 'only the super admin can create an admin';
  end if;
  -- The hygiene auditor sees every branch: only an admin creates one.
  if p_role = 'hygiene_auditor' and v_caller_role <> 'owner' then
    raise exception 'only an admin can create a hygiene auditor';
  end if;

  if v_caller_role = 'team_admin' then
    if p_role <> 'employee' then
      raise exception 'a branch manager can only create supervisors';
    end if;
    if p_team_id is null or not (p_team_id = any(v_caller_teams)) then
      raise exception 'a branch manager can only create users on their own branch';
    end if;
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org
  ) then
    raise exception 'team not found in this organization';
  end if;

  if p_brand_id is not null then
    if p_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if p_team_id is null or not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  if v_username = '' then
    raise exception 'a username is required';
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.org_id = v_caller_org and lower(p.username) = v_username
  ) then
    raise exception 'that username is already taken in this organization';
  end if;

  select o.org_code into v_org_code
  from public.organizations o where o.id = v_caller_org;

  -- Globally unique: org_code is unique across orgs, username is unique
  -- within an org. Never a real mailbox — see recovery_email for that.
  v_email := v_username || '.' || v_org_code || '@users.rungs.internal';

  -- confirmed_at is a generated column and must not be inserted into. The
  -- token columns must be '' rather than NULL: GoTrue scans them into
  -- non-nullable Go strings and errors out on NULL at login.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf', 10)),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- GoTrue's password grant checks identities as well as users; without this
  -- row the account exists but cannot sign in.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_new_id::text, v_new_id,
    jsonb_build_object(
      'sub', v_new_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  );

  insert into public.profiles (
    id, org_id, name, title, username, role,
    must_change_password, active
  ) values (
    v_new_id, v_caller_org, p_name,
    nullif(trim(coalesce(p_title, '')), ''), v_username, p_role,
    true, true
  );

  if p_team_id is not null then
    insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
    values (v_new_id, p_team_id, auth.uid(), p_brand_id);
  end if;

  return v_new_id;
end;
$function$;
