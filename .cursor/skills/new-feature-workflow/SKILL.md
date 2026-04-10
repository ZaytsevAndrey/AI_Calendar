---
name: new-feature-workflow
description: >-
  Guides end-to-end development of a new product feature: plan, surface open
  questions and get answers before coding, implement with minimal scope creep,
  remove obsolete code after behavior changes, then simplify using best
  practices. Use when the user starts or discusses a new feature, greenfield
  work, or asks for a structured feature delivery flow.
---

# New feature workflow

## Role

Act as a **workflow orchestrator**. Follow the phases in order. Do not skip **Planning** or **Question gate** unless the user explicitly says requirements are already frozen and complete.

## Architecture (how this scales)

- **This repo**: one **entry skill** (`new-feature-workflow`) plus **phase files** in the same folder. Keeps discovery simple and avoids loading many skills at once.
- **To grow**: add a new phase file (e.g. `security-review.md`) and link it below; or extract a **narrow** standalone skill later (separate folder + its own `description`) only when a phase should trigger **on its own** (e.g. “dead code audit” without the full feature flow).
- **Agents vs skills**: use **one skill** for the full pipeline; use **separate agent sessions** for heavy exploration vs implementation if the product UI allows—this pack stays skill-based and copy-paste friendly.

## Phase map

| Phase | Read when |
|------|-----------|
| 1. Planning & questions | Starting the feature |
| 2. Implementation | After all blocking questions are answered |
| 3. Dead code & leftovers | After implementation compiles and behavior matches intent |
| 4. Simplify & best practices | After cleanup |
| 5. Wrap-up | Before handoff / PR |

Detailed steps:

1. **Planning & questions** — [planning.md](planning.md)
2. **Implementation** — [implementation.md](implementation.md)
3. **Dead code & leftovers** — [dead-code-cleanup.md](dead-code-cleanup.md)
4. **Simplify & best practices** — [simplification.md](simplification.md)
5. **Wrap-up** — [wrap-up.md](wrap-up.md)

## Master checklist (copy into chat when starting)

```text
New feature — progress
- [ ] Phase 1: Plan + open questions; blocking items answered (or explicitly waived)
- [ ] Phase 2: Implemented minimal change set; English in code; root build passes
- [ ] Phase 3: Removed unused / obsolete code paths
- [ ] Phase 4: Simplified; aligned with project conventions
- [ ] Phase 5: Wrap-up (tests, risk notes, summary; build re-checked if needed)
```

## Reuse in other projects

Copy the entire folder `new-feature-workflow/` into another repo under `.cursor/skills/new-feature-workflow/`, or into `~/.cursor/skills/new-feature-workflow/` for personal use across all projects.
