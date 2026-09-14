# Brands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "brand" as a real, admin-configurable dimension under a branch — a supervisor belongs to a branch *and* a brand within it, branches configure which brands they run, and reporting breaks down by brand within each branch.

**Architecture:** Two new tables (`brands` org-wide, `branch_brands` join table) plus a nullable `brand_id` on the existing `profile_teams` row (the same granularity as branch membership itself, so a multi-branch supervisor can have a different brand per branch). Two new RPCs (`create_brand`, `set_branch_brands`); three existing RPCs gain a brand dimension (`admin_create_user`, `add_profile_to_team`, and the two reporting RPCs). No new tables or RPC touch `tasks`/`task_completions` — a completion's brand is always derived at read time from the subject's `profile_teams` row, never stored on the completion itself.

**Tech Stack:** Expo SDK 54 + expo-router + Supabase (existing stack, no new packages).

**Spec:** `docs/superpowers/specs/2026-09-14-brands-design.md`

## Global Constraints

- Never run `supabase/SETUP.sql` against the live project. Write each schema/RPC change to a scratch file and apply it with `psql` against the session-pooler connection string in `secrets.txt` (`postgresql://postgres.spnvsjmmeddwompkeerh:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`), then update `SETUP.sql` to match so a future full rebuild stays correct.
- Every schema/RPC change gets a new `TESTS.sql` block (a `do $$ ... end $$;` appended right before the file's final `rollback;`), run live via `psql -f`, before that task's commit.
- Changing an existing RPC's parameter list creates a new overload rather than replacing it if Postgres can't tell the old and new signatures apart — always `drop function if exists public.<name>(<old signature>) cascade;` explicitly before `create function` when a live RPC's params change shape (this project's own documented gotcha).
- New tables need explicit `grant select, insert, update, delete on <table> to authenticated, service_role;` — RLS alone is not enough; a fresh table without this grant fails every direct client read with 42501 even though SECURITY DEFINER RPC writes still succeed (this project's own documented gotcha).
- `npx tsc --noEmit` clean after every UI/data-layer task.
- Reuse the two checklist templates and every already-shipped audit-report behavior unchanged — this plan only adds a dimension alongside them.

---

### Task 1: Schema — `brands`, `branch_brands`, `profile_teams.brand_id`

**Files:**
- Modify: `supabase/SETUP.sql` (drop-list near the top, `profile_teams` table definition around line 159, RLS/grants section around line 471-490 and 543)
- Modify: `supabase/TESTS.sql` (new block appended before the final `rollback;`)

**Interfaces:**
- Produces: table `public.brands(id, org_id, name, archived, created_at)`; table `public.branch_brands(branch_id, brand_id)`; column `public.profile_teams.brand_id` (nullable uuid, FK to `brands`, `on delete set null`).

- [ ] **Step 1: Add failing schema assertions to `TESTS.sql`**

```sql
do $$
declare
  v_has_table boolean;
  v_has_col boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'brands'
  ) into v_has_table;
  if not v_has_table then
    raise exception 'FAIL: public.brands table is missing';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'branch_brands'
  ) into v_has_table;
  if not v_has_table then
    raise exception 'FAIL: public.branch_brands table is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_teams'
      and column_name = 'brand_id'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profile_teams.brand_id column is missing';
  end if;
  raise notice 'PASS: brands, branch_brands, profile_teams.brand_id exist';
end $$;
```

- [ ] **Step 2: Run `psql -f supabase/TESTS.sql <connection string>` against the live project, confirm it fails** with "FAIL: public.brands table is missing".

- [ ] **Step 3: Write the migration to a scratch file and apply it live via `psql`**

```sql
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.branch_brands (
  branch_id uuid not null references public.teams(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  primary key (branch_id, brand_id)
);

alter table public.profile_teams
  add column brand_id uuid references public.brands(id) on delete set null;

alter table public.brands enable row level security;
alter table public.branch_brands enable row level security;

-- Mutations all go through SECURITY DEFINER RPCs (Task 2/3), which bypass
-- RLS as the table owner — same pattern as checklist_templates/teams — so
-- only SELECT policies are needed here.
create policy "org members can read their org's brands"
  on public.brands for select
  using (org_id = public.my_org_id());

create policy "org members can read their org's branch brands"
  on public.branch_brands for select
  using (
    exists (
      select 1 from public.teams t
      where t.id = branch_id and t.org_id = public.my_org_id()
    )
  );

grant select, insert, update, delete on public.brands, public.branch_brands to authenticated, service_role;
```

- [ ] **Step 4: Add the same to `SETUP.sql`**:
  - Add `drop table if exists public.branch_brands cascade;` and `drop table if exists public.brands cascade;` to the drop-list (before `drop table if exists public.profile_teams cascade;`, since `profile_teams.brand_id` will reference `brands`).
  - Add the two `create table` statements right after the existing `create table public.profile_teams (...)` block, and add `brand_id uuid references public.brands(id) on delete set null,` as a column inline inside `profile_teams`'s own `create table` statement (not a separate `alter table` — `SETUP.sql` rebuilds from scratch every time).
  - Add the two `enable row level security` lines next to the existing ones (~line 474).
  - Add the two `create policy` statements next to `"org members can read their org's teams"` (~line 541).
  - Add the grant line next to the other table grants.

- [ ] **Step 5: Re-run `TESTS.sql` live — all prior blocks plus the new one pass.**

- [ ] **Step 6: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add brands and branch_brands tables, profile_teams.brand_id"
```

---

### Task 2: `create_brand` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (new function near `create_team`, ~line 1340; drop-list; grants ~line 2230)
- Modify: `supabase/TESTS.sql`

**Interfaces:**
- Consumes: table `public.brands` (Task 1).
- Produces: `create_brand(p_name text) returns uuid` — owner-only, mirrors `create_team`.

- [ ] **Step 1: Add failing tests** — an owner can create a brand and gets its id back; a `team_admin` is rejected; a duplicate name within the same org is rejected (the `unique (org_id, name)` constraint); the same name in a *different* org succeeds.

Every block that calls `create_organization` must first insert its own fresh
`auth.users` row and switch `auth.uid()` to it via `request.jwt.claims` —
`create_organization` requires an authenticated caller with no existing
profile, and this project's tests never rely on a jwt claim left over from
an earlier block. This is the same boilerplate every existing block in
`TESTS.sql` already uses (see the block starting "Monthly close" for the
canonical version) — repeated here in full rather than abbreviated, since
this is exactly the code to paste into the file.

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_leader_id uuid;
  v_brand_id uuid;
  v_owner2_id uuid := gen_random_uuid();
  v_org2_id uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'brand-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('Brand Test Org', 'Brand Owner', 'brandowner');
  v_leader_id := public.admin_create_user('Leader', 'brandleader', 'initial123', 'team_admin', v_team_id);

  -- owner creates a brand
  v_brand_id := public.create_brand('360');
  if v_brand_id is null then
    raise exception 'FAIL: create_brand should return the new brand''s id';
  end if;
  if not exists (select 1 from public.brands where id = v_brand_id and name = '360' and org_id = v_org_id) then
    raise exception 'FAIL: the new brand row was not saved correctly';
  end if;
  raise notice 'PASS: an owner can create a brand';

  -- a team_admin is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  begin
    perform public.create_brand('AA Chicken');
    raise exception 'FAIL: a team_admin should not be able to create a brand';
  exception when others then
    if sqlerrm !~ 'only.*admin' then raise; end if;
  end;
  raise notice 'PASS: a team_admin cannot create a brand';

  -- duplicate name in the same org is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.create_brand('360');
    raise exception 'FAIL: a duplicate brand name in the same org should be rejected';
  exception when others then
    if sqlerrm !~ 'already exists' then raise; end if;
  end;
  raise notice 'PASS: a duplicate brand name in the same org is rejected';

  -- the same name in a different org is fine — needs its own fresh owner,
  -- since create_organization refuses a caller who already has a profile
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner2_id, 'authenticated', 'authenticated',
    'brand-owner2.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner2_id)::text, true);
  select org_id into v_org2_id
  from public.create_organization('Other Brand Org', 'Other Owner', 'otherbrandowner');
  if not exists (select 1 from public.brands where name = '360' and org_id = v_org2_id) then
    raise exception 'FAIL: the same brand name should be allowed in a different org';
  end if;
  raise notice 'PASS: the same brand name is allowed across different orgs';
end $$;
```

- [ ] **Step 2: Run live, confirm it fails** ("function create_brand(unknown) does not exist").

- [ ] **Step 3: Write the RPC**

```sql
drop function if exists public.create_brand(text) cascade;

create function public.create_brand(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_name text := trim(coalesce(p_name, ''));
  v_brand_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only an admin can create a brand';
  end if;
  if v_name = '' then
    raise exception 'a brand name is required';
  end if;
  if exists (select 1 from public.brands b where b.org_id = v_org_id and lower(b.name) = lower(v_name)) then
    raise exception 'a brand named "%" already exists', v_name;
  end if;

  insert into public.brands (org_id, name)
  values (v_org_id, v_name)
  returning id into v_brand_id;

  return v_brand_id;
end;
$$;

grant execute on function public.create_brand(text) to authenticated;
```

- [ ] **Step 4: Apply live via `psql`, re-run `TESTS.sql` — all pass.**

- [ ] **Step 5: Add the function (with the matching `drop function if exists` in the drop-list) and grant to `SETUP.sql`, next to `create_team`.**

- [ ] **Step 6: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add create_brand RPC"
```

---

### Task 3: `set_branch_brands` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (new function near `update_checklist_template`, ~line 2112; drop-list; grants)
- Modify: `supabase/TESTS.sql`

**Interfaces:**
- Consumes: tables `public.brands`, `public.branch_brands` (Task 1); `create_brand` (Task 2, used only to set up test fixtures).
- Produces: `set_branch_brands(p_branch_id uuid, p_brand_ids uuid[]) returns void` — owner-only; replaces the full set of brands configured for that branch.

- [ ] **Step 1: Add failing tests** — an owner can set a branch's brands and reading `branch_brands` back matches exactly; calling it again with a different set fully replaces the old one (delete-and-reinsert, not additive); a `team_admin` is rejected; a brand id from a different org is rejected; a branch id from a different org is rejected.

Same auth-bootstrap requirement as Task 2's tests — each of the three orgs
here needs its own fresh `auth.users` row before `create_organization`.

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_leader_id uuid;
  v_brand_360 uuid;
  v_brand_aa uuid;
  v_brand_center uuid;
  v_count int;
  v_other_owner_id uuid := gen_random_uuid();
  v_other_org_id uuid;
  v_other_brand_id uuid;
  v_third_owner_id uuid := gen_random_uuid();
  v_other_team_id uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'setbrands-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('SetBrands Org', 'SetBrands Owner', 'setbrandsowner');
  v_leader_id := public.admin_create_user('Leader', 'setbrandsleader', 'initial123', 'team_admin', v_team_id);

  v_brand_360 := public.create_brand('360');
  v_brand_aa := public.create_brand('AA Chicken');
  v_brand_center := public.create_brand('Center');

  -- owner sets the branch's brands
  perform public.set_branch_brands(v_team_id, array[v_brand_360, v_brand_aa]);
  select count(*) into v_count from public.branch_brands where branch_id = v_team_id;
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 branch_brands rows, got %', v_count;
  end if;
  raise notice 'PASS: an owner can set a branch''s brands';

  -- calling again fully replaces the set
  perform public.set_branch_brands(v_team_id, array[v_brand_center]);
  select count(*) into v_count from public.branch_brands where branch_id = v_team_id;
  if v_count <> 1 or not exists (select 1 from public.branch_brands where branch_id = v_team_id and brand_id = v_brand_center) then
    raise exception 'FAIL: set_branch_brands should replace the full set, not add to it';
  end if;
  raise notice 'PASS: set_branch_brands replaces the full set';

  -- a team_admin is rejected
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  begin
    perform public.set_branch_brands(v_team_id, array[v_brand_360]);
    raise exception 'FAIL: a team_admin should not be able to set a branch''s brands';
  exception when others then
    if sqlerrm !~ 'only.*admin' then raise; end if;
  end;
  raise notice 'PASS: a team_admin cannot set a branch''s brands';

  -- a brand from a different org is rejected — needs its own fresh owner
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_other_owner_id, 'authenticated', 'authenticated',
    'setbrands-other-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_owner_id)::text, true);
  select org_id into v_other_org_id
  from public.create_organization('SetBrands Other Org', 'Other Owner', 'setbrandsotherowner');
  v_other_brand_id := public.create_brand('Foreign Brand');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.set_branch_brands(v_team_id, array[v_other_brand_id]);
    raise exception 'FAIL: a brand from another organization should be rejected';
  exception when others then
    if sqlerrm !~ 'does not belong' then raise; end if;
  end;
  raise notice 'PASS: a brand from another organization is rejected';

  -- a branch from a different org is rejected — needs its own fresh owner
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_third_owner_id, 'authenticated', 'authenticated',
    'setbrands-third-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_third_owner_id)::text, true);
  select team_id into v_other_team_id
  from public.create_organization('SetBrands Third Org', 'Third Owner', 'setbrandsthirdowner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  begin
    perform public.set_branch_brands(v_other_team_id, array[v_brand_360]);
    raise exception 'FAIL: a branch from another organization should be rejected';
  exception when others then
    if sqlerrm !~ 'does not belong' then raise; end if;
  end;
  raise notice 'PASS: a branch from another organization is rejected';
end $$;
```

- [ ] **Step 2: Run live, confirm it fails.**

- [ ] **Step 3: Write the RPC** — same delete-and-reinsert pattern as `update_checklist_template`.

```sql
drop function if exists public.set_branch_brands(uuid, uuid[]) cascade;

create function public.set_branch_brands(p_branch_id uuid, p_brand_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_branch_org uuid;
  v_foreign_count int;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role is distinct from 'owner' then
    raise exception 'only an admin can set a branch''s brands';
  end if;

  select org_id into v_branch_org from public.teams where id = p_branch_id;
  if v_branch_org is null then
    raise exception 'branch not found';
  end if;
  if v_branch_org is distinct from v_caller_org then
    raise exception 'that branch does not belong to your organization';
  end if;

  select count(*) into v_foreign_count
  from unnest(coalesce(p_brand_ids, '{}')) bid
  where not exists (select 1 from public.brands b where b.id = bid and b.org_id = v_caller_org);
  if v_foreign_count > 0 then
    raise exception 'one or more brands do not belong to your organization';
  end if;

  delete from public.branch_brands where branch_id = p_branch_id;

  insert into public.branch_brands (branch_id, brand_id)
  select p_branch_id, bid from unnest(coalesce(p_brand_ids, '{}')) bid;
end;
$$;

grant execute on function public.set_branch_brands(uuid, uuid[]) to authenticated;
```

- [ ] **Step 4: Apply live via `psql`, re-run `TESTS.sql` — all pass.**

- [ ] **Step 5: Add to `SETUP.sql`, next to `update_checklist_template`.**

- [ ] **Step 6: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add set_branch_brands RPC"
```

---

### Task 4: Brand validation on `admin_create_user` and `add_profile_to_team`

**Files:**
- Modify: `supabase/SETUP.sql` (`admin_create_user` ~line 945, `add_profile_to_team` ~line 1216, drop-list, grants)
- Modify: `supabase/TESTS.sql`

**Interfaces:**
- Consumes: `public.brands`, `public.branch_brands` (Task 1).
- Produces: `admin_create_user(p_name, p_username, p_password, p_role default 'employee', p_team_id default null, p_title default null, p_brand_id uuid default null) returns uuid`; `add_profile_to_team(p_profile_id uuid, p_team_id uuid, p_brand_id uuid default null) returns void`. Both: `p_brand_id` must be null unless the target's role is `employee`; when set, `(p_team_id, p_brand_id)` must exist in `branch_brands`. `add_profile_to_team` now **upserts** the brand on an existing membership (`on conflict (profile_id, team_id) do update set brand_id = excluded.brand_id`) instead of doing nothing — this is what lets an already-added supervisor's brand be changed later by calling it again with the same team and a new brand.

- [ ] **Step 1: Add failing tests** — `admin_create_user` with a valid `(team, brand)` pair succeeds and the profile's `profile_teams` row has that `brand_id`; `p_brand_id` set with `p_role = 'team_admin'` is rejected; `p_brand_id` pointing at a brand not enabled at that branch is rejected; `add_profile_to_team` on an *existing* employee membership with a new valid brand updates `brand_id` in place (no duplicate row, no error); `add_profile_to_team` with `p_brand_id` set and the target role `team_admin` is rejected.

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_team2_id uuid;
  v_brand_360 uuid;
  v_brand_aa uuid;
  v_emp_id uuid;
  v_leader_id uuid;
  v_saved_brand uuid;
  v_row_count int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'brandval-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('BrandVal Org', 'BrandVal Owner', 'brandvalowner');
  v_brand_360 := public.create_brand('360');
  v_brand_aa := public.create_brand('AA Chicken');
  perform public.set_branch_brands(v_team_id, array[v_brand_360]);
  insert into public.teams (org_id, name) values (v_org_id, 'Second Branch') returning id into v_team2_id;

  -- admin_create_user with a valid (team, brand) pair
  v_emp_id := public.admin_create_user('Supervisor', 'brandvalemp', 'initial123', 'employee', v_team_id, null, v_brand_360);
  select brand_id into v_saved_brand from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  if v_saved_brand is distinct from v_brand_360 then
    raise exception 'FAIL: admin_create_user should save the supervisor''s brand';
  end if;
  raise notice 'PASS: admin_create_user saves a valid brand for a supervisor';

  -- a brand for a team_admin is rejected
  begin
    perform public.admin_create_user('Manager', 'brandvalmgr', 'initial123', 'team_admin', v_team_id, null, v_brand_360);
    raise exception 'FAIL: a brand should be rejected for a team_admin';
  exception when others then
    if sqlerrm !~ 'brand' then raise; end if;
  end;
  raise notice 'PASS: admin_create_user rejects a brand for a non-employee role';

  -- a brand not enabled at that branch is rejected
  begin
    perform public.admin_create_user('Supervisor2', 'brandvalemp2', 'initial123', 'employee', v_team_id, null, v_brand_aa);
    raise exception 'FAIL: a brand not enabled at the branch should be rejected';
  exception when others then
    if sqlerrm !~ 'does not operate' then raise; end if;
  end;
  raise notice 'PASS: admin_create_user rejects a brand not enabled at that branch';

  -- add_profile_to_team upserts the brand on an existing membership
  perform public.set_branch_brands(v_team_id, array[v_brand_360, v_brand_aa]);
  perform public.add_profile_to_team(v_emp_id, v_team_id, v_brand_aa);
  select count(*) into v_row_count from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  select brand_id into v_saved_brand from public.profile_teams where profile_id = v_emp_id and team_id = v_team_id;
  if v_row_count <> 1 or v_saved_brand is distinct from v_brand_aa then
    raise exception 'FAIL: add_profile_to_team should update the existing row''s brand in place, got % rows / brand %', v_row_count, v_saved_brand;
  end if;
  raise notice 'PASS: add_profile_to_team upserts the brand on an existing membership';

  -- add_profile_to_team rejects a brand for a team_admin
  v_leader_id := public.admin_create_user('Leader2', 'brandvalleader', 'initial123', 'team_admin', v_team2_id);
  begin
    perform public.add_profile_to_team(v_leader_id, v_team_id, v_brand_360);
    raise exception 'FAIL: add_profile_to_team should reject a brand for a team_admin';
  exception when others then
    if sqlerrm !~ 'brand' then raise; end if;
  end;
  raise notice 'PASS: add_profile_to_team rejects a brand for a non-employee role';
end $$;
```

- [ ] **Step 2: Run live, confirm failure.**

- [ ] **Step 3: Edit `admin_create_user`** — drop and recreate with the new parameter, insert into `profile_teams` with `brand_id`:

```sql
drop function if exists public.admin_create_user(text, text, text, text, uuid, text) cascade;

create function public.admin_create_user(
  p_name text,
  p_username text,
  p_password text,
  p_role text default 'employee',
  p_team_id uuid default null,
  p_title text default null,
  p_brand_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_org_code text;
  v_new_id uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  -- ... unchanged: authentication check, role checks, team_admin branch,
  -- team-belongs-to-org check, username/password checks, org_code lookup,
  -- auth.users/auth.identities/profiles inserts (see current body) ...

  if p_brand_id is not null then
    if p_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if p_team_id is null or not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  -- ... unchanged: insert into auth.users, auth.identities, profiles ...

  if p_team_id is not null then
    insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
    values (v_new_id, p_team_id, auth.uid(), p_brand_id);
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, uuid, text, uuid) to authenticated;
```

The elided middle is the function's existing body unchanged — only the new parameter, the new validation block placed right after the existing `if p_team_id is not null and not exists (...)` check, and `brand_id` added to the final `profile_teams` insert, are new.

- [ ] **Step 4: Edit `add_profile_to_team`** — drop and recreate with the new parameter and the upsert:

```sql
drop function if exists public.add_profile_to_team(uuid, uuid) cascade;

create function public.add_profile_to_team(p_profile_id uuid, p_team_id uuid, p_brand_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_target_org uuid;
  v_target_role text;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id, p.role into v_target_org, v_target_role
  from public.profiles p where p.id = p_profile_id;

  if v_target_org is null or v_target_org is distinct from v_caller_org then
    raise exception 'that person is not in your organization';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org) then
    raise exception 'team not found in this organization';
  end if;

  if v_caller_role = 'owner' then
    if v_target_role not in ('team_admin', 'employee') then
      raise exception 'only a team leader or employee can be added to a team';
    end if;
  elsif v_caller_role = 'team_admin' then
    if v_target_role <> 'employee' then
      raise exception 'a team leader can only add employees to a team';
    end if;
    if not (p_team_id = any(v_caller_teams)) then
      raise exception 'a team leader can only add someone to their own team';
    end if;
  else
    raise exception 'only an admin or team leader can change team membership';
  end if;

  if p_brand_id is not null then
    if v_target_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
  values (p_profile_id, p_team_id, auth.uid(), p_brand_id)
  on conflict (profile_id, team_id) do update set brand_id = excluded.brand_id;
end;
$$;

grant execute on function public.add_profile_to_team(uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 5: Apply both live via `psql`, re-run `TESTS.sql` — all pass** (including the existing multi-team test around line 1513, which calls `add_profile_to_team` with two positional args — confirm it still passes unchanged since `p_brand_id` defaults to null).

- [ ] **Step 6: Update `SETUP.sql`** with both functions' new signatures, the extra `drop function if exists ... cascade;` lines in the drop-list (the old 2-arg/6-arg signatures), and the updated grants.

- [ ] **Step 7: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add brand validation to admin_create_user and add_profile_to_team"
```

---

### Task 5: Brand in `get_current_branch_summary` and `get_period_report`

**Files:**
- Modify: `supabase/SETUP.sql` (`get_period_report` ~line 1422, `get_current_branch_summary` ~line 1480, drop-list, grants)
- Modify: `supabase/TESTS.sql`

**Interfaces:**
- Consumes: `public.brands`, `public.profile_teams.brand_id` (Task 1).
- Produces: both RPCs now return `brand_id uuid, brand_name text` alongside the existing columns — `left join` so a null-brand subject (no brand assigned, or a branch manager audited directly) still appears, with both columns null.

- [ ] **Step 1: Add failing tests** — a subject with a brand assigned shows the right `brand_id`/`brand_name` in both RPCs' output; a subject with no brand assigned still appears in the results with both columns null (not silently dropped).

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_team_id uuid;
  v_brand_id uuid;
  v_emp_with_brand uuid;
  v_emp_no_brand uuid;
  v_task_id uuid;
  v_returned_brand_name text;
  v_null_brand_count int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'brandreport-owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, team_id into v_org_id, v_team_id
  from public.create_organization('BrandReport Org', 'BrandReport Owner', 'brandreportowner');
  v_brand_id := public.create_brand('360');
  perform public.set_branch_brands(v_team_id, array[v_brand_id]);
  v_emp_with_brand := public.admin_create_user('With Brand', 'brandreportwith', 'initial123', 'employee', v_team_id, null, v_brand_id);
  v_emp_no_brand := public.admin_create_user('No Brand', 'brandreportwithout', 'initial123', 'employee', v_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  insert into public.tasks (org_id, team_id, title, assignee_id, created_by, is_audit, priority, requires_review)
  values (v_org_id, v_team_id, 'Brand Report Audit', v_owner_id, v_owner_id, true, 'medium', false)
  returning id into v_task_id;

  perform public.set_task_completion(v_task_id, true, null, '{}', null, '[]'::jsonb, v_emp_with_brand, 'morning', -1);
  perform public.set_task_completion(v_task_id, true, null, '{}', null, '[]'::jsonb, v_emp_no_brand, 'morning', -1);

  select brand_name into v_returned_brand_name
  from public.get_current_branch_summary()
  where subject_profile_id = v_emp_with_brand;
  if v_returned_brand_name is distinct from '360' then
    raise exception 'FAIL: expected brand_name ''360'', got %', coalesce(v_returned_brand_name, '<null>');
  end if;
  raise notice 'PASS: get_current_branch_summary returns the right brand_name';

  select count(*) into v_null_brand_count
  from public.get_current_branch_summary()
  where subject_profile_id = v_emp_no_brand and brand_id is null;
  if v_null_brand_count <> 1 then
    raise exception 'FAIL: a null-brand subject should still appear, with brand_id null';
  end if;
  raise notice 'PASS: a null-brand subject still appears in get_current_branch_summary';
end $$;
```

- [ ] **Step 2: Run live, confirm failure** (extra `brand_name`/`brand_id` columns don't exist yet on the returned rows).

- [ ] **Step 3: Edit both RPCs** — drop and recreate with the widened return type, left-joining `brands` via `profile_teams.brand_id`:

```sql
drop function if exists public.get_period_report(uuid) cascade;

create function public.get_period_report(p_period_id uuid)
returns table (
  branch_id uuid,
  branch_name text,
  brand_id uuid,
  brand_name text,
  subject_profile_id uuid,
  subject_name text,
  total_points numeric,
  iqd_amount numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
  v_role text;
  v_period_org_id uuid;
  v_month date;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can view reports';
  end if;

  select rp.org_id, rp.period_month into v_period_org_id, v_month
  from public.report_periods rp where rp.id = p_period_id;

  if v_period_org_id is distinct from v_org_id then
    raise exception 'that report period does not belong to your organization';
  end if;

  return query
  select
    t.id,
    t.name,
    b.id,
    b.name,
    tc.subject_profile_id,
    sp.name,
    sum(tc.points_awarded),
    sum(tc.points_awarded) * 25000
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  left join public.brands b on b.id = pt.brand_id
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and (tc.created_at at time zone 'Asia/Baghdad') >= v_month
    and (tc.created_at at time zone 'Asia/Baghdad') < (v_month + interval '1 month')
  group by t.id, t.name, b.id, b.name, tc.subject_profile_id, sp.name
  order by t.name, b.name nulls last, sp.name;
end;
$$;

grant execute on function public.get_period_report(uuid) to authenticated;
```

Apply the identical `t.id, t.name` → `+ b.id, b.name` / `left join public.brands` / `group by` / `order by` change to `get_current_branch_summary` (same shape, same reasoning, `v_month_start` in place of `p_period_id`'s `v_month`).

- [ ] **Step 4: Apply both live via `psql`, re-run `TESTS.sql` — all pass.**

- [ ] **Step 5: Update `SETUP.sql`** with both new return types and the drop-list entries.

- [ ] **Step 6: Commit.**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "Add brand breakdown to get_current_branch_summary and get_period_report"
```

---

### Task 6: Client data layer — types, `useOrgData`, `useAuth`, `useReports`

**Files:**
- Modify: `src/types/index.ts` (add `Brand`, extend `Profile` and `BranchSummaryRow`)
- Modify: `src/hooks/useOrgData.tsx` (load brands/branch_brands, extend `mapProfile`, add `createBrand`/`setBranchBrands`)
- Modify: `src/hooks/useAuth.tsx` (`adminCreateUser`, `addProfileToTeam` gain `brandId`)
- Modify: `src/hooks/useReports.tsx` (`mapSummaryRow` gains `brandId`/`brandName`)

**Interfaces:**
- Consumes: the RPC/table shapes from Tasks 1, 2, 3, 4, 5.
- Produces (used by Tasks 7-10):
  - `Brand { id: string; orgId: string; name: string; archived: boolean; createdAt: string }`
  - `Profile.teamBrandIds: Record<string, string | null>` — keyed by team id, only for teams the profile belongs to.
  - `BranchSummaryRow.brandId: string | null`, `BranchSummaryRow.brandName: string | null`
  - `useOrgData()` gains `brands: Brand[]`, `branchBrandIds: Record<string, string[]>` (branch id → its configured brand ids, in `brands` insertion order), `createBrand(name: string) => Promise<string>`, `setBranchBrands(branchId: string, brandIds: string[]) => Promise<void>`.
  - `useAuth().adminCreateUser` args gain `brandId?: string | null`.
  - `useAuth().addProfileToTeam(profileId: string, teamId: string, brandId?: string | null) => Promise<void>`.

- [ ] **Step 1: `src/types/index.ts`** — add after `Team`:

```ts
export interface Brand {
  id: string;
  orgId: string;
  name: string;
  archived: boolean;
  createdAt: string;
}
```

In `Profile`, add after `teamIds`:

```ts
  /**
   * teamId -> brand assigned in that branch, or null when none is set yet
   * (or the role is team_admin/owner, which never has one). Only has an
   * entry for teams this profile actually belongs to — mirrors teamIds.
   */
  teamBrandIds: Record<string, string | null>;
```

In `BranchSummaryRow`, add after `branchName`:

```ts
  brandId: string | null;
  brandName: string | null;
```

- [ ] **Step 2: `src/hooks/useOrgData.tsx`** — add `mapBrand`:

```ts
function mapBrand(row: any): Brand {
  return { id: row.id, orgId: row.org_id, name: row.name, archived: row.archived, createdAt: row.created_at };
}
```

Update the `Team, TaskCompletion` import line to also import `Brand`. Update `mapProfile` to take the brand map:

```ts
function mapProfile(row: any, teamIds: string[], teamBrandIds: Record<string, string | null>): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamIds,
    teamBrandIds,
    name: row.name,
    title: row.title,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password,
    active: row.active,
    recoveryEmail: row.recovery_email,
    createdAt: row.created_at,
  };
}
```

Add `brands: Brand[]` and `branchBrandIds: Record<string, string[]>` state next to `members`:

```ts
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branchBrandIds, setBranchBrandIds] = useState<Record<string, string[]>>({});
```

In `refresh()`, fetch `brands` and `branch_brands` alongside the existing queries, and change the `profile_teams` select to include `brand_id`:

```ts
    const [tasksRes, teamsRes, membersRes, historyRes, brandsRes, branchBrandsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false }),
      supabase.from('teams').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('profiles').select('*').eq('org_id', organization.id),
      supabase.from('task_completions').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('brands').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('branch_brands').select('branch_id, brand_id'),
    ]);
    if (!teamsRes.error) setTeams((teamsRes.data ?? []).map(mapTeam));
    if (!brandsRes.error) setBrands((brandsRes.data ?? []).map(mapBrand));
    if (!branchBrandsRes.error) {
      const byBranch = new Map<string, string[]>();
      for (const r of branchBrandsRes.data ?? []) {
        const list = byBranch.get(r.branch_id) ?? [];
        list.push(r.brand_id);
        byBranch.set(r.branch_id, list);
      }
      setBranchBrandIds(Object.fromEntries(byBranch));
    }

    if (!membersRes.error) {
      const rows = membersRes.data ?? [];
      const { data: membershipRows } = rows.length
        ? await supabase.from('profile_teams').select('profile_id, team_id, brand_id').in('profile_id', rows.map((r) => r.id))
        : { data: [] as { profile_id: string; team_id: string; brand_id: string | null }[] };
      const byProfile = new Map<string, string[]>();
      const brandByProfile = new Map<string, Record<string, string | null>>();
      for (const m of membershipRows ?? []) {
        const list = byProfile.get(m.profile_id) ?? [];
        list.push(m.team_id);
        byProfile.set(m.profile_id, list);
        const brandMap = brandByProfile.get(m.profile_id) ?? {};
        brandMap[m.team_id] = m.brand_id;
        brandByProfile.set(m.profile_id, brandMap);
      }
      setMembers(rows.map((r) => mapProfile(r, byProfile.get(r.id) ?? [], brandByProfile.get(r.id) ?? {})));
    }
```

(This replaces the existing `membershipRows`-only select and the `mapProfile(r, byProfile.get(r.id) ?? [])` call at the tail of the current block — the surrounding `if (!membersRes.error) { ... }` structure and the rest of `refresh()` below it are unchanged.)

Add `createBrand`/`setBranchBrands` next to `createTeam`:

```ts
  const createBrand = useCallback<OrgDataContextValue['createBrand']>(
    async (name) => {
      const { data, error } = await supabase.rpc('create_brand', { p_name: name });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const setBranchBrands = useCallback<OrgDataContextValue['setBranchBrands']>(
    async (branchId, brandIds) => {
      const { error } = await supabase.rpc('set_branch_brands', { p_branch_id: branchId, p_brand_ids: brandIds });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );
```

Add both to `OrgDataContextValue` (next to `createTeam: (name: string) => Promise<void>;`):

```ts
  brands: Brand[];
  branchBrandIds: Record<string, string[]>;
  createBrand: (name: string) => Promise<string>;
  setBranchBrands: (branchId: string, brandIds: string[]) => Promise<void>;
```

And to the context value object returned at the end of the provider (next to the existing `createTeam,`):

```ts
      brands,
      branchBrandIds,
      createBrand,
      setBranchBrands,
```

- [ ] **Step 3: `src/hooks/useAuth.tsx`** — extend `adminCreateUser`'s arg type (wherever it's declared on `AuthContextValue`, next to `teamId`) with `brandId?: string | null;`, and its RPC call:

```ts
  const adminCreateUser: AuthContextValue['adminCreateUser'] = async ({
    name,
    username,
    password,
    role,
    teamId,
    title,
    brandId,
  }) => {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_name: name.trim(),
      p_username: username.trim(),
      p_password: password,
      p_role: role,
      p_team_id: teamId,
      p_title: title?.trim() || null,
      p_brand_id: brandId ?? null,
    });
    if (error) throw error;
    return data as string;
  };
```

Extend `addProfileToTeam`'s type to `(profileId: string, teamId: string, brandId?: string | null) => Promise<void>` and its body:

```ts
  const addProfileToTeam: AuthContextValue['addProfileToTeam'] = async (profileId, teamId, brandId) => {
    const { error } = await supabase.rpc('add_profile_to_team', {
      p_profile_id: profileId,
      p_team_id: teamId,
      p_brand_id: brandId ?? null,
    });
    if (error) throw error;
    if (profileId === state.profile?.id) await refreshProfile();
  };
```

- [ ] **Step 4: `src/hooks/useReports.tsx`** — extend `mapSummaryRow`:

```ts
function mapSummaryRow(row: any): BranchSummaryRow {
  return {
    branchId: row.branch_id,
    branchName: row.branch_name,
    brandId: row.brand_id,
    brandName: row.brand_name,
    subjectProfileId: row.subject_profile_id,
    subjectName: row.subject_name,
    totalPoints: Number(row.total_points),
    iqdAmount: Number(row.iqd_amount),
  };
}
```

- [ ] **Step 5: `npx tsc --noEmit`** — fix any call sites the type changes surface (there should be none besides what Tasks 7-10 will add, since every existing caller of `adminCreateUser`/`addProfileToTeam` uses named/positional args that still satisfy the widened signatures).

- [ ] **Step 6: Commit.**

```bash
git add src/types/index.ts src/hooks/useOrgData.tsx src/hooks/useAuth.tsx src/hooks/useReports.tsx
git commit -m "Add brands to the client data layer"
```

---

### Task 7: Branch brand management UI (`teams.tsx`)

**Files:**
- Modify: `src/app/(main)/teams.tsx`

**Interfaces:**
- Consumes: `useOrgData().brands`, `branchBrandIds`, `createBrand`, `setBranchBrands` (Task 6).

Decision: brand assignment is a **separate step from branch creation**, not folded into the "New branch" modal — tapping an *existing* branch's card opens a "Manage brands" sheet. This keeps branch creation exactly as simple as it is today and avoids threading a brand-editor into a one-field creation modal; the spec's "create/edit" language is satisfied by editing being reachable right after creating (create the branch, then tap it).

- [ ] **Step 1**: Add state for the manage-brands sheet and a working set of staged brand ids:

```ts
  const [managingBranchId, setManagingBranchId] = useState<string | null>(null);
  const [stagedBrandIds, setStagedBrandIds] = useState<string[]>([]);
  const [newBrandName, setNewBrandName] = useState('');
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
```

Pull `brands, branchBrandIds, createBrand, setBranchBrands` out of `useOrgData()` alongside the existing `teams, members, tasks, createTeam`.

- [ ] **Step 2**: Wrap each branch `Card` in a `Pressable` that opens the sheet, seeding `stagedBrandIds` from the branch's current set:

```ts
          return (
            <Pressable
              key={team.id}
              onPress={() => {
                setManagingBranchId(team.id);
                setStagedBrandIds(branchBrandIds[team.id] ?? []);
                setBrandError(null);
              }}
            >
              <Card style={{ marginBottom: 12 }}>
                {/* ...existing Card content unchanged... */}
              </Card>
            </Pressable>
          );
```

- [ ] **Step 3**: Add the manage-brands `Modal`, toggling chips for every org brand plus an inline "add new brand" row:

```tsx
      <Modal visible={!!managingBranchId} animationType="slide" transparent onRequestClose={() => setManagingBranchId(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 4 }}>
                {t('teams.manageBrandsTitle', { name: teams.find((t) => t.id === managingBranchId)?.name })}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>{t('teams.manageBrandsHint')}</Text>
              {brandError ? <ErrorBanner message={brandError} /> : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {brands.map((b) => {
                  const active = stagedBrandIds.includes(b.id);
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() =>
                        setStagedBrandIds((prev) => (active ? prev.filter((id) => id !== b.id) : [...prev, b.id]))
                      }
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: active ? c.indigo : c.bgSubtle,
                        borderWidth: 1,
                        borderColor: active ? c.indigo : c.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{b.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <FieldInput
                    placeholder={t('teams.newBrandPlaceholder')}
                    value={newBrandName}
                    onChangeText={setNewBrandName}
                  />
                </View>
                <Pressable
                  onPress={async () => {
                    if (!newBrandName.trim()) return;
                    setBrandLoading(true);
                    setBrandError(null);
                    try {
                      const id = await createBrand(newBrandName.trim());
                      setStagedBrandIds((prev) => [...prev, id]);
                      setNewBrandName('');
                    } catch (e: any) {
                      setBrandError(e?.message ?? t('teams.genericError'));
                    } finally {
                      setBrandLoading(false);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: c.card }}
                >
                  <Ionicons name="add" size={18} color={c.text} />
                </Pressable>
              </View>

              <PrimaryButton
                title={t('common.save')}
                loading={brandLoading}
                onPress={async () => {
                  if (!managingBranchId) return;
                  setBrandLoading(true);
                  setBrandError(null);
                  try {
                    await setBranchBrands(managingBranchId, stagedBrandIds);
                    setManagingBranchId(null);
                  } catch (e: any) {
                    setBrandError(e?.message ?? t('teams.genericError'));
                  } finally {
                    setBrandLoading(false);
                  }
                }}
              />
              <View style={{ height: 10 }} />
              <SecondaryButton title={t('common.cancel')} onPress={() => setManagingBranchId(null)} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
```

- [ ] **Step 4**: Add the three new i18n keys (`teams.manageBrandsTitle`, `teams.manageBrandsHint`, `teams.newBrandPlaceholder`) to whichever locale file(s) `teams.title`/`teams.addTeam` already live in (`en`/`ar`), matching that file's existing key style. Use plain English/Arabic text for now — matching the existing untranslated-screen convention noted in the roadmap for screens still mid-migration is out of scope here; just add real strings for both locales the same way the rest of `teams.tsx` already does.

- [ ] **Step 5: `npx tsc --noEmit`.**

- [ ] **Step 6: Commit.**

```bash
git add src/app/\(main\)/teams.tsx src/i18n
git commit -m "Add brand management to the branch screen"
```

---

### Task 8: Staff brand picker (`CreateUserSheet`, `ManageUserSheet`)

**Files:**
- Modify: `src/components/CreateUserSheet.tsx`
- Modify: `src/components/ManageUserSheet.tsx`

**Interfaces:**
- Consumes: `useOrgData().brands`, `branchBrandIds` (Task 6); `useAuth().adminCreateUser({ ..., brandId })`, `addProfileToTeam(profileId, teamId, brandId)` (Task 6).

- [ ] **Step 1: `CreateUserSheet.tsx`** — add brand state, pull `brands, branchBrandIds` from `useOrgData()`:

```ts
  const { teams, brands, branchBrandIds, refresh } = useOrgData();
  // ...
  const [brandId, setBrandId] = useState<string | null>(null);
```

Reset `brandId` to `null` whenever `teamId` or `role` changes (an old brand can point at a branch that no longer applies):

```ts
  useEffect(() => {
    setBrandId(null);
  }, [teamId, role]);
```

Add a brand picker, shown only when `role === 'employee'` and a branch is chosen, right after the existing branch-picker block (inside the `role !== 'owner' ? (...) : (...)` branch, nested one level further so it only shows for `role === 'employee'` specifically — a `team_admin` still sees the branch picker but not this):

```tsx
                {role === 'employee' && teamId ? (
                  <>
                    <FieldLabel>Brand</FieldLabel>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {(branchBrandIds[teamId] ?? []).length === 0 ? (
                        <Text style={{ fontSize: 12, color: c.textFaint }}>No brands configured for this branch yet.</Text>
                      ) : (
                        (branchBrandIds[teamId] ?? []).map((bid) => {
                          const brand = brands.find((b) => b.id === bid);
                          if (!brand) return null;
                          const active = brandId === bid;
                          return (
                            <Pressable
                              key={bid}
                              onPress={() => setBrandId(active ? null : bid)}
                              style={{
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                borderRadius: 999,
                                backgroundColor: active ? c.indigo : c.bgSubtle,
                                borderWidth: 1,
                                borderColor: active ? c.indigo : c.border,
                              }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                                {brand.name}
                              </Text>
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  </>
                ) : null}
```

For the non-owner path (a branch manager creating a supervisor on their own fixed branch), add the same block using `profile?.teamIds[0]` in place of `teamId` — the non-owner branch renders `"They will join your branch as a supervisor."` today; add the brand picker right below that text, gated the same way (`role` is always `'employee'` on this path already, so just check `branchBrandIds[profile?.teamIds[0] ?? ''] ?? []`).

Wire `brandId` into `handleCreate`:

```ts
      await adminCreateUser({ name, username, password, role, teamId, title, brandId });
```

And reset it in `reset()`:

```ts
    setBrandId(null);
```

- [ ] **Step 2: `ManageUserSheet.tsx`** — pull `brands, branchBrandIds` from `useOrgData()`, and add a per-branch brand row, shown only for `live.role === 'employee'`, right under each branch chip:

```ts
  const { members, teams, brands, branchBrandIds, refresh } = useOrgData();
  // ...
  const [brandBusyTeamId, setBrandBusyTeamId] = useState<string | null>(null);
```

```tsx
                  {live.role === 'employee'
                    ? memberTeams.map((t) => {
                        const available = branchBrandIds[t.id] ?? [];
                        if (available.length === 0) return null;
                        return (
                          <View key={`brand-${t.id}`} style={{ marginTop: 6 }}>
                            <Text style={{ fontSize: 11, color: c.textFaint, marginBottom: 4 }}>{t.name} brand</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {available.map((bid) => {
                                const brand = brands.find((b) => b.id === bid);
                                if (!brand) return null;
                                const active = live.teamBrandIds[t.id] === bid;
                                return (
                                  <Pressable
                                    key={bid}
                                    disabled={brandBusyTeamId === t.id}
                                    onPress={async () => {
                                      setBrandBusyTeamId(t.id);
                                      setError(null);
                                      try {
                                        await addProfileToTeam(live.id, t.id, active ? null : bid);
                                        await refresh();
                                      } catch (e: any) {
                                        setError(e?.message ?? 'Could not set that brand.');
                                      } finally {
                                        setBrandBusyTeamId(null);
                                      }
                                    }}
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 5,
                                      borderRadius: 999,
                                      backgroundColor: active ? c.indigo : c.bgSubtle,
                                      borderWidth: 1,
                                      borderColor: active ? c.indigo : c.border,
                                      opacity: brandBusyTeamId === t.id ? 0.5 : 1,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : c.text }}>
                                      {brand.name}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })
                    : null}
```

Place this block right after the existing `{memberTeams.map((t) => (...))}` chips row (still inside the `live.role !== 'owner' ? (...) : null` wrapper), before the `addableTeams` "add a branch" row.

- [ ] **Step 3: `npx tsc --noEmit`.**

- [ ] **Step 4: Commit.**

```bash
git add src/components/CreateUserSheet.tsx src/components/ManageUserSheet.tsx
git commit -m "Add a brand picker to staff create/edit"
```

---

### Task 9: Audit picker — Brand step (`FillChecklistSheet`)

**Files:**
- Modify: `src/components/FillChecklistSheet.tsx`

**Interfaces:**
- Consumes: `useOrgData().brands`, `branchBrandIds` (Task 6); `Profile.teamBrandIds` (Task 6).

- [ ] **Step 1**: Widen the audit-step union and add brand state:

```ts
  const [auditStep, setAuditStep] = useState<'branch' | 'brand' | 'subject' | 'shift' | 'fill'>('branch');
  const [auditBranchId, setAuditBranchId] = useState<string | null>(null);
  const [auditBrandId, setAuditBrandId] = useState<string | null>(null);
```

Pull `brands, branchBrandIds` from `useOrgData()` alongside the existing `teams, members, setTaskCompletion, declareTaskOffDuty`.

- [ ] **Step 2**: Update `branchMembers` to also filter by brand when one is chosen:

```ts
  const branchMembers = members.filter(
    (m) =>
      m.id !== profile?.id &&
      m.role !== 'owner' &&
      auditBranchId != null &&
      m.teamIds.includes(auditBranchId) &&
      (auditBrandId == null || m.teamBrandIds[auditBranchId] === auditBrandId)
  );
  const auditBrand = brands.find((b) => b.id === auditBrandId);
```

- [ ] **Step 3**: In the branch step's `onPress`, go to `'brand'` when the chosen branch has configured brands, otherwise fall straight through to `'subject'` (today's behavior, unreachable-brand-step fallback from the spec):

```tsx
                        onPress={() => {
                          setAuditBranchId(t.id);
                          setAuditBrandId(null);
                          setAuditStep((branchBrandIds[t.id] ?? []).length > 0 ? 'brand' : 'subject');
                        }}
```

- [ ] **Step 4**: Add the brand step's rendering, between the existing `branch` and `subject` branches of the `auditStep === 'branch' ? (...) : auditStep === 'subject' ? (...) : (...)` chain — change it to a 4-way chain and insert:

```tsx
                ) : auditStep === 'brand' ? (
                  <>
                    <Pressable onPress={() => setAuditStep('branch')} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>{'< Back to branch'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 10 }}>Which brand?</Text>
                    {(branchBrandIds[auditBranchId ?? ''] ?? []).map((bid) => {
                      const brand = brands.find((b) => b.id === bid);
                      if (!brand) return null;
                      return (
                        <Pressable
                          key={bid}
                          onPress={() => {
                            setAuditBrandId(bid);
                            setAuditStep('subject');
                          }}
                          style={{
                            paddingVertical: 14,
                            paddingHorizontal: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: c.border,
                            marginBottom: 8,
                          }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{brand.name}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                ) : auditStep === 'subject' ? (
```

Update the `subject` step's back-link to return to `'brand'` when the branch has configured brands, else `'branch'`:

```tsx
                    <Pressable
                      onPress={() => setAuditStep((branchBrandIds[auditBranchId ?? ''] ?? []).length > 0 ? 'brand' : 'branch')}
                      style={{ marginBottom: 10 }}
                    >
                      <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>{'< Back'}</Text>
                    </Pressable>
```

- [ ] **Step 5**: Update the summary line shown once filling starts to include the brand when one was chosen:

```tsx
                    <Text style={{ fontSize: 12, color: c.textMuted }}>
                      {teams.find((t) => t.id === auditBranchId)?.name}
                      {auditBrand ? ` • ${auditBrand.name}` : ''} • {auditSubject?.name} • {auditShift === 'morning' ? 'AM' : 'PM'}
                    </Text>
```

- [ ] **Step 6**: Reset `auditBrandId` in `reset()`:

```ts
    setAuditBrandId(null);
```

- [ ] **Step 7**: The "Change" link on the summary line currently calls `setAuditStep('branch')` — leave it as-is (restarting from branch is still correct; the brand step re-appears naturally on the way back through if the branch has brands configured).

- [ ] **Step 8: `npx tsc --noEmit`.**

- [ ] **Step 9: Commit.**

```bash
git add src/components/FillChecklistSheet.tsx
git commit -m "Add a brand step to the audit branch/subject/shift picker"
```

---

### Task 10: Dashboard/Report brand breakdown

**Files:**
- Create: `src/lib/branchSummary.ts` (shared grouping helper — DRY between Dashboard and Report, which both need branch → brand → subject grouping from the same `BranchSummaryRow[]` shape)
- Modify: `src/app/(main)/index.tsx` (`OwnerDashboard`'s `branches` memo and its rendering, ~lines 205-313)
- Modify: `src/app/(main)/report.tsx` (rows rendering, ~lines 112-140)
- Modify: `src/lib/exportReport.ts` (add a Brand column)

**Interfaces:**
- Consumes: `BranchSummaryRow.brandId`/`brandName` (Task 6).
- Produces: `groupBranchSummary(rows: BranchSummaryRow[]): BranchGroup[]` where

```ts
export interface BrandGroup {
  brandKey: string; // brandId, or '__unassigned__'
  brandName: string; // brandName, or 'Unassigned'
  totalPoints: number;
  iqdAmount: number;
  rows: BranchSummaryRow[];
}
export interface BranchGroup {
  branchId: string;
  branchName: string;
  totalPoints: number;
  iqdAmount: number;
  brandGroups: BrandGroup[];
}
```

- [ ] **Step 1: `src/lib/branchSummary.ts`**

```ts
import type { BranchSummaryRow } from '@/types';

export interface BrandGroup {
  brandKey: string;
  brandName: string;
  totalPoints: number;
  iqdAmount: number;
  rows: BranchSummaryRow[];
}

export interface BranchGroup {
  branchId: string;
  branchName: string;
  totalPoints: number;
  iqdAmount: number;
  brandGroups: BrandGroup[];
}

/** Branch -> brand -> subject, from the flat rows get_current_branch_summary
 * / get_period_report return. A subject with no brand (or a branch with no
 * brands configured at all) lands in an "Unassigned" group, never dropped. */
export function groupBranchSummary(rows: BranchSummaryRow[]): BranchGroup[] {
  const branches = new Map<string, BranchGroup>();
  for (const row of rows) {
    let branch = branches.get(row.branchId);
    if (!branch) {
      branch = { branchId: row.branchId, branchName: row.branchName, totalPoints: 0, iqdAmount: 0, brandGroups: [] };
      branches.set(row.branchId, branch);
    }
    branch.totalPoints += row.totalPoints;
    branch.iqdAmount += row.iqdAmount;

    const brandKey = row.brandId ?? '__unassigned__';
    let brandGroup = branch.brandGroups.find((g) => g.brandKey === brandKey);
    if (!brandGroup) {
      brandGroup = { brandKey, brandName: row.brandName ?? 'Unassigned', totalPoints: 0, iqdAmount: 0, rows: [] };
      branch.brandGroups.push(brandGroup);
    }
    brandGroup.totalPoints += row.totalPoints;
    brandGroup.iqdAmount += row.iqdAmount;
    brandGroup.rows.push(row);
  }
  return Array.from(branches.values()).sort((a, b) => a.branchName.localeCompare(b.branchName));
}
```

- [ ] **Step 2: `src/app/(main)/index.tsx`** — replace the `branches` memo with:

```ts
  const branches = useMemo(() => groupBranchSummary(currentSummary), [currentSummary]);
```

(Remove the now-unused `BranchSummaryRow` import if nothing else in the file uses it directly — check first.) Add `import { groupBranchSummary } from '@/lib/branchSummary';`.

Replace the expanded-branch rendering (the flat `branch.supervisors.map(...)`) with a nested brand → subject render:

```tsx
                {expanded ? (
                  <View style={{ marginTop: 10, gap: 12 }}>
                    {branch.brandGroups.map((bg) => (
                      <View key={bg.brandKey}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                          {bg.brandName}
                        </Text>
                        <View style={{ gap: 6 }}>
                          {bg.rows.map((s) => (
                            <View key={s.subjectProfileId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 13, color: c.text }}>{s.subjectName}</Text>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: s.totalPoints < 0 ? c.rose : c.emerald }}>
                                {s.totalPoints} · {s.iqdAmount.toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
```

- [ ] **Step 3: `src/app/(main)/report.tsx`** — replace the flat `rows.map(...)` card body with the same grouped structure, reusing `groupBranchSummary`:

```ts
import { groupBranchSummary } from '@/lib/branchSummary';
// ...
  const groups = useMemo(() => groupBranchSummary(rows), [rows]);
```

```tsx
              <Card style={{ marginTop: 12 }}>
                {groups.map((branch) => (
                  <View key={branch.branchId} style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 6 }}>{branch.branchName}</Text>
                    {branch.brandGroups.map((bg) => (
                      <View key={bg.brandKey} style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                          {bg.brandName}
                        </Text>
                        {bg.rows.map((r) => (
                          <View
                            key={`${r.subjectProfileId}-${r.branchId}`}
                            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}
                          >
                            <Text style={{ fontSize: 14, color: c.text }}>{r.subjectName}</Text>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: r.totalPoints < 0 ? c.rose : c.emerald }}>
                              {r.totalPoints} · {r.iqdAmount.toLocaleString(i18n.language)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{t('report.total')}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                    {totalPoints} · {totalIqd.toLocaleString(i18n.language)}
                  </Text>
                </View>
              </Card>
```

- [ ] **Step 4: `src/lib/exportReport.ts`** — add a Brand column:

```ts
  const sheetData = rows.map((r) => ({
    Name: r.subjectName,
    Branch: r.branchName,
    Brand: r.brandName ?? 'Unassigned',
    Points: r.totalPoints,
    'Amount (IQD)': r.iqdAmount,
  }));
```

- [ ] **Step 5: `npx tsc --noEmit`.**

- [ ] **Step 6: Commit.**

```bash
git add src/lib/branchSummary.ts src/app/\(main\)/index.tsx src/app/\(main\)/report.tsx src/lib/exportReport.ts
git commit -m "Add brand-level breakdown to Dashboard and Report"
```

---

### Task 11: Live QA (flag for the user, do not attempt)

Configure Tuwaysah's real brands (360 + AA Chicken + Center) and Olympic's (360 + AA Chicken + Awtar + Center) via the new branch "Manage brands" sheet; assign Mahmoud (and any other real supervisor) a brand via ManageUserSheet; create one new supervisor with `admin_create_user`'s brand picker; run a real audit through the new Branch → Brand → Subject → Shift flow; confirm the Dashboard's branch card expands to show brand-grouped supervisors, and that the Report tab's closed-month view and its exported `.xlsx` both show the right brand per row.

---

## Explicitly out of scope (see spec)

Brand-wide reporting across branches (e.g. "AA Chicken org-wide"); retroactively assigning brands to existing supervisors via a migration script (the user does this by hand through the new UI); any change to what a branch manager or admin can see/do beyond the brand picker being absent for them.
