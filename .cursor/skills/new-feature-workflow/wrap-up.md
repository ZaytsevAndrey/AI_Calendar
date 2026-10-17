# Phase 6 — Wrap-up

## Before handoff

1. **Confirm Phase 5** — new/changed behavior is covered by tests and the relevant commands passed (or the user explicitly waived tests).
2. **Correct documentation** in the same change, before the commit. Follow [feature-docs.md](feature-docs.md):
   - Rewrite this feature's doc so it matches what shipped (status `shipped`). If nothing diverged from the plan, only flip the status.
   - Update the doc of every other feature whose behavior this change altered. Create `documentation/features/<slug>.md` when that feature has no doc yet.
   - Then the cross-cutting files this change actually affected:
     - `roadmap.md` — **delete** the shipped item from the live queue. Do not leave it checked (`[x]`). This file is open work only. Point **Recommended next steps** at what is still open.
     - `roadmap-archive.md` — add the done item with a short behavior note.
     - `overview.md` — user-visible behavior in **Features**.
     - `api-reference.md` — only when routes or payload fields changed.
     - `e2e-test-coverage.md` — add cases for the new behavior; drop the item from “out of scope” once it exists.
     - Spec files (`spec-intelligent-scheduling.md`, `task-creation-rules.md`, `task-scheduling-test-matrix.md`) only when that contract changed.
     - `README.md` — refresh the **Last documentation update** line.
   Write in English. Do not rewrite unrelated sections.
3. **Summarize** for the user: user-visible behavior, config/env changes, migrations, and which docs were updated.
4. **Rollback / feature flag** notes if applicable.
5. **Follow-ups** as an explicit list (deferred questions, tech debt, untested gaps).

## PR / commit hygiene (if the user uses Git)

- Commits tell a **story**: implement → cleanup → simplify → tests (or separate commits with clear messages).
- **Commit messages describe the product change only** — why the code changed for users/devs. Do **not** mention Cursor, the agent, Copilot, ChatGPT, “AI-assisted”, “generated with…”, or any similar tooling attribution. That noise does not belong in git history.
- PR description links **decisions** from Phase 1 when non-obvious.

## Done criteria

- No known **blocking** bugs for the agreed scope
- No obvious **unused** code left from the change
- **Simplification** pass completed or explicitly skipped with reason
- **Tests** for the feature exist and pass (Phase 5), unless explicitly waived
- **Feature doc** matches shipped behavior, and docs of features this change touched are updated
- **`documentation/`** cross-cutting files match the shipped behavior (roadmap, overview, and any API/spec/e2e files the feature changed)
- **`roadmap.md` has no `[x]` items** for work that already has an archive note
- **Build** still succeeds from the project root (or standard CI build)—re-run if there were late edits after Phase 2. Run that build alone, after tests have exited ([machine load](testing.md#machine-load)).

## Push

When the feature is done, the root build succeeds, **all tests passed**, and the **end-to-end** suite passed too, commit the feature and **push the current branch immediately**. Do not wait for a separate push request. Run the full suite, e2e, and the root build one after another, never at the same time. Jest is already `--runInBand`.

Do not push when tests were skipped, end-to-end was not run, or end-to-end failed. Leave unrelated uncommitted work out of the commit.
