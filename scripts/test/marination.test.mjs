// Run: node scripts/test/marination.test.mjs
import assert from 'node:assert/strict';
import { marinationStatus, dueAt, DEFAULT_MARINATION_RULES } from '../../src/lib/marination.ts';

const at = '2026-09-25T09:00:00Z'; // marinated
const out = (h, m = 0) => new Date(Date.parse(at) + (h * 60 + m) * 60000).toISOString();
const now = Date.parse('2026-09-26T00:00:00Z');
const s = (unloadedAt, rules) => marinationStatus({ marinatedAt: at, unloadedAt }, rules, now).state;

// Defaults: 3 h, early grace 5 min, late grace 5 min.
assert.equal(dueAt({ marinatedAt: at }), Date.parse(at) + 3 * 3600000);
assert.equal(s(out(3)), 'onTime');
assert.equal(s(out(3, 5)), 'onTime');     // late grace edge
assert.equal(s(out(3, 6)), 'late');
assert.equal(s(out(2, 55)), 'onTime');    // early grace edge
assert.equal(s(out(2, 54)), 'early');
// The live Karbala row: out the same minute it went in — never "on time" again.
assert.equal(s(out(0)), 'early');
assert.equal(marinationStatus({ marinatedAt: at, unloadedAt: out(0) }, undefined, now).ms, 3 * 3600000);

// His numbers: 2.5 h, a generous late grace, a tight early one.
const his = { hours: 2.5, earlyGraceMin: 5, lateGraceMin: 60 };
assert.equal(s(out(3, 30), his), 'onTime');
assert.equal(s(out(3, 31), his), 'late');
assert.equal(s(out(2, 24), his), 'early');
assert.equal(s(out(2, 25), his), 'onTime');

// Still in: marinating, then overdue by the settings' hours.
assert.equal(marinationStatus({ marinatedAt: at }, his, Date.parse(out(2))).state, 'marinating');
assert.equal(marinationStatus({ marinatedAt: at }, his, Date.parse(out(2, 31))).state, 'overdue');
assert.deepEqual(DEFAULT_MARINATION_RULES, { hours: 3, earlyGraceMin: 5, lateGraceMin: 5 });

// A batch keeps the rule it was made under: frozen 3 h / 5 / 5 beats today's 4 h / 60.
const frozen = { marinatedAt: at, dueAt: out(3), earlyGraceMin: 5, lateGraceMin: 5, unloadedAt: out(3) };
assert.equal(marinationStatus(frozen, { hours: 4, earlyGraceMin: 10, lateGraceMin: 60 }, now).state, 'onTime');
assert.equal(marinationStatus({ ...frozen, unloadedAt: out(3, 6) }, { hours: 4, earlyGraceMin: 10, lateGraceMin: 60 }, now).state, 'late');
assert.equal(dueAt(frozen, { hours: 4, earlyGraceMin: 10, lateGraceMin: 60 }), Date.parse(out(3)));

console.log('PASS: marination');
