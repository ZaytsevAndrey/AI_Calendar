# Phase 2 — Implementation

## Preconditions

- Blocking questions from Phase 1 are **answered**, or the user **explicitly** waived them in writing.

## Principles

- **Smallest viable change** that meets the agreed scope.
- **Match existing patterns** in the codebase (naming, layers, error handling, tests).
- **No drive-by refactors** unrelated to the feature.
- **English in code**: use **English only** for identifiers, comments, JSDoc/TSDoc, and technical strings you add or change (logs aimed at developers, non-localized API messages, etc.). **End-user UI copy** may stay in the product language if that is already the convention in the same area—when in doubt, confirm in Phase 1.

## Steps

1. **Locate touchpoints**: routes, modules, state, DB, jobs, config, env vars.
2. **Sketch the change** as a short bullet plan (files / modules), then implement.
3. **Instrument for debuggability** only where the project already does (logging, metrics)—do not add noise.
4. **Verify locally** before treating Phase 2 as done:
   - typecheck / lint (if used in the repo),
   - unit tests (if present),
   - **full project build** from the **repository root** (e.g. `npm run build` or the documented equivalent) and fix **all** compilation/bundling errors—do not hand off with a failing build.
5. If scope creep appears, **stop** and ask whether to extend the feature or split follow-up work.

## When stuck

- Prefer **one** clarifying question over guessing product behavior.
- If two designs are viable, state **trade-offs** in 2–3 bullets and ask for a preference.

## Output

- What changed (high level)
- How to **exercise** the feature (steps or commands)
- Confirmation that **root/workspace build** completed without errors (command used)
- Known **limitations** or follow-ups
