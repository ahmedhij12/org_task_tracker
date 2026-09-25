/**
 * The one place that decides whether a batch of chicken came out of the vinegar
 * on time. The dashboard monitor, the live countdown and the history all read
 * this, so an admin can never be shown "on time" on one screen and "late" on
 * another.
 *
 * The numbers are the control panel's (org_settings, via useOrgSettings): the
 * marination hours, and two SEPARATE graces — a tight early one (pulled out
 * before its time = under-marinated, a food-safety breach) and a looser late
 * one (forgotten in the vinegar). One number cannot do both jobs: a late grace
 * of an hour would let chicken pulled at two hours count as on time.
 *
 * Mirrors the database: submit_chicken_marination sets remind_at to
 * marinated_at + marination_hours_for(org), and FREEZES the rule on the row
 * (due_at and both graces), like a checklist's score — so changing the control
 * panel never re-grades yesterday's batches. A row's frozen rule always wins;
 * the control panel's rules only fill in for a row that has none.
 *
 * No "@/..." imports: scripts/test/marination.test.mjs loads this file
 * straight into Node.
 */
export interface MarinationRules {
  hours: number;
  earlyGraceMin: number;
  lateGraceMin: number;
}

/** What was live before the control panel: 3 h, a 5-minute late grace; the early grace is new. */
export const DEFAULT_MARINATION_RULES: MarinationRules = { hours: 3, earlyGraceMin: 5, lateGraceMin: 5 };

export type MarinationState = 'marinating' | 'overdue' | 'onTime' | 'early' | 'late';

export interface MarinationStatus {
  state: MarinationState;
  /** Milliseconds left (still in), past the deadline (overdue / out late), or short of it (out early). */
  ms: number;
}

type Batch = {
  marinatedAt: string;
  unloadedAt?: string | null;
  dueAt?: string | null;
  earlyGraceMin?: number | null;
  lateGraceMin?: number | null;
};

/** When this batch should be out of the vinegar: its own frozen time if it has one. */
export function dueAt(r: Batch, rules: MarinationRules = DEFAULT_MARINATION_RULES): number {
  if (r.dueAt) return new Date(r.dueAt).getTime();
  return new Date(r.marinatedAt).getTime() + rules.hours * 3600000;
}

export function marinationStatus(
  r: Batch,
  rules: MarinationRules = DEFAULT_MARINATION_RULES,
  now: number = Date.now()
): MarinationStatus {
  const due = dueAt(r, rules);
  const earlyGraceMin = r.earlyGraceMin ?? rules.earlyGraceMin;
  const lateGraceMin = r.lateGraceMin ?? rules.lateGraceMin;
  const out = r.unloadedAt ? new Date(r.unloadedAt).getTime() : null;
  // A removal time that has not arrived yet is not a removal. The sheet lets
  // the time be typed, so someone can enter "out at 4 PM" at 1:47 PM — and we
  // used to answer "Removed on time" about chicken still sitting in vinegar.
  // Until that moment passes the batch is exactly what it is: still in.
  if (out == null || out > now) {
    const left = due - now;
    return left < 0 ? { state: 'overdue', ms: -left } : { state: 'marinating', ms: left };
  }
  const over = out - due;
  if (over < -earlyGraceMin * 60000) return { state: 'early', ms: -over };
  if (over > lateGraceMin * 60000) return { state: 'late', ms: over };
  return { state: 'onTime', ms: Math.abs(over) };
}

/** "2h 15m" / "40m" — always a positive span, so pass an absolute value. */
export function humanSpan(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
