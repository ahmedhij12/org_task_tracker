// Run: node scripts/test/checkIn.test.mjs
// Node 22 strips the TypeScript itself, so this imports the real module.
// Keep src/lib/checkIn.ts free of "@/..." imports or this cannot load it.
import assert from 'node:assert/strict';
import { metersBetween, checkInFor, CHECK_IN_MIN_M, CHECK_IN_MAX_M, DEFAULT_CHECK_IN_M } from '../../src/lib/checkIn.ts';

const branch = { lat: 33.3, lng: 44.4, radiusM: 15 };
const at = (dLat, accuracyM) => ({ lat: 33.3 + dLat, lng: 44.4, accuracyM });

// 0.001 degree of latitude is 111.19 m on a 6,371 km earth.
assert.equal(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.3, lng: 44.4 }), 0);
assert.equal(Math.round(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.301, lng: 44.4 })), 111);

// 11 m, inside a 15 m circle: in the kitchen, whatever the accuracy.
assert.deepEqual(checkInFor(at(0.0001, 40), branch), { meters: 11, radiusM: 15, accuracyM: 40, status: 'in' });
// Exactly on the edge counts as inside.
assert.equal(checkInFor(at(0.0001, 5), { ...branch, radiusM: 11 }).status, 'in');
// 33 m with a tight 5 m reading: even the nearest possible point (28 m) is outside → not in the kitchen.
assert.deepEqual(checkInFor(at(0.0003, 5), branch), { meters: 33, radiusM: 15, accuracyM: 5, status: 'out' });
// 33 m but the GPS is ±30 m: he may well be inside → unclear, never an accusation.
assert.equal(checkInFor(at(0.0003, 30), branch).status, 'unclear');
// The edge of doubt: 33 - 18 = 15, not beyond the circle → unclear; ±17 → out.
assert.equal(checkInFor(at(0.0003, 18), branch).status, 'unclear');
assert.equal(checkInFor(at(0.0003, 17), branch).status, 'out');
// No accuracy reported and outside: cannot be sure → unclear.
assert.equal(checkInFor({ lat: 33.3003, lng: 44.4 }, branch).status, 'unclear');
// Far away with a weak reading is still out: 111 m ± 40 m.
assert.equal(checkInFor(at(0.001, 40), branch).status, 'out');

// Nothing to compare -> null, never a fake distance.
assert.equal(checkInFor({ lat: null, lng: null }, branch), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, { lat: null, lng: null, radiusM: 15 }), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, undefined), null);
// A Team whose radiusM is missing uses the live default, 15 m.
assert.equal(checkInFor(at(0.0003, 5), { lat: 33.3, lng: 44.4 }).radiusM, DEFAULT_CHECK_IN_M);

assert.equal(CHECK_IN_MIN_M, 5);
assert.equal(CHECK_IN_MAX_M, 2000);
assert.equal(DEFAULT_CHECK_IN_M, 15);

console.log('PASS: checkIn');
