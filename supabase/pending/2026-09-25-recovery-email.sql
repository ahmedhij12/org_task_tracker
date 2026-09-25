-- 2026-09-25. Recovery email that actually works.
--
-- Sign-in addresses are synthetic (username.ORG@users.rungs.internal), so
-- Supabase's own reset mail can never reach anyone, and the old "add recovery
-- email" saved an address nobody ever proved was theirs. This replaces both
-- with 6-digit codes, sent through Resend from the database:
--   Settings:  request_recovery_email(email)  → code mailed to that address
--              confirm_recovery_email(code)    → address marked verified
--   Sign-in:   request_password_reset(org, username) → code to the VERIFIED address
--              reset_password_with_code(org, username, code, new password)
-- Sign-in addresses are never changed. Codes are stored hashed, expire after
-- 15 minutes, die after 5 wrong tries, and requests are rate-limited. The
-- reset request never says whether an account exists or has an email.
--
-- The Resend key is inserted into app_secrets OUT OF BAND (never in git):
--   insert into app_secrets (key, value) values ('resend_api_key', '<key>')
--   on conflict (key) do update set value = excluded.value;
-- Apply with psql -1.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists recovery_email_verified_at timestamptz;

create table if not exists public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recovery_codes_profile on public.recovery_codes (profile_id, purpose, created_at desc);
alter table public.recovery_codes enable row level security;
-- No policies: only the SECURITY DEFINER functions below touch it.
revoke all on public.recovery_codes from anon, authenticated;

-- A 6-digit code from the cryptographic generator, not random().
create or replace function public.new_recovery_code() returns text
language sql volatile set search_path = public, extensions as $$
  select lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
$$;

-- Send one email through Resend. Never granted to the app.
create or replace function public.send_app_email(p_to text, p_subject text, p_html text)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select value into v_key from public.app_secrets where key = 'resend_api_key';
  if v_key is null then raise exception 'email is not configured'; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'from', 'BD Audit <noreply@mail.hijazionline.com>',
      'to', jsonb_build_array(p_to),
      'subject', p_subject,
      'html', p_html
    )
  );
end; $$;

-- The one email body, English then Arabic, the code large in both.
create or replace function public.recovery_email_html(p_code text, p_for_reset boolean)
returns text language sql immutable as $$
  select '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:auto;padding:24px;color:#111">'
    || '<p style="font-size:13px;color:#6b7280;margin:0 0 4px">BD Audit</p>'
    || '<p style="font-size:16px;margin:0 0 16px">'
    || case when p_for_reset then 'Your code to reset your password:' else 'Your code to confirm this recovery email:' end
    || '</p><p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px">' || p_code || '</p>'
    || '<p style="font-size:13px;color:#6b7280;margin:0 0 24px">It works for 15 minutes. If you did not ask for it, ignore this email.</p>'
    || '<div dir="rtl" style="border-top:1px solid #e5e7eb;padding-top:16px">'
    || '<p style="font-size:16px;margin:0 0 16px">'
    || case when p_for_reset then 'رمز إعادة تعيين كلمة المرور:' else 'رمز تأكيد بريد الاسترداد:' end
    || '</p><p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px" dir="ltr">' || p_code || '</p>'
    || '<p style="font-size:13px;color:#6b7280;margin:0">صالح لمدة 15 دقيقة. إذا لم تطلبه، تجاهل هذه الرسالة.</p>'
    || '</div></div>';
$$;

-- At most one code a minute and five an hour, per person and purpose.
create or replace function public.recovery_rate_ok(p_profile uuid, p_purpose text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.recovery_codes where profile_id = p_profile and purpose = p_purpose and created_at > now() - interval '60 seconds')
     and (select count(*) from public.recovery_codes where profile_id = p_profile and purpose = p_purpose and created_at > now() - interval '1 hour') < 5;
$$;

create or replace function public.request_recovery_email(p_email text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(p_email)); v_code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that does not look like an email address'; end if;
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

-- A wrong code RETURNS null instead of raising: raising would roll back the
-- attempts counter with it, and the five-try limit would never count.
drop function if exists public.confirm_recovery_email(text);
create function public.confirm_recovery_email(p_code text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_row public.recovery_codes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_row from public.recovery_codes
   where profile_id = auth.uid() and purpose = 'verify_email' and used_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_row.id is null or v_row.attempts >= 5 then return null; end if;
  if crypt(trim(p_code), v_row.code_hash) <> v_row.code_hash then
    update public.recovery_codes set attempts = attempts + 1 where id = v_row.id;
    return null;
  end if;
  update public.recovery_codes set used_at = now() where id = v_row.id;
  update public.profiles set recovery_email = v_row.email, recovery_email_verified_at = now() where id = auth.uid();
  return v_row.email;
end; $$;

-- The profile a sign-in screen names, or null. Same matching as get_login_email.
create or replace function public.profile_for_login(p_org_code text, p_username text)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p join public.organizations o on o.id = p.org_id
  where o.org_code = upper(trim(p_org_code)) and lower(p.username) = lower(trim(p_username))
    and coalesce(p.active, true) and p.deleted_at is null
  limit 1;
$$;

-- Never says whether the account exists or has an email.
create or replace function public.request_password_reset(p_org_code text, p_username text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_email text; v_code text;
begin
  v_id := public.profile_for_login(p_org_code, p_username);
  if v_id is null then return; end if;
  select recovery_email into v_email from public.profiles
   where id = v_id and recovery_email is not null and recovery_email_verified_at is not null;
  if v_email is null or not public.recovery_rate_ok(v_id, 'reset_password') then return; end if;
  v_code := public.new_recovery_code();
  update public.recovery_codes set used_at = now()
   where profile_id = v_id and purpose = 'reset_password' and used_at is null;
  insert into public.recovery_codes (profile_id, purpose, email, code_hash, expires_at)
  values (v_id, 'reset_password', v_email, crypt(v_code, gen_salt('bf', 8)), now() + interval '15 minutes');
  perform public.send_app_email(v_email, 'BD Audit — ' || v_code || ' resets your password', public.recovery_email_html(v_code, true));
end; $$;

-- Returns false for a wrong, used or expired code — never raises, for the
-- same reason as confirm_recovery_email, and so every failure looks the same.
drop function if exists public.reset_password_with_code(text, text, text, text);
create function public.reset_password_with_code(p_org_code text, p_username text, p_code text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_row public.recovery_codes;
begin
  if length(coalesce(p_new_password, '')) < 6 then raise exception 'password must be at least 6 characters'; end if;
  v_id := public.profile_for_login(p_org_code, p_username);
  if v_id is not null then
    select * into v_row from public.recovery_codes
     where profile_id = v_id and purpose = 'reset_password' and used_at is null and expires_at > now()
     order by created_at desc limit 1;
  end if;
  if v_row.id is null or v_row.attempts >= 5 then return false; end if;
  if crypt(trim(p_code), v_row.code_hash) <> v_row.code_hash then
    update public.recovery_codes set attempts = attempts + 1 where id = v_row.id;
    return false;
  end if;
  update public.recovery_codes set used_at = now() where id = v_row.id;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)), updated_at = now() where id = v_id;
  update public.profiles set must_change_password = false where id = v_id;
  return true;
end; $$;

revoke all on function public.new_recovery_code(), public.send_app_email(text, text, text),
  public.recovery_rate_ok(uuid, text), public.profile_for_login(text, text) from public, anon, authenticated;
revoke all on function public.request_recovery_email(text), public.confirm_recovery_email(text) from public, anon;
grant execute on function public.request_recovery_email(text), public.confirm_recovery_email(text) to authenticated;
revoke all on function public.request_password_reset(text, text), public.reset_password_with_code(text, text, text, text) from public;
grant execute on function public.request_password_reset(text, text), public.reset_password_with_code(text, text, text, text) to anon, authenticated;
