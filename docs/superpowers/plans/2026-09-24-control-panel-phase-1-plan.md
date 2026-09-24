# Control Panel — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admins a Control panel screen, reached from Settings, that holds the point value, each branch's check-in distance (with "set all") and the fryers. Settings becomes personal-only. The check-in distance also starts doing its job: a record signed outside its branch's circle shows how far away it was.

**Architecture:** A new hidden route `src/app/(main)/control-panel.tsx` built from one card component per setting in `src/components/control/`. Phase 2 adds more cards the same way. The point value and fryers cards are moved out of `settings.tsx` unchanged, because they already work. One new RPC, `set_branch_radius`, changes the distance without moving the pin. A pure helper, `src/lib/checkIn.ts`, measures a signing point against its branch's circle. The detail sheet and the PDF both use it.

**Tech Stack:** Expo SDK 54, expo-router 6, react-native-web, Supabase Postgres (live project `spnvsjmmeddwompkeerh`), i18next EN/AR, Playwright for headless checks, and Node 22's built-in TypeScript stripping for unit tests. No new packages.

**Spec:** `docs/superpowers/specs/2026-09-24-control-panel-and-roles-design.md`. Phase 1 is section 9, row 1. It covers the control panel (section 2) and the Settings cleanup (section 2, "Settings, after the cleanup").

## Global Constraints

- **Who counts as "admin" in Phase 1:** `profiles.role = 'owner'`. The super admin is an owner with `is_super_admin = true`, so he is included. The seven roles are Phase 4; do not touch roles, RLS policies or `my_role()` here.
- **Wording:** say "Branch manager", never "team admin". "Admin" is the right word for `owner`.
- **Check-in distance range: 5 to 2000 metres.** The live `teams_radius_range` constraint already enforces this. The app and the RPC use the same numbers.
- **A record outside the circle is FLAGGED with the distance, never blocked.** Indoor GPS drifts 20-50 m. This has been his rule since 2026-09-22.
- **Every new string goes in both `src/i18n/en.ts` and `src/i18n/ar.ts`.** Arabic uses the words already in the file: الفرع, المسافة المسموحة, م for metres.
- **Database changes:** write a dated file in `supabase/pending/`, apply it live with `psql`, and prove it with a transaction that is rolled back. Since 2026-09-22 this project has not mirrored changes into `SETUP.sql` / `TESTS.sql`, and this plan does not reopen that. Connect with the password read inline for each command. **Never write it to a file**; auto mode blocks that as credential leakage:
  ```bash
  PGPASSWORD="$(grep -A20 -i 'NEW project' secrets.txt | grep -i 'db password:' | head -1 | sed 's/.*db password:[[:space:]]*//' | tr -d '\r')" \
    psql "postgresql://postgres.spnvsjmmeddwompkeerh@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" -X -v ON_ERROR_STOP=1 -f <file>
  ```
  Auto mode sometimes blocks live reads as "[Production Reads]" and writes need Ahmad's explicit words. If a live apply is blocked, stop and ask him to say **"apply the branch radius migration"**. Do not work around it.
- **Live data is real.** The branches are using the app today. Only Task 6 writes to live data outside a rolled-back transaction, and it restores the value it changed.
- `npx tsc --noEmit` must be clean after every task that touches `src/`.
- Match the surrounding code: inline styles, `useThemeColors()`, `Card` / `FieldInput` / `PrimaryButton` / `ErrorBanner` from `@/components/ui`, and comments that explain *why*.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/pending/2026-09-24-branch-radius.sql` | create | `set_branch_radius(team, metres)`. A null team means every branch in the org. |
| `supabase/pending/2026-09-24-branch-radius.test.sql` | create | Proves the guards on live data, then rolls back |
| `src/lib/checkIn.ts` | create | `metersBetween`, `checkInFor`, and the 5 / 2000 limits |
| `scripts/test/checkIn.test.mjs` | create | Unit test, run with `node` |
| `src/components/CompletionDetailSheet.tsx` | modify | Shows "At the branch · 6 m" or "Outside the branch · 38 m away" |
| `src/lib/exportAuditReport.ts` | modify | The same line under the PDF's "Signed at" map |
| `src/app/(main)/control-panel.tsx` | create | The screen: back link, title, the cards |
| `src/components/control/PointValueCard.tsx` | create | Moved out of Settings, unchanged in behaviour |
| `src/components/control/FryersCard.tsx` | create | Moved out of Settings, opens the existing `FryersSheet` |
| `src/components/control/CheckInDistanceCard.tsx` | create | Per-branch distance, plus "set all" |
| `src/app/(main)/_layout.tsx` | modify | Registers the hidden route |
| `src/app/(main)/settings.tsx` | modify | Point value and fryers removed; a "Control panel" row added for admins |
| `src/app/(main)/history.tsx` | modify | `testID="history-row"` so the headless check can open a record |
| `scripts/dev/verify-control-panel.js` | create | Headless check of the whole feature against a real web build |
| `app.json`, `settings.tsx` footer | modify | Version 2.0.0 → 2.1.0 at release |

---

### Task 1: `set_branch_radius` — change the distance without moving the pin

Today the only way to change a branch's distance is `set_team_location`. That also requires a lat/lng, so the distance can only change by re-saving the pin on the map. The control panel needs to set the distance alone, per branch or for all branches at once.

**Files:**
- Create: `supabase/pending/2026-09-24-branch-radius.sql`
- Create: `supabase/pending/2026-09-24-branch-radius.test.sql`

**Interfaces:**
- Produces: `public.set_branch_radius(p_team_id uuid, p_radius_m int) returns int`. It returns the number of branches changed. `p_team_id = null` sets every branch in the caller's org. Only role `owner` may call it. A value outside 5-2000 raises `distance must be between 5 and 2000 metres`. An unknown or foreign branch id raises `branch not found`.

- [ ] **Step 1: Write the test file first**

`supabase/pending/2026-09-24-branch-radius.test.sql`:

```sql
-- Proves set_branch_radius's guards against the LIVE data, then rolls back,
-- so nothing it does persists. Run it with psql -f (see the plan's Global
-- Constraints for the connection). Success = only "PASS:" notices, then ROLLBACK.
begin;

-- Become a real user of org 51880 for the rest of the transaction.
create function pg_temp.as_user(p_username text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select p.id into v_id
  from public.profiles p join public.organizations o on o.id = p.org_id
  where p.username = p_username and o.org_code = '51880';
  if v_id is null then raise exception 'FAIL: no profile %', p_username; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end; $$;

do $$
declare
  v_org uuid;
  v_baghdad uuid;
  v_n int;
  v_before_other_orgs text;
begin
  -- 1. A supervisor is refused.
  perform pg_temp.as_user('ob12');
  begin
    perform public.set_branch_radius(null, 30);
    raise exception 'FAIL: a supervisor changed the check-in distance';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: supervisor refused (%)', sqlerrm;
  end;

  perform pg_temp.as_user('hijazi12');
  select org_id into v_org from public.profiles where id = auth.uid();
  select id into v_baghdad from public.teams where org_id = v_org and name = 'Baghdad';
  if v_baghdad is null then raise exception 'FAIL: Baghdad branch not found'; end if;
  select coalesce(string_agg(id::text || '=' || radius_m, ',' order by id), '')
    into v_before_other_orgs from public.teams where org_id <> v_org;

  -- 2. Out of range is refused, both ends.
  begin
    perform public.set_branch_radius(null, 4);
    raise exception 'FAIL: 4 m was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: 4 m refused (%)', sqlerrm;
  end;
  begin
    perform public.set_branch_radius(null, 2001);
    raise exception 'FAIL: 2001 m was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: 2001 m refused (%)', sqlerrm;
  end;

  -- 3. An unknown branch is refused.
  begin
    perform public.set_branch_radius(gen_random_uuid(), 30);
    raise exception 'FAIL: an unknown branch was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: unknown branch refused (%)', sqlerrm;
  end;

  -- 4. One branch changes, and only that branch. 1237 is a value no real branch has.
  v_n := public.set_branch_radius(v_baghdad, 1237);
  if v_n <> 1 then raise exception 'FAIL: one branch should change, got %', v_n; end if;
  if (select radius_m from public.teams where id = v_baghdad) <> 1237 then
    raise exception 'FAIL: Baghdad did not change';
  end if;
  if exists (select 1 from public.teams where org_id = v_org and id <> v_baghdad and radius_m = 1237) then
    raise exception 'FAIL: another branch changed too';
  end if;
  raise notice 'PASS: one branch changed alone';

  -- 5. "Set all" changes every branch in the org and nothing outside it.
  v_n := public.set_branch_radius(null, 1238);
  if v_n <> (select count(*) from public.teams where org_id = v_org) then
    raise exception 'FAIL: set all changed % branches', v_n;
  end if;
  if exists (select 1 from public.teams where org_id = v_org and radius_m <> 1238) then
    raise exception 'FAIL: set all missed a branch';
  end if;
  if v_before_other_orgs <> (select coalesce(string_agg(id::text || '=' || radius_m, ',' order by id), '')
                             from public.teams where org_id <> v_org) then
    raise exception 'FAIL: set all reached another organisation';
  end if;
  raise notice 'PASS: set all changed every branch of this org only';

  -- 6. The pin itself never moves.
  if exists (select 1 from public.teams where id = v_baghdad and lat is null) then
    raise exception 'FAIL: the pin was cleared';
  end if;
  raise notice 'PASS: pin untouched';
end $$;

rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run the psql command from Global Constraints with `-f supabase/pending/2026-09-24-branch-radius.test.sql`.
Expected: `ERROR: function public.set_branch_radius(unknown, integer) does not exist` on step 1. The error is raised inside the `begin … exception` block, so it may instead appear as `PASS: supervisor refused (function … does not exist)` followed by an ERROR on step 2's first *uncaught* call. Either way the run must **not** reach `PASS: one branch changed alone`.

- [ ] **Step 3: Write the migration**

`supabase/pending/2026-09-24-branch-radius.sql`:

```sql
-- 2026-09-24, Control panel phase 1. Change a branch's check-in distance
-- WITHOUT moving its pin (set_team_location needs a lat/lng, so the distance
-- could only change by re-saving the map). p_team_id null = every branch in
-- the caller's org — the control panel's "set all".
-- The distance only ever FLAGS a record signed outside it; nothing is blocked.
create or replace function public.set_branch_radius(p_team_id uuid, p_radius_m int)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'only an admin can change the check-in distance';
  end if;
  if p_radius_m is null or p_radius_m not between 5 and 2000 then
    raise exception 'distance must be between 5 and 2000 metres';
  end if;

  update public.teams
     set radius_m = p_radius_m
   where org_id = public.my_org_id()
     and (p_team_id is null or id = p_team_id);
  get diagnostics v_count = row_count;

  if p_team_id is not null and v_count = 0 then
    raise exception 'branch not found';
  end if;
  return v_count;
end; $$;

grant execute on function public.set_branch_radius(uuid, int) to authenticated;
```

- [ ] **Step 4: Apply it live, then rerun the test**

Apply: the psql command with `-f supabase/pending/2026-09-24-branch-radius.sql`. Expected: `CREATE FUNCTION`, `GRANT`.
Test: the psql command with `-f supabase/pending/2026-09-24-branch-radius.test.sql`.
Expected: exactly these notices, then `ROLLBACK`:
```
PASS: supervisor refused (only an admin can change the check-in distance)
PASS: 4 m refused (distance must be between 5 and 2000 metres)
PASS: 2001 m refused (distance must be between 5 and 2000 metres)
PASS: unknown branch refused (branch not found)
PASS: one branch changed alone
PASS: set all changed every branch of this org only
PASS: pin untouched
```

- [ ] **Step 5: Confirm the rollback left live data alone**

Run the psql command with `-c "select name, radius_m from teams order by name;"`.
Expected: Baghdad 15, Karbala 15. These are the values from before the test.

- [ ] **Step 6: Commit**

```bash
git add supabase/pending/2026-09-24-branch-radius.sql supabase/pending/2026-09-24-branch-radius.test.sql
git commit -m "Let the admin change a branch's check-in distance without moving its pin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `checkIn.ts` — how far from the branch was this signed

The distance setting currently does nothing. Every branch stores 15 m, but no code compares a signing point against it. The 2026-09-22 commit said records outside the circle are "flagged with the distance", but that flag was never built. This task adds the measuring. Task 3 shows the result.

**Files:**
- Create: `src/lib/checkIn.ts`
- Create: `scripts/test/checkIn.test.mjs`

**Interfaces:**
- Produces:
  - `CHECK_IN_MIN_M = 5`, `CHECK_IN_MAX_M = 2000`
  - `metersBetween(a: LatLng, b: LatLng): number`
  - `checkInFor(signed: { lat: number | null; lng: number | null }, branch: BranchCircle | null | undefined): CheckIn | null`
  - `interface CheckIn { meters: number; radiusM: number; outside: boolean }`, where `meters` is rounded to a whole metre and `outside` is `meters > radiusM` (exactly on the edge counts as inside)
  - `DEFAULT_CHECK_IN_M = 15`, the live `teams.radius_m` default
  - `interface BranchCircle { lat?: number | null; lng?: number | null; radiusM?: number }`. These are the same optional fields the app's `Team` type has, so a `Team` can be passed directly. A missing `radiusM` falls back to `DEFAULT_CHECK_IN_M`.

- [ ] **Step 1: Write the failing test**

`scripts/test/checkIn.test.mjs`:

```js
// Run: node scripts/test/checkIn.test.mjs
// Node 22 strips the TypeScript itself, so this imports the real module.
// Keep src/lib/checkIn.ts free of "@/..." imports or this cannot load it.
import assert from 'node:assert/strict';
import { metersBetween, checkInFor, CHECK_IN_MIN_M, CHECK_IN_MAX_M, DEFAULT_CHECK_IN_M } from '../../src/lib/checkIn.ts';

const branch = { lat: 33.3, lng: 44.4, radiusM: 15 };

// 0.001 degree of latitude is 111.19 m on a 6,371 km earth.
assert.equal(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.3, lng: 44.4 }), 0);
assert.equal(Math.round(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.301, lng: 44.4 })), 111);

// 0.0001 deg = 11 m: inside a 15 m circle.
assert.deepEqual(checkInFor({ lat: 33.3001, lng: 44.4 }, branch), { meters: 11, radiusM: 15, outside: false });
// 0.0003 deg = 33 m: outside it.
assert.deepEqual(checkInFor({ lat: 33.3003, lng: 44.4 }, branch), { meters: 33, radiusM: 15, outside: true });
// Exactly on the edge counts as inside.
assert.equal(checkInFor({ lat: 33.3001, lng: 44.4 }, { ...branch, radiusM: 11 }).outside, false);

// Nothing to compare -> null, never a fake distance.
assert.equal(checkInFor({ lat: null, lng: null }, branch), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, { lat: null, lng: null, radiusM: 15 }), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, undefined), null);
// A Team whose radiusM is missing uses the live default, 15 m.
assert.equal(checkInFor({ lat: 33.3003, lng: 44.4 }, { lat: 33.3, lng: 44.4 }).radiusM, DEFAULT_CHECK_IN_M);

assert.equal(CHECK_IN_MIN_M, 5);
assert.equal(CHECK_IN_MAX_M, 2000);
assert.equal(DEFAULT_CHECK_IN_M, 15);

console.log('PASS: checkIn');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test/checkIn.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` for `src/lib/checkIn.ts`.

- [ ] **Step 3: Write the module**

`src/lib/checkIn.ts`:

```ts
// Where a record was signed, measured against its branch's check-in circle.
// A record outside the circle is FLAGGED with the distance, never blocked —
// GPS indoors drifts 20-50 m. Each branch's circle is set in the control panel.
//
// No "@/..." imports here: scripts/test/checkIn.test.mjs loads this file
// straight into Node.

/** Same limits as the live teams_radius_range constraint and set_branch_radius. */
export const CHECK_IN_MIN_M = 5;
export const CHECK_IN_MAX_M = 2000;
/** The live teams.radius_m default; the app maps a missing value to this too. */
export const DEFAULT_CHECK_IN_M = 15;

export interface LatLng { lat: number; lng: number }
/** Optional fields on purpose: the app's Team type declares them optional. */
export interface BranchCircle { lat?: number | null; lng?: number | null; radiusM?: number }
export interface CheckIn { meters: number; radiusM: number; outside: boolean }

/** Straight-line metres between two points (haversine) — the same formula as public.meters_between. */
export function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Null when there is nothing honest to say: no signing point, or the branch
 * has no pin yet. Exactly on the edge counts as inside.
 */
export function checkInFor(
  signed: { lat: number | null; lng: number | null },
  branch: BranchCircle | null | undefined,
): CheckIn | null {
  if (signed.lat == null || signed.lng == null) return null;
  if (!branch || branch.lat == null || branch.lng == null) return null;
  const radiusM = branch.radiusM ?? DEFAULT_CHECK_IN_M;
  const meters = Math.round(metersBetween({ lat: signed.lat, lng: signed.lng }, { lat: branch.lat, lng: branch.lng }));
  return { meters, radiusM, outside: meters > radiusM };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `node scripts/test/checkIn.test.mjs`. Expected: `PASS: checkIn`. An `ExperimentalWarning` about type stripping may also appear and is fine.
Run: `npx tsc --noEmit`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkIn.ts scripts/test/checkIn.test.mjs
git commit -m "Measure how far from its branch a record was signed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Show the distance on the record and in the PDF

**Files:**
- Modify: `src/components/CompletionDetailSheet.tsx`: the branch lookup around lines 85-96 and the location row around lines 288-300
- Modify: `src/lib/exportAuditReport.ts`: `AuditReportData` (line ~40), the `proofHtml(...)` call (line ~144) and `proofHtml` itself (line ~196)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (`detail` block)

**Interfaces:**
- Consumes: `checkInFor`, `CheckIn` from Task 2 (`@/lib/checkIn`)
- Produces: `AuditReportData.checkIn?: CheckIn | null`

**Which branch a record is measured against:** the branch the record is *about*. That is the same choice the PDF already makes for `branchName`. An audit uses the subject's branch. A checklist uses the completion's own branch, falling back to the actor's first branch.

- [ ] **Step 1: Add the strings**

`src/i18n/en.ts`, inside `detail: { … }` after `tapMap`:
```ts
    atBranch: "At the branch · {{m}} m from the pin",
    outsideBranch: "Outside the branch · {{m}} m away (allowed {{r}} m)",
```
`src/i18n/ar.ts`, inside `detail: { … }` after `tapMap`:
```ts
    atBranch: "في الفرع · {{m}} م من الدبوس",
    outsideBranch: "خارج الفرع · على بعد {{m}} م (المسموح {{r}} م)",
```

- [ ] **Step 2: Work out the check-in in the detail sheet**

In `CompletionDetailSheet.tsx`, add `import { checkInFor } from '@/lib/checkIn';` next to the other `@/lib` imports. Replace the two name lookups:

```ts
  const subjectBranchName = teams.find((t) => t.id === subjectProfile?.teamIds[0])?.name ?? '—';
  const actorBranchName =
    teams.find((t) => t.id === completion.teamId)?.name ??
    teams.find((t) => t.id === members.find((m) => m.id === completion.actorId)?.teamIds[0])?.name ??
    '—';
```

with the branch objects, keeping the comment above them:

```ts
  const subjectBranch = teams.find((t) => t.id === subjectProfile?.teamIds[0]);
  const actorBranch =
    teams.find((t) => t.id === completion.teamId) ??
    teams.find((t) => t.id === members.find((m) => m.id === completion.actorId)?.teamIds[0]);
  const subjectBranchName = subjectBranch?.name ?? '—';
  const actorBranchName = actorBranch?.name ?? '—';
  // Measured against the branch the record is ABOUT — the same choice the
  // export makes for branchName below.
  const checkIn = checkInFor(
    { lat: completion.signedLat, lng: completion.signedLng },
    isAudit ? subjectBranch : actorBranch,
  );
```

In `handleExport`'s `report` object, add `checkIn,` after `branchName: …`.

- [ ] **Step 3: Show it under the address**

In the location row, colour the pin by the result:

```tsx
                            <Ionicons name="location" size={16} color={checkIn?.outside ? c.amber : c.emerald} />
```

Then add this after the address `<Text>` (the one showing `signedAddress` and `±… m`), inside the same `<View style={{ flex: 1 }}>`:

```tsx
                              {checkIn ? (
                                <Text style={{ fontSize: 12, fontWeight: '700', color: checkIn.outside ? c.amber : c.emerald, marginTop: 2 }}>
                                  {checkIn.outside
                                    ? t('detail.outsideBranch', { m: checkIn.meters, r: checkIn.radiusM })
                                    : t('detail.atBranch', { m: checkIn.meters })}
                                </Text>
                              ) : null}
```

- [ ] **Step 4: Carry it into the PDF**

In `exportAuditReport.ts`:
- Add `import type { CheckIn } from '@/lib/checkIn';` next to the file's other `@/lib` imports.
- Add this to `AuditReportData`:
  ```ts
  /** How far from its branch this was signed; null when either point is missing. */
  checkIn?: CheckIn | null;
  ```
- In `buildHtml`, destructure `checkIn` with the other fields and change the call to `${proofHtml(completion, kind === 'audit' ? auditorName : subjectName, locale, checkIn ?? null)}`.
- Change the signature to `function proofHtml(completion: TaskCompletion, signerName: string, locale: string, checkIn: CheckIn | null): string {`.
- In the `if (hasLoc)` block, replace the `caption(...)` argument so the distance sits under the accuracy:

```ts
    const accuracy = completion.signedAccuracyM != null ? `±${Math.round(completion.signedAccuracyM)} m` : '';
    // Numbers only, so nothing here needs escaping. The PDF is English-labelled
    // throughout ("Selfie", "Signed at"), so this line is too.
    const distance = !checkIn
      ? ''
      : checkIn.outside
        ? `<span style="color:#b45309;font-weight:700;">Outside the branch · ${checkIn.meters} m away (allowed ${checkIn.radiusM} m)</span>`
        : `At the branch · ${checkIn.meters} m from the pin`;
    cells.push(
      label('Signed at') +
        `<a href="https://www.google.com/maps/search/?api=1&query=${completion.signedLat},${completion.signedLng}" style="text-decoration:none;color:inherit;">` +
        frame(miniMapHtml(completion.signedLat!, completion.signedLng!, cellW, BOX_H)) +
        caption(escapeHtml(completion.signedAddress ?? 'Open in Maps'), [accuracy, distance].filter(Boolean).join('<br />')) +
        '</a>'
    );
```

- [ ] **Step 5: Typecheck and check every caller**

Run: `npx tsc --noEmit`. Expected: no output. `checkIn` is optional on `AuditReportData`, so any other caller (`grep -rn "exportAuditReport\|buildWebReportFile" src`) still compiles and simply shows no distance.
Run: `node scripts/test/checkIn.test.mjs`. Expected: `PASS: checkIn`.

- [ ] **Step 6: Commit**

```bash
git add src/components/CompletionDetailSheet.tsx src/lib/exportAuditReport.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "Say on the record and the PDF when it was signed away from the branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Control panel screen, and Settings becomes personal

This moves the point value and fryers out of Settings into the new screen. Both cards keep their existing behaviour and strings. Settings gains one row, "Control panel", for admins only.

**Files:**
- Create: `src/app/(main)/control-panel.tsx`
- Create: `src/components/control/PointValueCard.tsx`
- Create: `src/components/control/FryersCard.tsx`
- Modify: `src/app/(main)/_layout.tsx`: register the route next to `create-task`
- Modify: `src/app/(main)/settings.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`: new `control` block

**Interfaces:**
- Consumes: `useAuth()` → `{ profile, organization, setIqdPerPoint }`, and `FryersSheet({ visible, onClose })`, which is unchanged.
- Produces: route `/(main)/control-panel`; `PointValueCard()`, `FryersCard()` (no props); i18n keys `control.title`, `control.subtitle`, `control.openHint`, `control.back`.

- [ ] **Step 1: Add the strings**

`src/i18n/en.ts`: a new top-level block after `settings: { … },`:
```ts
  control: {
    title: "Control panel",
    subtitle: "How the app works for the whole company. A change here applies to everyone straight away — no update needed.",
    openHint: "Point value, check-in distance, fryers",
    back: "Settings",
  },
```
`src/i18n/ar.ts`: the same place:
```ts
  control: {
    title: "لوحة التحكم",
    subtitle: "طريقة عمل التطبيق للشركة كلها. أي تغيير هنا يُطبَّق على الجميع فوراً — بدون تحديث.",
    openHint: "قيمة النقطة، مسافة الحضور، القلايات",
    back: "الإعدادات",
  },
```

- [ ] **Step 2: Move the point value card**

Create `src/components/control/PointValueCard.tsx`. Move the code as it is from `settings.tsx`: the `rateText` / `savingRate` / `rateNotice` / `rateError` state, `parsedRate`, `rateValid`, `handleSaveRate`, and the `<Card>` JSX under `profile?.role === 'owner'` that renders `settings.pointValue`. Keep its `settings.*` string keys; they are already translated, and renaming them buys nothing.

```tsx
import { View, Text } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

/** 1 point = X IQD, company-wide. Moved here from Settings unchanged. */
export function PointValueCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { organization, setIqdPerPoint } = useAuth();
  const [rateText, setRateText] = useState(String(organization?.iqdPerPoint ?? ''));
  const [savingRate, setSavingRate] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  const parsedRate = Number(rateText.replace(/,/g, '').trim());
  const rateValid = rateText.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0;

  const handleSaveRate = async () => {
    if (!rateValid || savingRate) return;
    setSavingRate(true);
    setRateNotice(null);
    setRateError(null);
    try {
      await setIqdPerPoint(parsedRate);
      setRateText(String(parsedRate));
      setRateNotice(t('settings.rateSaved', { rate: parsedRate.toLocaleString() }));
    } catch (e: any) {
      setRateError(e?.message ?? t('settings.rateFailed'));
    } finally {
      setSavingRate(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('settings.pointValue')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
        {t('settings.pointValueHint', { rate: (organization?.iqdPerPoint ?? 0).toLocaleString() })}
      </Text>
      {rateError ? <ErrorBanner message={rateError} /> : null}
      {rateNotice ? (
        <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ color: c.brand, fontSize: 13 }}>{rateNotice}</Text>
        </View>
      ) : null}
      <FieldInput
        placeholder="25000"
        value={rateText}
        onChangeText={(v) => {
          setRateText(v);
          setRateNotice(null);
        }}
        keyboardType="number-pad"
      />
      <PrimaryButton
        title={t('settings.savePointValue')}
        onPress={handleSaveRate}
        loading={savingRate}
        disabled={!rateValid || parsedRate === organization?.iqdPerPoint}
      />
    </Card>
  );
}
```

- [ ] **Step 3: Move the fryers card**

Create `src/components/control/FryersCard.tsx`:

```tsx
import { Text } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FryersSheet } from '@/components/FryersSheet';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';

/** Fryers per branch — the sheet picks the branch first. Moved here from Settings unchanged. */
export function FryersCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [managingFryers, setManagingFryers] = useState(false);

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('oil.fryersCardTitle')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('oil.fryersCardHint')}</Text>
      <PrimaryButton title={t('oil.manageFryers')} onPress={() => setManagingFryers(true)} />
      <FryersSheet visible={managingFryers} onClose={() => setManagingFryers(false)} />
    </Card>
  );
}
```

- [ ] **Step 4: Create the screen**

`src/app/(main)/control-panel.tsx`:

```tsx
import { ScrollView, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useThemeColors } from '@/components/ui';
import { PointValueCard } from '@/components/control/PointValueCard';
import { FryersCard } from '@/components/control/FryersCard';

/**
 * The control panel: every setting that decides how the app behaves for the
 * whole company, in one place, so a change never needs a developer or a new
 * build. Admins only — in the database that is role 'owner' today (the super
 * admin is an owner with is_super_admin). Settings keeps only personal things.
 * Each setting is its own card in src/components/control/; later phases add
 * cards here.
 */
export default function ControlPanelScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  if (!profile) return null;
  // Direct URL on the web build: a non-admin lands back in Settings. The
  // database refuses their writes anyway; this is about not showing the screen.
  if (profile.role !== 'owner') return <Redirect href="/(main)/settings" />;

  const isArabic = i18n.language?.startsWith('ar');
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(main)/settings'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={goBack}
          hitSlop={8}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 12 }}
        >
          <Ionicons name={isArabic ? 'chevron-forward' : 'chevron-back'} size={20} color={c.textMuted} />
          <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: 14 }}>{t('control.back')}</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('control.title')}</Text>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 20 }}>{t('control.subtitle')}</Text>

        <PointValueCard />
        <FryersCard />
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Register the route**

In `src/app/(main)/_layout.tsx`, add this right after the `create-task` screen:

```tsx
        <Tabs.Screen
          name="control-panel"
          options={{
            href: null, // reached from Settings, not a tab
          }}
        />
```

- [ ] **Step 6: Clean up Settings**

In `src/app/(main)/settings.tsx`:
- Delete `import { FryersSheet } from '@/components/FryersSheet';`.
- Add `import { router } from 'expo-router';`.
- Remove `setIqdPerPoint` from the `useAuth()` destructure.
- Delete the `rateText`, `managingFryers`, `savingRate`, `rateNotice`, `rateError` state lines, plus `parsedRate`, `rateValid` and `handleSaveRate`.
- Delete both `profile?.role === 'owner'` cards (point value, fryers) and the `<FryersSheet … />` line before `</SafeAreaView>`.
- Put this where the point value card was, right after the Organization card:

```tsx
        {profile?.role === 'owner' ? (
          <Pressable onPress={() => router.push('/(main)/control-panel')} accessibilityRole="button" testID="open-control-panel">
            <Card style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="options" size={22} color={c.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{t('control.title')}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('control.openHint')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textFaint} style={{ transform: [{ scaleX: i18n.language?.startsWith('ar') ? -1 : 1 }] }} />
              </View>
            </Card>
          </Pressable>
        ) : null}
```

  Change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();` so the chevron can flip in Arabic.

After this, Settings reads top to bottom as: profile · organisation name + ID · (admins) Control panel · push for this device · recovery email · appearance · language · sign out. That is the spec's personal-only list.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`. Expected: no output. `app.json` has `typedRoutes: true`, and `.expo/types/router.d.ts` is gitignored and was last written Sep 15, so it does not know the new route and tsc may reject `'/(main)/control-panel'`. expo-router rewrites that file while the dev server runs. Start `npx expo start --web`, wait for the bundler to say it is ready, stop it, and confirm `grep -c control-panel .expo/types/router.d.ts` is at least 1. Then rerun tsc. Never hand-edit the generated file.

- [ ] **Step 8: Look at it headlessly**

```bash
npx expo export -p web && (npx serve dist -s -l 4173 >/dev/null 2>&1 &) && sleep 3
```
Sign in as the owner (org `51880`, `hijazi12` / `123123`) with the same Playwright steps `scripts/dev/verify-ui.js` uses. Open Settings, screenshot it, tap **Control panel**, and screenshot that. Confirm with your own eyes: Settings no longer has Point value or Manage fryers, and the panel shows both, working. Task 6 turns this into a repeatable script. Here it is a look.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(main)/control-panel.tsx" src/components/control "src/app/(main)/_layout.tsx" "src/app/(main)/settings.tsx" src/i18n/en.ts src/i18n/ar.ts
git commit -m "Give the admins a control panel and keep Settings personal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The check-in distance card

**Files:**
- Create: `src/components/control/CheckInDistanceCard.tsx`
- Modify: `src/app/(main)/control-panel.tsx`: render it between the point value and fryers cards
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`: `control` block

**Interfaces:**
- Consumes: `set_branch_radius` (Task 1); `CHECK_IN_MIN_M`, `CHECK_IN_MAX_M` (Task 2); `useOrgData()` → `{ teams: Team[]; refresh(): Promise<void> }`, where `Team` has `id`, `name`, `lat`, `radiusM`.
- Produces: `CheckInDistanceCard()` (no props).

- [ ] **Step 1: Add the strings**

`en.ts`, inside `control: { … }`:
```ts
    distanceTitle: "Check-in distance",
    distanceHint: "How far from a branch's pin still counts as \"at the branch\". A record signed further away is flagged with the distance — never blocked. Move the pin itself in the Branches tab.",
    distanceAll: "All branches",
    distanceSetAll: "Set all",
    distanceSave: "Save",
    distanceCurrent: "{{m}} m now",
    distanceNoPin: "no pin yet",
    distanceRange: "Between {{min}} and {{max}} metres.",
    distanceSaved: "{{name}}: {{m}} m.",
    distanceSavedAll: "Every branch: {{m}} m.",
    distanceFailed: "Could not save the distance. Please try again.",
```
`ar.ts`, inside `control: { … }`:
```ts
    distanceTitle: "مسافة الحضور",
    distanceHint: "أقصى بُعد عن دبوس الفرع يُحسب \"في الفرع\". أي سجل يُوقَّع أبعد من ذلك يُعلَّم بالمسافة — ولا يُمنع أبداً. لتحريك الدبوس نفسه استخدم تبويب الفروع.",
    distanceAll: "كل الفروع",
    distanceSetAll: "تطبيق على الكل",
    distanceSave: "حفظ",
    distanceCurrent: "{{m}} م حالياً",
    distanceNoPin: "لا يوجد دبوس بعد",
    distanceRange: "بين {{min}} و{{max}} متر.",
    distanceSaved: "{{name}}: {{m}} م.",
    distanceSavedAll: "كل الفروع: {{m}} م.",
    distanceFailed: "تعذّر حفظ المسافة. حاول مرة أخرى.",
```

- [ ] **Step 2: Write the card**

`src/components/control/CheckInDistanceCard.tsx`:

```tsx
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOrgData } from '@/hooks/useOrgData';
import { CHECK_IN_MIN_M, CHECK_IN_MAX_M, DEFAULT_CHECK_IN_M } from '@/lib/checkIn';
import { Card, ErrorBanner, useThemeColors } from '@/components/ui';

/** Whole metres in the allowed range, or null. */
function parseMeters(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= CHECK_IN_MIN_M && n <= CHECK_IN_MAX_M ? n : null;
}

/**
 * Per-branch check-in distance, plus one row that sets every branch at once.
 * Only the distance — the pin is moved on the Branches tab (set_team_location).
 */
export function CheckInDistanceCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { teams, refresh } = useOrgData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [allText, setAllText] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // a branch id, 'all', or null
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (teamId: string | null, meters: number) => {
    setBusy(teamId ?? 'all');
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await supabase.rpc('set_branch_radius', { p_team_id: teamId, p_radius_m: meters });
      if (e) throw e;
      await refresh();
      if (teamId) {
        setDrafts(({ [teamId]: _, ...rest }) => rest);
        setNotice(t('control.distanceSaved', { name: teams.find((b) => b.id === teamId)?.name ?? '', m: meters }));
      } else {
        setDrafts({});
        setAllText('');
        setNotice(t('control.distanceSavedAll', { m: meters }));
      }
    } catch (e: any) {
      setError(e?.message ?? t('control.distanceFailed'));
    } finally {
      setBusy(null);
    }
  };

  const allMeters = parseMeters(allText);

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('control.distanceTitle')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('control.distanceHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: c.brand, fontSize: 13 }}>{notice}</Text>
        </View>
      ) : null}

      {teams.length > 1 ? (
        <DistanceRow
          label={t('control.distanceAll')}
          sub={null}
          value={allText}
          onChange={setAllText}
          actionTitle={t('control.distanceSetAll')}
          canSave={allMeters != null}
          busy={busy === 'all'}
          onSave={() => allMeters != null && save(null, allMeters)}
          testID="distance-all"
        />
      ) : null}

      {teams.map((b) => {
        const text = drafts[b.id] ?? '';
        const meters = parseMeters(text);
        return (
          <DistanceRow
            key={b.id}
            label={b.name}
            sub={b.lat == null ? t('control.distanceNoPin') : t('control.distanceCurrent', { m: b.radiusM ?? DEFAULT_CHECK_IN_M })}
            value={text}
            onChange={(v) => setDrafts((d) => ({ ...d, [b.id]: v }))}
            actionTitle={t('control.distanceSave')}
            canSave={meters != null && meters !== (b.radiusM ?? DEFAULT_CHECK_IN_M)}
            busy={busy === b.id}
            onSave={() => meters != null && save(b.id, meters)}
            testID={`distance-${b.name}`}
          />
        );
      })}

      <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 8 }}>
        {t('control.distanceRange', { min: CHECK_IN_MIN_M, max: CHECK_IN_MAX_M })}
      </Text>
    </Card>
  );
}

function DistanceRow(props: {
  label: string;
  sub: string | null;
  value: string;
  onChange: (v: string) => void;
  actionTitle: string;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
  testID: string;
}) {
  const c = useThemeColors();
  const disabled = !props.canSave || props.busy;
  return (
    <View testID={props.testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{props.label}</Text>
        {props.sub ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{props.sub}</Text> : null}
      </View>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType="number-pad"
        placeholder="m"
        placeholderTextColor={c.textFaint}
        maxLength={4}
        style={{ width: 72, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, fontSize: 14, color: c.text, textAlign: 'center' }}
      />
      <Pressable
        onPress={props.onSave}
        disabled={disabled}
        accessibilityRole="button"
        style={{ backgroundColor: c.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, minWidth: 64, alignItems: 'center', opacity: disabled ? 0.45 : 1 }}
      >
        {props.busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{props.actionTitle}</Text>}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 3: Put it on the screen**

In `control-panel.tsx`, add `import { CheckInDistanceCard } from '@/components/control/CheckInDistanceCard';` and render `<CheckInDistanceCard />` between `<PointValueCard />` and `<FryersCard />`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/control/CheckInDistanceCard.tsx "src/app/(main)/control-panel.tsx" src/i18n/en.ts src/i18n/ar.ts
git commit -m "Set each branch's check-in distance, or all of them, from the control panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Prove the whole feature on a real build, then ship it

This is the whole-feature check: one script, run against the web build, covering all three roles' points of view. Run it locally first. After deploy, run it against the live site.

**Files:**
- Create: `scripts/dev/verify-control-panel.js`
- Modify: `src/app/(main)/history.tsx`: `testID="history-row"` on `HistoryRow`'s outer `<Pressable onPress={onPress}>` (line ~297)
- Modify: `app.json` (`"version": "2.1.0"`), `src/app/(main)/settings.tsx` footer (`BD Audit • v2.1.0`)

**Interfaces:**
- Consumes: everything above. The logins are owner `hijazi12` / `123123` and supervisor `ob12` / `123123`, both in org `51880`.

- [ ] **Step 1: Add the History test id**

In `history.tsx` `HistoryRow`, change `<Pressable onPress={onPress}>` to `<Pressable onPress={onPress} testID="history-row">`. react-native-web renders this as `data-testid`, the same mechanism `verify-viewer.js` uses.

- [ ] **Step 2: Write the script**

`scripts/dev/verify-control-panel.js`:

```js
// Headless check of Control panel phase 1 against a real web build.
//   npx expo export -p web && npx serve dist -s -l 4173 &
//   node scripts/dev/verify-control-panel.js                 # local build
//   BASE=https://bdaudit.hijazionline.com node scripts/dev/verify-control-panel.js
// It changes ONE live value — Baghdad's check-in distance, by 1 m — through
// the real UI, and puts it back in a finally block. Everything else is read-only.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signIn(page, username) {
  // networkidle never settles on the live domain; domcontentloaded does.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText('Sign in', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const inputs = await page.locator('input').all();
  await inputs[0].fill('51880');
  await inputs[1].fill(username);
  await inputs[2].fill('123123');
  await page.getByText('Sign in', { exact: true }).last().click();
  await page.waitForTimeout(9000);
  for (const l of ['Done', 'Skip', 'Not now', 'Later']) {
    const el = page.getByText(l, { exact: true }).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
}

const visible = async (page, text) =>
  (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false));

async function openSettings(page) {
  await page.getByText('Settings', { exact: true }).last().click();
  await page.waitForTimeout(2500);
}

(async () => {
  const browser = await chromium.launch();

  // ── Owner ────────────────────────────────────────────────────────────
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(owner, 'hijazi12');
  await openSettings(owner);
  check(await owner.getByTestId('open-control-panel').isVisible().catch(() => false), 'owner sees the Control panel row in Settings');
  check(!(await visible(owner, 'Save point value')), 'point value is gone from Settings');
  check(!(await visible(owner, 'Manage fryers')), 'fryers are gone from Settings');
  await owner.screenshot({ path: `${OUT}/cp-settings-owner.png`, fullPage: true });

  await owner.getByTestId('open-control-panel').click();
  await owner.waitForTimeout(2500);
  for (const text of ['Control panel', 'Point value', 'Check-in distance', 'Manage fryers', 'Baghdad', 'Karbala', 'All branches']) {
    check(await visible(owner, text), `control panel shows "${text}"`);
  }
  await owner.screenshot({ path: `${OUT}/cp-panel-owner.png`, fullPage: true });

  // Change Baghdad by 1 m through the UI, read it back, restore it.
  const row = owner.getByTestId('distance-Baghdad');
  const before = Number(((await row.innerText()).match(/(\d+) m now/) || [])[1]);
  check(Number.isInteger(before), 'read Baghdad\'s current distance', `${before} m`);
  const target = before === 2000 ? before - 1 : before + 1;
  try {
    await row.locator('input').fill(String(target));
    await row.getByText('Save', { exact: true }).click();
    await owner.waitForTimeout(3000);
    check(await visible(owner, `Baghdad: ${target} m.`), 'save notice shown', `${target} m`);
    check((await row.innerText()).includes(`${target} m now`), 'Baghdad now reads the new distance');
  } finally {
    await row.locator('input').fill(String(before));
    await row.getByText('Save', { exact: true }).click().catch(() => {});
    await owner.waitForTimeout(3000);
    check((await row.innerText()).includes(`${before} m now`), 'Baghdad restored', `${before} m`);
  }

  // The flag on a real record: every record that shows where it was signed
  // must also say how far from its branch that was.
  await owner.getByText('History', { exact: true }).last().click();
  await owner.waitForTimeout(3000);
  const rows = owner.getByTestId('history-row');
  const n = Math.min(await rows.count(), 8);
  let withLocation = 0;
  let withFlag = 0;
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    await owner.waitForTimeout(2500);
    const hasLoc = (await visible(owner, 'Submitted here')) || (await visible(owner, 'Signed here'));
    const hasFlag = (await visible(owner, 'At the branch')) || (await visible(owner, 'Outside the branch'));
    if (hasLoc) withLocation++;
    if (hasLoc && hasFlag) withFlag++;
    if (hasLoc && withLocation === 1) await owner.screenshot({ path: `${OUT}/cp-record-flag.png` });
    await owner.getByText('Close', { exact: true }).last().click().catch(() => {});
    await owner.waitForTimeout(1200);
  }
  check(withLocation > 0, 'found a record with a signing location', `${withLocation} of ${n}`);
  check(withFlag === withLocation, 'every located record says how far from its branch', `${withFlag}/${withLocation}`);

  // ── Supervisor ───────────────────────────────────────────────────────
  const sup = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(sup, 'ob12');
  await openSettings(sup);
  check(!(await sup.getByTestId('open-control-panel').isVisible().catch(() => false)), 'supervisor has no Control panel row');
  await sup.goto(new URL('control-panel', BASE).toString(), { waitUntil: 'domcontentloaded' });
  await sup.waitForTimeout(5000);
  check(!(await visible(sup, 'Check-in distance')), 'supervisor typing the URL does not get the panel');

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 3: Run it against the local build**

```bash
npx expo export -p web && (npx serve dist -s -l 4173 >/dev/null 2>&1 &) && sleep 3
OUT=<session scratchpad> node scripts/dev/verify-control-panel.js
```
Expected: every line `PASS`, and `N/N passed`. **Open the four screenshots and look at them.** Check the layout at 390 px wide: nothing is clipped, and the distance rows line up. If any check fails, fix the code, not the check, unless the check's selector is provably wrong (for example, the sign-in placeholders changed). Say which in the commit.

- [ ] **Step 4: Look at it in Arabic once**

Sign in as `hijazi12`, set Language → العربية in Settings, open لوحة التحكم, and screenshot it. Check that the text is right-to-left, the back chevron points the right way, and the numbers are not reversed. Set the language back to English afterwards. Language is stored on the device, so this does not touch his phone.

- [ ] **Step 5: Bump the version and commit**

`app.json`: `"version": "2.0.0"` → `"version": "2.1.0"`. `settings.tsx` footer: `BD Audit • v2.0.0` → `BD Audit • v2.1.0`.

```bash
git add scripts/dev/verify-control-panel.js "src/app/(main)/history.tsx" app.json "src/app/(main)/settings.tsx"
git commit -m "Prove the control panel end to end, and call it 2.1.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Deploy the web app and prove it live**

Task 1 is already live and the new RPC is additive, so the order is safe.

```bash
npx expo export -p web && npx wrangler deploy
BASE=https://bdaudit.hijazionline.com/ OUT=<session scratchpad> node scripts/dev/verify-control-panel.js
```
Expected: the same `N/N passed` against the live site. Also confirm the live bundle is the new one: `curl -s https://bdaudit.hijazionline.com/ | grep -o '_expo/static/js/web/entry-[a-z0-9]*.js'` should name the same file as `ls dist/_expo/static/js/web/`.

- [ ] **Step 7: Push**

```bash
git push
```

The native iPhone build picks this up at its next rebuild or re-sign (due ~Sep 29). The branches use the web app, so they have it now.
