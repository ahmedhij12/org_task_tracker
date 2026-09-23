/**
 * The one place that decides whether a batch of chicken came out of the vinegar
 * on time. The dashboard monitor, the live countdown and the history all read
 * this, so an admin can never be shown "on time" on one screen and "late" on
 * another.
 *
 * Mirrors the database: submit_chicken_marination sets remind_at to
 * marinated_at + marination_hours(), and set_chicken_unloaded clears it. We
 * measure against marinated_at + MARINATION_HOURS, which is defined for every
 * record whether or not a reminder was ever asked for.
 */
export const MARINATION_HOURS = 3;

/** A removal a few minutes past the three hours is not worth flagging. */
const GRACE_MS = 5 * 60000;

export type MarinationState = 'marinating' | 'overdue' | 'onTime' | 'late';

export interface MarinationStatus {
  state: MarinationState;
  /** Milliseconds left (still in) or past the deadline (out late / overdue). */
  ms: number;
}

/** When this batch should be out of the vinegar. */
export function dueAt(r: { marinatedAt: string }): number {
  return new Date(r.marinatedAt).getTime() + MARINATION_HOURS * 3600000;
}

export function marinationStatus(
  r: { marinatedAt: string; unloadedAt?: string | null },
  now: number = Date.now()
): MarinationStatus {
  const due = dueAt(r);
  if (!r.unloadedAt) {
    const left = due - now;
    return left < 0 ? { state: 'overdue', ms: -left } : { state: 'marinating', ms: left };
  }
  const over = new Date(r.unloadedAt).getTime() - due;
  return over > GRACE_MS ? { state: 'late', ms: over } : { state: 'onTime', ms: Math.abs(over) };
}

/** "2h 15m" / "40m" — always a positive span, so pass an absolute value. */
export function humanSpan(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
