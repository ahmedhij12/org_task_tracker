# Admin-Provisioned Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace employee self-registration with accounts created by an admin (owner) or team leader (team_admin), forcing a password change on first login, with admin password reset and account deactivation.

**Architecture:** Account creation moves server-side into `SECURITY DEFINER` Postgres RPCs that write directly to `auth.users` / `auth.identities` with a bcrypt hash from `pgcrypto`, because the new employee has no client session to call `supabase.auth.signUp()` from. Login stays exactly as it is (org code + username + password, resolved by `get_login_email`). A `must_change_password` flag on `profiles` gates access to the main app through an expo-router `Stack.Protected` guard.

**Tech Stack:** React Native 0.81 + Expo SDK 54 + expo-router 6, Supabase (Postgres + GoTrue Auth), TypeScript, pgcrypto.

**Spec:** [docs/superpowers/specs/2026-08-17-admin-provisioned-accounts-design.md](../specs/2026-08-17-admin-provisioned-accounts-design.md)

## Global Constraints

- **`supabase/SETUP.sql` stays idempotent**: it is a drop-and-rebuild script. New columns go into the `create table` statements, NOT `alter table`. New functions get a matching `drop function if exists ... cascade;` line in the "Clean slate" block at the top.
- **Login stays org code + username + password.** No email login, ever.
- **No email at account creation.** Auth emails are synthetic: `<username>.<org_code>@users.orgtasks.internal`.
- **Only `owner` and `team_admin` may create accounts.** `team_admin` is restricted to `p_role = 'employee'` on their own `team_id`. `owner` role can never be created by this flow.
- **Password minimum is 6 characters**, matching the existing owner-signup validation.
- **`search_path` on any function calling `crypt`/`gen_salt` must be `public, extensions`** — Supabase installs pgcrypto into the `extensions` schema, so `set search_path = public` alone makes `crypt()` unresolvable.
- **Never insert into `auth.users.confirmed_at`** — it is a generated column and the insert will fail.
- **GoTrue token columns must be `''`, not NULL** (`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token`). GoTrue scans them into non-nullable Go strings; NULL causes `converting NULL to string is unsupported` at login.
- **Verification commands:** `npm run typecheck` for TypeScript; `supabase/TESTS.sql` pasted into the Supabase SQL Editor for database logic; Playwright scripts against `http://localhost:8081/` (started with `npm run web`) for UI flows.

---

### Task 1: Schema columns, helper functions, and RLS hardening

**Files:**
- Modify: `supabase/SETUP.sql` (profiles table ~line 58, helper functions ~line 124, RLS policies ~line 158)
- Create: `supabase/TESTS.sql`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `public.profiles.must_change_password boolean`, `public.profiles.active boolean`, `public.profiles.recovery_email text`; SQL functions `public.my_active() returns boolean`, `public.my_must_change_password() returns boolean`; test harness file `supabase/TESTS.sql` that later tasks append to.

- [ ] **Step 1: Write the failing test**

Create `supabase/TESTS.sql`. This harness fakes an authenticated session by setting the `request.jwt.claims` GUC that `auth.uid()` reads from, runs assertions, and rolls back so it never pollutes real data.

```sql
-- OrgTasks — automated database tests.
-- Paste the whole file into Supabase Studio -> SQL Editor -> Run.
-- Everything runs inside a transaction that is rolled back at the end,
-- so this never changes real data. Any failed assertion aborts with an
-- exception naming the check that failed.

begin;

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_has_col boolean;
begin
  -- ── Test 1: the new profiles columns exist with the right defaults ──
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'must_change_password'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.must_change_password column is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'active'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.active column is missing';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'recovery_email'
  ) into v_has_col;
  if not v_has_col then
    raise exception 'FAIL: profiles.recovery_email column is missing';
  end if;
  raise notice 'PASS: profiles has must_change_password, active, recovery_email';

  -- ── Test 2: helper functions exist ──
  if to_regprocedure('public.my_active()') is null then
    raise exception 'FAIL: public.my_active() is missing';
  end if;
  if to_regprocedure('public.my_must_change_password()') is null then
    raise exception 'FAIL: public.my_must_change_password() is missing';
  end if;
  raise notice 'PASS: my_active() and my_must_change_password() exist';

  -- ── Test 3: an owner created the normal way defaults to active,
  --            and is NOT forced to change their password ──
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);

  select org_id, org_code into v_org_id, v_org_code
  from public.create_organization('Test Org', 'Test Owner', 'testowner');

  if not (select active from public.profiles where id = v_owner_id) then
    raise exception 'FAIL: a newly created owner should be active';
  end if;
  if (select must_change_password from public.profiles where id = v_owner_id) then
    raise exception 'FAIL: an owner who chose their own password should not be forced to change it';
  end if;
  raise notice 'PASS: owner defaults are active=true, must_change_password=false';
end;
$$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Paste `supabase/TESTS.sql` into the Supabase SQL Editor and Run.
Expected: `ERROR: FAIL: profiles.must_change_password column is missing`

- [ ] **Step 3: Add the columns to the profiles table**

In `supabase/SETUP.sql`, replace the `create table public.profiles (...)` block with:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  title text,
  username text,
  role text not null check (role in ('owner', 'team_admin', 'employee')),
  -- Set true whenever an admin creates the account or resets the password,
  -- so the app can force a change before letting them in. An owner who chose
  -- their own password at signup starts false.
  must_change_password boolean not null default false,
  -- Deactivated accounts cannot sign in; see admin_set_user_active.
  active boolean not null default true,
  -- Optional, added by the user later, purely so password reset can email
  -- them. NOT the auth email — see the design spec.
  recovery_email text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Add the helper functions**

In `supabase/SETUP.sql`, immediately after the existing `public.my_team_id()` function (~line 142), add:

```sql
create function public.my_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select active from public.profiles where id = auth.uid();
$$;

create function public.my_must_change_password()
returns boolean
language sql stable security definer set search_path = public as $$
  select must_change_password from public.profiles where id = auth.uid();
$$;
```

- [ ] **Step 5: Register the new functions in the clean-slate block**

In `supabase/SETUP.sql`, in the drop block near the top (~line 19-28), add alongside the existing `drop function` lines:

```sql
drop function if exists public.my_active() cascade;
drop function if exists public.my_must_change_password() cascade;
```

- [ ] **Step 6: Harden the self-update RLS policy**

The existing "users can update their own display name" policy lets a user update *any* column on their own row, which would let them flip their own `active` flag back on after being deactivated, or clear `must_change_password` to skip the forced change. Replace that policy in `supabase/SETUP.sql` with:

```sql
create policy "users can update their own display name"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and org_id = public.my_org_id()
    and role = public.my_role()
    and team_id is not distinct from public.my_team_id()
    -- Users may edit their own name/title/recovery_email, but never
    -- reactivate themselves or skip a forced password change. Those two
    -- only move through SECURITY DEFINER RPCs.
    and active = public.my_active()
    and must_change_password = public.my_must_change_password()
  );
```

- [ ] **Step 7: Apply the schema and run the test to verify it passes**

Paste the whole of `supabase/SETUP.sql` into the Supabase SQL Editor and Run (this wipes all data — expected).
Then paste `supabase/TESTS.sql` and Run.
Expected: three `PASS:` notices, no exception.

- [ ] **Step 8: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "feat(db): add must_change_password, active, recovery_email to profiles

Adds the two SECURITY DEFINER helpers my_active() and
my_must_change_password() and uses them to stop a user from
reactivating themselves or skipping a forced password change through
the self-update RLS policy. Introduces supabase/TESTS.sql as the
automated database test harness."
```

---

### Task 2: `admin_create_user` RPC

**Files:**
- Modify: `supabase/SETUP.sql` (drop block, RPC section after `join_organization`, grants block)
- Modify: `supabase/TESTS.sql` (append new DO block before `rollback;`)

**Interfaces:**
- Consumes: `public.profiles.must_change_password`, `public.profiles.active` (Task 1); `public.my_org_id()`, `public.my_role()`, `public.my_team_id()` (existing).
- Produces: `public.admin_create_user(p_name text, p_username text, p_password text, p_role text default 'employee', p_team_id uuid default null, p_title text default null) returns uuid` — returns the new profile id. Raises on: not authenticated, caller not owner/team_admin, invalid role, team_admin creating a non-employee or creating outside their own team, team not in caller's org, empty username, password under 6 chars, duplicate username in org.

- [ ] **Step 1: Confirm the auth.identities schema on this Supabase instance**

`auth.identities.provider_id` is required (NOT NULL) on current GoTrue versions but absent on old ones, so verify before writing the insert. Run in the SQL Editor:

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'auth' and table_name = 'identities'
order by ordinal_position;
```

Expected: a `provider_id` column with `is_nullable = NO`. If it is absent, drop `provider_id` from the insert in Step 4. If `id` is present with no default, add `gen_random_uuid()` for it too.

- [ ] **Step 2: Write the failing test**

Append this DO block to `supabase/TESTS.sql`, immediately before the final `rollback;`:

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_team_b_id uuid;
  v_leader_id uuid;
  v_emp_id uuid;
  v_email text;
  v_raised boolean;
begin
  -- Bootstrap an owner with an organization and two teams.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
    'owner2.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Acme', 'Owner Two', 'ownertwo');

  -- ── Test: owner creates a team leader ──
  v_leader_id := public.admin_create_user(
    p_name => 'Leader One',
    p_username => 'leader1',
    p_password => 'initial123',
    p_role => 'team_admin',
    p_team_id => v_team_id,
    p_title => 'Shift Lead'
  );

  if (select role from public.profiles where id = v_leader_id) <> 'team_admin' then
    raise exception 'FAIL: created leader should have role team_admin';
  end if;
  if not (select must_change_password from public.profiles where id = v_leader_id) then
    raise exception 'FAIL: an admin-created account must be forced to change its password';
  end if;
  if not (select active from public.profiles where id = v_leader_id) then
    raise exception 'FAIL: a newly created account should be active';
  end if;
  if (select team_id from public.profiles where id = v_leader_id) is distinct from v_team_id then
    raise exception 'FAIL: created leader is on the wrong team';
  end if;
  raise notice 'PASS: owner can create a team leader with forced password change';

  -- ── Test: the auth user is real and its password verifies ──
  select email into v_email from auth.users where id = v_leader_id;
  if v_email <> 'leader1.' || v_org_code || '@users.orgtasks.internal' then
    raise exception 'FAIL: synthetic email is wrong, got %', v_email;
  end if;
  if not exists (
    select 1 from auth.users
    where id = v_leader_id
      and encrypted_password = extensions.crypt('initial123', encrypted_password)
  ) then
    raise exception 'FAIL: the stored password hash does not verify against the given password';
  end if;
  if not exists (select 1 from auth.identities where user_id = v_leader_id and provider = 'email') then
    raise exception 'FAIL: no auth.identities row was created, GoTrue login will fail';
  end if;
  raise notice 'PASS: auth.users + auth.identities rows are correct and the password verifies';

  -- ── Test: get_login_email resolves the new account ──
  if public.get_login_email(v_org_code, 'leader1') is distinct from v_email then
    raise exception 'FAIL: get_login_email did not resolve the admin-created account';
  end if;
  raise notice 'PASS: get_login_email resolves an admin-created account';

  -- ── Test: duplicate username in the same org is rejected ──
  v_raised := false;
  begin
    perform public.admin_create_user('Dup', 'leader1', 'initial123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: duplicate username should have been rejected';
  end if;
  raise notice 'PASS: duplicate username is rejected';

  -- ── Test: a short password is rejected ──
  v_raised := false;
  begin
    perform public.admin_create_user('Shorty', 'shorty', '123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a password under 6 characters should have been rejected';
  end if;
  raise notice 'PASS: short password is rejected';

  -- ── Test: creating an owner through this RPC is rejected ──
  v_raised := false;
  begin
    perform public.admin_create_user('Sneaky', 'sneaky', 'initial123', 'owner', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: creating an owner through admin_create_user should be rejected';
  end if;
  raise notice 'PASS: cannot create an owner through admin_create_user';

  -- ── Test: a team leader can create an employee on their own team ──
  insert into public.teams (org_id, name) values (v_org_id, 'Team B') returning id into v_team_b_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);

  v_emp_id := public.admin_create_user('Emp One', 'emp1', 'initial123', 'employee', v_team_id);
  if (select role from public.profiles where id = v_emp_id) <> 'employee' then
    raise exception 'FAIL: team leader should be able to create an employee on their own team';
  end if;
  raise notice 'PASS: a team leader can create an employee on their own team';

  -- ── Test: a team leader cannot create another team leader ──
  v_raised := false;
  begin
    perform public.admin_create_user('Rival', 'rival', 'initial123', 'team_admin', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to create another team leader';
  end if;
  raise notice 'PASS: a team leader cannot create another team leader';

  -- ── Test: a team leader cannot create a user on someone else's team ──
  v_raised := false;
  begin
    perform public.admin_create_user('Outsider', 'outsider', 'initial123', 'employee', v_team_b_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not be able to create a user on another team';
  end if;
  raise notice 'PASS: a team leader cannot create a user on another team';

  -- ── Test: a plain employee cannot create anyone ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_create_user('Nope', 'nope', 'initial123', 'employee', v_team_id);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to create accounts';
  end if;
  raise notice 'PASS: an employee cannot create accounts';
end;
$$;
```

- [ ] **Step 3: Run the test to verify it fails**

Paste `supabase/TESTS.sql` into the SQL Editor and Run.
Expected: `ERROR: function public.admin_create_user(...) does not exist`

- [ ] **Step 4: Write the RPC**

In `supabase/SETUP.sql`, add after the `join_organization` function (~line 332):

```sql
-- Creates a user account on behalf of an admin or team leader. The new
-- employee is not present, so there is no client session to call
-- supabase.auth.signUp() from — this writes the auth.users row itself,
-- hashing the password with the same bcrypt GoTrue verifies against, so
-- the account signs in through the normal password flow.
--
-- search_path includes extensions because Supabase installs pgcrypto
-- (crypt, gen_salt) there, not in public.
create function public.admin_create_user(
  p_name text,
  p_username text,
  p_password text,
  p_role text default 'employee',
  p_team_id uuid default null,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_team uuid;
  v_org_code text;
  v_new_id uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id, p.team_id
    into v_caller_role, v_caller_org, v_caller_team
  from public.profiles p where p.id = auth.uid();

  if v_caller_role is null then
    raise exception 'not authenticated';
  end if;
  if v_caller_role not in ('owner', 'team_admin') then
    raise exception 'only an admin or team leader can create users';
  end if;
  if p_role not in ('employee', 'team_admin') then
    raise exception 'role must be employee or team_admin';
  end if;

  if v_caller_role = 'team_admin' then
    if p_role <> 'employee' then
      raise exception 'a team leader can only create employees';
    end if;
    if p_team_id is distinct from v_caller_team then
      raise exception 'a team leader can only create users on their own team';
    end if;
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org
  ) then
    raise exception 'team not found in this organization';
  end if;
  if v_username = '' then
    raise exception 'a username is required';
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.org_id = v_caller_org and lower(p.username) = v_username
  ) then
    raise exception 'that username is already taken in this organization';
  end if;

  select o.org_code into v_org_code
  from public.organizations o where o.id = v_caller_org;

  -- Globally unique: org_code is unique across orgs, username is unique
  -- within an org. Never a real mailbox — see recovery_email for that.
  v_email := v_username || '.' || v_org_code || '@users.orgtasks.internal';

  -- confirmed_at is a generated column and must not be inserted into.
  -- The token columns must be '' rather than NULL: GoTrue scans them into
  -- non-nullable Go strings and errors out on NULL at login.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf', 10)),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- GoTrue's password grant checks identities as well as users; without
  -- this row the account exists but cannot sign in.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_new_id::text, v_new_id,
    jsonb_build_object(
      'sub', v_new_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  );

  insert into public.profiles (
    id, org_id, team_id, name, title, username, role,
    must_change_password, active
  ) values (
    v_new_id, v_caller_org, p_team_id, p_name,
    nullif(trim(coalesce(p_title, '')), ''), v_username, p_role,
    true, true
  );

  return v_new_id;
end;
$$;
```

- [ ] **Step 5: Register the function in the clean-slate and grants blocks**

In the drop block near the top of `supabase/SETUP.sql`:

```sql
drop function if exists public.admin_create_user(text, text, text, text, uuid, text) cascade;
```

In the grants block (~line 440):

```sql
grant execute on function public.admin_create_user(text, text, text, text, uuid, text) to authenticated;
```

- [ ] **Step 6: Run the tests to verify they pass**

Paste `supabase/SETUP.sql` into the SQL Editor and Run, then paste `supabase/TESTS.sql` and Run.
Expected: all `PASS:` notices from Task 1 and Task 2, no exception.

- [ ] **Step 7: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "feat(db): add admin_create_user RPC

Creates the auth.users and auth.identities rows server-side with a
pgcrypto bcrypt hash, since an admin-provisioned employee has no client
session to sign up from. Enforces that only owners and team leaders can
create accounts, that team leaders are limited to employees on their own
team, and that owner accounts can never be created this way."
```

---

### Task 3: `admin_reset_password`, `admin_set_user_active`, `clear_must_change_password` RPCs

**Files:**
- Modify: `supabase/SETUP.sql` (drop block, RPC section after `admin_create_user`, grants block)
- Modify: `supabase/TESTS.sql` (append new DO block before `rollback;`)

**Interfaces:**
- Consumes: `public.admin_create_user(...)` (Task 2); `public.profiles.must_change_password`, `public.profiles.active` (Task 1).
- Produces:
  - `public.admin_reset_password(p_target_profile_id uuid, p_new_password text) returns void`
  - `public.admin_set_user_active(p_target_profile_id uuid, p_active boolean) returns void`
  - `public.clear_must_change_password() returns void` — no arguments, operates on `auth.uid()`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/TESTS.sql`, immediately before the final `rollback;`:

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_emp_id uuid;
  v_other_team_id uuid;
  v_other_emp_id uuid;
  v_leader_id uuid;
  v_raised boolean;
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
    'owner3.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Reset Co', 'Owner Three', 'ownerthree');

  v_emp_id := public.admin_create_user('Emp', 'emp', 'initial123', 'employee', v_team_id);

  -- ── Test: the user clears their own forced-change flag ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  perform public.clear_must_change_password();
  if (select must_change_password from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: clear_must_change_password did not clear the flag';
  end if;
  raise notice 'PASS: clear_must_change_password clears the caller''s own flag';

  -- ── Test: an admin reset changes the hash and re-forces a change ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  perform public.admin_reset_password(v_emp_id, 'brandnew123');

  if not exists (
    select 1 from auth.users
    where id = v_emp_id
      and encrypted_password = extensions.crypt('brandnew123', encrypted_password)
  ) then
    raise exception 'FAIL: the new password does not verify after an admin reset';
  end if;
  if not (select must_change_password from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: an admin reset must re-force a password change';
  end if;
  raise notice 'PASS: admin_reset_password sets a working password and re-forces a change';

  -- ── Test: a short reset password is rejected ──
  v_raised := false;
  begin
    perform public.admin_reset_password(v_emp_id, '12');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a reset password under 6 characters should have been rejected';
  end if;
  raise notice 'PASS: admin_reset_password rejects a short password';

  -- ── Test: deactivating blocks sign-in lookup ──
  perform public.admin_set_user_active(v_emp_id, false);
  if (select active from public.profiles where id = v_emp_id) then
    raise exception 'FAIL: admin_set_user_active(false) did not deactivate the profile';
  end if;
  if public.get_login_email(v_org_code, 'emp') is not null then
    raise exception 'FAIL: a deactivated user must not resolve to a login email';
  end if;
  if (select banned_until from auth.users where id = v_emp_id) is null then
    raise exception 'FAIL: a deactivated user should also be banned at the auth level';
  end if;
  raise notice 'PASS: deactivation blocks login lookup and bans the auth user';

  -- ── Test: reactivating restores sign-in ──
  perform public.admin_set_user_active(v_emp_id, true);
  if public.get_login_email(v_org_code, 'emp') is null then
    raise exception 'FAIL: a reactivated user should resolve to a login email again';
  end if;
  if (select banned_until from auth.users where id = v_emp_id) is not null then
    raise exception 'FAIL: reactivating should clear the auth-level ban';
  end if;
  raise notice 'PASS: reactivation restores login and clears the ban';

  -- ── Test: a team leader cannot reset someone on another team ──
  v_leader_id := public.admin_create_user('Lead', 'lead', 'initial123', 'team_admin', v_team_id);
  insert into public.teams (org_id, name) values (v_org_id, 'Other Team') returning id into v_other_team_id;
  v_other_emp_id := public.admin_create_user('Other', 'other', 'initial123', 'employee', v_other_team_id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_leader_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_reset_password(v_other_emp_id, 'hacked123');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a team leader must not reset a password outside their team';
  end if;
  raise notice 'PASS: a team leader cannot reset a password outside their own team';

  -- ── Test: an employee cannot reset anyone ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_id)::text, true);
  v_raised := false;
  begin
    perform public.admin_reset_password(v_leader_id, 'hacked123');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: an employee must not be able to reset anyone''s password';
  end if;
  raise notice 'PASS: an employee cannot reset passwords';
end;
$$;
```

- [ ] **Step 2: Run the test to verify it fails**

Paste `supabase/TESTS.sql` into the SQL Editor and Run.
Expected: `ERROR: function public.clear_must_change_password() does not exist`

- [ ] **Step 3: Write the three RPCs**

In `supabase/SETUP.sql`, add after `admin_create_user`:

```sql
-- Shared authorization check for the admin user-management RPCs: the
-- caller must be the org owner (any member) or a team leader acting on
-- someone on their own team. Returns silently when allowed, raises when not.
create function public.assert_can_manage_user(p_target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_team uuid;
  v_target_org uuid;
  v_target_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id, p.team_id
    into v_caller_role, v_caller_org, v_caller_team
  from public.profiles p where p.id = auth.uid();

  select p.org_id, p.team_id into v_target_org, v_target_team
  from public.profiles p where p.id = p_target_profile_id;

  if v_target_org is null then
    raise exception 'user not found';
  end if;
  if v_target_org is distinct from v_caller_org then
    raise exception 'that user is not in your organization';
  end if;
  if v_caller_role = 'owner' then
    return;
  end if;
  if v_caller_role = 'team_admin' and v_target_team is not distinct from v_caller_team then
    return;
  end if;
  raise exception 'only an admin or the user''s team leader can manage this account';
end;
$$;

-- Sets a new password for another user without knowing the old one, and
-- re-forces a password change so the user picks their own again.
create function public.admin_reset_password(
  p_target_profile_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_can_manage_user(p_target_profile_id);

  if coalesce(length(p_new_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = now()
  where id = p_target_profile_id;

  update public.profiles
  set must_change_password = true
  where id = p_target_profile_id;
end;
$$;

-- Deactivating also bans the auth user and drops their sessions, so an
-- already-signed-in device is cut off at its next token refresh rather
-- than lingering until the account is touched again.
create function public.admin_set_user_active(
  p_target_profile_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_can_manage_user(p_target_profile_id);

  if p_target_profile_id = auth.uid() then
    raise exception 'you cannot deactivate your own account';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = p_target_profile_id and p.role = 'owner'
  ) then
    raise exception 'the organization owner cannot be deactivated';
  end if;

  update public.profiles
  set active = p_active
  where id = p_target_profile_id;

  if p_active then
    update auth.users set banned_until = null, updated_at = now()
    where id = p_target_profile_id;
  else
    update auth.users set banned_until = 'infinity'::timestamptz, updated_at = now()
    where id = p_target_profile_id;
    delete from auth.sessions where user_id = p_target_profile_id;
    delete from auth.refresh_tokens where user_id = p_target_profile_id::text;
  end if;
end;
$$;

-- Called by the client right after supabase.auth.updateUser({ password })
-- succeeds on the forced-change screen.
create function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
end;
$$;
```

- [ ] **Step 4: Register the functions in the clean-slate and grants blocks**

In the drop block near the top of `supabase/SETUP.sql`:

```sql
drop function if exists public.assert_can_manage_user(uuid) cascade;
drop function if exists public.admin_reset_password(uuid, text) cascade;
drop function if exists public.admin_set_user_active(uuid, boolean) cascade;
drop function if exists public.clear_must_change_password() cascade;
```

In the grants block:

```sql
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
```

Note: `assert_can_manage_user` is deliberately NOT granted — it is an internal helper called only from other SECURITY DEFINER functions.

- [ ] **Step 5: Run the tests to verify they pass**

Paste `supabase/SETUP.sql` and Run, then `supabase/TESTS.sql` and Run.
Expected: all `PASS:` notices through Task 3.

Note: the deactivation test asserts `get_login_email` returns null for a deactivated user, which requires the Task 4 change. If that assertion fails here, complete Task 4 Step 3 and re-run — the two tasks are adjacent on purpose.

- [ ] **Step 6: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "feat(db): add password reset, deactivation, and forced-change RPCs

admin_reset_password sets a password without the old one and re-forces a
change. admin_set_user_active bans the auth user and drops their sessions
so a signed-in device is cut off, and refuses to deactivate the owner or
the caller themselves. Authorization is shared through
assert_can_manage_user: owners manage anyone in the org, team leaders
only their own team."
```

---

### Task 4: Extend `get_login_email`, simplify `create_team`, remove `join_organization`

**Files:**
- Modify: `supabase/SETUP.sql` (drop block, `get_login_email` ~line 334, `create_team` ~line 373, remove `join_organization` ~line 299, grants block)
- Modify: `supabase/TESTS.sql` (append new DO block before `rollback;`)

**Interfaces:**
- Consumes: `public.profiles.active` (Task 1); `public.admin_create_user(...)` (Task 2).
- Produces: `public.create_team(p_name text) returns uuid` — signature changed, `p_admin_profile_id` removed. `public.get_login_email(p_org_code text, p_username text) returns text` — now returns NULL for deactivated users. `public.join_organization(...)` no longer exists.

- [ ] **Step 1: Write the failing test**

Append to `supabase/TESTS.sql`, immediately before the final `rollback;`:

```sql
do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_org_id uuid;
  v_org_code text;
  v_team_id uuid;
  v_new_team_id uuid;
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
    'owner4.test@example.com', 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_id)::text, true);
  select org_id, org_code, team_id into v_org_id, v_org_code, v_team_id
  from public.create_organization('Teams Co', 'Owner Four', 'ownerfour');

  -- ── Test: join_organization is gone ──
  if to_regprocedure('public.join_organization(text, uuid, text, text, text)') is not null then
    raise exception 'FAIL: join_organization should have been removed';
  end if;
  raise notice 'PASS: join_organization has been removed';

  -- ── Test: create_team takes only a name now ──
  if to_regprocedure('public.create_team(text, uuid)') is not null then
    raise exception 'FAIL: the old two-argument create_team should have been removed';
  end if;
  v_new_team_id := public.create_team('Night Shift');
  if (select name from public.teams where id = v_new_team_id) <> 'Night Shift' then
    raise exception 'FAIL: create_team did not create the team';
  end if;
  if (select org_id from public.teams where id = v_new_team_id) is distinct from v_org_id then
    raise exception 'FAIL: create_team put the team in the wrong org';
  end if;
  raise notice 'PASS: create_team(p_name) creates a team in the caller''s org';
end;
$$;
```

- [ ] **Step 2: Run the test to verify it fails**

Paste `supabase/TESTS.sql` into the SQL Editor and Run.
Expected: `ERROR: FAIL: join_organization should have been removed`

- [ ] **Step 3: Add the active check to `get_login_email`**

In `supabase/SETUP.sql`, in `get_login_email`, replace the select that resolves the email with:

```sql
  select u.email into v_email
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  join auth.users u on u.id = p.id
  where o.org_code = v_org_code
    and lower(p.username) = v_username
    and coalesce(p.active, true)
  limit 1;
```

- [ ] **Step 4: Replace `create_team`**

In `supabase/SETUP.sql`, replace the whole `create_team` function with:

```sql
-- Team leaders are now created directly through admin_create_user with
-- p_role => 'team_admin', so this no longer promotes an existing profile.
create function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_team_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if v_role is distinct from 'owner' then
    raise exception 'only the org owner can create teams';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a team name is required';
  end if;

  insert into public.teams (org_id, name)
  values (v_org_id, trim(p_name))
  returning id into v_team_id;

  return v_team_id;
end;
$$;
```

- [ ] **Step 5: Remove `join_organization`**

Delete the entire `create function public.join_organization(...) ... $$;` block from `supabase/SETUP.sql` (~lines 299-332).

Also delete its grant line from the grants block:

```sql
grant execute on function public.join_organization(text, uuid, text, text, text) to authenticated;
```

Keep the `drop function if exists public.join_organization(text, uuid, text, text, text) cascade;` line in the clean-slate block — it must stay so re-running the script removes the function from databases that already have it.

Update the `create_team` drop line in the clean-slate block to the new signature, keeping the old one so existing databases get cleaned:

```sql
drop function if exists public.create_team(text, uuid) cascade;
drop function if exists public.create_team(text) cascade;
```

And update the grant to the new signature:

```sql
grant execute on function public.create_team(text) to authenticated;
```

- [ ] **Step 6: Run the tests to verify they pass**

Paste `supabase/SETUP.sql` and Run, then `supabase/TESTS.sql` and Run.
Expected: every `PASS:` notice from Tasks 1-4, no exception. This is the full database test suite green.

- [ ] **Step 7: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "feat(db): block deactivated logins, simplify create_team, drop join_organization

get_login_email now refuses to resolve a deactivated account, so a
banned user cannot even start a sign-in. create_team loses its
admin-promotion argument now that team leaders are created directly
through admin_create_user. Self-service join is removed."
```

---

### Task 5: TypeScript types and `useAuth.tsx`

**Files:**
- Modify: `src/types/index.ts:5-14`
- Modify: `src/hooks/useAuth.tsx` (interface ~line 23-46, `mapProfile` ~line 50-70, remove `lookupOrgByCode`/`joinOrganization` ~line 166-200, add new functions, `useMemo` ~line 219-231)
- Modify: `src/hooks/useOrgData.tsx` (`mapProfile` ~line 31-42, `createTeam` in the interface ~line 60 and its implementation ~line 152)
- Create: `src/lib/password.ts`

**Interfaces:**
- Consumes: `admin_create_user`, `admin_reset_password`, `admin_set_user_active`, `clear_must_change_password`, `create_team(p_name)` (Tasks 2-4).
- Produces:
  - `Profile` gains `mustChangePassword: boolean`, `active: boolean`, `recoveryEmail: string | null`.
  - `generatePassword(): string` in `src/lib/password.ts`.
  - On `useAuth()`: `adminCreateUser(args: { name: string; username: string; password: string; role: 'employee' | 'team_admin'; teamId: string | null; title?: string }) => Promise<string>`, `adminResetPassword(profileId: string, newPassword: string) => Promise<void>`, `adminSetUserActive(profileId: string, active: boolean) => Promise<void>`, `changeOwnPassword(newPassword: string) => Promise<void>`, `addRecoveryEmail(email: string) => Promise<void>`.
  - `lookupOrgByCode` and `joinOrganization` are gone from `useAuth()`.
  - `useOrgData().createTeam` signature narrows to `(name: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

There is no JS test runner in this project; `npm run typecheck` is the type-level test. Write the consumer first so the compiler fails on the missing members. Create `src/lib/password.ts` with only its test consumer for now — instead, add this temporary type assertion at the bottom of `src/types/index.ts`:

```ts
// Temporary compile-time assertion — removed in Step 6 of this task.
const _profileShapeCheck: Pick<Profile, 'mustChangePassword' | 'active' | 'recoveryEmail'> = {
  mustChangePassword: false,
  active: true,
  recoveryEmail: null,
};
void _profileShapeCheck;
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL with `Property 'mustChangePassword' does not exist on type 'Profile'` (and the same for `active`, `recoveryEmail`).

- [ ] **Step 3: Extend the Profile type**

In `src/types/index.ts`, replace the `Profile` interface with:

```ts
export interface Profile {
  id: string; // auth.users.id
  orgId: string;
  teamId: string | null; // null only for an org owner not attached to a team
  name: string;
  title: string | null; // job title, e.g. "IT", "Accountant" — separate from permission role
  username: string | null;
  role: Role;
  /** True until the user picks their own password after an admin created or reset it. */
  mustChangePassword: boolean;
  /** Deactivated accounts cannot sign in. */
  active: boolean;
  /** Optional, added later by the user, only used for password recovery. */
  recoveryEmail: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Write the password generator**

Create `src/lib/password.ts`:

```ts
// Characters that are hard to confuse when an admin reads a password out
// loud or writes it down: no O/0, I/l/1, or similar lookalikes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 10;

/**
 * Generates an initial password for an admin-created account.
 *
 * Math.random is not cryptographically secure, which is acceptable here
 * and only here: this password exists to be read aloud once, used once,
 * and replaced immediately — the forced-change screen blocks the app
 * until the user sets their own. Never reuse this for anything durable.
 */
export function generatePassword(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
```

- [ ] **Step 5: Update `mapProfile` in both hooks**

In `src/hooks/useAuth.tsx`, replace the `mapProfile` function with:

```tsx
function mapProfile(row: {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  title: string | null;
  username: string | null;
  role: Role;
  must_change_password: boolean;
  active: boolean;
  recovery_email: string | null;
  created_at: string;
}): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
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

In `src/hooks/useOrgData.tsx`, replace its `mapProfile` with:

```tsx
function mapProfile(row: any): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
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

- [ ] **Step 6: Remove the temporary assertion**

Delete the `_profileShapeCheck` block added in Step 1 from `src/types/index.ts`.

- [ ] **Step 7: Replace the auth context surface**

In `src/hooks/useAuth.tsx`, delete the `OrgTeamOption` interface (lines 6-12), and replace the `AuthContextValue` interface with:

```tsx
interface AuthContextValue extends AuthState {
  createOrganization: (args: {
    orgName: string;
    ownerName: string;
    username: string;
    email: string;
    password: string;
  }) => Promise<void>;
  /** Sign in with Org ID + username + password — no email retyping. */
  signInWithUsername: (orgCode: string, username: string, password: string) => Promise<void>;
  /** Creates an account for someone else. Returns the new profile id. */
  adminCreateUser: (args: {
    name: string;
    username: string;
    password: string;
    role: 'employee' | 'team_admin';
    teamId: string | null;
    title?: string;
  }) => Promise<string>;
  adminResetPassword: (profileId: string, newPassword: string) => Promise<void>;
  adminSetUserActive: (profileId: string, active: boolean) => Promise<void>;
  /** Used by the forced-change screen; clears mustChangePassword on success. */
  changeOwnPassword: (newPassword: string) => Promise<void>;
  addRecoveryEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}
```

- [ ] **Step 8: Replace the join functions with the admin functions**

In `src/hooks/useAuth.tsx`, delete `lookupOrgByCode` (lines 166-176) and `joinOrganization` (lines 178-200), and add in their place:

```tsx
  const adminCreateUser: AuthContextValue['adminCreateUser'] = async ({
    name,
    username,
    password,
    role,
    teamId,
    title,
  }) => {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_name: name.trim(),
      p_username: username.trim(),
      p_password: password,
      p_role: role,
      p_team_id: teamId,
      p_title: title?.trim() || null,
    });
    if (error) throw error;
    return data as string;
  };

  const adminResetPassword: AuthContextValue['adminResetPassword'] = async (profileId, newPassword) => {
    const { error } = await supabase.rpc('admin_reset_password', {
      p_target_profile_id: profileId,
      p_new_password: newPassword,
    });
    if (error) throw error;
  };

  const adminSetUserActive: AuthContextValue['adminSetUserActive'] = async (profileId, active) => {
    const { error } = await supabase.rpc('admin_set_user_active', {
      p_target_profile_id: profileId,
      p_active: active,
    });
    if (error) throw error;
  };

  const changeOwnPassword: AuthContextValue['changeOwnPassword'] = async (newPassword) => {
    setState((s) => ({ ...s, error: null }));
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;

    const { error: rpcError } = await supabase.rpc('clear_must_change_password');
    if (rpcError) throw rpcError;

    await refreshProfile();
  };

  const addRecoveryEmail: AuthContextValue['addRecoveryEmail'] = async (email) => {
    const trimmed = email.trim();
    // Moves the auth email off the synthetic address so Supabase's built-in
    // password reset can reach a real mailbox.
    const { error: updateError } = await supabase.auth.updateUser({ email: trimmed });
    if (updateError) throw updateError;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ recovery_email: trimmed })
      .eq('id', state.profile?.id ?? '');
    if (profileError) throw profileError;

    await refreshProfile();
  };
```

- [ ] **Step 9: Update the context value**

In `src/hooks/useAuth.tsx`, replace the `useMemo` body with:

```tsx
  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      createOrganization,
      signInWithUsername,
      adminCreateUser,
      adminResetPassword,
      adminSetUserActive,
      changeOwnPassword,
      addRecoveryEmail,
      signOut,
      refreshProfile,
      clearError,
    }),
    [state]
  );
```

- [ ] **Step 10: Narrow `createTeam` in `useOrgData.tsx`**

In `src/hooks/useOrgData.tsx`, change the interface line from `createTeam: (name: string, adminProfileId?: string) => Promise<void>;` to:

```tsx
  createTeam: (name: string) => Promise<void>;
```

and replace the implementation with:

```tsx
  const createTeam = useCallback<OrgDataContextValue['createTeam']>(
    async (name) => {
      const { error } = await supabase.rpc('create_team', { p_name: name });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );
```

- [ ] **Step 11: Run typecheck to verify it passes**

Run: `npm run typecheck`
Expected: PASS with no errors. If it reports errors in `src/app/(auth)/join.tsx` or `src/app/(main)/teams.tsx`, that is expected — those are fixed in Tasks 7 and 9. Note the errors and continue.

- [ ] **Step 12: Commit**

```bash
git add src/types/index.ts src/hooks/useAuth.tsx src/hooks/useOrgData.tsx src/lib/password.ts
git commit -m "feat(auth): swap self-join for admin account management in useAuth

Adds adminCreateUser, adminResetPassword, adminSetUserActive,
changeOwnPassword, and addRecoveryEmail; removes lookupOrgByCode and
joinOrganization. Profile now carries mustChangePassword, active, and
recoveryEmail."
```

---

### Task 6: Forced password change screen and root layout guard

**Files:**
- Create: `src/app/change-password.tsx`
- Modify: `src/app/_layout.tsx:25-45`

**Interfaces:**
- Consumes: `useAuth().changeOwnPassword`, `useAuth().profile.mustChangePassword` (Task 5).
- Produces: route `/change-password`, reachable only while `profile.mustChangePassword` is true.

- [ ] **Step 1: Write the failing test**

Create `scripts/e2e/forced-password-change.js` (create the directory if needed). This drives the real app in a browser, which is how every flow in this project has been verified:

```js
// Verifies that an admin-created account is forced to change its password
// before it can reach the main app, and lands in the app afterwards.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/forced-password-change.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8081/';
const PASSWORD = 'testpass123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `owner${runId % 100000}`;
  const empUsername = `emp${runId % 100000}`;
  const initialPassword = 'initial123';
  const newPassword = 'chosen456';
  let orgCode = null;

  // ── Owner creates the org, then creates an employee account ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });
  const errorsA = [];
  pageA.on('pageerror', (e) => errorsA.push('PAGE ERROR: ' + e.message));

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('PwOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Pw');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`owner-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(PASSWORD);
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  await pageA.getByText('Settings', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  const settingsText = await pageA.locator('body').innerText();
  const idMatch = settingsText.match(/ID:\s*([A-Z0-9]+)/);
  orgCode = idMatch ? idMatch[1] : null;
  if (!orgCode) throw new Error('Could not read the org code from Settings');
  console.log('Org code:', orgCode);

  await pageA.getByText('People', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  await pageA.getByText('Add person', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Forced Change');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(initialPassword);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  console.log('Owner errors:', JSON.stringify(errorsA));
  await ctxA.close();

  // ── The employee signs in and must be sent to the change-password screen ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  const errorsB = [];
  pageB.on('pageerror', (e) => errorsB.push('PAGE ERROR: ' + e.message));

  await pageB.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageB.getByText('Sign in', { exact: true }).click();
  await pageB.waitForTimeout(400);
  await pageB.getByPlaceholder('e.g. 48213', { exact: true }).fill(orgCode);
  await pageB.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageB.getByPlaceholder('Your password', { exact: true }).fill(initialPassword);
  await pageB.getByText('Sign in', { exact: true }).last().click();
  await pageB.waitForTimeout(3500);

  const forcedText = await pageB.locator('body').innerText();
  console.log('After sign-in:', forcedText.slice(0, 200).replace(/\n/g, ' | '));
  if (!/Set your password/i.test(forcedText)) {
    throw new Error('FAIL: expected the forced password change screen, got: ' + forcedText.slice(0, 200));
  }
  console.log('PASS: forced password change screen is shown');

  // ── Setting a new password lets them into the app ──
  await pageB.getByPlaceholder('At least 6 characters', { exact: true }).fill(newPassword);
  await pageB.getByPlaceholder('Re-enter your new password', { exact: true }).fill(newPassword);
  await pageB.getByText('Save password', { exact: true }).last().click();
  await pageB.waitForTimeout(3500);

  const appText = await pageB.locator('body').innerText();
  console.log('After change:', appText.slice(0, 200).replace(/\n/g, ' | '));
  if (/Set your password/i.test(appText)) {
    throw new Error('FAIL: still stuck on the change-password screen');
  }
  if (!/My Tasks/i.test(appText)) {
    throw new Error('FAIL: expected to land in the app, got: ' + appText.slice(0, 200));
  }
  console.log('PASS: landed in the app after changing the password');
  console.log('Employee errors:', JSON.stringify(errorsB));
  await ctxB.close();

  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Start the dev server if it is not already running: `npm run web`
Then run: `node scripts/e2e/forced-password-change.js`
Expected: FAIL — the People tab does not exist yet (Task 7). This test stays red until Task 7 is complete; that is intentional, it is the acceptance test spanning both tasks. Confirm it fails on the People/Add person step, not on org creation.

- [ ] **Step 3: Write the change-password screen**

Create `src/app/change-password.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function ChangePasswordScreen() {
  const c = useThemeColors();
  const { changeOwnPassword, profile } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 6 && password === confirm;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await changeOwnPassword(password);
      // The root layout guard flips automatically once the profile reloads.
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your new password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
          <ScreenTitle>Set your password</ScreenTitle>
          <ScreenSubtitle>
            {profile?.name ? `Welcome, ${profile.name}. ` : ''}
            Your account was set up with a temporary password. Choose your own before you continue.
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label="New password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {tooShort ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>
              Use at least 6 characters.
            </Text>
          ) : null}

          <FieldInput
            label="Confirm new password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
          {mismatch ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>
              Those passwords do not match.
            </Text>
          ) : null}

          <View style={{ height: 8 }} />
          <PrimaryButton title="Save password" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: Add the guard to the root layout**

In `src/app/_layout.tsx`, replace the `RootNavigator` function with:

```tsx
function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const { isDark } = useThemePref();

  if (loading) return null;

  const signedInWithOrg = !!session && !!profile;
  // An admin-created account (or one whose password an admin just reset)
  // cannot reach the app until it picks its own password.
  const needsPasswordChange = signedInWithOrg && !!profile?.mustChangePassword;

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedInWithOrg}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={needsPasswordChange}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={signedInWithOrg && !needsPasswordChange}>
          <Stack.Screen name="(main)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors from `change-password.tsx` or `_layout.tsx`. Pre-existing errors in `join.tsx` and `teams.tsx` remain until Tasks 7 and 9.

- [ ] **Step 6: Commit**

```bash
git add src/app/change-password.tsx src/app/_layout.tsx scripts/e2e/forced-password-change.js
git commit -m "feat(auth): force a password change on first login

Adds the change-password screen and gates it behind a third
Stack.Protected branch, so an admin-created account cannot reach the
main tabs until it sets its own password. Adds the end-to-end test that
covers the whole provisioned-account journey."
```

---

### Task 7: People screen — create a user and show the credentials once

**Files:**
- Create: `src/app/(main)/people.tsx`
- Create: `src/components/CreateUserSheet.tsx`
- Modify: `src/app/(main)/_layout.tsx:22-50`

**Interfaces:**
- Consumes: `useAuth().adminCreateUser`, `generatePassword()` (Task 5); `useOrgData().members`, `useOrgData().teams`.
- Produces: route `/(main)/people` shown as a "People" tab to `owner` and `team_admin` only; `CreateUserSheet` component with props `{ visible: boolean; onClose: () => void }`.

- [ ] **Step 1: Write the failing test**

The acceptance test is `scripts/e2e/forced-password-change.js` from Task 6, which already drives the People tab and the create form. No new test file — this task turns that test green.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/e2e/forced-password-change.js`
Expected: FAIL on the `People` tab lookup, because the tab does not exist yet.

- [ ] **Step 3: Write the create-user sheet**

Create `src/components/CreateUserSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { generatePassword } from '@/lib/password';
import {
  Card,
  FieldInput,
  FieldLabel,
  UsernameInput,
  PrimaryButton,
  SecondaryButton,
  ErrorBanner,
  useThemeColors,
} from '@/components/ui';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CreateUserSheet({ visible, onClose }: Props) {
  const c = useThemeColors();
  const { profile, adminCreateUser } = useAuth();
  const { teams, refresh } = useOrgData();

  const isOwner = profile?.role === 'owner';

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [role, setRole] = useState<'employee' | 'team_admin'>('employee');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the account exists — the only time the password is ever shown.
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // A team leader can only ever create employees on their own team, so lock
  // those two fields to their own values whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    if (!isOwner) {
      setRole('employee');
      setTeamId(profile?.teamId ?? null);
    }
  }, [visible, isOwner, profile?.teamId]);

  const reset = () => {
    setName('');
    setTitle('');
    setUsername('');
    setPassword(generatePassword());
    setRole('employee');
    setTeamId(isOwner ? null : (profile?.teamId ?? null));
    setError(null);
    setCreated(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit = name.trim().length > 0 && username.trim().length > 0 && password.length >= 6;

  const handleCreate = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await adminCreateUser({
        name,
        username,
        password,
        role,
        teamId,
        title,
      });
      setCreated({ username: username.trim(), password });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create this account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    await Clipboard.setStringAsync(`Username: ${created.username}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
              maxHeight: '90%',
            }}
          >
            {created ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 4 }}>Account created</Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 16 }}>
                  Write these down or copy them now — the password is not shown again. They will be asked to choose
                  their own password the first time they sign in.
                </Text>

                <Card style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>Username</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 10 }}>
                    {created.username}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>Temporary password</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>{created.password}</Text>
                </Card>

                <Pressable
                  onPress={handleCopy}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 14,
                    paddingVertical: 14,
                    marginBottom: 10,
                  }}
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={c.text} />
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
                    {copied ? 'Copied' : 'Copy username and password'}
                  </Text>
                </Pressable>

                <PrimaryButton title="Done" onPress={handleClose} />
              </ScrollView>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>New person</Text>
                  <Pressable onPress={handleClose} hitSlop={8}>
                    <Ionicons name="close" size={24} color={c.textMuted} />
                  </Pressable>
                </View>

                {error ? <ErrorBanner message={error} /> : null}

                <FieldInput label="Their name" placeholder="e.g. Ali" value={name} onChangeText={setName} />
                <FieldInput
                  label="Job title (optional)"
                  placeholder="e.g. IT, Accountant, Cashier"
                  value={title}
                  onChangeText={setTitle}
                />
                <UsernameInput value={username} onChangeText={setUsername} />

                <FieldLabel>Temporary password</FieldLabel>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <FieldInput
                      placeholder="At least 6 characters"
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                    />
                  </View>
                  <Pressable
                    onPress={() => setPassword(generatePassword())}
                    style={{
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 14,
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                      backgroundColor: c.card,
                    }}
                  >
                    <Ionicons name="refresh" size={18} color={c.text} />
                  </Pressable>
                </View>

                {isOwner ? (
                  <>
                    <FieldLabel>Role</FieldLabel>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                      {(
                        [
                          { key: 'employee', label: 'Employee' },
                          { key: 'team_admin', label: 'Team leader' },
                        ] as { key: 'employee' | 'team_admin'; label: string }[]
                      ).map((opt) => {
                        const active = role === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => setRole(opt.key)}
                            style={{
                              flex: 1,
                              alignItems: 'center',
                              paddingVertical: 12,
                              borderRadius: 12,
                              backgroundColor: active ? c.indigo : c.bgSubtle,
                              borderWidth: 1,
                              borderColor: active ? c.indigo : c.border,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <FieldLabel>Team</FieldLabel>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      <Pressable
                        onPress={() => setTeamId(null)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: teamId === null ? c.indigo : c.bgSubtle,
                          borderWidth: 1,
                          borderColor: teamId === null ? c.indigo : c.border,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: teamId === null ? '#fff' : c.text }}>
                          No team
                        </Text>
                      </Pressable>
                      {teams.map((t) => {
                        const active = teamId === t.id;
                        return (
                          <Pressable
                            key={t.id}
                            onPress={() => setTeamId(t.id)}
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
                              {t.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
                    They will join your team as an employee.
                  </Text>
                )}

                <PrimaryButton title="Create account" onPress={handleCreate} loading={loading} disabled={!canSubmit} />
                <View style={{ height: 10 }} />
                <SecondaryButton title="Cancel" onPress={handleClose} />
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Write the People screen**

Create `src/app/(main)/people.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { CreateUserSheet } from '@/components/CreateUserSheet';
import { Card, useThemeColors } from '@/components/ui';
import { initials } from '@/lib/taskUtils';
import type { Profile } from '@/types';

function roleLabel(role: Profile['role']): string {
  if (role === 'owner') return 'Admin';
  if (role === 'team_admin') return 'Team leader';
  return 'Employee';
}

export default function PeopleScreen() {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { members, teams } = useOrgData();
  const [creating, setCreating] = useState(false);

  const isOwner = profile?.role === 'owner';
  // An owner manages the whole org; a team leader only their own team.
  const visible = isOwner ? members : members.filter((m) => m.teamId === profile?.teamId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>People</Text>
          <Pressable
            onPress={() => setCreating(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: c.indigo,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Add person</Text>
          </Pressable>
        </View>

        {visible.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint }}>
            No one here yet. Tap "Add person" to create an account and hand them the username and password.
          </Text>
        ) : null}

        {visible.map((m) => {
          const team = teams.find((t) => t.id === m.teamId);
          return (
            <Card key={m.id} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: m.active ? c.indigo : c.textFaint,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{initials(m.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{m.name}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                    {m.username ? `@${m.username} • ` : ''}
                    {roleLabel(m.role)}
                    {team ? ` • ${team.name}` : ''}
                  </Text>
                </View>
                {!m.active ? (
                  <Text style={{ fontSize: 10, fontWeight: '700', color: c.rose }}>INACTIVE</Text>
                ) : m.mustChangePassword ? (
                  <Text style={{ fontSize: 10, fontWeight: '700', color: c.textFaint }}>NEW</Text>
                ) : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <CreateUserSheet visible={creating} onClose={() => setCreating(false)} />
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Add the People tab**

In `src/app/(main)/_layout.tsx`, add this `Tabs.Screen` between the `teams` and `create-task` entries:

```tsx
        <Tabs.Screen
          name="people"
          options={{
            title: 'People',
            // Employees have no one to manage, so the tab is hidden for them.
            href: isEmployee ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="person-add" size={size} color={color} />,
          }}
        />
```

- [ ] **Step 6: Run typecheck and the end-to-end test to verify they pass**

Run: `npm run typecheck`
Expected: no errors from `people.tsx` or `CreateUserSheet.tsx`.

Run: `node scripts/e2e/forced-password-change.js`
Expected: `PASS: forced password change screen is shown`, `PASS: landed in the app after changing the password`, `ALL PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(main\)/people.tsx src/app/\(main\)/_layout.tsx src/components/CreateUserSheet.tsx
git commit -m "feat(people): add the People tab and admin account creation

Owners see everyone in the org and can pick role and team; team leaders
see only their own team and can only add employees, with both fields
locked. The generated password is shown exactly once, with a copy
button, since it is never recoverable afterwards."
```

---

### Task 8: Manage an existing user — reset password and deactivate

**Files:**
- Create: `src/components/ManageUserSheet.tsx`
- Modify: `src/app/(main)/people.tsx` (make the member cards tappable)

**Interfaces:**
- Consumes: `useAuth().adminResetPassword`, `useAuth().adminSetUserActive` (Task 5); `useOrgData().refresh`.
- Produces: `ManageUserSheet` component with props `{ member: Profile | null; onClose: () => void }` — renders nothing when `member` is null.

- [ ] **Step 1: Write the failing test**

Create `scripts/e2e/manage-user.js`:

```js
// Verifies that an admin can reset a user's password and deactivate them,
// and that both changes take effect at sign-in.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/manage-user.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8081/';

async function signIn(page, orgCode, username, password) {
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByText('Sign in', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('e.g. 48213', { exact: true }).fill(orgCode);
  await page.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(username);
  await page.getByPlaceholder('Your password', { exact: true }).fill(password);
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForTimeout(3500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `mgro${runId % 100000}`;
  const empUsername = `mgre${runId % 100000}`;
  const ownerPassword = 'testpass123';
  const initialPassword = 'initial123';
  const resetPassword = 'wasreset789';

  // ── Owner creates an org and an employee ──
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.setViewportSize({ width: 420, height: 900 });

  await pageA.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.getByText('Create an organization').click();
  await pageA.waitForTimeout(400);
  await pageA.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('MgOrg ' + runId);
  await pageA.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Mg');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await pageA.getByPlaceholder('you@example.com', { exact: true }).fill(`ownermg-${runId}@example.com`);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(ownerPassword);
  await pageA.getByText('Create organization', { exact: true }).last().click();
  await pageA.waitForTimeout(3000);

  await pageA.getByText('Settings', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  const idMatch = (await pageA.locator('body').innerText()).match(/ID:\s*([A-Z0-9]+)/);
  const orgCode = idMatch ? idMatch[1] : null;
  if (!orgCode) throw new Error('Could not read the org code');
  console.log('Org code:', orgCode);

  await pageA.getByText('People', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  await pageA.getByText('Add person', { exact: true }).last().click();
  await pageA.waitForTimeout(500);
  await pageA.getByPlaceholder('e.g. Ali', { exact: true }).fill('Managed User');
  await pageA.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(empUsername);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(initialPassword);
  await pageA.getByText('Create account', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  await pageA.getByText('Done', { exact: true }).last().click();
  await pageA.waitForTimeout(800);

  // ── Owner resets that user's password ──
  await pageA.getByText('Managed User', { exact: true }).last().click();
  await pageA.waitForTimeout(600);
  await pageA.getByPlaceholder('At least 6 characters', { exact: true }).fill(resetPassword);
  await pageA.getByText('Set new password', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  const afterReset = await pageA.locator('body').innerText();
  if (!/Password updated/i.test(afterReset)) {
    throw new Error('FAIL: expected a password-updated confirmation, got: ' + afterReset.slice(0, 200));
  }
  console.log('PASS: admin reset the password');

  // ── The reset password works and still forces a change ──
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewportSize({ width: 420, height: 900 });
  await signIn(pageB, orgCode, empUsername, resetPassword);
  const bText = await pageB.locator('body').innerText();
  if (!/Set your password/i.test(bText)) {
    throw new Error('FAIL: a reset password should still force a change, got: ' + bText.slice(0, 200));
  }
  console.log('PASS: the reset password works and forces a change');
  await ctxB.close();

  // ── Owner deactivates the user ──
  await pageA.getByText('Deactivate account', { exact: true }).last().click();
  await pageA.waitForTimeout(2500);
  const afterDeactivate = await pageA.locator('body').innerText();
  if (!/INACTIVE/i.test(afterDeactivate)) {
    throw new Error('FAIL: the user should be shown as inactive, got: ' + afterDeactivate.slice(0, 300));
  }
  console.log('PASS: the user shows as inactive');

  // ── A deactivated user cannot sign in ──
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.setViewportSize({ width: 420, height: 900 });
  await signIn(pageC, orgCode, empUsername, resetPassword);
  const cText = await pageC.locator('body').innerText();
  if (!/No account found/i.test(cText)) {
    throw new Error('FAIL: a deactivated user should not be able to sign in, got: ' + cText.slice(0, 200));
  }
  console.log('PASS: a deactivated user cannot sign in');
  await ctxC.close();

  await ctxA.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/e2e/manage-user.js`
Expected: FAIL — tapping the member card does nothing, so the "Set new password" field is never found.

- [ ] **Step 3: Write the manage-user sheet**

Create `src/components/ManageUserSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { generatePassword } from '@/lib/password';
import {
  FieldInput,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  ErrorBanner,
  useThemeColors,
} from '@/components/ui';
import type { Profile } from '@/types';

interface Props {
  member: Profile | null;
  onClose: () => void;
}

export function ManageUserSheet({ member, onClose }: Props) {
  const c = useThemeColors();
  const { profile, adminResetPassword, adminSetUserActive } = useAuth();
  const { refresh } = useOrgData();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
    setNotice(null);
  }, [member?.id]);

  if (!member) return null;

  // The owner is never deactivatable, and nobody can deactivate themselves.
  const canDeactivate = member.role !== 'owner' && member.id !== profile?.id;

  const handleReset = async () => {
    if (password.length < 6 || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await adminResetPassword(member.id, password);
      await refresh();
      setNotice(`Password updated. Give ${member.name} the new password — they will be asked to choose their own.`);
      setPassword('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not reset that password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const applyActive = async (next: boolean) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await adminSetUserActive(member.id, next);
      await refresh();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not update that account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = () => {
    if (member.active) {
      Alert.alert(
        'Deactivate account',
        `${member.name} will be signed out and will not be able to sign in again until you reactivate them.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deactivate', style: 'destructive', onPress: () => applyActive(false) },
        ]
      );
    } else {
      applyActive(true);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
              maxHeight: '90%',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{member.name}</Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Ionicons name="close" size={24} color={c.textMuted} />
                </Pressable>
              </View>
              <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 18 }}>
                {member.username ? `@${member.username}` : 'No username'}
                {member.active ? '' : ' • inactive'}
              </Text>

              {error ? <ErrorBanner message={error} /> : null}
              {notice ? (
                <View style={{ backgroundColor: c.indigoSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: c.indigo, fontSize: 13 }}>{notice}</Text>
                </View>
              ) : null}

              <FieldLabel>Set new password</FieldLabel>
              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 8 }}>
                Use this when they forget their password. You do not need their old one.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <FieldInput
                    placeholder="At least 6 characters"
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                  />
                </View>
                <Pressable
                  onPress={() => setPassword(generatePassword())}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    backgroundColor: c.card,
                  }}
                >
                  <Ionicons name="refresh" size={18} color={c.text} />
                </Pressable>
              </View>

              <PrimaryButton
                title="Set new password"
                onPress={handleReset}
                loading={loading}
                disabled={password.length < 6}
              />

              {canDeactivate ? (
                <>
                  <View style={{ height: 20 }} />
                  <Pressable
                    onPress={handleToggleActive}
                    disabled={loading}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      borderWidth: 1,
                      borderColor: member.active ? c.roseSoft : c.border,
                      backgroundColor: member.active ? c.roseSoft : 'transparent',
                      borderRadius: 14,
                      paddingVertical: 14,
                      opacity: loading ? 0.5 : 1,
                    }}
                  >
                    <Ionicons
                      name={member.active ? 'ban-outline' : 'checkmark-circle-outline'}
                      size={18}
                      color={member.active ? c.rose : c.text}
                    />
                    <Text style={{ color: member.active ? c.rose : c.text, fontWeight: '700', fontSize: 15 }}>
                      {member.active ? 'Deactivate account' : 'Reactivate account'}
                    </Text>
                  </Pressable>
                </>
              ) : null}

              <View style={{ height: 10 }} />
              <SecondaryButton title="Close" onPress={onClose} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Make the member cards open the sheet**

In `src/app/(main)/people.tsx`, add the import and state, wrap each card in a `Pressable`, and render the sheet.

Add to the imports:

```tsx
import { ManageUserSheet } from '@/components/ManageUserSheet';
```

Add next to the existing `creating` state:

```tsx
  const [managing, setManaging] = useState<Profile | null>(null);
```

Replace the `visible.map(...)` block with:

```tsx
        {visible.map((m) => {
          const team = teams.find((t) => t.id === m.teamId);
          return (
            <Pressable key={m.id} onPress={() => setManaging(m)}>
              <Card style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: m.active ? c.indigo : c.textFaint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{initials(m.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{m.name}</Text>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                      {m.username ? `@${m.username} • ` : ''}
                      {roleLabel(m.role)}
                      {team ? ` • ${team.name}` : ''}
                    </Text>
                  </View>
                  {!m.active ? (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: c.rose }}>INACTIVE</Text>
                  ) : m.mustChangePassword ? (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: c.textFaint }}>NEW</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </View>
              </Card>
            </Pressable>
          );
        })}
```

Replace the closing `<CreateUserSheet ... />` line with both sheets:

```tsx
      <CreateUserSheet visible={creating} onClose={() => setCreating(false)} />
      <ManageUserSheet member={managing} onClose={() => setManaging(null)} />
```

- [ ] **Step 5: Run typecheck and the test to verify they pass**

Run: `npm run typecheck`
Expected: no errors.

Run: `node scripts/e2e/manage-user.js`
Expected: all four `PASS:` lines and `ALL PASS`.

Note: the deactivation step uses `Alert.alert`, which on web renders as a native `confirm` dialog. If Playwright stalls there, add `page.on('dialog', (d) => d.accept());` after creating `pageA` in the test.

- [ ] **Step 6: Commit**

```bash
git add src/components/ManageUserSheet.tsx src/app/\(main\)/people.tsx scripts/e2e/manage-user.js
git commit -m "feat(people): reset passwords and deactivate accounts

Tapping a person opens a sheet to set a new password without knowing the
old one, or to deactivate them, which signs them out and blocks
sign-in. The owner and the acting user themselves cannot be deactivated."
```

---

### Task 9: Remove self-service join, add recovery email, verify end to end

**Files:**
- Delete: `src/app/(auth)/join.tsx`
- Modify: `src/app/(auth)/index.tsx:33-51`
- Modify: `src/app/(main)/teams.tsx` (drop the admin-promotion UI)
- Modify: `src/app/(main)/settings.tsx` (add the recovery email card)
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: `useAuth().addRecoveryEmail` (Task 5); `useOrgData().createTeam(name)` (Task 5).
- Produces: no `/(auth)/join` route; landing screen with two choices instead of three.

- [ ] **Step 1: Write the failing test**

Create `scripts/e2e/no-self-join.js`:

```js
// Verifies that self-service joining is gone and that a signed-in user can
// add a recovery email.
//
// Prereq: `npm run web` is running on http://localhost:8081/.
// Run: node scripts/e2e/no-self-join.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:8081/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const runId = Date.now();
  const ownerUsername = `njo${runId % 100000}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 420, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));

  // ── The landing screen no longer offers self-service join ──
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const landing = await page.locator('body').innerText();
  if (/Join an organization/i.test(landing)) {
    throw new Error('FAIL: the landing screen still offers "Join an organization"');
  }
  console.log('PASS: the landing screen no longer offers self-service join');

  // ── The route itself is gone ──
  await page.goto(TARGET_URL + '(auth)/join', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  const joinRoute = await page.locator('body').innerText();
  if (/Choose your team leader/i.test(joinRoute) || /Enter the Organization ID your admin shared/i.test(joinRoute)) {
    throw new Error('FAIL: the join screen is still reachable directly');
  }
  console.log('PASS: the join route is gone');

  // ── A signed-in owner can add a recovery email ──
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByText('Create an organization').click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('e.g. Basra Retail Co.', { exact: true }).fill('NjOrg ' + runId);
  await page.getByPlaceholder('e.g. Ahmed', { exact: true }).fill('Owner Nj');
  await page.getByPlaceholder('e.g. ahmed_h', { exact: true }).fill(ownerUsername);
  await page.getByPlaceholder('you@example.com', { exact: true }).fill(`ownernj-${runId}@example.com`);
  await page.getByPlaceholder('At least 6 characters', { exact: true }).fill('testpass123');
  await page.getByText('Create organization', { exact: true }).last().click();
  await page.waitForTimeout(3000);

  await page.getByText('Settings', { exact: true }).last().click();
  await page.waitForTimeout(600);
  const settings = await page.locator('body').innerText();
  if (!/Recovery email/i.test(settings)) {
    throw new Error('FAIL: Settings has no recovery email section, got: ' + settings.slice(0, 300));
  }
  console.log('PASS: Settings offers a recovery email field');

  console.log('Errors:', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
  console.log('ALL PASS');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/e2e/no-self-join.js`
Expected: `FAIL: the landing screen still offers "Join an organization"`

- [ ] **Step 3: Delete the join screen and its landing entry**

Delete the file:

```bash
git rm src/app/\(auth\)/join.tsx
```

In `src/app/(auth)/index.tsx`, delete the second `ChoiceRow` and the spacer above it, so the block reads:

```tsx
        <ChoiceRow
          icon="business"
          title="Create an organization"
          subtitle="You'll be the owner, create teams, and add people."
          onPress={() => router.push('/(auth)/create')}
        />

        <Pressable onPress={() => router.push('/(auth)/signin')} style={{ marginTop: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: c.textMuted }}>
            Already have an account? <Text style={{ color: c.indigo, fontWeight: '700' }}>Sign in</Text>
          </Text>
        </Pressable>
```

- [ ] **Step 4: Drop the admin-promotion UI from the Teams screen**

`create_team` no longer takes an admin id (Task 4). In `src/app/(main)/teams.tsx`:

Remove the `adminId` state line and the `unassignedAsAdmin` line. Change `handleCreate` to:

```tsx
  const handleCreate = async () => {
    if (!newTeamName.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createTeam(newTeamName.trim());
      setNewTeamName('');
      setCreating(false);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create team.');
    } finally {
      setLoading(false);
    }
  };
```

Delete the whole `{unassignedAsAdmin.length > 0 ? (...) : null}` block from the modal, and replace it with a hint pointing at the new flow:

```tsx
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              After you create the team, add its leader from the People tab.
            </Text>
```

Then remove `FieldLabel` from the `@/components/ui` import if nothing else on the screen uses it.

- [ ] **Step 5: Add the recovery email card to Settings**

In `src/app/(main)/settings.tsx`, add `useState` imports as needed and this card immediately after the Organization card. Add to the existing destructure: `const { profile, organization, team, signOut, addRecoveryEmail } = useAuth();`

Add these state lines next to `copied`:

```tsx
  const [recoveryEmail, setRecoveryEmail] = useState(profile?.recoveryEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
```

Add this handler next to `handleCopy`:

```tsx
  const handleSaveEmail = async () => {
    const trimmed = recoveryEmail.trim();
    if (!trimmed || savingEmail) return;
    setSavingEmail(true);
    setEmailNotice(null);
    setEmailError(null);
    try {
      await addRecoveryEmail(trimmed);
      setEmailNotice('Saved. You can use this address to reset your password if you forget it.');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Could not save that email. Please try again.');
    } finally {
      setSavingEmail(false);
    }
  };
```

Add this card after the Organization card:

```tsx
        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
            Recovery email
          </Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
            Optional. Without one, only your admin can reset your password for you.
          </Text>
          {emailError ? <ErrorBanner message={emailError} /> : null}
          {emailNotice ? (
            <View style={{ backgroundColor: c.indigoSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: c.indigo, fontSize: 13 }}>{emailNotice}</Text>
            </View>
          ) : null}
          <FieldInput
            placeholder="you@example.com"
            value={recoveryEmail}
            onChangeText={setRecoveryEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <PrimaryButton
            title="Save recovery email"
            onPress={handleSaveEmail}
            loading={savingEmail}
            disabled={!recoveryEmail.trim() || recoveryEmail.trim() === (profile?.recoveryEmail ?? '')}
          />
        </Card>
```

Update the `@/components/ui` import on that screen to include what the card uses:

```tsx
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
```

- [ ] **Step 6: Run the full verification suite**

Run: `npm run typecheck`
Expected: PASS, zero errors across the whole project.

Paste `supabase/SETUP.sql` into the SQL Editor and Run, then `supabase/TESTS.sql` and Run.
Expected: every `PASS:` notice, no exception.

Then run all three end-to-end tests against a running `npm run web`:

```bash
node scripts/e2e/forced-password-change.js
node scripts/e2e/manage-user.js
node scripts/e2e/no-self-join.js
```

Expected: `ALL PASS` from each.

- [ ] **Step 7: Update the roadmap**

In `ROADMAP.md`, replace the "Now building" section with:

```markdown
## Done: Admin-provisioned signup & login

Employees no longer self-register. Owners create accounts for anyone in the
org (choosing role and team); team leaders create employees on their own team
only. Every admin-created account is forced to pick its own password on first
login. Admins can reset any password without the old one and deactivate
accounts, which signs the user out and blocks sign-in. Recovery email is
optional and added by the user from Settings.

## Now building: nothing — pick the next milestone
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): remove self-service join and add recovery email

Deletes the join screen and its landing entry now that accounts are
provisioned by admins. Teams lose the admin-promotion picker, since team
leaders are created directly from the People tab. Settings gains an
optional recovery email so a user can self-reset later instead of
depending on an admin."
```

---

## Verification Summary

After Task 9, all of the following should be green:

| Layer | Command | Expected |
|---|---|---|
| Types | `npm run typecheck` | no errors |
| Database | paste `supabase/SETUP.sql` then `supabase/TESTS.sql` in SQL Editor | every `PASS:`, no exception |
| Forced change | `node scripts/e2e/forced-password-change.js` | `ALL PASS` |
| User management | `node scripts/e2e/manage-user.js` | `ALL PASS` |
| Join removed | `node scripts/e2e/no-self-join.js` | `ALL PASS` |
