-- Admin activity: where the phone was (his request, 2026-09-26 — "maybe he
-- is working from home and pretends he is in the branch").
--
-- The app of a watched admin (see watched_admin) reads the phone's location
-- ONLY when location is already allowed — it never asks — plus the screen
-- size, and sends them with each request in an `x-geo` header (base64 JSON).
-- Every activity line, opened screens and database changes alike, keeps the
-- latest reading. Nobody else's app sends the header.
--   {"s":"ok","lat":..,"lng":..,"acc":..,"place":"street, area, city","at":iso,"sw":402,"sh":874}
--   {"s":"denied"|"ask"|"none", "sw":.., "sh":..}   location not available
-- Only what is shaped right is kept; anything else is dropped, never trusted.

alter table public.admin_activity add column if not exists geo jsonb;

create or replace function public.request_geo()
returns jsonb language plpgsql stable as $$
declare h text; j jsonb; v_lat numeric; v_lng numeric; v_screen jsonb;
begin
  h := (nullif(current_setting('request.headers', true), '')::json) ->> 'x-geo';
  if h is null or length(h) > 2000 then return null; end if;
  j := convert_from(decode(h, 'base64'), 'UTF8')::jsonb;
  v_screen := jsonb_strip_nulls(jsonb_build_object(
    'sw', case when (j->>'sw') ~ '^\d{2,4}$' then (j->>'sw')::int end,
    'sh', case when (j->>'sh') ~ '^\d{2,4}$' then (j->>'sh')::int end));
  if j->>'s' is distinct from 'ok' then
    return jsonb_build_object('s', case when j->>'s' in ('denied', 'ask', 'none') then j->>'s' else 'none' end) || v_screen;
  end if;
  v_lat := (j->>'lat')::numeric;
  v_lng := (j->>'lng')::numeric;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    return jsonb_build_object('s', 'none') || v_screen;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    's', 'ok',
    'lat', round(v_lat, 6),
    'lng', round(v_lng, 6),
    'acc', round(least(greatest((j->>'acc')::numeric, 0), 100000)),
    'place', left(nullif(trim(j->>'place'), ''), 200),
    'at', case when (j->>'at') ~ '^\d{4}-\d\d-\d\dT' then left(j->>'at', 30) end
  )) || v_screen;
exception when others then
  return null;
end; $$;

create or replace function public.log_activity(p_kind text, p_what text, p_detail jsonb default null::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_admin record;
begin
  if p_kind not in ('sign_in', 'view', 'export') then return; end if;
  select * into v_admin from public.watched_admin();
  if v_admin.id is null then return; end if;
  insert into public.admin_activity
    (org_id, actor_id, actor_name, kind, op, detail, ip, user_agent, geo)
  values
    (v_admin.org_id, v_admin.id, v_admin.name, p_kind, left(p_what, 200),
     case when pg_column_size(p_detail) > 2000 then null else p_detail end,
     public.request_ip(), public.request_user_agent(), public.request_geo());
exception when others then
  raise warning 'admin_activity: %', sqlerrm;
end; $function$;

create or replace function public.log_admin_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      (org_id, actor_id, actor_name, kind, table_name, op, row_id, before, after, ip, user_agent, geo)
    values
      (v_admin.org_id, v_admin.id, v_admin.name, 'change', tg_table_name, lower(tg_op),
       coalesce(v_after->>'id', v_before->>'id'), v_before, v_after,
       public.request_ip(), public.request_user_agent(), public.request_geo());
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
end; $function$;
