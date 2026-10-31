/**
 * Active structured regression gate for voice vNext (Stage 4.1).
 * Every suite here drives the structured path and must pass.
 * Historical suites that still assert removed V1 mechanisms run with `npm run test:vnext:historical`;
 * their classification is in documentation/scheduling-stabilization-progress.md (stage F1);
 * the original STAGE-4.1-REPORT was deleted and never committed (documentation/voice-agent-roadmap.md,
 * "Missing historical context").
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
    // V7: the live sets' shape and the production-faithful live harness (no model is called).
    `${VNEXT}/eval/english-set.spec.ts`,
    `${VNEXT}/eval/live-service-harness.spec.ts`,
  ],
};
