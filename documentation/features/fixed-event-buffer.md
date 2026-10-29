# Buffer around fixed events

Status: shipped

## Purpose

Give the user breathing room around meetings. A setting reserves a number of minutes before and after each fixed event so back-to-back tasks are not packed against a meeting, without making placement fail when the day is tight.

## User-facing behavior

- **Settings → Buffer around fixed events**: a number field, 0–180 minutes, default 0. 0 turns the buffer off. The field clamps typed values into 0–180.
- When the buffer is on, the scheduler prefers a slot that stays that many minutes away from the start and end of:
  - fixed tasks and fixed-external tasks (imported events marked fixed);
  - timed events on every **visible** connected calendar: Google, Microsoft, and Apple.
- The buffer is soft. If a task cannot be seated without touching the gap, it is seated in the gap rather than left unplaced or marked Problematic.
- The gap is not drawn on the calendar. The user only sees its effect in where new and re-seated tasks land.
- Dragging or resizing a block is not stopped by the buffer; a drag can land inside a gap.
- A preferred or typed time that fits is honored even inside a gap; only a direct overlap with the event itself raises a conflict.
- Habit blocks and ended flexible slots are not padded.

## Logic

Normalization: `normalizeFixedEventBufferMinutes(value)` returns 0 for missing, non-finite, or non-positive values, otherwise `min(180, floor(value))`.

Buffer sources:

- Incremental placement (`PlacementStepService`): seats flagged `buffered`. These are fixed-task slot anchors (`eventType` fixed or `isFixedExternal`), fixed task peers that are `todo` or `in_progress` and have not ended, and external anchors from `ExternalCalendarBusyService.listVisibleEvents` (all-day events excluded). Hidden calendars are dropped before this step.
- Full planning engine (`intelligent-scheduling.engine.ts`): `bufferSourceIntervals` takes the external busy intervals plus fixed and fixed-external task slots, then pads both sides by the buffer (`expandIntervalsBothSides`).
- Not sources: habit block intervals, flexible and series slots, resolved copies, and elapsed time.

Decision order when seating a task without a claimed time (`planPlacement` / `findHole`):

1. Build `hard` busy time (every seat plus series-home ghosts).
2. Build `soft` busy time: each buffered seat widened by the buffer on both sides.
3. Search the phase windows for a hole in `hard ∪ soft`. Take the earliest start at or after `notBefore`, or the one nearest the preferred time when one is given.
4. If that finds nothing, search again against `hard` only.
5. If that also finds nothing, the existing outcomes apply (Problematic, Unscheduled, or a conflict) as in [spec-incremental-placement.md](../spec-incremental-placement.md).

The engine path follows the same two passes per day: a soft pass against placed tasks plus buffer zones, then a hard pass. For a task with a preferred time that fits the hard free time, the preferred slot is kept even inside a buffer zone.

What is written: only the chosen task slot (`scheduled_tasks` and the task row). The buffer is never stored as an event or a Google block.

When it runs: the value is read at each placement. Saving the setting does not reseat tasks that are already placed; the new value affects later placements and replans.

## Edge cases

- **Hidden calendars** (see [calendar-visibility.md](calendar-visibility.md)) contribute nothing, so hiding a calendar also removes its buffer.
- **All-day events** are not anchors and have no buffer.
- **Two meetings closer than 2× buffer** merge their zones into one soft block.
- **A gap smaller than task + buffer** is still used by step 4.
- **Conflicts** (a claimed time that overlaps a fixed event) are decided by the event overlap alone; the buffer does not change them.
- **Provider read failure**: a provider that fails to list is skipped, so its events add no buffer for that run.
- **API validation**: `PATCH /user-settings` rejects values outside 0–180 with 400; the engine still clamps defensively.
- **Past events** that have ended do not count (`end <= now` is skipped for fixed peers).

## Data / settings / API

- `user_settings.fixedEventBufferMinutes` (int, default 0), `PATCH /user-settings`, `@Min(0) @Max(180)`.
- Code: `placement-step.util.ts` (`softBusy`, `findHole`, `planPlacement`), `placement-step.service.ts` (`buffered` seats, `externalAnchors`), `intelligent-scheduling.engine.ts` (`bufferSourceIntervals`, `bufferZones`).
- `ExternalCalendarBusyService.listVisibleEvents` supplies visible events from every connected provider.
- No new tables or endpoints.

## Out of scope

- Soft buffers around flexible tasks, habits, or travel time.
- Drawing the buffer on the calendar.
- Blocking drag or resize into a gap.
- Per-calendar or per-event buffer lengths.
- Reseating existing tasks when only the setting changes.

## Known gaps

- Nothing tells the user when a task was seated inside the buffer because the hard fallback ran.
- The setting does not trigger a replan, so existing placements keep their old spacing until something else moves them.
- The Swagger text for the setting still says "external Google event" even though Microsoft and Apple events are buffered too.
- Habit blocks and flexible tasks have no buffer, so a task can sit directly against a habit.
- Errors listing a provider are swallowed silently for placement anchors, so buffer around that provider's events can disappear for a run.

## Related

- [multi-calendar.md](multi-calendar.md)
- [calendar-visibility.md](calendar-visibility.md)
- [calendar-drag.md](calendar-drag.md)
- [spec-incremental-placement.md](../spec-incremental-placement.md)
- [task-scheduling-test-matrix.md](../task-scheduling-test-matrix.md)
