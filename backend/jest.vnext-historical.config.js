/**
 * Historical voice vNext suites (pre-Stage-4.1 envelope contract). They are
 * excluded from `npm test` (the CI gate) because they fail at setup: they
 * describe targets by text instead of a catalog id and expect retired error
 * codes. The behaviors they guard are covered by the active structured gate
 * (`jest.vnext-structured.config.js`). Evidence and list:
 * documentation/scheduling-stabilization-progress.md (stage F1).
 * Run with `npm run test:vnext:historical`.
 */
const { testRegex, testPathIgnorePatterns, ...base } = require('./package.json').jest;
void testRegex;
void testPathIgnorePatterns;

const VNEXT = '<rootDir>/modules/voice/vnext';
const HISTORICAL = [
  'phase42',
  'phase43',
  'phase47',
  'phase471',
  'phase4710',
  'phase4711',
  'phase474',
  'phase475',
  'phase476',
  'phase478',
  'phase479',
  'vnext.integrity',
  'vnext',
];

module.exports = {
  ...base,
  testMatch: HISTORICAL.map((name) => `${VNEXT}/${name}.spec.ts`),
};
