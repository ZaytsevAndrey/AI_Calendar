/**
 * Active structured regression gate for voice vNext (Stage 4.1).
 * Every suite here drives the structured path and must pass.
 * Historical suites that still assert removed V1 mechanisms run with `npm run test:vnext:historical`;
 * their classification is in docs/voice-vnext/STAGE-4.1-REPORT.md.
 */
const { testRegex, ...base } = require('./package.json').jest;
void testRegex;

const VNEXT = '<rootDir>/modules/voice/vnext';

module.exports = {
  ...base,
  testMatch: [
    // Structured contract, state machine, and Stage 4 / 4.1 behavior.
    `${VNEXT}/contracts/**/*.spec.ts`,
    `${VNEXT}/state/**/*.spec.ts`,
    `${VNEXT}/phase4712*.spec.ts`,
    // Production /voice/turn wiring.
    `${VNEXT}/production/**/*.spec.ts`,
    `${VNEXT}/search/**/*.spec.ts`,
    `${VNEXT}/broker/**/*.spec.ts`,
    // Historical suites that pass in full on the structured path. Kept as behavioral coverage.
    `${VNEXT}/phase46.spec.ts`,
    `${VNEXT}/phase472.spec.ts`,
    `${VNEXT}/phase473.spec.ts`,
    `${VNEXT}/phase477.spec.ts`,
    `${VNEXT}/eval/arm-a-live.spec.ts`,
  ],
};
