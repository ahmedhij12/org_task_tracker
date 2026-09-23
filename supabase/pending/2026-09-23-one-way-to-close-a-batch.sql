-- One marination record, closed exactly one way.
--
-- A batch is opened by submit_chicken_marination and closed by
-- set_chicken_unloaded, which stamps the SERVER clock and demands a photo.
-- Two other doors are open on production today and neither can be trusted:
--
--   1. set_chicken_unloaded(uuid, timestamptz, numeric) — the original
--      version, which took the removal time from the phone and required no
--      photo. 2026-09-22-unload-proof.sql meant to drop it, but BOTH
--      overloads are live (verified 2026-09-23). Two overloads of the same
--      name is also a PostgREST ambiguity waiting to happen.
--
--   2. submit_chicken_marination's p_unloaded_at / p_count_out — a batch
--      could be opened and closed in one call, with times typed by hand and
--      no photo. That is what produced the four Karbala rows on 2026-09-23,
--      two of them claiming a removal that had not happened yet.
--
-- After this, unloaded_at can only ever be now(), and only with a photo.
-- The app already stopped sending p_unloaded_at, so nothing running breaks.
--
-- The function below is the LIVE definition (pg_get_functiondef, 2026-09-23)
-- with three changes, marked CHANGED. Everything else is untouched — including
-- p_remind defaulting to false and the argument list, so this replaces cleanly.

-- 1. The untrusted overload.
drop function if exists public.set_chicken_unloaded(uuid, timestamptz, numeric);

-- 2. A marination that cannot open in the future and cannot close itself.
CREATE OR REPLACE FUNCTION public.submit_chicken_marination(
  p_team_id uuid,
  p_marinated_at timestamp with time zone,
  p_count_in numeric,
  p_unloaded_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_count_out numeric DEFAULT NULL::numeric,
  p_note text DEFAULT NULL::text,
  p_signature_url text DEFAULT NULL::text,
  p_is_audit boolean DEFAULT false,
  p_remind boolean DEFAULT false
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid; v_remind timestamptz;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_marinated_at is null then raise exception 'the marination time is required'; end if;
  -- CHANGED: a batch cannot have gone into the vinegar in the future.
  if p_marinated_at > now() then
    raise exception 'that marination time has not come yet'; end if;

  -- CHANGED: a new batch is always still in, so the reminder no longer depends
  -- on an unload that can no longer be sent.
  if coalesce(p_remind, false) then
    v_remind := p_marinated_at + make_interval(hours => public.marination_hours());
  end if;

  -- CHANGED: p_unloaded_at and p_count_out are accepted and ignored. A removal
  -- is recorded only by set_chicken_unloaded, with the server's clock and a
  -- photo. The arguments stay in the signature so an older build still works.
  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at,
    count_in, note, signature_url, remind_at)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), p_marinated_at,
    p_count_in, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''), v_remind)
  returning id into v_id;
  return v_id;
end; $function$;

grant execute on function public.submit_chicken_marination(uuid, timestamptz, numeric, timestamptz, numeric, text, text, boolean, boolean) to authenticated;
