# Brands — Design

Date: 2026-09-14
Scope: adds "brand" as a real dimension under a branch — a supervisor
belongs to a branch *and* a brand within it; a branch manager only ever
needs the branch. Touches branch create/edit, staff create/edit, the audit
picker, and Dashboard/Report.

## Why

Basra Delight runs more than one brand out of the same physical branch —
Tuwaysah currently runs 360 + AA Chicken + Center; Olympic runs 360 + AA
Chicken + Awtar + Center. "Center" isn't a food brand — it's the area inside
a branch where delivery orders are consolidated and handed to drivers — but
it behaves identically to a brand in every way that matters here: a
supervisor sits under it, gets audited under it, and its numbers should
roll up the same way. A branch manager is unaffected — they own the whole
location across every brand, so they never need one.

## Data model

```sql
-- Org-wide, admin-managed list — deliberately not hardcoded to today's 4
-- names, since a 5th brand or renamed one is a real possibility ("make it
-- flexible" was explicit).
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- Which brands actually operate at which branch — configured per branch,
-- since the set genuinely differs (confirmed: Tuwaysah ≠ Olympic).
create table public.branch_brands (
  branch_id uuid not null references public.teams(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  primary key (branch_id, brand_id)
);

-- A supervisor's brand within a branch. Nullable: a branch manager's own
-- profile_teams row never sets one (enforced in the RPCs below, not a bare
-- check constraint, since it depends on the target's role); an existing
-- supervisor added before this feature stays null until assigned one.
alter table public.profile_teams add column brand_id uuid references public.brands(id) on delete set null;
```

`profile_teams` already supports one person belonging to more than one
branch (multi-team membership, existing feature) — a `brand_id` per *row*
means a supervisor's brand can differ if they ever cover more than one
branch, which is the correct granularity, not a flat `profiles.brand_id`.

### New RPCs

- **`create_brand(p_name text)`** — owner-only, mirrors `create_team`.
- **`set_branch_brands(p_branch_id uuid, p_brand_ids uuid[])`** — owner-only;
  replaces the full set for that branch (delete-and-reinsert into
  `branch_brands`, same pattern as `update_checklist_template`'s items).
  Simplest correct approach for "which brands does this branch run" as a
  single editable set rather than incremental add/remove calls.

### Changed RPCs

- **`admin_create_user`** gains `p_brand_id uuid default null`. Validated:
  only meaningful when the created role is `employee` (a supervisor); if
  role is `team_admin` or `owner`, `p_brand_id` must be null (reject
  otherwise — matches "no need for brand, he's the respective person for
  this location"). When set, `(p_team_id, p_brand_id)` must exist in
  `branch_brands` — a supervisor cannot be assigned a brand that doesn't
  actually operate at their branch.
- **`add_profile_to_team`** gains the same `p_brand_id` param and the same
  two checks (role must be `employee`; brand must belong to that branch).
- **`get_current_branch_summary`** / **`get_period_report`** — both already
  join `task_completions` → `profiles` (subject) → `profile_teams` →
  `teams` for branch attribution. Add `brand_id`/`brand_name` to the same
  join (`profile_teams.brand_id` → `brands.name`) and to the returned rows,
  so a null-brand subject (a branch manager being audited directly, or a
  supervisor never assigned one) still shows up ungrouped rather than being
  silently dropped.

## UI changes

**Branch create/edit** (`teams.tsx` + wherever branch creation lives) — add
a brand multi-select when creating or editing a branch, wired to
`set_branch_brands`. Existing branches (Tuwaysah, Olympic, Baghdad) start
with zero brands configured — the user sets them once, matches the real
list they already gave.

**Staff create/edit** (`CreateUserSheet`, `ManageUserSheet`) — when the
selected role is `employee` (Supervisor), a Brand picker appears *after*
Branch is chosen, filtered to that branch's configured brands
(`branch_brands`). When role is `team_admin` (Branch manager) or `owner`
(Admin), no brand picker at all — matches "if I chose branch manager, no
need for brand."

**Audit picker** (`FillChecklistSheet`) — inserts a Brand step between
Branch and Subject: Branch → Brand (that branch's configured brands) →
Subject (members whose `profile_teams` row for that branch has that
`brand_id`) → Shift → checklist. A branch with zero brands configured falls
back to today's behavior (subject picker shows everyone at that branch,
brand-less) rather than being unreachable.

**Dashboard / Report** — the branch rollup gains a brand-level breakdown
nested under each branch (branch → brand → supervisor, three levels instead
of two). A subject with no brand (or a branch with no brands configured at
all) shows under an "Unassigned" bucket within that branch, not hidden.

## Explicitly out of scope (this spec)

- Brand-wide reporting *across* branches (e.g. "how is AA Chicken doing
  org-wide") — the ask was breakdown *within* a branch, not a rollup by
  brand as its own top-level dimension. Revisit only if asked.
- Retroactively assigning a brand to already-existing supervisors (Mahmoud,
  Ali) — the user does this themselves via the edit-staff screen once it
  exists; not a migration script.
- Any change to what a "branch manager" or "admin" role can see/do beyond
  the brand-picker being absent for them — already correct today.

## Testing

- New `TESTS.sql` coverage: `create_brand` owner-only; `set_branch_brands`
  replaces the full set; `admin_create_user`/`add_profile_to_team` reject a
  brand for a non-employee role, reject a brand not enabled at that branch,
  and accept a valid one; `get_current_branch_summary`/`get_period_report`
  return the right brand_name per subject, and a null-brand subject still
  appears.
- `npx tsc --noEmit` after UI changes.
- Live QA (flagged for the user): configure Tuwaysah's real brands, assign
  Mahmoud a brand, run an audit through the new Branch → Brand → Subject
  flow, confirm Dashboard/Report show the right brand breakdown.
