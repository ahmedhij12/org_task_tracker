// Run: node scripts/test/time.test.mjs
import assert from 'node:assert/strict';
import { correctedStartIso, isoForBranchDayTime } from '../../src/lib/time.ts';

const tz = 'Asia/Baghdad'; // UTC+3, no DST
assert.equal(isoForBranchDayTime('2026-09-25', '14:30', tz), '2026-09-25T11:30:00.000Z');
assert.equal(isoForBranchDayTime('2026-09-25', '25:00', tz), null);
// Recorded 10:12 Baghdad, really went in at 09:00 → same day.
const now = Date.parse('2026-09-25T09:00:00Z'); // 12:00 Baghdad
assert.equal(correctedStartIso('2026-09-25T07:12:00Z', '09:00', tz, now), '2026-09-25T06:00:00.000Z');
// Recorded 00:20 Baghdad on the 26th, really in at 23:40 → the 25th.
const late = Date.parse('2026-09-25T21:30:00Z'); // 00:30 Baghdad on the 26th
assert.equal(correctedStartIso('2026-09-25T21:20:00Z', '23:40', tz, late), '2026-09-25T20:40:00.000Z');
console.log('PASS: time');
