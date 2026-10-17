# Feature documentation

One file per feature. English. Present tense, as the feature works today.

Thin bullet lists are not enough. The file must teach a reader who has never seen the code how the feature behaves **and** how the logic decides.

## Where

- New feature: `documentation/features/<slug>.md` (kebab-case, stable).
- Already documented (that file, or an older `documentation/spec-*.md` / topical file that is this feature): update that file. Do not add a second copy.
- Cross-cutting docs stay at `documentation/` root (`overview.md`, `api-reference.md`, `roadmap.md`, and the rest). They are not a substitute for the feature file.

## When

1. **After planning**, once blocking questions are answered (or explicitly waived): create the feature file from the plan. Status `planned`.
2. **Before the commit**: rewrite it so it matches what shipped. If implementation did not diverge, set status to `shipped` and leave the rest.
3. **Same commit**: update the doc of every other feature whose behavior this change altered. If that feature has no doc, create `documentation/features/<slug>.md` for the behavior as it works now.

Do not revise the feature file on every experiment during implementation. The pre-commit pass is the correction.

## Required depth

- **Purpose** — why the feature exists in one short paragraph.
- **User-facing behavior** — every entry point, control, and outcome the user can hit.
- **Logic** — decision order, filters, defaults, what is written where (API, DB, provider). Name the important rules; do not paste large code blocks.
- **Edge cases** — what the code actually does on overlaps, empty data, provider failure, series, phone vs desktop, etc.
- **Data / settings / API** — fields, routes, env vars that belong to this feature (skip if none).
- **Out of scope** — explicit non-goals and pointers to other docs.
- **Known gaps** — behavior that looks shipped in UI but is incomplete or wrong in code (document truthfully).
- **Related** — links to other feature docs and specs.

Match the density of [task-creation-rules.md](../../../documentation/task-creation-rules.md): enough that product and engineering can argue from the doc without opening the repo for the happy path.

## Template

```markdown
# Feature name

Status: planned | shipped

## Purpose

## User-facing behavior

## Logic

## Edge cases

## Data / settings / API

## Out of scope

## Known gaps

## Related
```
