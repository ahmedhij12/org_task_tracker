# OrgTasks Roadmap

One milestone at a time. Park mid-stream ideas here instead of building them immediately.

## Status (2026-08-17)

Core flow tested and working end-to-end: org creation, org-code lookup, self-service
join, username+password sign-in. `SETUP.sql` is the single source of truth for schema
— re-run it in Supabase SQL Editor whenever schema changes.

## Now building: Admin-provisioned signup & login

Replacing self-service join with admin/team-leader-created accounts. See requirements
below (shared with an external developer for a second opinion before implementation
starts). This is being done first, before the task-completion feature, because it
changes the shape of the account/team-creation screens and is better to get right once.

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
