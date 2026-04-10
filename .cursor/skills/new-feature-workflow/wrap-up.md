# Phase 5 — Wrap-up

## Before handoff

1. **Summarize** for the user: user-visible behavior, config/env changes, migrations.
2. **Test matrix** (even if short): happy path, permission edge, failure mode.
3. **Rollback / feature flag** notes if applicable.
4. **Follow-ups** as an explicit list (deferred questions, tech debt).

## PR / commit hygiene (if the user uses Git)

- Commits tell a **story**: implement → cleanup → simplify (or separate commits with clear messages).
- PR description links **decisions** from Phase 1 when non-obvious.

## Done criteria

- No known **blocking** bugs for the agreed scope
- No obvious **unused** code left from the change
- **Simplification** pass completed or explicitly skipped with reason
