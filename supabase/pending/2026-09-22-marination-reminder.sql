-- NOT YET APPLIED (2026-09-22). The 3-hour marination rule: chicken marinates
-- for 3 hours, then the vinegar must come out immediately. A batch can ask for
-- a reminder; a scheduled sweep sends it once the 3 hours are up.

alter table public.chicken_marinations
  add column if not exists remind_at timestamptz,
  add column if not exists reminded_at timestamptz;

create index if not exists chicken_due_reminders_idx
  on public.chicken_marinations(remind_at)
  where remind_at is not null and reminded_at is null and unloaded_at is null;

comment on column public.chicken_marinations.remind_at is
  'When the 3 hours are up and the vinegar must come out. Null = no reminder asked for.';

-- How long a batch marinates before the reminder fires. One place to change it.
create or replace function public.marination_hours() returns int
language sql immutable as $$ select 3 $$;

-- Recreate the submit RPC with the reminder flag.
create or replace function public.submit_chicken_marination(
  p_team_id uuid, p_marinated_at timestamptz, p_count_in numeric,
  p_unloaded_at timestamptz default null, p_count_out numeric default null,
  p_note text default null, p_signature_url text default null, p_is_audit boolean default false,
  p_remind boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid; v_remind timestamptz;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_marinated_at is null then raise exception 'the marination time is required'; end if;

  -- Only worth reminding when the batch is still in (no unload recorded yet).
  if coalesce(p_remind, false) and p_unloaded_at is null then
    v_remind := p_marinated_at + make_interval(hours => public.marination_hours());
  end if;

  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at,
    count_in, unloaded_at, count_out, note, signature_url, remind_at)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), p_marinated_at,
    p_count_in, p_unloaded_at, p_count_out, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''), v_remind)
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.submit_chicken_marination(uuid, timestamptz, numeric, timestamptz, numeric, text, text, boolean, boolean) to authenticated;

-- Records the unload later, which also cancels a pending reminder.
create or replace function public.set_chicken_unloaded(
  p_id uuid, p_unloaded_at timestamptz, p_count_out numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_row public.chicken_marinations;
begin
  select * into v_row from public.chicken_marinations where id = p_id;
  if v_row.id is null then raise exception 'record not found'; end if;
  if not (public.my_role() = 'owner' or v_row.team_id = any(public.my_team_ids())) then
    raise exception 'not your branch'; end if;
  update public.chicken_marinations
     set unloaded_at = coalesce(p_unloaded_at, now()),
         count_out = coalesce(p_count_out, count_out),
         remind_at = null
   where id = p_id;
end; $$;

grant execute on function public.set_chicken_unloaded(uuid, timestamptz, numeric) to authenticated;

-- Sweep: push "remove the vinegar" for every batch whose 3 hours are up.
-- Called on a schedule; safe to run often (each batch is reminded once).
create or replace function public.send_due_marination_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare v_token text; r record; v_subs jsonb; v_sent int := 0;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return 0; end if;

  for r in
    select m.id, m.org_id, m.team_id, m.marinated_at, t.name as branch, t.timezone
      from public.chicken_marinations m
      join public.teams t on t.id = m.team_id
     where m.remind_at is not null
       and m.reminded_at is null
       and m.unloaded_at is null
       and m.remind_at <= now()
     limit 50
  loop
    -- ONLY the people working that branch (supervisors + its manager).
    -- Deliberately NOT the owner: across ~10 branches these fire all day and
    -- would be noise. The owner sees the proof in the record instead —
    -- whether the vinegar came out on time.
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs
      from public.web_push_subscriptions s
      join public.profiles p on p.id = s.profile_id
     where s.org_id = r.org_id
       and p.role <> 'owner'
       and exists (select 1 from public.profile_teams pt where pt.profile_id = p.id and pt.team_id = r.team_id);

    if jsonb_array_length(v_subs) > 0 then
      perform net.http_post(
        url := 'https://bd-push.ahmedhijazi09.workers.dev',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
        body := jsonb_build_object(
          'subscriptions', v_subs,
          'title', 'Remove the vinegar',
          'body', r.branch || ' · marinated ' ||
                  to_char(r.marinated_at at time zone r.timezone, 'HH12:MI AM') ||
                  ' · ' || public.marination_hours() || ' hours are up',
          'url', 'https://bdaudit.hijazionline.com/',
          'tag', 'marination-' || r.id
        )
      );
      v_sent := v_sent + 1;
    end if;

    update public.chicken_marinations set reminded_at = now() where id = r.id;
  end loop;

  return v_sent;
end; $$;

-- The pre-reminder overload must go, or PostgREST resolves to it and reminders
-- are silently never set.
drop function if exists public.submit_chicken_marination(uuid,timestamp with time zone,numeric,timestamp with time zone,numeric,text,text,boolean);

-- Runs the sweep every 2 minutes (pg_cron).
-- select cron.schedule('marination-reminders','*/2 * * * *','select public.send_due_marination_reminders();');
