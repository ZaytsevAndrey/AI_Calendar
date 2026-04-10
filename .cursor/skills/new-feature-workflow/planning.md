# Phase 1 — Planning & questions

## Goals

- Understand **user value**, **scope**, and **constraints** before writing code.
- Surface **unknowns early** so implementation is not blocked mid-way.

## Steps

1. **Restate the feature** in one short paragraph (what ships, what is out of scope).
2. **Identify stakeholders / consumers**: API, UI, jobs, admins, integrations.
3. **List assumptions** explicitly. Mark each as *verified*, *likely*, or *unknown*.
4. **Draft open questions** grouped by theme (product, data model, UX, security, performance, rollout).
5. **Prioritize questions**:
   - **Blocking** — wrong answer would invalidate the design or require a large rewrite.
   - **Non-blocking** — can default sensibly and document the default.
6. **Present questions to the user** in a compact list. Wait for answers on **blocking** items before Phase 2.
7. **Record decisions** (even “we defer X to v2”) so later phases do not re-litigate.

## Question prompts (examples)

- What is the **happy path** and the **must-not-break** existing flows?
- Any **compatibility** requirements (mobile, offline, API versioning)?
- **Permissions** and **data sensitivity**?
- **Idempotency** / retries for writes or side effects?
- **Feature flag** or gradual rollout?

## Output

- Short **plan summary**
- **Decision log** (bullet list)
- **Open questions** with status: answered / deferred / assumed-with-default
