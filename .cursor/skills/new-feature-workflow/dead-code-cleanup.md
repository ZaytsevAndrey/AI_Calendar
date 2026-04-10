# Phase 3 — Dead code & leftovers

## Goals

After behavior or requirements shift, remove **unused** or **obsolete** pieces so the codebase does not accumulate cruft.

## Steps

1. **Compare intent vs reality**: list code paths added for old behavior that no longer apply.
2. **Search for usage** before deleting:
   - exports, imports, DI tokens, string-based references (routes, config keys)
   - dead feature flags and branches left behind
3. **Remove**:
   - unused files, functions, types, CSS, copy, translation keys (if applicable)
   - obsolete migrations-only helpers **only** if truly unused and safe
4. **Tighten public surface**: narrow exports if the feature no longer needs them.
5. **Run** project checks (typecheck / lint / tests) and the **root build** if that is how the repo validates production output; fix fallout.

## Guardrails

- Do not delete code **shared** by other features without confirming references.
- Prefer **one focused cleanup commit** (or clearly separated commits) so review is easy.

## Output

- List of **removed** symbols / files (short)
- Anything **kept intentionally** and why
