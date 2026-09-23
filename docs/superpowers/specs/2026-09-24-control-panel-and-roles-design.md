# Control panel, roles, and the penalty system — design

**Status:** agreed in conversation 2026-09-24. Nothing built yet.
**Read this back and correct it before any code is written.**

The point of all of it: the app should be run from inside the app. Ahmad should
not need a developer to change a time, a distance, a point value or a penalty.

---

## 1. The seven roles

| Role | Short version |
|---|---|
| **Super admin** | One person. Creates admins. Can override anything. Cannot be deactivated or deleted. |
| **Admin** | Creates everyone except admins. Runs the control panel. Keeps all the audit powers too. |
| **Hygiene auditor** | Audits hygiene, verifies checklists, closes the month. Admin minus Branches, Staff, Control panel. |
| **Food auditor** (quality control) | Audits food on his own checklist. Charges penalties by hand. |
| **Operations manager** | Watches everything, changes nothing day to day. Has the final say at month end. |
| **Branch manager** | Does his own checklist, runs his branch, sets shifts. Decides nothing. |
| **Supervisor** | Does the work. Sees only his own numbers. |

### Super admin
- Only one.
- Creates 1 or 2 **admins**. Nobody else can create an admin.
- Can override anything, anywhere.
- **Cannot be deactivated or deleted by anyone**, including himself. This is the
  only guard against locking the company out.
- Can create a **new organisation** for a second company: one flow — create the
  org, it gets its own ID, then create his own user inside it. He signs in with
  that username to work there. The two companies share nothing.
- *(Already built and live as `profiles.is_super_admin`.)*

### Admin
- Creates: hygiene auditor, food auditor, operations manager, branch manager,
  supervisor. **Cannot create another admin.**
- The control panel is his.
- **Keeps** audits, oil tests and checklist templates — he does not lose them to
  the auditors. If no auditor is hired yet, the admin can still do everything.
- Can Keep / Wipe the automatic penalties.
- Can close the month (as well as the hygiene auditor).

### Hygiene auditor
Several may exist. All of them see **all branches** — same as the admin.

Has:
- **Dashboard** — branch scores, trends, best and worst supervisor, best and
  worst branch
- **Audits** — the hygiene audit, and control of the checklist template:
  questions, sections, point values. An edit applies to everyone immediately.
- **Oil test** — at any time on a visit, not tied to the supervisor's slots
- **Checklists** — **verifying the branches' checklists is her job.** This is
  taken off the branch manager. It is what she is paid for.
- **History** — oil tests and marinations across branches
- **Report** — close the month, the detailed report
- **Settings** — without the control panel

Is: **admin minus Branches, Staff, Control panel.**

### Food auditor (quality control)
- His own checklist: **same machinery as hygiene** — same points system,
  signature, location, branch, brand, supervisor — with **different questions**
  and a **photos section**.
- Charges penalties by hand on a supervisor or a branch manager during a visit.
- **Nothing of his fires automatically.** Revisit if that changes.
- Can write notes about **hygiene** problems he sees; those surface for the
  hygiene auditor.

### Both auditors together
**See everything. Edit only your own kind.**

- Hygiene auditor sees hygiene and food results, edits only **hygiene** penalties
- Food auditor sees both, edits only **food** penalties
- The monthly report is one shared document both work on

This means every penalty carries a **source** — hygiene, food, late checklist,
marination — and the source decides who may touch it.

### Operations manager
- **Reads everything. Changes nothing day to day.**
- **No automatic notifications.** He is never disturbed by the system.
- Can chase: open a branch that was late and see why.
- Gets pinged **only when a human decides it matters** — an auditor sends him
  *"call the Karbala manager, critical issue, needs follow-up."* One-way. He
  does not report back; he will phone whoever he wants.
- **His authority lives at month end** (section 5), where he can wipe or edit
  anything before the month closes.

### Branch manager
**Removed from him:**
- Verifying checklists — now the hygiene auditor's job
- Managing his supervisors — he can **see** who is on his branch and nothing
  more. No adding, changing, deleting, resetting.
- Adjusting audits

**Keeps:**
- Does his own checklist
- Sees the marination in progress and the **empty-the-bucket** button
- Oil test at any time, not tied to the supervisor's slots
- Sees that a supervisor's checklist is done, and can **export it** — for when a
  supervisor's phone is broken

**New:**
- **Sets the shifts** (section 3)
- Sees **his own penalties** and **his supervisors' penalties**, read-only
- Sees **his branch's score** this month, read-only
- **No late warnings** — those go to supervisors only

He does the work, watches the branch, chases problems, and decides nothing.

### Supervisor
Everything he has today — his checklist, oil tests on the slots, marination —
plus, on his dashboard:
- **His own penalties** — what he owes and why
- **His own warnings** — before they become money
- **His own score** — his alone. No comparison with other supervisors.

### Who creates whom

| Creates → | Super admin | Admin | Everyone else |
|---|---|---|---|
| Admin | yes | **no** | no |
| Hygiene auditor | yes | yes | no |
| Food auditor | yes | yes | no |
| Operations manager | yes | yes | no |
| Branch manager | yes | yes | no |
| Supervisor | yes | yes | no |

---

## 2. The control panel

A new screen reached from Settings. **Admin and super admin only.**
It is the single source of truth for how the app behaves.

| Setting | Scope |
|---|---|
| **Point value** — 1 point = X IQD | whole company |
| **Check-in distance** — metres | per branch, list of branches, plus "set all" |
| **Fryers** — add and manage | per branch, choose the branch first |
| **Push test** — send a test notification | to a whole branch, or to chosen people |
| **Oil test times** — add, change, remove | whole company |
| **Oil test grace** | whole company |
| **Marination hours** | whole company |
| **Marination early grace** and **late grace** — two separate numbers | whole company |
| **Checklist times + grace** | per branch |
| **Penalty amounts** — late checklist, marination | each rule its own flat IQD amount |

### Why this matters more than it looks
Several of these numbers are written **inside the app's code** today —
marination = 3 hours, the oil grades, the 5-minute grace. Changing one means a
new build and a new release.

Moving them into the database is the real work of this phase. After that, a
change in the control panel takes effect **immediately**, everywhere, with no
rebuild and nothing to install:

> Change the oil test from 2:00 PM to 4:00 PM → all branches, the notifications,
> and every phone follow at once. The app reads the time; it does not carry it.
> (Anyone with the app already open sees it after a refresh, and a reminder that
> already fired today stays fired.)

### Settings, after the cleanup
Personal only, the same for everyone: profile · org name and ID · recovery email
· theme · language · push notifications for this device · sign out.
Admins and the super admin also see the **Control panel** row.

---

## 3. Shifts

The branch manager sets his supervisors' shifts in his Staff tab:
**Oday → AM / PM / OFF.** One day at a time, or a week ahead. A daily
notification nudges him to set them.

This is what makes the warnings fair — a man who is off is never warned.

---

## 4. Warnings and penalties

### Points and money are two separate things
- **Points** — the checklist and audit score. Points × point value = IQD.
- **Penalties** — a flat amount typed into the control panel. Nothing to do with
  points. Each rule has its own amount.

### What happens when time runs out

| | Shifts set | Shifts not set |
|---|---|---|
| **Warning** | the scheduled supervisor | everyone at the branch |
| **Done late** | that person pays | whoever actually did it pays |
| **Never done at all** | scheduled supervisor pays | **the branch manager pays** |

The manager pays in **one case only**: the check never happened. That is the one
case with no supervisor to blame, and the only thing that stops skipping a
food-safety check entirely from being cheaper than doing it late.

Like every penalty, it is not final — admin or hygiene auditor still press Keep
or Wipe.

### The supervisor must explain
Whenever he is late, he types the real reason. Same as the oil test.

### Keep / Wipe
On the checklist itself, the admin or hygiene auditor press:
- **Keep** — it stands
- **Wipe** — gone for everyone, with a message to the supervisor: *"you will not
  be punished this time"*

**A wipe leaves a trace.** The record stays and is marked cleared, by whom and
why. Only the money goes to zero. Otherwise nobody can tell next month whether a
man was clean or forgiven.

### Who owns which penalty

| Penalty from | Who can Keep / Wipe / reduce |
|---|---|
| Late checklist, marination (automatic) | admin, hygiene auditor |
| Hygiene audit | hygiene auditor, admin |
| Food audit | food auditor, admin |
| Anything | super admin, and the operations manager at month end |

---

## 5. Closing the month

The month is a **chain**, not a button.

1. **Hygiene auditor** flags: time to decide the penalties
2. → the **food auditor** is notified — confirm or change his own penalties
3. **Food auditor** decides
4. **Hygiene auditor** decides on hers
5. → the report goes to the **operations manager**
6. He reviews the final numbers per supervisor — wipe all, edit, whatever he
   judges right. **His changes are recorded with a reason.**
7. → the report goes **back to both auditors**, who read his notes
8. **The month closes.** Either the hygiene auditor or the admin can close it, so
   a forgotten close never blocks the company.

**If someone does not act**, the chain does not stall: the hygiene auditor
carries on without them and their penalties stand as they are.

---

## 6. The monthly statement

Per person, after the close:

```
Audit score      5 points × 25,000  =  125,000
Late checklist   3 × 20,000         =   60,000
Marination       4 × 25,000         =  100,000
                              Subtotal  285,000
Reduction (Fatima, admin)            − 200,000
                                 Final   85,000
```

- Every penalty listed with **the day it happened and the real reason**
- The **reduction** line is optional, and records who reduced it and why
- Exportable, sent to each person by **WhatsApp or email**

**Branch report:** each supervisor and the manager, visits this month split
**AM and PM**, who collected the most penalties, best supervisor.

**Dashboard:** a score per branch.

### Already safe
A submitted checklist **freezes** its own score — `points_awarded`, `score` and
even `iqd_per_point` are stored on the submission. Changing the point value next
month does not move last month's money.

### One gap to close first
The answer rows store the *question text* but not what that question was
**worth** at the time. The totals are safe, but a per-question breakdown would be
rebuilt from today's template and could show a wrong number. Store the point
weight on the answer row, exactly as the question text already is — before the
detailed statement is built.

---

## 7. Being removed

- **The "+" / New Audit screen, entirely.** It is confusing and each of its three
  parts has a better home:
  - *Audit type* → an audit is started from the dashboard
  - *Daily checklist* → not needed. The **role** decides: supervisors fill the
    supervisor checklist, managers fill theirs. The template is edited in the
    Checklists tab.
  - *One-off task* → deleted.
- **Checklists appearing in both the Checklists tab and History** — pick one
  place.
- **Verify**, from the branch manager.
- **The zoom-out button** — already done.

---

## 8. His answers on the numbers (2026-09-24)

| | Decision |
|---|---|
| **Marination time** | **3 hours**, and changeable in the control panel — 2.5, 4, 5. **The reminder follows whatever it is set to**, it is not a separate number. |
| **Checklist grace** | Per branch, in the control panel. 30 or 60 minutes, agreed between the admin and the auditor. |
| **Penalty amounts** | In the control panel, changeable at any time. **Changing one never touches penalties already given — only new ones.** |
| **Oil test grace** | In the control panel, 10 to 60 minutes or more. A meeting with both auditors decides, then the admin sets it once for everyone. |
| **"Never done" fires** | **At the next shift's time**, not at end of day. |
| **The one-minute-late batch** | Not a problem. A 5-minute grace already exists (`GRACE_MS`, `src/lib/marination.ts`) and 15:00:59 reads *on time*. Nothing to change. |

### A rule that falls out of this
**A penalty freezes its amount when it is created.** Same principle as the
checklist score, which already freezes `points_awarded`, `score` and
`iqd_per_point`. Raise the late-checklist penalty from 20,000 to 30,000 and
last month's 20,000 penalties stay at 20,000.

### Removing the chicken EARLY — a violation, and a serious one

His words: *"yes and its a big issue, removing before 3 hours."* Out at 2.5 hours
means the marination never completed and under-marinated chicken reached
customers. Today the app only checks the late side, so a real Karbala row
marinated 12:00 and removed 12:00 — **zero minutes in the vinegar** — grades
*"on time"*.

What happens instead:
- **A warning**, not an automatic penalty
- It goes to the **hygiene auditor and the branch manager**, not to the
  supervisor — they follow up on *why* it happened
- The auditor can then turn it into a penalty if the reason does not hold up,
  the same way she owns the other automatic penalties

Note this is the only rule whose warning goes **upward** rather than to the
person who did it. It is a "find out what happened" signal, not a fine.

### The two graces are separate numbers

Agreed 2026-09-24: **an early grace and a late grace, each set on its own** in
the control panel. One number for both would be wrong, and his own figures show
why — he wants a late grace of up to an hour, because the man simply forgot.
Apply that same hour to the early side and chicken pulled at **two hours** would
count as on time, which is the exact thing he called a big issue.

| | What it means | Typical grace |
|---|---|---|
| **Late** | He forgot. Over-marinated — bad, not dangerous | generous, 30–60 min |
| **Early** | He pulled it deliberately. Under-marinated chicken went out | tight, 5–10 min |

So a batch is on time between `marinated + hours − earlyGrace` and
`marinated + hours + lateGrace`. Before that window → warning upward to the
hygiene auditor and the branch manager. After it → late, penalty on the
supervisor.

The early grace should never be set as loose as the late one. Worth a quiet
hint in the control panel when someone tries.

Still parked: the **Learning zone**, renaming "admin", and per-question photos
for supervisors *(an auditor photographing a few things on a visit is a
different scale and is approved)*.

Still blocked, unrelated: **recovery email / SMTP**.

## 9. Build order

Discussion order and build order are not the same. Roles were settled first
because everything else depends on knowing who may do what — but roles are built
later, because they touch 17 security policies on a system the branches are
using right now.

| Phase | What | Depends on |
|---|---|---|
| **1** | Control panel shell + point value, distance, fryers, Settings cleanup | nothing |
| **2** | Move the hardcoded rules into the database — oil times, marination, checklist times, graces, penalty amounts | 1 |
| **3** | Push test · recovery email / SMTP | nothing |
| **4** | **Roles** — the seven, and who creates whom | ← the critical path |
| **5** | Rules that fire by themselves — the server watches the clock, warnings, penalties, shifts, Keep/Wipe | 2, 4 |
| **6** | The food auditor's own audit | 4 |
| **7** | Reports — monthly statement, reduction, export, branch report, dashboard scores | 5, 6 |
| **8** | Learning zone | — |

Phases 1–3 can start today.

### How it gets built
The same way the Brands feature was built, which worked: a spec, then a plan
broken into small verifiable tasks, then one agent implements each task and a
second, independent agent reviews it — then **one review over the whole feature
at the end**. That final review is what caught the real bug last time. Every
step verified against the live database, not assumed.
