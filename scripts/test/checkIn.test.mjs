// Run: node scripts/test/checkIn.test.mjs
// Node 22 strips the TypeScript itself, so this imports the real module.
// Keep src/lib/checkIn.ts free of "@/..." imports or this cannot load it.
import assert from 'node:assert/strict';
import { metersBetween, checkInFor, CHECK_IN_MIN_M, CHECK_IN_MAX_M, DEFAULT_CHECK_IN_M } from '../../src/lib/checkIn.ts';

const branch = { lat: 33.3, lng: 44.4, radiusM: 15 };

// 0.001 degree of latitude is 111.19 m on a 6,371 km earth.
assert.equal(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.3, lng: 44.4 }), 0);
assert.equal(Math.round(metersBetween({ lat: 33.3, lng: 44.4 }, { lat: 33.301, lng: 44.4 })), 111);

// 0.0001 deg = 11 m: inside a 15 m circle.
assert.deepEqual(checkInFor({ lat: 33.3001, lng: 44.4 }, branch), { meters: 11, radiusM: 15, outside: false });
// 0.0003 deg = 33 m: outside it.
assert.deepEqual(checkInFor({ lat: 33.3003, lng: 44.4 }, branch), { meters: 33, radiusM: 15, outside: true });
// Exactly on the edge counts as inside.
assert.equal(checkInFor({ lat: 33.3001, lng: 44.4 }, { ...branch, radiusM: 11 }).outside, false);

// Nothing to compare -> null, never a fake distance.
assert.equal(checkInFor({ lat: null, lng: null }, branch), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, { lat: null, lng: null, radiusM: 15 }), null);
assert.equal(checkInFor({ lat: 33.3, lng: 44.4 }, undefined), null);
// A Team whose radiusM is missing uses the live default, 15 m.
assert.equal(checkInFor({ lat: 33.3003, lng: 44.4 }, { lat: 33.3, lng: 44.4 }).radiusM, DEFAULT_CHECK_IN_M);

assert.equal(CHECK_IN_MIN_M, 5);
assert.equal(CHECK_IN_MAX_M, 2000);
assert.equal(DEFAULT_CHECK_IN_M, 15);

console.log('PASS: checkIn');
