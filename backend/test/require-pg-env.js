// `npm run test:pg` guard: without Postgres the .pg specs skip themselves,
// which would let CI pass without testing anything.
const { PG_TEST_URL, DATABASE_URL } = process.env;
if (!PG_TEST_URL || !DATABASE_URL || PG_TEST_URL !== DATABASE_URL) {
  console.error('Set PG_TEST_URL and DATABASE_URL to the same Postgres URL.');
  process.exit(1);
}
