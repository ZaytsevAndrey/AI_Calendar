# Personal day

Status: shipped

## Purpose

People do not live from 00:00 to 24:00. The Day and Week time grids show the **personal day**: the hours between wake and sleep (and, optionally, only the hours that phases cover), so the grid is dense where the user actually works and a late evening after midnight still belongs to the day that started that morning.

Code: `frontend/src/modules/calendar/calendarView.ts` (`personalDayWindow`, `buildCalendarAxis`, `eventDisplayRange`, `habitDisplayOnColumn`, `eventsQueryRange`), `frontend/src/modules/phases/utils/phasesTimeUtils.ts` (`resolveActiveWindow`), and `components/CalendarGrid.tsx` / `CalendarTimeGrid.tsx`.

## User-facing behavior

- The Day and Week grids start at **wake** and end at **sleep**. Hours between sleep and the next wake are not drawn.
- When sleep is at or after midnight (sleep clock ≤ wake clock, e.g. wake 07:00, sleep 01:00), those small hours sit at the **bottom of the day that began at wake**, not as a strip at the top of the next calendar morning. A block at 00:30 on Tuesday appears at the bottom of Monday's column.
- Hour rows that no schedulable phase covers are removed, so a day with a gap between two phases shows two stretches stacked with no empty band between them. With no schedulable phases the whole wake-to-sleep window stays.
- Hour labels are the real clock times of the visible hours; clicking a label (Day view) starts a new task for that day.
- Phase colors tint their hour bands; the phase legend above the grid hides sleep phases.
- Habit blocks follow the same axis, including blocks that start after midnight on the next civil date.
- Events that start during sleep, or outside every schedulable phase, are not drawn on the grid. An event that starts outside wake-to-sleep is also missing from the side Events list.
- Month view has **no hour axis** (it shows chips per day, dots on phone). It still uses the personal-day boundary to decide which day an event belongs to.

## Logic

**Window** (`personalDayWindow` → `resolveActiveWindow`). Wake and sleep are `HH:mm` clocks. `start = wake` in minutes; `end = sleep`, plus 24 h when `sleep ≤ wake`. `spansNextDay` records that case. If either clock is missing or blank, the client falls back to **06:00–23:00** for both. Server defaults for a settings row are 08:00 and 23:00. Postgres `HH:mm:ss` strings are read by their first two fields.

**Schedulable phases** (`phasesForDays`): not `sleep_time`, not `main_phase`, and not named "Focus hours". A phase with `weekDays` counts only if at least one visible day matches it, so Day view uses that day's phases and Week view uses the union over the seven days.

**Axis** (`buildCalendarAxis`):
1. Resolve each schedulable phase into the active window (`resolvePhaseRangeInActiveWindow`; overnight phases wrap) and clamp it to `[start, end]`.
2. Merge touching or overlapping ranges into `segments`.
3. No segments → one segment `[start, end]`.
4. `spanMin` is the sum of segment lengths (minimum 60). Display minutes are the segments packed end to end; `personalToDisplay` and `displayToPersonal` convert between personal minutes and the packed axis. A boundary shared by two segments belongs to the later one.

**Placing an event** (`eventDisplayRange`, `instantPersonalMinutes`). For a column day, the start must fall on that civil day at a clock ≥ wake, or on the next civil day when `end > 24:00` (clock + 24 h). The end uses the same mapping, inclusive; when it does not fit or is not after the start, the block runs to the axis end. The result is clipped to the visible segments. A block whose start falls outside the window is dropped entirely, even if it overlaps the window, for example a 06:00–09:00 meeting with wake 08:00.

**Sleep filter.** `isEventInSleepHours` uses `[sleep, wake)` so the wake hour is the first visible hour. Week/Day grids drop sleep-hour timed events before layout; `gridEventsForDay` (grid, Month cells, and the side list) applies the same rule through the axis.

**Fetch range** (`eventsQueryRange`). Day and Week start at local midnight of the first day. The end is `personalDayQueryEnd`: end of the last civil day, or, when sleep is after midnight, **the next morning up to the sleep clock**, so evening blocks past midnight load. Month fetches from the first of the month to that same extended end of the last day of the month.

**Habits.** `habitBlockChips` produces chips per civil day in the habits' time zone; when the axis passes midnight one extra following day is generated and each chip is mapped to the column whose personal day contains it.

**Scheduler side.** Placement reads the same `wakeTime` / `sleepTime` in the Settings time zone to build each day's window (`dayWakeSleep`), so what the grid hides is also not offered to automatic placement.

## Edge cases

- Wake equal to sleep is treated as overnight (a 24 h window).
- An event that crosses sleep is clipped at the axis end; one that starts before wake is dropped.
- Events inside a hidden gap between phases are not drawn, but stay in the side Events list (that list applies only the wake-to-sleep window, not phases).
- The first column of a range does not show the tail of the previous night, because the previous civil day is not fetched.
- Month view cells put an after-midnight, before-sleep event into the **previous** day's cell and omit sleep-hour events.
- The grid uses the **browser's local clock** (`Date#getHours`, local midnight) to place events and apply wake/sleep. Habit chips and the Now strip use the Settings IANA time zone.
- All-day events are not on the axis; they sit above the grid on their civil date.
- `PX_PER_HOUR` is fixed (48 px); a day with many hidden hours is simply shorter.

## Data / settings / API

- Settings: `wakeTime`, `sleepTime` (`HH:mm`, Postgres may return `HH:mm:ss`), `timeZone`.
- Phases: `useTimePhases()` (all phases for the axis) and `useTimePhasesForDate(date)` (colors, legend).
- Events: `GET /calendar-providers/events?timeMin&timeMax` with the range above.
- No dedicated endpoint; the axis is computed in the browser on every render.

## Out of scope

- Wake/sleep semantics for voice "today/tomorrow" ([spec-voice-agent.md](../spec-voice-agent.md)).
- Phone daily-path polish (roadmap §32) and crowded-hour card sizing (§33).
- Editing wake, sleep or phases ([first-run-phases.md](first-run-phases.md)).

## Known gaps

- **Browser zone vs Settings zone.** When the browser's zone differs from Settings `timeZone`, the grid applies wake/sleep and event clocks in the browser zone while Now/Next, habits and placement use the Settings zone, so the same event can sit in different hours or be hidden.
- Month fetch covers only the calendar month; the dimmed leading/trailing days of neighbouring months show no events.
- Events that start before wake but run into the day are not drawn at all (no clipping at the top).
- No indicator tells the user that events were hidden by sleep or phase gaps.

## Related

- [first-run-phases.md](first-run-phases.md)
- [phone-layout.md](phone-layout.md)
- [calendar-drag.md](calendar-drag.md)
- [now-next.md](now-next.md)
- [habits.md](habits.md)
