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

/** A clock time with no date — "19:00", or "19:00:00" as a Postgres `time`
 * arrives — as "7:00 PM". Already the branch's own clock, so no zone. */
export function clockLabel(at: string, locale?: string): string {
  const [h, m] = at.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
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

/** "HH:MM at the branch" on a given branch day ("YYYY-MM-DD"), as a timestamp. */
export function isoForBranchDayTime(day: string, time: string, tz: string = BAGHDAD): string | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  const dm = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !dm) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, mi, 0, 0);
  const off = offsetMinutes(new Date(guess), tz);
  return new Date(guess - off * 60000).toISOString();
}

/**
 * The moment a corrected start time means: that HH:MM on the day the batch
 * was recorded — or the day before, when that would still be in the future
 * (a batch recorded at 00:20 that really went in at 23:40).
 */
export function correctedStartIso(recordedIso: string, time: string, tz: string = BAGHDAD, now: number = Date.now()): string | null {
  const day = dayKey(recordedIso, tz);
  const same = isoForBranchDayTime(day, time, tz);
  if (!same) return null;
  if (new Date(same).getTime() <= now) return same;
  const prev = new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  return isoForBranchDayTime(prev, time, tz);
}
