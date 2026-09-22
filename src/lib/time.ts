/**
 * Everything happens in Iraq, so times and "which day" must be Baghdad's, not
 * whatever a phone or laptop happens to be set to. Asia/Baghdad is UTC+3 with
 * no daylight saving. Always format and bucket through here.
 */
export const BAGHDAD = 'Asia/Baghdad';

/** "3:28 PM" in Baghdad time, 12-hour. */
export function timeOf(iso: string, locale?: string, tz: string = BAGHDAD): string {
  return new Date(iso).toLocaleTimeString(locale, {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/** A date label in Baghdad time, e.g. "Tue, 22 Sep". */
export function dateOf(iso: string | Date, locale?: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }, tz: string = BAGHDAD): string {
  return new Date(iso).toLocaleDateString(locale, { timeZone: tz, ...opts });
}

/** Stable "YYYY-MM-DD" key for the Baghdad day a timestamp falls on — use this
 * to group records by day instead of the device's own calendar day. */
export function dayKey(iso: string | Date, tz: string = BAGHDAD): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Today's Baghdad day key. */
export function todayKey(tz: string = BAGHDAD): string {
  return dayKey(new Date(), tz);
}

/** The zone's offset in minutes at a given moment (positive = ahead of UTC). */
function offsetMinutes(at: Date, tz: string): number {
  // Compare the same instant rendered in the zone against UTC.
  const inZone = new Date(at.toLocaleString('en-US', { timeZone: tz }));
  const inUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((inZone.getTime() - inUtc.getTime()) / 60000);
}

/** Builds a timestamp meaning "HH:MM today AT THE BRANCH" from a time-picker
 * value, in the branch's own zone. Blank or half-typed input falls back to now.
 * Works for any region, and reads the zone's real offset so DST is handled. */
export function isoForBranchTime(time: string, tz: string = BAGHDAD): string {
  const m = time.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  const now = new Date();
  if (!m) return now.toISOString();
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return now.toISOString();
  const [y, mo, d] = todayKey(tz).split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const off = offsetMinutes(new Date(guess), tz);
  return new Date(guess - off * 60000).toISOString();
}
