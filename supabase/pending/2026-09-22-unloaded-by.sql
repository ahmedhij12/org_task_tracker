-- NOT YET APPLIED (2026-09-22). Record WHO emptied the vinegar.
-- A batch is often marinated by the morning supervisor and emptied by the
-- evening one, so the record needs both names, not just the one who started it.
alter table public.chicken_marinations
  add column if not exists unloaded_by uuid references public.profiles(id) on delete set null;

comment on column public.chicken_marinations.unloaded_by is
  'Who recorded the emptying — often a different shift from actor_id, who marinated.';

create or replace function public.set_chicken_unloaded(
  p_id uuid, p_photo_url text, p_count_out numeric default null
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_row public.chicken_marinations; v_now timestamptz := now();
begin
  select * into v_row from public.chicken_marinations where id = p_id;
  if v_row.id is null then raise exception 'record not found'; end if;
  -- Anyone working that branch may empty it, whoever marinated it.
  if not (public.my_role() = 'owner' or v_row.team_id = any(public.my_team_ids())) then
    raise exception 'not your branch'; end if;
  if v_row.unloaded_at is not null then raise exception 'this batch is already recorded as removed'; end if;
  if coalesce(trim(p_photo_url), '') = '' then
    raise exception 'a photo is required as proof of removal'; end if;

  update public.chicken_marinations
     set unloaded_at = v_now,          -- server clock: the whole point of the proof
         unloaded_by = auth.uid(),
         unload_photo_url = p_photo_url,
         count_out = coalesce(p_count_out, count_out),
         remind_at = null
   where id = p_id;
  return v_now;
end; $$;

grant execute on function public.set_chicken_unloaded(uuid, text, numeric) to authenticated;
