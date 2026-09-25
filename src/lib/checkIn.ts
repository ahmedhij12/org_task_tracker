// Where a record was signed, measured against its branch's check-in circle,
// with three honest answers (his choice, 2026-09-25):
//   in      — inside the circle: in the kitchen
//   out     — outside the circle EVEN AFTER allowing for the phone's own GPS
//             error: certainly not in the kitchen
//   unclear — outside the circle, but the GPS reading is too loose to say
// Indoor GPS drifts 20-50 m and the circle is often 15 m, so without the
// "unclear" answer a man standing in the kitchen would be accused. Never
// blocks anything. Each branch's circle is set in the control panel.
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
export type CheckInStatus = 'in' | 'out' | 'unclear';
export interface CheckIn { meters: number; radiusM: number; accuracyM: number | null; status: CheckInStatus }

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
 * has no pin yet. Exactly on the edge counts as inside. Outside the circle is
 * "out" only when even the closest point the GPS error allows is outside too;
 * a reading with no accuracy at all cannot be sure, so it is "unclear".
 */
export function checkInFor(
  signed: { lat: number | null; lng: number | null; accuracyM?: number | null },
  branch: BranchCircle | null | undefined,
): CheckIn | null {
  if (signed.lat == null || signed.lng == null) return null;
  if (!branch || branch.lat == null || branch.lng == null) return null;
  const radiusM = branch.radiusM ?? DEFAULT_CHECK_IN_M;
  const meters = Math.round(metersBetween({ lat: signed.lat, lng: signed.lng }, { lat: branch.lat, lng: branch.lng }));
  const accuracyM = signed.accuracyM == null ? null : Math.round(signed.accuracyM);
  const status: CheckInStatus =
    meters <= radiusM ? 'in' : accuracyM != null && meters - accuracyM > radiusM ? 'out' : 'unclear';
  return { meters, radiusM, accuracyM, status };
}
