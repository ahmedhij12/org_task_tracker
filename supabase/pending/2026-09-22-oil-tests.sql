-- NOT YET APPLIED to live (2026-09-22). Oil-tester feature.
-- Fryers (admin-managed list per branch) + oil tests (TPM/temp/photo, several
-- per day per fryer). Mirrored into SETUP.sql. Apply with psql -1.

-- ── Fryers ──────────────────────────────────────────────────────────
-- A fryer/station at a branch that gets oil-tested (شواية الكنتاكي …).
-- Owner-managed; each row belongs to one branch so a branch sees its own.
create table if not exists public.oil_fryers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists oil_fryers_branch_idx on public.oil_fryers(team_id) where not archived;

-- ── Oil tests ───────────────────────────────────────────────────────
-- One reading of one fryer. grade is derived from tpm at write time so the
-- report never has to recompute the rule: <20 good, 20–<22 watch, >=22 change.
create table if not exists public.oil_tests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  fryer_id uuid not null references public.oil_fryers(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  -- true when an auditor did it on a branch visit, false for the daily one a
  -- supervisor/manager runs. Auditor red results are recorded, never penalised.
  is_audit boolean not null default false,
  tpm numeric not null check (tpm >= 0 and tpm <= 100),
  temp_c numeric check (temp_c >= 0 and temp_c <= 400),
  filtered boolean not null default false,
  grade text not null check (grade in ('good', 'watch', 'change')),
  photo_url text not null,
  signature_url text,
  note text,
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists oil_tests_branch_day_idx on public.oil_tests(team_id, tested_at);
create index if not exists oil_tests_fryer_idx on public.oil_tests(fryer_id, tested_at);

alter table public.oil_fryers enable row level security;
alter table public.oil_tests enable row level security;

-- Read: anyone in the org sees fryers/tests for a branch they belong to; the
-- owner sees all. No direct insert/update/delete — RPCs below own writes.
drop policy if exists "read fryers" on public.oil_fryers;
create policy "read fryers" on public.oil_fryers for select
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or team_id = any(public.my_team_ids())));

drop policy if exists "read oil tests" on public.oil_tests;
create policy "read oil tests" on public.oil_tests for select
  using (org_id = public.my_org_id() and (public.my_role() = 'owner' or team_id = any(public.my_team_ids())));

-- Owner adds/edits/archives a fryer.
create or replace function public.set_oil_fryer(
  p_team_id uuid, p_name text, p_fryer_id uuid default null, p_sort_order int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can manage fryers'; end if;
  select org_id into v_org from public.profiles where id = auth.uid();
  if coalesce(trim(p_name), '') = '' then raise exception 'a fryer needs a name'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if p_fryer_id is null then
    insert into public.oil_fryers (org_id, team_id, name, sort_order, created_by)
    values (v_org, p_team_id, trim(p_name), coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.oil_fryers set name = trim(p_name),
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_fryer_id and org_id = v_org returning id into v_id;
    if v_id is null then raise exception 'fryer not found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.archive_oil_fryer(p_fryer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'owner' then raise exception 'only the admin can manage fryers'; end if;
  update public.oil_fryers set archived = true
  where id = p_fryer_id and org_id = public.my_org_id();
end; $$;

-- Anyone who belongs to the fryer's branch (or the owner/auditor) records a test.
create or replace function public.submit_oil_test(
  p_fryer_id uuid, p_tpm numeric, p_temp_c numeric, p_filtered boolean,
  p_photo_url text, p_signature_url text default null, p_note text default null,
  p_is_audit boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text; v_teams uuid[]; v_fryer public.oil_fryers; v_grade text; v_id uuid;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  select * into v_fryer from public.oil_fryers where id = p_fryer_id and org_id = v_org and not archived;
  if v_fryer.id is null then raise exception 'fryer not found'; end if;
  if not (v_role = 'owner' or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;
  v_grade := case when p_tpm >= 22 then 'change' when p_tpm >= 20 then 'watch' else 'good' end;
  insert into public.oil_tests (org_id, team_id, fryer_id, actor_id, is_audit, tpm, temp_c,
    filtered, grade, photo_url, signature_url, note)
  values (v_org, v_fryer.team_id, p_fryer_id, auth.uid(), coalesce(p_is_audit, false), p_tpm, p_temp_c,
    coalesce(p_filtered, false), v_grade, p_photo_url, nullif(trim(p_signature_url), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.set_oil_fryer(uuid, text, uuid, int) to authenticated;
grant execute on function public.archive_oil_fryer(uuid) to authenticated;
grant execute on function public.submit_oil_test(uuid, numeric, numeric, boolean, text, text, text, boolean) to authenticated;

-- Realtime so a new test shows for the admin without a refresh.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='oil_tests') then
    alter publication supabase_realtime add table public.oil_tests;
  end if;
end $$;
