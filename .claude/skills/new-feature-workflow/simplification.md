# Phase 4 — Simplify & best practices

## Goals

Make the solution **easier to read and maintain** without changing behavior (unless a small fix is required for clarity).

## Steps

1. **Read the diff / changed files** as a reviewer would.
2. **Compress complexity**:
   - merge duplicate conditionals; extract small helpers only when repetition is real
   - prefer early returns over deep nesting
   - align error messages and types with project style
3. **Apply domain-appropriate best practices** (examples):
   - validate inputs at boundaries; fail with clear errors
   - avoid leaking implementation details in API responses
   - keep side effects in obvious places
4. **Performance sanity**: avoid accidental N+1 queries or pointless re-renders; only optimize if justified.
5. **Re-run** checks after refactors.

## Stop conditions

- If simplification would **blur** important edge-case handling, keep the explicit version and add a **one-line comment** only where the project already uses that pattern.

## Output

- **What** was simplified
- **Risk assessment** (low/med) for the refactor
