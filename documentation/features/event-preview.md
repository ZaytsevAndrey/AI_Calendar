# Event preview

Status: shipped

## Purpose

Clicking a calendar block should not drop the user straight into an editor or a delete. The preview is a small read-only modal that shows what the block is and then makes **Edit** and **Delete** deliberate choices. It is the single entry point from the Calendar page (grid chips and the side list) to the task editor, the external-event editor, and every calendar delete flow.

Code: `frontend/src/modules/calendar/components/EventPreview.tsx`, `planEventPreviewActions.ts`, and the handlers in `frontend/src/pages/CalendarPage/CalendarPage.tsx` (`handleEditEvent`, `openEditorFromPreview`, `deleteFromPreview`).

## User-facing behavior

**What opens the preview**

- A timed chip on the Day or Week grid (click, or Enter / Space on the focused chip).
- An all-day chip above the grid, and any chip in the Month grid.
- The Edit button on a row in the side Events list (`CalendarEvents`).
- A drag or resize that moved the chip does not open it; the click that ends a drag is suppressed.
- **Habit blocks never open it.** A habit chip toggles check-in for that day (only while that date is editable). Habit Google events are filtered out of the grid, so there is no second chip to click.

**What it shows**

- Title: linked task name, else the event summary, else "Untitled event".
- Time range from the event start/end (`formatDateTimeRange`); "Time not set" when neither parses.
- One meta line with a recurrence hint: linked recurring task → Daily / Weekly / Monthly / generic "Repeats" from `recurrencePattern`; otherwise an event with `recurringEventId` → "Recurring". One-offs show no hint.
- Location (linked task location, else event location) with a "Location:" prefix.
- Description (task description, else event description), trimmed and cut to 280 characters with an ellipsis; line breaks are kept.
- Nothing in the preview is editable.

**Footer buttons**

| Block | Edit | Delete |
|-------|------|--------|
| Linked one-off app task | Edit button | Delete button, then a confirm dialog |
| Linked recurring app task, or any linked event with `recurringEventId` | Split button with *This day only / This day and following / Entire series* | Split button with the same three choices |
| External event, not recurring | Edit button | Delete button, then a confirm dialog (provider delete) |
| External event with `recurringEventId` | Split button (same three labels) | Delete button, then a confirm dialog (provider delete, no scopes) |

The delete and edit split menus reuse the `calendar.seriesDelete*` labels.

## Logic

**1. Resolve the linked task** (`resolveTaskForCalendarEvent`, `completedTaskEvents.ts`). Event id `local-completed:<taskId>` resolves by task id. Anything else matches a task whose `googleEventId` equals the event id or the event `recurringEventId`. No match means the block is an external event.

**2. Pick the Edit plan** (`planEventPreviewEdit`). `series_menu` when `task.isRecurring` or `event.recurringEventId` is set (linked or not); otherwise `direct`.

**3. Pick the Delete plan** (`planEventPreviewDelete`), in this order:
1. No linked task → `confirm_google`.
2. Linked and (`task.isRecurring` or `recurringEventId`) → `series_menu`.
3. Linked one-off → `confirm_task`.

**4. Edit action** (`openEditorFromPreview`). The preview closes first. The chosen scope is **ignored**:
- Linked task: `TaskForm` opens with the occurrence context (start, end, event id, calendar id) and `actionsMode: 'editOnly'`, which hides Delete and Skip inside the form. Editing a recurring task edits the series, whichever scope was picked.
- No linked task: `EventForm` opens and saves through the event's own provider (`PUT /google-calendar/events/:id` for Google, `PUT /calendar-providers/:provider/events/:id` for Microsoft/Apple, with `calendarId`).

**5. Delete action** (`deleteFromPreview`). The preview closes first, then:
- No scope (one-off task, or external): the standard delete confirm dialog. Task mode calls `DELETE /tasks/:id`; provider mode calls the provider delete for that event id and calendar id.
- Scope on a linked series (`planEventPreviewDeleteMutation`):
  - **This day only** (`occurrence`) → `POST /tasks/:id/skip-occurrence` with `occurrenceStart`, the event id (omitted for `local-completed:` chips), and the calendar id. The backend records the local day in `skippedOccurrenceYmds`, removes the open slot, deletes that provider instance, and rewrites the Google series.
  - **This day and following** (`series`) → `POST /tasks/:id/end-series-from`. The series `deadline` becomes local midnight of that day, open slots from that day on are removed, earlier days stay.
  - **Entire series** (`all`) → `DELETE /tasks/:id`.
- `occurrenceStart` is the event `start.dateTime`, or the civil-day start in the Settings time zone for all-day blocks. If it cannot be derived and the scope is not *Entire series*, an error toast is shown and nothing is written.
- Chip hover-delete (the X on a chip) and the list Delete button skip the preview but use the same rules; series choices there go through `SeriesDeleteHost`.

## Edge cases

- **Completed tasks** keep a grid chip (`local-completed:` overlay). Preview Edit opens the task; Delete scopes work, but `skip-occurrence` and `end-series-from` reject completed or canceled tasks, so those two choices end in an error toast.
- **Fixed tasks** reject *This day only* (`Fixed events cannot be skipped`) with an error toast. *Entire series* still works.
- **Unscheduled-completed or canceled** inbox tasks are filtered off the grid and cannot be previewed.
- **Hidden calendars:** events from hidden calendars are not in the grid, so they cannot be previewed.
- **All-day blocks** are built from the date bounds at local midnight, so the time line reads like `10 Oct 2026, 00:00 – 11 Oct 2026, 00:00` rather than "All day".
- A busy preview (`busy` prop) disables both footer controls; the modal closes before any request starts, so the prop is not set today.
- External recurring events: Delete removes the single provider event id the grid holds. Whether that is one instance or the whole series is decided by the provider's `deleteEvent`.
- If a block matches no task (id and `recurringEventId` both miss every `googleEventId`), it is treated as external even when the app wrote it.

## Data / settings / API

- Source events: `GET /calendar-providers/events` (Google + Microsoft + Apple, hidden calendars already removed server-side).
- Tasks: the cached task list (`useGetTasksQuery` from `eventTasksApi`).
- Writes: `PUT` provider event, `DELETE` provider event, `DELETE /tasks/:id`, `POST /tasks/:id/skip-occurrence`, `POST /tasks/:id/end-series-from`.
- Settings used indirectly: `timeZone` (all-day `occurrenceStart`), `hiddenGoogleCalendarIds` (which events exist at all).
- Strings: `calendar.preview.title`, `calendar.seriesDelete*`, `tasks.item.repeats*`, `calendar.recurring`, `calendar.timeNotSet`.

## Out of scope

- Editing fields inside the preview.
- Which providers are connected ([integrations.md](../integrations.md)).
- Habit editing and check-in rules ([habits.md](habits.md)).
- Series semantics of the backend operations (placement and conflict specs).

## Known gaps

- **Edit scope is shown but ignored.** *This day only / This day and following / Entire series* all open the same editor for that occurrence; only Delete applies the choice. The menu also appears on external recurring events, where the scope has even less meaning. Fixing this is a product follow-up.
- All-day blocks show midnight-to-midnight times instead of "All day".
- Fixed or completed recurring series offer scope choices that the backend then rejects (error toast).
- `busy` on the modal is never set by the page, so there is no in-flight state on the footer.

## Related

- [calendar-drag.md](calendar-drag.md)
- [multi-calendar.md](multi-calendar.md)
- [calendar-visibility.md](calendar-visibility.md)
- [habits.md](habits.md)
- [spec-incremental-placement.md](../spec-incremental-placement.md)
- [api-reference.md](../api-reference.md)
