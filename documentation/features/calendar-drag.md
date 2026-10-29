# Calendar drag and resize

Status: shipped

## Purpose

Let the user reschedule by direct manipulation: grab a block on the Day or Week grid and drop it at another time or day, or pull its top or bottom edge to change its length. The same gesture works for app tasks, repeating tasks, and external events from any connected provider, and the app decides what that means for each kind.

Code: `frontend/src/modules/calendar/components/CalendarTimeGrid.tsx` (gesture), `eventDrag.ts` (math), `CalendarPage.tsx` `handleEventTimeChange` (optimistic update and progress), `frontend/src/api/schedule.api.ts` `moveDisplayedEvent`, `modules/schedule/components/SeriesDragHost.tsx` (scope modal), and `backend/src/modules/schedule/displayed-event-move.service.ts` with `move-displayed-event.util.ts`.

## User-facing behavior

- **Where.** Timed blocks on the Day and Week grids, only with a **fine pointer** (mouse, trackpad, pen). On a touch / coarse pointer (`(pointer: coarse)`) the page passes no drag handler: no handles, no grab cursor, and a tap opens the preview. Phone week view renders a single day.
- **Gestures.** Drag the body to move (including to another day column in Week view); drag the thin top or bottom handle to change start or end. A movement under 4 px counts as a click and opens the [preview](event-preview.md). After a real drag the trailing click is suppressed.
- **Snap and limits.** 15-minute steps; minimum length 15 minutes; the block stays inside the visible axis ([personal-day.md](personal-day.md)). A drop across a hidden phase gap lands on the next visible stretch.
- **Not draggable.** Month chips and all-day chips (no handles), habit blocks (they toggle check-in), and touch input. Blocks are drawn with the title only; hover reveals the delete X, which does not start a drag.
- **Feedback.** The block previews the new position live, then stays at the new spot while the request runs, so it does not jump back. A progress toast follows the stages (saving, placing, syncing); on error the chip returns and an error toast shows.
- **Repeating tasks.** Dropping one asks "How should '<name>' move?" with *This day only*, *This day and following*, *All days*, plus Cancel. Repeating blocks cannot change day: the horizontal position is locked to the original column.
- A short hint under the legend (desktop only) explains the gesture.

## Logic

**Client** (`bindDrag`, `applyEventDrag`):
1. Pointer-down on the body is `move`, on a handle `resize-start` / `resize-end`. Events with `recurringEventId` get `lockDay`.
2. `move`: `snap(pointerMin − grabOffset)`, clamped to `[axis start, axis end − duration]`. `resize-start`: pointer snapped, clamped below `end − 15`. `resize-end`: pointer snapped, clamped above `start + 15` and the axis end.
3. Display minutes convert back to civil time with `displayToPersonal` and the column date. Nothing is sent when the position is unchanged, shorter than 15 minutes, or `end ≤ start`.
4. `handleEventTimeChange` applies an optimistic patch to every cached events query (this occurrence first; after a series choice, the whole series or its tail by the same delta) and keeps `undo` handles for failure or cancel.
5. `POST /schedule/move-event` with `googleEventId`, `calendarId`, `provider`, `recurringEventId`, original and new times. For a repeating instance the first request has no `seriesScope` and is a **probe**: the server writes nothing and answers `series-choice`; the client opens the scope modal and resends with `seriesScope` (`occurrence`, `series`, `all`). Cancelling the modal rolls everything back.
6. The returned `jobId` is polled (`settleReplanJob`); then the task and event caches are invalidated.

**Server decision order** (`planDisplayedEventMove`, then `DisplayedEventMoveService.move`):
1. `end` must be after `start`, else 400.
2. Event id or its `recurringEventId` belongs to a **habit** → 400 "Habit blocks cannot be moved from the calendar."
3. Linked **fixed** non-recurring task → update the task's start, end and `estimatedTimeInMinutes` (the drop's length). If the saved start is not the dropped start → 400 "That time is already taken."
4. Linked task or slot (flexible or recurring) → app-task branch below. A slot is matched by event id, else by the closest slot of that task within 60 s of `originalStart`.
5. No task, no slot → **external**: Google `patchEventTimes`, or `updateEvent` on the Microsoft / Apple provider, with the event's `calendarId`. No overlay, placement or job. Returns `kind: 'google'`, `jobId: null`.

**App-task branch.** Every move retargets the task's phase to the phase at the drop start (cleared when none covers it).
- *One-off flexible:* a `move-slot` mutation job calls placement with `preferredStart = drop` and `commit: 'preferred'`. The plan is written **only if the block seats exactly at the dropped start**; otherwise the job fails with "That time is already taken." On success the Google event is patched (sync fallback if the patch fails) and open holes are re-seated. It is not a full replan.
- *Recurring:* the move must stay on the same local day (400 "Recurring tasks can only be moved within the same day."). Without `seriesScope` the answer is `series-choice`.
  - **This day only:** skip that occurrence, then create an identical non-recurring task (same name, type, split, priority, Google settings, `parentSeriesId`, `seriesGroupId`) at the new time. The response `jobId` is the create job.
  - **This day and following:** a series-move job. If the day is the first still-open day it behaves as *All days*. Otherwise the old series `deadline` is set to local midnight of that day, its open slots from that day on are removed, and a new recurring task with the new clock, the same pattern and weekdays, the same `seriesGroupId`, and the old `deadline` (if later) is placed with series expansion. Earlier days keep the old clock.
  - **All days:** every still-open day is rewritten to the new clock, anchored on the earliest open day; the series master gets the new start, end, length and phase.
  - Both series jobs sync the old and new series to the provider and re-seat open holes.

## Edge cases

- **Drop on a busy interval.** A flexible block dropped where a fixed task, external event or habit already sits is rejected ("That time is already taken."), and the block snaps back. A fixed block that does not save at the drop does the same. No conflict sheet is opened from drag.
- Dropping a flexible block over another flexible block seats the dragged one and lets placement displace the overlapped one, as the placement spec describes.
- The soft buffer around fixed events does not block a drop (placement spec rule 24).
- External recurring instances (no app task) are also locked to their column, and are moved as that single instance; there is no series choice.
- A resize passes the new length to placement (flexible) or saves it as `estimatedTimeInMinutes` (fixed).
- Moving a repeating block to a different clock on the same day is allowed for all three scopes; moving it to another day is blocked client-side and rejected server-side.
- Dragging a **completed** chip (`local-completed:` id) is not specially handled: the id matches no task, slot or habit, so it goes to the external branch with a synthetic id and is expected to fail with the move-failed toast.
- Overlay mode (fixed or flexible) on an external event does not affect drag; both are movable.
- A job failure after the HTTP response (placement fails) surfaces through the progress toast and rolls the optimistic patch back.

## Data / settings / API

- `POST /schedule/move-event` (see [api-reference.md](../api-reference.md)): request fields above; response `{ kind: 'fixed' | 'slot' | 'google' | 'series-choice', jobId, taskName? }`.
- `GET /schedule-jobs/:id` for `progressStage` (`saving` → `placing` → `syncing` → `done`).
- Settings that matter: `timeZone` (series splits and same-day check), `wakeTime` / `sleepTime` and phases (axis and phase retarget).
- Constants: `EVENT_DRAG_SNAP_MIN = 15`, `EVENT_DRAG_MIN_DURATION_MIN = 15`, 4 px handle height, 4 px click threshold.

## Out of scope

- Crowded-hour stretch and minimum card height (roadmap §33).
- Internals of series placement ([spec-incremental-placement.md](../spec-incremental-placement.md)).
- Moving events between calendars or accounts.
- Undo of a move (there is none besides the optimistic rollback on failure).

## Known gaps

- Dropping onto an anchor is an error rather than the conflict choice sheet described for fixed-vs-fixed in [spec-conflict-rules.md](../spec-conflict-rules.md).
- Dragging a completed chip is not guarded and fails late.
- "All days" rewrites only still-open days; past occurrences keep their old time, which the label does not say.
- Resizing or moving an external event gives no warning, regardless of its overlay mode.

## Related

- [event-preview.md](event-preview.md)
- [personal-day.md](personal-day.md)
- [multi-calendar.md](multi-calendar.md)
- [spec-incremental-placement.md](../spec-incremental-placement.md)
- [spec-conflict-rules.md](../spec-conflict-rules.md)
