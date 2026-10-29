# Feature docs

One file per feature: `documentation/features/<slug>.md`.

Each file is a full product + logic write-up (not a one-paragraph archive note): purpose, user-facing behavior, decision order, edge cases, data/API, known gaps, and links. Written after planning (`planned`), corrected before commit (`shipped`). Rules: [feature-docs.md](../../.cursor/skills/new-feature-workflow/feature-docs.md).

Older contracts stay next to this folder (`spec-incremental-placement.md`, `spec-conflict-rules.md`, `spec-voice-agent.md`, `spec-voice-commander.md`, `spec-intelligent-scheduling.md`, `task-creation-rules.md`). Update those in place. Do not copy them here.

Seed notes from the catch-up pass: [feature-docs-backfill.md](../feature-docs-backfill.md).

## Index

| File | What it covers |
|------|----------------|
| [event-preview.md](event-preview.md) | Calendar click → read-only preview; Edit/Delete; series scopes |
| [multi-calendar.md](multi-calendar.md) | Google/Microsoft/Apple busy time, chips, overlays, app-calendar writes |
| [personal-day.md](personal-day.md) | Wake–sleep grid axis, overnight sleep, phase-hidden hours |
| [calendar-drag.md](calendar-drag.md) | Move/resize 15‑min snap, series drag scopes, touch disabled |
| [calendar-visibility.md](calendar-visibility.md) | Hide calendars; effect on grid, placement, voice, reminders |
| [now-next.md](now-next.md) | Now / Next / Unscheduled strip; Done/Skip; habit competition |
| [schedule-suggestions.md](schedule-suggestions.md) | Groq 7‑day tips; empty skip; visible externals only |
| [default-task-duration.md](default-task-duration.md) | Settings default length for form, voice, `POST /tasks` |
| [task-filters.md](task-filters.md) | Tasks page search/filters per section |
| [task-series-group.md](task-series-group.md) | `seriesGroupId` grouping; head delete; nested confirm |
| [fixed-event-buffer.md](fixed-event-buffer.md) | Soft buffer around fixed/external; hard fallback |
| [voice-series-scope.md](voice-series-scope.md) | Voice this-day / following / whole series |
| [voice-quota.md](voice-quota.md) | Daily chat-token cap; Groq key rotation; session pin |
| [habits.md](habits.md) | Check-in, streak, points, achievements, tip, time block |
| [first-run-phases.md](first-run-phases.md) | Setup gate; wake/sleep; lifestyle presets |
| [language.md](language.md) | UI `language` vs `speechLanguage` |
| [phone-layout.md](phone-layout.md) | &lt;768px shell; what §32 still owns |
| [reminders.md](reminders.md) | Web Push; 60s tick + cron wake; 30‑min lookahead |
