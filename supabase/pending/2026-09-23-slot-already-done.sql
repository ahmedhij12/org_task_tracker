-- NOT YET APPLIED (2026-09-23). A slot that has already been tested is done.
--
-- Karam tests at 12:30 AM, which counts as the 1:00 AM check. If he opens the
-- sheet again at 1:15 AM it used to say "5 minutes late" — the slot was
-- already satisfied. A further test is simply an extra test: tied to no slot,
-- never late, and it does not overwrite the one that counted.
create or replace function public.oil_slot_for(
  p_team_id uuid, p_at timestamptz
) returns table (slot_time time, minutes_late int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_local timestamp; v_day date;
  v_next time; v_next_in int;
  v_prev time; v_prev_diff int;
  v_slot time; v_late int;
begin
  select timezone into v_tz from public.teams where id = p_team_id;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_local := p_at at time zone v_tz;
  v_day := v_local::date;

  -- A slot coming up soon: the work is being done early, so it counts for it.
  select s.at_time,
         (extract(epoch from ((date_trunc('day', v_local) + s.at_time) - v_local))::int / 60)
    into v_next, v_next_in
  from public.oil_slots s
  join public.teams t on t.id = p_team_id and t.org_id = s.org_id
  where (date_trunc('day', v_local) + s.at_time) > v_local
  order by (date_trunc('day', v_local) + s.at_time) asc
  limit 1;

  if v_next is not null and v_next_in <= public.oil_early_window_minutes() then
    v_slot := v_next; v_late := null;
  else
    -- Otherwise the most recent slot that already passed, with the late rule.
    select s.at_time,
           extract(epoch from (v_local - (date_trunc('day', v_local) + s.at_time)))::int / 60
      into v_prev, v_prev_diff
    from public.oil_slots s
    join public.teams t on t.id = p_team_id and t.org_id = s.org_id
    where (date_trunc('day', v_local) + s.at_time) <= v_local
    order by (date_trunc('day', v_local) + s.at_time) desc
    limit 1;

    if v_prev is null or v_prev_diff > 8 * 60 then
      return query select null::time, null::int;
      return;
    end if;
    v_slot := v_prev;
    v_late := nullif(greatest(0, v_prev_diff - public.oil_grace_minutes()), 0);
  end if;

  -- Already covered today (possibly by an early test): this one is an extra.
  if exists (
    select 1 from public.oil_tests o
    where o.team_id = p_team_id
      and o.slot_time = v_slot
      and (o.tested_at at time zone v_tz)::date = v_day
  ) then
    return query select null::time, null::int;
    return;
  end if;

  return query select v_slot, v_late;
end; $$;

grant execute on function public.oil_slot_for(uuid, timestamptz) to authenticated;
