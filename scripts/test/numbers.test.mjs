// Run: node scripts/test/numbers.test.mjs
import assert from 'node:assert/strict';
import { toNumber } from '../../src/lib/numbers.ts';

const cases = [
  ['3', 3], ['٣', 3], ['١٢', 12], ['۴', 4], ['2.5', 2.5], ['٢٫٥', 2.5], ['2,5', 2.5],
  [' 7 ', 7], ['', null], ['abc', null], [null, null], ['٣a', null],
];
for (const [input, want] of cases) assert.equal(toNumber(input), want, `toNumber(${JSON.stringify(input)})`);
console.log(`PASS: ${cases.length} cases`);
