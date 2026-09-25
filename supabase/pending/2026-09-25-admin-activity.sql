-- 2026-09-25. The super admin's record of what the other admins do.
--
-- Every change an admin (role 'owner', NOT the super admin) makes to any
-- table is written here by a trigger, with a full copy of the row before and
-- after — so anything changed or deleted can be put back. Sign-ins, screens
-- opened and PDFs exported are written by the app through log_activity().
-- The IP address and device come from the request headers PostgREST sets.
--
-- ONLY the super admin can read it: admins have no screen, no menu item and
-- no read access, and nobody can edit or delete a line through the API
-- (RLS has no insert/update/delete policy and the grants are revoked). The
-- triggers write as the table owner (SECURITY DEFINER), which RLS exempts.
--
-- Apply with: psql -1 -f this file (one transaction: all or nothing).

create table if not exists public.admin_activity (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  -- Snapshot, so the line still reads right if the admin is renamed or deleted.
  actor_name text,
  kind text not null check (kind in ('change', 'sign_in', 'view', 'export', 'password')),
  -- For a change: the table and insert/update/delete. For a view: the screen.
  table_name text,
  op text,
  row_id text,
  before jsonb,
  after jsonb,
  detail jsonb,
  ip text,
  user_agent text,
  -- One admin action (say, submitting a 73-question audit) writes many rows in
  -- one transaction; the viewer groups them by this into a single line.
  txid bigint not null default txid_current(),
  created_at timestamptz not null default now()
);

create index if not exists admin_activity_org_time on public.admin_activity (org_id, created_at desc);
create index if not exists admin_activity_actor_time on public.admin_activity (actor_id, created_at desc);

alter table public.admin_activity enable row level security;

drop policy if exists "only the super admin reads admin activity" on public.admin_activity;
create policy "only the super admin reads admin activity"
  on public.admin_activity for select
  using (org_id = public.my_org_id() and public.is_super_admin(auth.uid()));

-- Supabase's default privileges grant everything on new public tables; take
-- back all but SELECT (which RLS then limits to the super admin).
revoke all on public.admin_activity from anon, authenticated;
grant select on public.admin_activity to authenticated;
revoke all on sequence public.admin_activity_id_seq from anon, authenticated;

-- The caller, when the caller is watched: an admin (role owner) who is not
-- the super admin, or a hygiene auditor (a role being added; the condition is
-- harmless until it exists). Null for everyone else, so every writer below is
-- a no-op for them.
create or replace function public.watched_admin()
returns table (id uuid, org_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.org_id, p.name
  from public.profiles p
  where p.id = auth.uid()
    and ((p.role = 'owner' and not p.is_super_admin) or p.role = 'hygiene_auditor');
$$;

-- Where the request came from. Cloudflare's header first (the real client),
-- then the first hop of x-forwarded-for.
create or replace function public.request_ip()
returns text language sql stable as $$
  select coalesce(
    nullif(h->>'cf-connecting-ip', ''),
    nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''),
    nullif(h->>'x-real-ip', '')
  )
  from (select nullif(current_setting('request.headers', true), '')::json as h) x;
$$;

create or replace function public.request_user_agent()
returns text language sql stable as $$
  select (nullif(current_setting('request.headers', true), '')::json)->>'user-agent';
$$;

-- Tell the super admin's phone about the actions that can hurt: a person
-- deleted or switched off, a password reset, a branch or a record deleted.
create or replace function public.alert_super_admin(p_org uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs
  from public.web_push_subscriptions s
  join public.profiles p on p.id = s.profile_id
  where p.org_id = p_org and p.is_super_admin;
  if jsonb_array_length(v_subs) = 0 then return; end if;
  perform net.http_post(
    url := 'https://bd-push.ahmedhijazi09.workers.dev',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'title', 'BD Audit',
      'body', p_text,
      'url', 'https://bdaudit.hijazionline.com/activity',
      -- A fresh tag every time, or iOS silently replaces the last banner.
      'tag', 'activity-' || txid_current() || '-' || floor(random() * 1e6)::text
    )
  );
end; $$;

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

  -- Recording must never break the admin's own action (or give it away):
  -- any failure here is swallowed and only warned about in the database log.
  begin
  insert into public.admin_activity
    (org_id, actor_id, actor_name, kind, table_name, op, row_id, before, after, ip, user_agent)
  values
    (v_admin.org_id, v_admin.id, v_admin.name, 'change', tg_table_name, lower(tg_op),
     coalesce(v_after->>'id', v_before->>'id'), v_before, v_after,
     public.request_ip(), public.request_user_agent());

  -- The alerts. Deleting a person is a soft delete (deleted_at set).
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
    perform public.alert_super_admin(v_admin.org_id, v_alert);
  end if;
  exception when others then
    raise warning 'admin_activity: % (%)', sqlerrm, tg_table_name;
  end;
  return null;
end; $$;

-- Every table in public, except the log itself and tables that are not an
-- admin's doing (push endpoints, reminder bookkeeping, the secrets store,
-- sign-in throttling, generated occurrences). A table added later needs its
-- own trigger — the list is taken from the live schema at apply time.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in (
        'admin_activity', 'app_secrets', 'web_push_subscriptions', 'push_tokens',
        'oil_slot_pings', 'login_lookup_attempts', 'task_occurrences'
      )
  loop
    execute format('drop trigger if exists zz_admin_activity on public.%I', r.relname);
    execute format(
      'create trigger zz_admin_activity after insert or update or delete on public.%I
         for each row execute function public.log_admin_change()', r.relname);
  end loop;
end $$;

-- What the app writes: a sign-in, a screen opened, a PDF exported. A no-op
-- for anyone who is not a watched admin, so the app can call it for everyone.
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
    (v_admin.org_id, v_admin.id, v_admin.name, p_kind, left(p_what, 200), p_detail,
     public.request_ip(), public.request_user_agent());
exception when others then
  raise warning 'admin_activity: %', sqlerrm;
end; $$;

-- Functions are executable by PUBLIC unless revoked from PUBLIC itself.
revoke all on function public.log_activity(text, text, jsonb) from public, anon;
grant execute on function public.log_activity(text, text, jsonb) to authenticated;
revoke all on function public.watched_admin() from public, anon, authenticated;
revoke all on function public.alert_super_admin(uuid, text) from public, anon, authenticated;
revoke all on function public.log_admin_change() from public, anon, authenticated;
