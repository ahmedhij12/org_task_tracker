# OrgTasks Roadmap

One milestone at a time. Park mid-stream ideas here instead of building them immediately.

## Status (2026-08-17)

`SETUP.sql` is the single source of truth for schema — it's an idempotent
drop-and-rebuild script (wipes all data every run, by design). Re-paste it into
Supabase SQL Editor whenever schema changes, then `TESTS.sql` to check the rules
actually hold. Both are verified clean as of today, full run, every block passing.

`npm run watch` (+ `npm run peek`, `npm run dev/reload.js`) opens a browser window
on the dev machine that Claude can inspect live over CDP — the way we test together
now instead of trading screenshots.

## Done and verified

**Admin-provisioned signup & login** — owners create accounts for anyone in the org;
team leaders create employees on their own team only. Forced password change on
first login. Admin password reset without the old one; deactivation signs the user
out. Recovery email optional, added from Settings.
Spec: `docs/superpowers/specs/2026-08-17-admin-provisioned-accounts-design.md`

**Task completion: proof photos + history** — camera-only capture (no gallery,
proof must be taken fresh), up to 6 photos per completion, enforced both client-
and server-side. Permanent `task_completions` audit log — reopening a task no
longer erases that it was ever done. History tab scoped by role (owner: org-wide,
team leader: own team, employee: own work only). "Failed" = due date passed, still
open, derived automatically.

**Checklist templates** — a repeating inspection form (e.g. the daily hygiene
sheet), assigned to however many people need it, each filling their own copy
independently. Built-in templates seeded from the company's two real PDFs
(`src/lib/builtInChecklists.ts` — 79 + 15 questions, Arabic, hand-corrected against
the source after two failed auto-fix attempts mangled the لا ligature). A "No"
answer requires a note when the template asks for one; photos are always optional.
No due time or shift concept — a template has a cooldown (hours after submission
before it's due again), so a double shift just sees it reappear mid-shift instead
of being falsely marked late. Declaring "off duty" is a claim, not an escape: it
sits pending until an admin or the team's leader reviews it — approval behaves
like a normal completion for the cooldown, rejection makes it immediately due
again.

**Multi-team membership** — `profiles.team_id` (one team) replaced by
`profile_teams` (many), so one person (e.g. a supervisor) can be on two teams run
by two different leaders. Each leader sees only what *they* personally assigned to
a shared person, never into another leader's assignments for the same
person — enforced in RLS, covered by a dedicated test. Team leaders and the owner
are still tied to one team each, as before; only employees can be multi-team for
now.

**Two Alert.alert dead-on-web bugs found and fixed** — `Alert.alert` renders
nothing on react-native-web (button confirms just silently did nothing). Both the
deactivate-account confirm and the sign-out confirm were switched to in-app
two-step confirmations. Works on Android either way; was genuinely broken on web
before the fix.

## In-progress / needs your test pass

Database and browser end-to-end scripts (`scripts/e2e/*.js`) all pass. Multi-team
and checklists haven't had a full hands-on pass from you yet — that's next, using
`npm run watch` so it can be done together instead of screenshot-by-screenshot.

## Known gaps, not yet addressed

- **Camera-only proof can't be enforced on web** — `ImagePicker.launchCameraAsync`
  degrades to a file picker on a browser (confirmed, not a bug), so the
  "taken at this moment" guarantee only holds on the phone. Matters only if web
  becomes a real way people complete tasks.
- **`expo-updates` isn't installed** — no OTA. Every code change needs a full
  `eas build`, not just a redeploy. Worth adding once the pace of changes slows down.
- **Assignment across teams for a multi-team employee**: when a leader assigns a
  checklist/task, it's scoped to *their own* team for visibility (by design — see
  above). An owner assigning to someone on 0 or 2+ teams gets no specific team
  scoping (visible to the owner and that person only) — acceptable but worth
  knowing if it ever feels surprising.

## Backlog / mentioned but not scheduled

- More built-in checklist templates as the user provides more source PDFs — the
  extraction pipeline (PyMuPDF + explicit per-word corrections, never a blanket
  regex fix) is proven and repeatable.
