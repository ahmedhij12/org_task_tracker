# Admin-Provisioned Accounts & Login — Design Spec

Status: draft, awaiting approval
Author: Claude, from requirements gathered with the project owner
Date: 2026-08-17
Parked in favor of this: [ROADMAP.md](../../../ROADMAP.md) — task-completion photo/history work

## 1. Problem

Employees currently self-register through `src/app/(auth)/join.tsx`: they enter the
org's numeric ID, pick a team, and choose their own name/username/email/password. The
org wants this replaced with admin- and team-leader-provisioned accounts: an admin (or
a team leader, scoped to their own team) creates the account and hands the employee a
username + password out of band. No email is collected at creation. The employee must
change their password on first login. Admins can force-reset any user's password.

## 2. Key technical constraint

The existing account-creation RPCs (`create_organization`, `join_organization`) work
because the **client** already called `supabase.auth.signUp()` before invoking the RPC
— the `auth.users` row exists first, and the RPC just attaches a `profiles` row to
`auth.uid()`. That doesn't work here: the employee isn't present when their account is
created, so there is no client session to call `signUp()` from.

The admin's RPC must create the `auth.users` row itself, server-side, with a password
the admin chooses/generates — not through `supabase.auth.signUp()`.

**Recommended approach:** insert directly into `auth.users` (and `auth.identities`)
from a `SECURITY DEFINER` Postgres function, hashing the password with `pgcrypto`'s
`crypt(password, gen_salt('bf'))` — the same bcrypt implementation Supabase's GoTrue
uses to verify passwords, so the resulting account logs in normally through the
standard `signInWithPassword` flow. This matches the brief's constraint ("Supabase Auth
not involved in user creation... managed through Postgres + custom RPC, as today") and
needs no new infrastructure.

**Flagging the real trade-off:** this touches `auth.*` tables directly, which is an
unofficial, undocumented pattern — it works today but isn't guaranteed stable across
Supabase platform upgrades, since GoTrue owns that schema. The officially-supported
alternative is a Supabase Edge Function using the `service_role` key and
`supabase.auth.admin.createUser()` — more robust, but it's new infrastructure (this
project currently has none — no backend beyond the Postgres RPCs) and a bigger lift.
**Recommendation: build the direct-SQL version now** (it's consistent with how this app
already works and ships faster); keep the Edge Function approach in your back pocket if
you ever hit a Supabase upgrade that breaks it.

## 3. Recommendations on the open questions

| Question | Recommendation | Why |
|---|---|---|
| Remove self-join screen? | **Remove it** (delete `join.tsx`, drop `join_organization` RPC) rather than keep both paths live. | Two divergent account-creation flows double the auth surface area and RLS/RPC logic to maintain for a feature the org no longer wants used. Fully recoverable from git history if ever needed. |
| Can admins create another owner? | **No** — only `team_admin` and `employee` via this flow. | `organizations.owner_id` is a single FK and every "owner-only" RLS policy assumes exactly one owner per org. Multi-owner is a materially bigger schema change, out of scope here. |
| Admin types password vs. system-generates? | **Both** — generate a strong default (shown once, copyable), but let the admin overwrite it. | Some admins want a memorable password for low-tech staff; auto-generation is the safer default. Enforce the same "6+ characters" minimum used elsewhere in the app. |
| User deactivation? | **Yes, add it now** — small addition, closes an obvious gap. | Without it, a departed employee's credentials work forever with no way to revoke them short of an admin password reset the employee would immediately notice. |

## 4. Data model changes

```sql
alter table public.profiles
  add column must_change_password boolean not null default false,
  add column active boolean not null default true,
  add column recovery_email text;
```

- `must_change_password` — set `true` whenever an admin creates an account or resets a
  password. The app blocks navigation into the main tabs until it's cleared.
- `active` — deactivated accounts fail login (`get_login_email` excludes them) and are
  banned at the `auth.users` level too (`banned_until` set far in the future), so even a
  cached session can't slip through.
- `recovery_email` — **not** the same as `auth.users.email`. The auth email stays a
  permanently synthetic address (see §5); `recovery_email` is what the user optionally
  adds later from their profile. When they add one, the app calls
  `supabase.auth.updateUser({ email: recoveryEmail })` directly (a standard, already
  -supported client call — no custom RPC needed) which updates `auth.users.email` to
  the real address. From that point, Supabase's built-in `resetPasswordForEmail` works
  unmodified. Username-based login is unaffected either way, since `get_login_email`
  resolves username → whatever `auth.users.email` currently is.

No changes needed to `organizations`, `teams`, or `tasks`.

## 5. RPCs

### `admin_create_user`

```sql
create function public.admin_create_user(
  p_name text,
  p_username text,
  p_password text,
  p_role text default 'employee',       -- 'employee' | 'team_admin'
  p_team_id uuid default null,
  p_title text default null
)
returns uuid  -- new profile id
language plpgsql security definer set search_path = public as $$
```

Behavior:
- Caller must be `owner` (any team, or none) or `team_admin` (only their own
  `p_team_id`, and only `p_role = 'employee'` — a team leader cannot create another
  team leader or promote anyone to owner).
- Validate `p_role in ('employee', 'team_admin')` — `'owner'` is never accepted here.
- Validate username uniqueness within the org (reuses the existing
  `profiles_org_username_unique_idx`).
- Build a synthetic email: `lower(p_username) || '.' || v_org_code || '@users.orgtasks.internal'`
  — globally unique because `org_code` is globally unique and username is unique
  per-org, so no collision risk across orgs.
- Insert into `auth.users` (id, instance_id, aud/role = 'authenticated', email,
  `encrypted_password = crypt(p_password, gen_salt('bf'))`, `email_confirmed_at = now()`
  so it's usable immediately, empty-string token columns per GoTrue's expectations) and
  a matching `auth.identities` row for the `email` provider (GoTrue's password grant
  checks identities as well as `users` on current schema versions — skipping this is a
  common cause of "works in SQL, fails to log in" bugs with this pattern).
- Insert into `public.profiles` with `must_change_password = true`, `active = true`.
- Returns the new profile id. The generated/typed password is never stored in plaintext
  anywhere — the caller (client) already has it in memory to display once.

### `admin_reset_password(p_target_profile_id uuid, p_new_password text)`

- Caller must be `owner` (any profile in org) or `team_admin` (only profiles on their
  own team).
- Updates `auth.users.encrypted_password` for the target.
- Sets `profiles.must_change_password = true` again — a reset always forces a change on
  next login, same as initial creation.

### `admin_set_user_active(p_target_profile_id uuid, p_active boolean)`

- Same authorization shape as the reset RPC.
- Sets `profiles.active`; when deactivating, also sets
  `auth.users.banned_until = 'infinity'::timestamptz` on the target (and clears it back
  to `null` on reactivate) so an already-cached client session is rejected too, not just
  future logins.

### `clear_must_change_password()`

- No arguments — operates on `auth.uid()`. Called after the client successfully calls
  `supabase.auth.updateUser({ password: newPassword })` on the forced-change screen.
  Sets `profiles.must_change_password = false`.

### `get_login_email` — extend existing function

Add `and coalesce(p.active, true)` to the `where` clause so a deactivated account
can't even resolve to an email to attempt sign-in (defense in depth alongside the
`banned_until` check GoTrue itself enforces).

### `create_team` — simplify

Drop the `p_admin_profile_id` parameter (which today promotes an *existing* profile to
lead a team). New shape: `create_team(p_name text) returns uuid`. Creating a team
leader becomes a normal `admin_create_user(..., p_role => 'team_admin', p_team_id =>
<new team id>)` call — one account-creation path for every role, instead of two.

### Remove

- `join_organization` and its RLS/UI dependents (`src/app/(auth)/join.tsx`, the
  `joinOrganization` function in `useAuth.tsx`).

## 6. `useAuth.tsx` changes

- Remove `lookupOrgByCode` / `joinOrganization` (self-join only).
- Add `adminCreateUser(args)` → calls `admin_create_user`, returns
  `{ username, password }` for the confirmation screen to display.
- Add `adminResetPassword(profileId, newPassword)` → calls `admin_reset_password`.
- Add `adminSetUserActive(profileId, active)` → calls `admin_set_user_active`.
- Add `changeOwnPassword(newPassword)` → `supabase.auth.updateUser({ password: newPassword })`
  then `supabase.rpc('clear_must_change_password')`, then `refreshProfile()`.
- Add `addRecoveryEmail(email)` → `supabase.auth.updateUser({ email })`; on success,
  also stores it in `profiles.recovery_email` via a trivial self-update (already allowed
  by the existing "users can update their own display name" policy's `with check`,
  since that policy doesn't restrict which columns beyond org/role/team integrity).
- `signInWithUsername` stays as-is mechanically; after `refreshProfile()`, the root
  layout's protected-route guard additionally checks `profile.must_change_password` and
  redirects to the forced-change screen if true (same pattern already used for the
  signed-in/signed-out split).

## 7. UI flow

1. **Create Team** (admin only) — name field only. Existing screen, simplified.
2. **Create User** (admin or team_admin) — name, job title (optional), username,
   password (pre-filled with a generated one + "Regenerate" button, editable, 6-char
   minimum validated live), role picker (Employee / Team Leader — Team Leader option
   hidden for team_admin callers), team picker (dropdown of the org's teams plus "No
   team"; locked to their own team and disabled for team_admin callers).
3. **Credentials confirmation** — immediately after creation: shows the username +
   password with a copy button and a plain warning that this is the only time it's
   shown. No "email it to them" step — handoff is out-of-band per the requirements.
4. **Sign in** — unchanged: org ID + username + password.
5. **Set your password** (new, forced) — shown whenever `profile.must_change_password`
   is true, before any other screen is reachable. Two fields: new password, confirm new
   password (6-char minimum, must match). No re-entry of the old password required —
   they're already authenticated by having signed in with it.
6. **Profile screen** — add an optional "Recovery email" field (for later self-service
   reset) and, for admins/team leaders, a way to open any managed user's profile to
   reset their password or toggle active/inactive.

## 8. Out of scope for this spec

- Task completion photos/history (parked separately, see ROADMAP.md).
- Any UI for the recovery-email "forgot password" entry point beyond adding the field —
  wiring up the actual "Forgot password?" link on the sign-in screen (which needs a
  small lookup RPC to find whether a recovery email exists for a given org+username, so
  the client knows whether to call `resetPasswordForEmail` or show "contact your
  admin") is a natural follow-up, not required for the core admin-provisioning flow to
  ship.
