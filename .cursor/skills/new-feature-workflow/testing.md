# Phase 5 — Tests

Cover the feature with tests **before wrap-up**. Implementation is not done until new or changed behavior has automated coverage.

## Preconditions

- Phases 2–4 are complete (behavior matches intent, leftovers removed, simplification done).
- Do **not** skip this phase unless the user **explicitly** waived tests in writing.

## What to cover

Write tests for the **agreed scope**, not unrelated modules.

1. **Happy path** — the user-visible / API behavior that ships.
2. **Must-not-break** flows from Phase 1 (regressions around the same code).
3. **Edge cases** that the feature actually handles (permissions, empty state, invalid input, failure / rollback).
4. **Do not** add tests for code you did not change, or speculative cases outside scope.

## How to write them

- **Match existing patterns** in the same area: colocated `*.spec.ts` / `*.spec.tsx`, Jest, mocks, naming, and assertion style.
- Prefer **unit / focused** tests next to the changed module (service, util, hook, controller).
- Add or extend **e2e** (`backend` `test:e2e`) only when the feature is an HTTP/integration contract and that suite already covers similar flows.
- **English** in test names, describe blocks, and comments (same as Phase 2).
- If a test would need heavy UI browser automation, still add the closest automated substitute (unit/hook/util) rather than skipping coverage.

## Steps

1. List behaviors from the plan that need assertions (short bullet list).
2. Add or update specs beside the changed files; reuse existing test helpers.
3. Run the relevant workspace tests, then root `npm test` (or the documented equivalent) if the change spans workspaces.
4. Fix failures caused by the feature. Do not weaken or delete unrelated failing tests without asking.

## Done criteria

- New/changed behavior has automated tests
- Relevant test command(s) pass, including the end-to-end suite when this feature is on an HTTP or UI path
- No skipped/`it.skip` / `xit` left for this feature unless the user agreed to defer a case
- Passing all tests and end-to-end unlocks the wrap-up push in [wrap-up.md](wrap-up.md); do not push if end-to-end was skipped or failed

## Output

- What was tested (behaviors, not just file names)
- Commands run and that they passed
- Gaps left untested and why (if any)
