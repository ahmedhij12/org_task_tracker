-- NOT YET APPLIED to live (2026-09-22). Chicken marination log.
-- The paper "وقت تخليل الدجاج": date, marination start time, count in,
-- unload time, count out, employee, signature. Supervisor/manager records it;
-- auditor just views. No OCR, no grading. Mirrored into SETUP.sql.

create table if not exists public.chicken_marinations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  is_audit boolean not null default false,
  -- When marination started and how many pieces/kg went in.
  marinated_at timestamptz not null,
  count_in numeric,
  -- When it was unloaded and how many came out (optional — may be filled later).
  unloaded_at timestamptz,
  count_out numeric,
  note text,
  signature_url text,
  created_at timestamptz not null default now()
);
create index if not exists chicken_branch_day_idx on public.chicken_marinations(team_id, marinated_at);

alter table public.chicken_marinations enable row level security;

drop policy if exists "read chicken" on public.chicken_marinations;
create policy "read chicken" on public.chicken_marinations for select
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or team_id = any(public.my_team_ids())));

-- Anyone on a branch (or the owner/auditor) records a marination.
create or replace function public.submit_chicken_marination(
  p_team_id uuid, p_marinated_at timestamptz, p_count_in numeric,
  p_unloaded_at timestamptz default null, p_count_out numeric default null,
  p_note text default null, p_signature_url text default null, p_is_audit boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_marinated_at is null then raise exception 'the marination time is required'; end if;
  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at,
    count_in, unloaded_at, count_out, note, signature_url)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), p_marinated_at,
    p_count_in, p_unloaded_at, p_count_out, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''))
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.submit_chicken_marination(uuid, timestamptz, numeric, timestamptz, numeric, text, text, boolean) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='chicken_marinations') then
    alter publication supabase_realtime add table public.chicken_marinations;
  end if;
end $$;
