# Phase 6 — Wrap-up

## Before handoff

1. **Confirm Phase 5** — new/changed behavior is covered by tests and the relevant commands passed (or the user explicitly waived tests).
2. **Summarize** for the user: user-visible behavior, config/env changes, migrations.
3. **Rollback / feature flag** notes if applicable.
4. **Follow-ups** as an explicit list (deferred questions, tech debt, untested gaps).

## PR / commit hygiene (if the user uses Git)

- Commits tell a **story**: implement → cleanup → simplify → tests (or separate commits with clear messages).
- PR description links **decisions** from Phase 1 when non-obvious.

## Done criteria

- No known **blocking** bugs for the agreed scope
- No obvious **unused** code left from the change
- **Simplification** pass completed or explicitly skipped with reason
- **Tests** for the feature exist and pass (Phase 5), unless explicitly waived
- **Build** still succeeds from the project root (or standard CI build)—re-run if there were late edits after Phase 2

## Push

When the feature is done, the root build succeeds, **all tests passed**, and the **end-to-end** suite passed too, commit the feature and **push the current branch immediately**. Do not wait for a separate push request.

Do not push when tests were skipped, end-to-end was not run, or end-to-end failed. Leave unrelated uncommitted work out of the commit.
