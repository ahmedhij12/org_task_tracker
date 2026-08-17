# OrgTasks Roadmap

One milestone at a time. Park mid-stream ideas here instead of building them immediately.

## Status (2026-08-17)

Core flow tested and working end-to-end: org creation, org-code lookup, self-service
join, username+password sign-in. `SETUP.sql` is the single source of truth for schema
— re-run it in Supabase SQL Editor whenever schema changes.

## Done and verified: Admin-provisioned signup & login

Employees no longer self-register. Owners create accounts for anyone in the org
(choosing role and team); team leaders create employees on their own team only.
Every admin-created account is forced to pick its own password on first login.
Admins can reset any password without knowing the old one, and deactivate accounts,
which signs the user out and blocks sign-in. Recovery email is optional and added
by the user from Settings.

Spec: `docs/superpowers/specs/2026-08-17-admin-provisioned-accounts-design.md`
Plan: `docs/superpowers/plans/2026-08-17-admin-provisioned-accounts.md`

**Applying schema changes:** paste `supabase/SETUP.sql` into the Supabase SQL Editor
and Run (wipes all data — intended), then `supabase/TESTS.sql` to check the
permission rules.

Verified 2026-08-17: `npm run typecheck` clean, `supabase/TESTS.sql` green, and all
three end-to-end scripts in `scripts/e2e/` pass against the real Supabase project —
including the part that was genuinely uncertain, that GoTrue accepts a login for an
account whose `auth.users` row was written by `admin_create_user` instead of by
`supabase.auth.signUp()`.

## Known issue — not yet fixed

`Alert.alert` does nothing on react-native-web (no dialog, callback never fires).
`ManageUserSheet` was switched to an in-app confirmation because of this, but
**sign-out in `settings.tsx` still uses `Alert.alert`**, so it is silently dead when
running `npm run web`. It works fine on the Android build. Same one-line-ish fix
pattern as the deactivate confirm if it becomes worth doing.

## Parked — come back after signup/login rework

**Task completion: proof photos + history.** Design was underway, paused to prioritize
auth. Requirements gathered so far:
- Bug: `CompleteTaskSheet.tsx` lets a task with `requiresProof` be marked done with a
  note but no photo (button only disables when *both* are empty). Also unenforced
  server-side in the `set_task_completion` RPC — needs fixing in both places.
- Switch photo capture from gallery picker (`launchImageLibraryAsync`) to camera-only
  (`launchCameraAsync`) — proof must be taken fresh, not selected from an existing photo.
- Support multiple photos per completion, not just one.
- Persist all proof photos to the task so they can be reviewed later.
- New completion-history log (currently nothing is kept — reopening a task wipes the
  completion fields). Visibility scoped by role: owner sees everything org-wide,
  team_admin sees their own team, employee sees only their own.
- "Failed" = due date passed and still not completed, derived automatically (not an
  explicit action) — confirmed with user.
- Open question not yet resolved: exact schema for multi-photo storage (array column
  vs. child table) and the history table shape.

## Backlog / mentioned but not scheduled

- (none yet)
