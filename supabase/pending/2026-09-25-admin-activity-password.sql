-- 2026-09-25, part 2 of the admin activity record (part 1:
-- 2026-09-25-admin-activity.sql, which must be applied first). Kept apart
-- because it puts a trigger on auth.users, which Supabase may refuse; part 1
-- must not roll back with it. If this is refused, a reset still shows in the
-- record as the profile's must_change_password turning on.

-- A password reset changes auth.users, which the public triggers never see.
create or replace function public.log_admin_password_reset()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin record; v_target text;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return null; end if;
  select * into v_admin from public.watched_admin();
  if v_admin.id is null then return null; end if;
  -- An admin changing their OWN password is not a reset of someone else's.
  if new.id = v_admin.id then return null; end if;
  select name into v_target from public.profiles where id = new.id;
  begin
  insert into public.admin_activity
    (org_id, actor_id, actor_name, kind, table_name, op, row_id, detail, ip, user_agent)
  values
    (v_admin.org_id, v_admin.id, v_admin.name, 'password', 'auth.users', 'update', new.id::text,
     jsonb_build_object('target_name', v_target), public.request_ip(), public.request_user_agent());
  perform public.alert_super_admin(v_admin.org_id, v_admin.name || ' reset the password of ' || coalesce(v_target, 'someone'));
  exception when others then
    raise warning 'admin_activity: %', sqlerrm;
  end;
  return null;
end; $$;

drop trigger if exists zz_admin_activity_password on auth.users;
create trigger zz_admin_activity_password after update of encrypted_password on auth.users
  for each row execute function public.log_admin_password_reset();

revoke all on function public.log_admin_password_reset() from public, anon, authenticated;
