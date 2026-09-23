-- Super admin: an admin who may also deactivate and delete other admins.
--
-- Why a flag and not a fourth role: 17 RLS policies and most of the app key
-- off role = 'owner'. A new role would have to be added to every one of them
-- to keep its ordinary admin powers, on a live system. A super admin IS an
-- admin — role stays 'owner', so nothing existing changes — and the flag adds
-- exactly one power on top.
--
-- Built from the LIVE pg_get_functiondef of both functions, not from
-- SETUP.sql, which has drifted.

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

comment on column public.profiles.is_super_admin is
  'An owner who may also manage other owners. Never settable from the app.';

create or replace function public.is_super_admin(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = p_profile_id), false);
$function$;

-- CHANGED: an admin target used to be refused outright. Now a super admin may
-- switch one off, and no one may switch off a super admin.
create or replace function public.admin_set_user_active(p_target_profile_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target public.profiles;
begin
  perform public.assert_can_manage_user(p_target_profile_id);

  if p_target_profile_id = auth.uid() then
    raise exception 'you cannot deactivate your own account';
  end if;

  select * into v_target from public.profiles where id = p_target_profile_id;

  -- The super admin is the account that can restore everyone else, so nothing
  -- may switch one off. This is the only guard against locking the org out.
  if v_target.is_super_admin and not p_active then
    raise exception 'a super admin cannot be deactivated';
  end if;
  if v_target.role = 'owner' and not public.is_super_admin(auth.uid()) then
    raise exception 'only a super admin can deactivate an admin';
  end if;

  update public.profiles
  set active = p_active
  where id = p_target_profile_id;

  if p_active then
    update auth.users set banned_until = null, updated_at = now()
    where id = p_target_profile_id;
  else
    update auth.users set banned_until = 'infinity'::timestamptz, updated_at = now()
    where id = p_target_profile_id;
    delete from auth.sessions where user_id = p_target_profile_id;
    delete from auth.refresh_tokens where user_id = p_target_profile_id::text;
  end if;
end;
$function$;

-- CHANGED: same swap of the blanket 'owner cannot be deleted' rule, plus an
-- explicit self-delete guard that the old owner rule used to provide.
create or replace function public.admin_delete_user(p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target public.profiles;
begin
  if public.role_of(auth.uid()) is distinct from 'owner' then
    raise exception 'only an admin can delete staff';
  end if;
  select * into v_target from public.profiles where id = p_target_profile_id;
  if v_target.id is null or v_target.org_id is distinct from public.my_org_id() then
    raise exception 'not found';
  end if;
  if v_target.id = auth.uid() then
    raise exception 'you cannot delete your own account';
  end if;
  if v_target.is_super_admin then
    raise exception 'a super admin cannot be deleted';
  end if;
  if v_target.role = 'owner' and not public.is_super_admin(auth.uid()) then
    raise exception 'only a super admin can delete an admin';
  end if;
  if v_target.active then
    raise exception 'deactivate this account before deleting it';
  end if;

  update public.profiles
  set deleted_at = now(), username = null, recovery_email = null
  where id = p_target_profile_id;

  -- The synthetic auth email is built from the username, so it has to move
  -- too, or the freed username couldn't be given to anyone new.
  update auth.users
  set banned_until = 'infinity'::timestamptz,
      email = 'deleted.' || p_target_profile_id || '@users.rungs.internal',
      updated_at = now()
  where id = p_target_profile_id;
  update auth.identities
  set identity_data = identity_data || jsonb_build_object('email', 'deleted.' || p_target_profile_id || '@users.rungs.internal')
  where user_id = p_target_profile_id;
  delete from auth.sessions where user_id = p_target_profile_id;
  delete from auth.refresh_tokens where user_id = p_target_profile_id::text;
end;
$function$;

-- hijazi is the super admin.
update public.profiles set is_super_admin = true where username = 'hijazi12';
