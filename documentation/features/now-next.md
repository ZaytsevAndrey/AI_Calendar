# Now / Next

Status: shipped

## Purpose

A glance at the top of the Calendar page answers three questions for today: what is happening **now**, what starts **next**, and what is still **waiting without a time**. It also gives one-tap **Done** and **Skip** so the user can keep the day moving without opening the grid or an editor.

Code: `frontend/src/modules/now/nowBlocks.ts` (all selection rules), `components/NowStrip.tsx`, `components/HabitNowStrip.tsx`, wired in `frontend/src/pages/CalendarPage/CalendarPage.tsx`.

## User-facing behavior

- The strip shows three cards: **Now**, **Next**, and **Unscheduled** (today's inbox). On desktop a **Habits** row follows with today's check-in buttons and a link to `/habits`.
- "Today" is the civil date in the Settings IANA time zone. The strip re-evaluates every 30 seconds.
- Each Now or Next card shows the title and `HH:mm–HH:mm` (or "All day"). Empty cards say "nothing in progress" or "nothing else today"; when all three cards are empty a short hint appears.
- **Done** completes a non-recurring app task, or checks in a habit for today. The task's seat stays on the grid, drawn as done.
- **Skip** drops one still-open occurrence and leaves the task as `todo`.
- External events are shown read-only: no Done, no Skip.
- **Unscheduled card:** up to five untimed tasks, highest priority first; each has Done unless the task is recurring or a fixed external.
- **Phone:** the strip is collapsed to one line (`Now · <title> · <range>`); tapping expands the three cards. The Habits row is **not** rendered on phone; habit check-in lives in the Day view's habit section and the habit dots.

## Logic

**Blocks for today** (`buildNowBlocks`). The window is yesterday 00:00 to today 24:00 (so a block that began last evening and runs past midnight still counts).

1. **Events** from all visible connected calendars, cancelled ones removed. All-day events count only when today lies in `[start, end)` and become a whole-day block. Timed events need an `end` (30 minutes if missing), must overlap today, and must start no earlier than yesterday. An event is matched to an *active* task by its id or `recurringEventId`; the matched task is attached for Done / Skip.
2. **Task rows** with a scheduled start and end that no event already covered. They must overlap today, start no earlier than yesterday, last no more than 36 hours (a series' first→last span is not a block), and not have the start's local day in `skippedOccurrenceYmds`.
3. **Habit blocks**: each habit with `blockStartTime` and `blockMinutes` yields today's block at that clock; `done` comes from the habit's check-in dates.

An *active* task is not completed or canceled, and is not a one-off whose scheduled end has passed.

**Picking** (`pickNowAndNext`):
- *Current* blocks satisfy `start ≤ now < end`. Timed current blocks win over all-day ones; all-day is used only when no timed block is current. Timed blocks that started before yesterday 00:00 are discarded.
- Among current blocks the winner is the one that **started earliest**; on an equal start the one with the **least time remaining** wins (`currentScore`). Tasks, habits and external events compete in the same pool.
- *Next* is the block with the earliest start strictly after now and before the end of today, other than the Now block (ties: earliest end). All-day blocks never become Next.

**Actions**
- `canCompleteNowBlock`: a habit that is not yet checked in, or a task that is not recurring, not a fixed external, and not completed / canceled. Done sends `status: completed` through `PATCH /tasks/:id`; for a habit it toggles today's check-in.
- `canSkipNowBlock`: a block with a task that is not a habit, not all-day, not a fixed external, not unscheduled, not `eventType === 'fixed'`, and not completed / canceled. Skip calls `POST /tasks/:id/skip-occurrence` with `occurrenceStart` = the block start and the event id / calendar id. The backend removes the open slot (one-offs) or records the day in `skippedOccurrenceYmds` (recurring, so placement will not put that day back) and removes the provider occurrence. Skip is rejected for fixed, completed and canceled tasks.

**Unscheduled card** (`unscheduledTasksForToday`): active tasks that are not recurring, not `problematic`, not already shown as Now or Next, and have **no** scheduled start/end; plus either `isUnscheduled`, or an open window that includes today (`earliestStartTime`, `deadline`, `eligibleWeekDays` checked in the Settings zone). Sorted by priority (urgent, high, medium, low) then creation time, first five. Recurring no-fit work is Problematic only and never listed here.

**Habits row** (`HabitNowStrip`): lists every habit with a toggle for today's check-in, colored when done.

## Edge cases

- A recurring series instance is matched through `recurringEventId`: Skip is offered, Done is not.
- A completed task disappears from Now/Next at once, while its seat stays on the grid.
- An external event with no linked task has no Done and no Skip, even when it is the Now block.
- Hidden calendars never contribute: the event list already excludes them ([calendar-visibility.md](calendar-visibility.md)).
- The page reuses its own loaded events when the visible range covers yesterday to today; otherwise the strip fetches `GET /calendar-providers/events` itself.
- After create, update, Done or Skip the shared task and event caches are invalidated and the mutation progress toast tracks the placement job, so the strip updates without a reload.
- The strip uses the Settings time zone for "today", while the grid places blocks in the browser's zone ([personal-day.md](personal-day.md)).
- A Done habit still appears in Now/Next, without the Done button.
- The voice agent's Now/Next tool is a separate ranking with no habit blocks; the two can disagree.

## Data / settings / API

- Inputs: `GET /calendar-providers/events` (or the page's shared events), the task list (`useGetTasksQuery`), `GET /habits`, Settings `timeZone`.
- Writes: `PATCH /tasks/:id` (complete), `POST /tasks/:id/skip-occurrence`, habit check-in toggle.
- Constants: Unscheduled limit 5; max single-block span 36 h; refresh tick 30 s.
- No server-side Now/Next endpoint.

## Out of scope

- The full Tasks-page Unscheduled inbox.
- The unfinished phone daily path (roadmap §32).
- Habit rules and streaks ([habits.md](habits.md)).
- Snoozing, reordering, or pinning a Now item.

## Known gaps

- **Habit duplicates (from code reading).** `buildNowBlocks` does not drop habit Google events the way the grid does (`isHabitGoogleEvent`). A habit with a synced block can therefore also appear as a plain event block; since events are added first, it can win the tie and hide the Done button of the habit block.
- The desktop Habits row lists *all* habits, including ones that already have a slot above, so a slotted habit can appear twice.
- "Earliest start wins" means a long meeting started earlier outranks a shorter task that started later; there is no way to say "I am doing this one".
- The strip and the grid use different time zones when the browser zone differs from Settings.

## Related

- [habits.md](habits.md)
- [phone-layout.md](phone-layout.md)
- [calendar-visibility.md](calendar-visibility.md)
- [personal-day.md](personal-day.md)
- [spec-conflict-rules.md](../spec-conflict-rules.md)
