# Task search and filters

Status: shipped

## Purpose

Let the user narrow the Tasks page quickly. The Tasks page has two lists with different jobs: the Unscheduled inbox (triage) and the Scheduled list (review). Each gets its own search and filters so working on one never hides rows in the other.

## User-facing behavior

The Tasks page (`/tasks`) shows two sections, each with its own filter bar. The two bars share no state.

**Unscheduled section** (inbox)

- Name search, status, Overdue toggle.
- No phase, schedule type, or sort controls.
- Completed and canceled inbox rows never appear, whatever the status control says.
- Order is fixed: deadline urgency (overdue, today, soon, none), then earlier deadline, then priority (urgent first), then older `createdAt`.

**Scheduled section**

- Name search, status, Overdue toggle, plus a **Filters** menu with Phase, Schedule type, and Sort.
- Phase: `any`, `none` (no phase), or one phase.
- Schedule type: `any`, Fixed, Flexible, Recurring.
- Sort: Deadline (default), Priority, Name, Duration. Tasks without a deadline sort last under Deadline.
- Active menu choices show as removable chips under the bar with a count badge on the Filters button.
- **Clear** appears when anything is narrowed and resets every control in that section (search empty, status Active, Overdue off, phase any, type any, sort Deadline).

**Layout**

- Desktop (768px and up): search, status, Overdue, and the Filters button sit inline.
- Phone (below 768px): search plus a filter icon. The icon opens a Filters sheet with status, Overdue, and (Scheduled only) phase, type, and sort, with Clear and Done. A dot on the icon marks an active narrowing.

**Matching**

- Search matches the task **name** only: case-insensitive substring. Description is not searched.
- Status options: Active (default), To do, In progress, Completed, Canceled, All.
- Overdue means an open task whose deadline has passed.

## Logic

All filtering runs in the browser on the full task list (`useGetEventsQuery`); the API has no search parameters.

1. `filterUnscheduledTasks`: keep rows with `isUnscheduled`; drop `completed` and `canceled`; then name, status, and Overdue.
2. `filterScheduledTasks`: drop rows with `isUnscheduled`; then name, status, Overdue; then schedule type; then phase.
3. Scheduled rows are sorted by the chosen field (`sortTasks`); Unscheduled rows use the fixed inbox order.
4. `EventList` then groups the filtered rows by `seriesGroupId` ([task-series-group.md](task-series-group.md)). Grouping happens after filtering, so a group only counts the members that survived.

Status rules:

- `all`: no status test.
- `active`: `isCurrentTask`, meaning not completed, not canceled, and not a finished one-off. A one-off whose `scheduledEndTime` is in the past is not current. Recurring tasks are never "finished" by this test.
- `todo` / `in_progress`: exact status match, and a one-off that has already ended is excluded.
- `completed` / `canceled`: exact status match.

Schedule type (`scheduleModeOf`): `recurring` when `isRecurring` **or** the task has a `seriesGroupId`; otherwise `fixed` when `eventType` is `fixed`; otherwise `flexible`. Series copies and detached one-offs therefore match Recurring.

Phase match: a task's phase ids are collected from `phaseId`, `phase`, and `phases`; `none` requires an empty set.

What is written: nothing. Filters are page state only.

## Edge cases

- Filtering leaves one member of a series group: that member renders as a normal single card, not a group.
- Search text with only spaces counts as empty.
- The inbox status menu still lists Completed, Canceled, and All, but those choices show no inbox rows (they are dropped before the status test).
- An empty result shows a "no match" message when a narrowing is active, otherwise the plain empty text; the Scheduled list shows its own empty state with a create button.
- Overdue on a completed or canceled task is always false.
- Filters reset when the page reloads or the user leaves and returns; nothing is stored.
- The two search boxes and status selects have distinct accessible names so both can be on screen.

## Data / settings / API

- Source list: `GET /tasks` through the events query. No server-side filtering, no new settings.
- Page state (React `useState`): `scheduledQuery`, `filterStatus`, `scheduledOverdue`, `phaseId`, `scheduleMode`, `sortField` for Scheduled; `inboxQuery`, `inboxStatus`, `inboxOverdue` for Unscheduled.
- Code: `taskListFilters.ts`, `TaskSectionFilters.tsx`, `EventsPage/index.tsx`, `isCurrentTask.ts`.

## Out of scope

- Server-side or full-text search; searching descriptions, locations, or phases by name.
- Saved filters and filter persistence across visits.
- Calendar grid filters (hiding calendars is [calendar-visibility.md](calendar-visibility.md)).
- Sorting the Unscheduled inbox.

## Known gaps

- Filter and sort choices are lost on reload.
- The inbox status control offers choices that can never show rows.
- Search is name-only, so a task found by its description is not found.
- Sorting happens before grouping, so a group sits at the position of its first surviving member, not by its head card.
- Large task lists are filtered in the browser; there is no pagination.

## Related

- [task-series-group.md](task-series-group.md)
- [phone-layout.md](phone-layout.md)
- [calendar-visibility.md](calendar-visibility.md)
