# Series grouping on Tasks

Status: shipped

## Purpose

A repeating task can end up as several rows: the main series, clock-split siblings, one-offs detached from one day, and Problematic park copies. Showing them as separate cards makes one series look like unrelated tasks. The Tasks page collapses rows that share `seriesGroupId` into one expandable group so the user sees one series and its parts together.

## User-facing behavior

- Rows with the same `seriesGroupId` render as one **group** when two or more rows remain after the page filters. One remaining row (or none sharing an id) renders as a normal single card.
- The group has a **head card**, a count button, and nested rows:
  - The head is the first member whose kind is *series* (recurring and not Problematic). If there is none, the first member is the head. The head uses the normal task card.
  - The count button (it shows the member count) toggles the nested rows. Groups start expanded.
  - Nested rows are indented under a left rule and carry a kind label: **series**, **one-off**, or **problematic**. They use compact cards with the same per-task actions as a normal card (Edit, Delete, and Done / Schedule / Skip / Do now where the page offers them).
- **Delete on the head card** removes every member of the group immediately, with no confirmation. Members are deleted one after another.
- **Delete on a nested row** removes only that row and asks the normal "delete this task?" confirmation first.
- Done, Skip, Edit, and Do now on any card act on that card's task only. Only Delete on the head card is group-wide.

## Logic

Grouping (`groupTasksBySeriesGroup`), applied to the filtered list:

1. Walk the rows in list order. A row with an empty or missing `seriesGroupId` becomes a single entry.
2. Rows with the same non-empty id collect under one entry placed at the position of the first row seen.
3. A group with fewer than two members becomes a single entry.
4. Member kind (`seriesMemberKind`): `problematic` if `scheduleState` is `problematic`; else `series` if `isRecurring`; else `oneOff`.
5. Group title (`pickGroupTitle`): the member whose id equals `seriesGroupId`, else the first recurring member, else the first member. The title names the group in the count button tooltip and in delete messages; the head card still shows its own task name.

Head delete: `SeriesGroupRow` passes every member id to `onDeleteGroup`, the Tasks page calls `deleteEvent(id)` for each id in order and stops at the first failure with a delete-failed error toast. There is no confirm dialog on this path.

Backend delete (`TasksService.remove`): deleting a task first deletes every task whose `parentSeriesId` is that task (park copies), then removes the task's synced Google events, removes the row, and re-seats open holes.

Membership rules on the server:

- Group ids are assigned by placement when a series is split, detached, or moved (see [spec-incremental-placement.md](../spec-incremental-placement.md)). The Tasks page only reads them.
- `PATCH /tasks/:id` clears `seriesGroupId` and `parentSeriesId` when the body touches any of: `name`, `description`, `location`, `priority`, Google color / visibility / transparency / reminders, `eventType`, `isRecurring`, `recurrencePattern`, `recurrenceWeekDays`, `allowSplit`, `deadline`, `earliestStartTime`, `eligibleWeekDays`. Time slot, phase, and status patches do not.

What is written by head delete: one `DELETE /tasks/:id` per member. Nothing is written by expanding or collapsing.

## Edge cases

- A search or filter that hides some members shrinks the group; at one member it turns into a single card.
- Members that match different filters (for example a completed one-off and an open series under status Active) may never appear together.
- Deleting the series master first also removes its park copies, so a later id in the same head-delete loop can already be gone and return 404. The loop then stops with an error toast although the group is effectively removed.
- A failure part-way leaves the remaining members in place.
- Saving a task from the Tasks form sends name, priority, recurrence, and similar fields, so any form save detaches that task from its group, even when only the time changed.
- Problematic members are labeled problematic and still delete with the group.
- Expanded state is local to the row and resets when the list re-mounts.

## Data / settings / API

- `tasks.seriesGroupId` (uuid, nullable): logical family of one repeating series. Survives clearing a Problematic park, unlike `parentSeriesId`.
- `tasks.parentSeriesId` (uuid, nullable): the series a detached copy came from.
- `DELETE /tasks/:id`, `PATCH /tasks/:id`.
- Frontend: `groupTasksBySeriesGroup.ts`, `SeriesGroupRow.tsx`, `EventList.tsx`, `EventsPage/index.tsx` (`requestDeleteGroup`, `deleteIds`).

## Out of scope

- How groups are created, split, and re-merged (placement spec).
- Calendar chip series menus (this day / following / all) in [event-preview.md](event-preview.md).
- Rolling back a partial group delete.
- Drag or reorder inside a group.

## Known gaps

- Head Delete has no confirmation and no undo, and removes every member, including Problematic copies.
- A failure or 404 mid-loop leaves a partially deleted group and shows one error toast.
- The group confirm text and `group` flag exist in the delete modal but the head path bypasses it.
- Any form save drops group membership; there is no way to re-attach a task to its group from the UI.
- Google event cleanup is per member and not atomic with the database delete.

## Related

- [task-filters.md](task-filters.md)
- [spec-incremental-placement.md](../spec-incremental-placement.md)
- [event-preview.md](event-preview.md)
