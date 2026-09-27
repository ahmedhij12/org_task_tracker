-- NOT YET APPLIED (2026-09-27). "Mark as seen" for the people who verify —
-- admins (the super admin included) and the hygiene auditor. His words: once
-- he has seen the alerts he wants them gone, "for me only and the hygiene and
-- admins". Each person hides, on their own account only, what they have
-- already seen: the waiting-checklist counts (and the dot on the menu) and the
-- "fryer needs change" card. Nothing is deleted or verified; anything newer
-- than what they saw shows again, and everyone else's view is untouched.

create table if not exists public.alerts_seen (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('checklists', 'oil_change')),
  seen_at timestamptz not null,
  primary key (profile_id, kind)
);
alter table public.alerts_seen enable row level security;
drop policy if exists alerts_seen_own on public.alerts_seen;
create policy alerts_seen_own on public.alerts_seen for select to authenticated using (profile_id = auth.uid());
-- Read your own marks; write only through mark_alerts_seen.
revoke all on public.alerts_seen from anon, authenticated;
grant select on public.alerts_seen to authenticated;

-- p_until = the newest item that was on screen: anything that arrived after
-- it stays new, and a mark never moves backwards or into the future.
create or replace function public.mark_alerts_seen(p_kind text, p_until timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_role text; v_at timestamptz;
begin
  select role into v_role from public.profiles where id = auth.uid() and deleted_at is null and active;
  if v_role is null or v_role not in ('owner', 'hygiene_auditor') then
    raise exception 'only the people who verify can mark alerts as seen'; end if;
  if p_kind is null or p_kind not in ('checklists', 'oil_change') then raise exception 'unknown alert'; end if;

  insert into public.alerts_seen (profile_id, kind, seen_at)
  values (auth.uid(), p_kind, least(coalesce(p_until, now()), now()))
  on conflict (profile_id, kind) do update set seen_at = greatest(public.alerts_seen.seen_at, excluded.seen_at)
  returning seen_at into v_at;
  return v_at;
end $$;
revoke execute on function public.mark_alerts_seen(text, timestamptz) from public, anon;
grant execute on function public.mark_alerts_seen(text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
