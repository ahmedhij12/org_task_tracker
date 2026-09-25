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
