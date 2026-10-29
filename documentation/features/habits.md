# Habits

Status: shipped

## Purpose

A lightweight daily yes/no loop. A habit is not a task: it has no deadline, duration estimate, or status. The user ticks it each day, sees a streak and points, and can optionally reserve a daily clock block that placement keeps free. This doc describes what exists today; the roadmap Later item about what habits should become is untouched.

## User-facing behavior

**Habits page (`/habits`)**

- Create, edit, and delete habits. Fields: name (required, up to 80 characters), color (hex, default blue), description (up to 500 characters), and an optional **daily time block** (start `HH:mm` plus 5–240 minutes; both or neither).
- A grid shows each habit across a rolling 14-day window ending today (today is the last column). Tapping a cell toggles that day. Future days do not exist in the grid.
- Each habit shows the current streak, points, and total check-ins, plus achievement badges and the latest streak tip once one exists.
- Deleting a habit removes its check-ins and its calendar block.

**Where else habits appear**

- **Now strip (desktop width):** shows today's habits with a one-tap check-in for today only. On phone width the habit strip is not shown; the current Now block can still be marked done when it is a habit block, and the calendar day shows a habit checklist.
- **Calendar:** month and week show habit dots with a check toggle. A habit with a time block also draws a timed block that toggles that day's check-in. The toggle is disabled for days outside the editable window.
- **Voice:** create, update, delete, check in, and uncheck a habit by name. Check-in and uncheck always apply to **today**. A "done" command that matches no task can fall through to habit check-in.

**Points, streaks, and achievements**

- Points: +1 per checked day, plus +1 each time a consecutive run reaches a multiple of 7 (day 7, 14, 21, …).
- Current streak: consecutive checked days ending today, or ending yesterday when today is not yet checked.
- Achievements: `first_check_in`, `streak_3`, `streak_7`, `streak_30`, `streak_100` (best consecutive run ever), and `clean_week` (any full Monday–Sunday week checked).
- A check-in that unlocks something returns `newlyUnlocked`; the client shows one toast per check-in. When a streak unlock happened, the toast shows the streak tip instead of the badge name.
- Unchecking recomputes streak, points, and totals down, but never revokes an achievement and never clears the stored streak tip text.

## Logic

**Check-in** (`POST /habits/:id/check-ins` with a date; `DELETE /habits/:id/check-ins/:date` to clear):

1. The date must be a real `YYYY-MM-DD` and not later than today in Settings `timeZone` (UTC when unset). Otherwise 400.
2. Done adds a row `(habitId, userId, localDate)` unless one exists. Not done removes it. Both are idempotent.
3. All check-in dates for the habit are re-read and `evaluateHabitAchievements` runs. `mergeHabitAchievements` adds only ids not yet stored, with `unlockedAt` set now; existing values stay.
4. Only for a **done** request that unlocked streak ids, the highest newly unlocked streak (100 over 30 over 7 over 3) selects a tip. `HabitStreakTipService` asks Groq for one sentence under 160 characters in `settings.language` (`uk` or English), and falls back to a built-in template when Groq is unavailable or returns bad JSON. The text is stored as `lastStreakTip`.
5. The response is the habit summary (streak, points, totals, `checkInDates`, achievements, `newlyUnlocked`, `streakTip`).

Listing (`GET /habits`) also silently backfills achievements from history so badges appear without a toast, and returns `today`, `editableFrom` (today − 13 days), `editableTo` (today), and `timeZone` for the grid.

**Time block and calendar sync** (`syncGoogleBlock`):

- The block is an open-ended daily event (`RRULE:FREQ=DAILY`, opaque) starting today at `blockStartTime` for `blockMinutes`, colored from the habit color. It is written to the app calendar provider when one is connected (Google when linked, otherwise the user's chosen provider) and skips the sleep-window check.
- Name, color, description, or block changes delete the old series and create a new one, so the start stays on the chosen clock. Removing the block deletes the event.
- Listing creates the series for blocks saved before a calendar was connected.
- Placement treats the block as busy time ([spec-incremental-placement.md](../spec-incremental-placement.md)); habits are not padded by the fixed-event buffer.

## Edge cases

- **Old days.** The API accepts check-ins for any past day, not only the 14-day grid, so voice, scripts, or older clients can edit history; the grid just does not show it.
- **Unchecking a day inside a streak** lowers the current streak and points. A badge earned from it stays.
- **Re-checking** a day after an uncheck does not re-toast an already stored badge.
- **Streak tip on uncheck:** none is generated, and the old tip stays.
- **Time zone.** "Today" is the Settings time-zone civil day, so a late check-in after local midnight lands on the new day.
- **Calendar not connected or token expired.** The habit saves locally and the block is not written; a later list call retries the write. A delete still removes the local habit when the provider is disconnected, leaving the remote event in place.
- **Other write errors** from the provider fail the create or update request.
- **Invalid block.** One of start or minutes alone, a start that is not `HH:mm`, or minutes outside 5–240 returns 400.

## Data / settings / API

- Tables: `habits` (name, color, description, `blockStartTime`, `blockMinutes`, `achievements` map, `lastStreakTip`, `googleEventId`, `googleEventCalendarId`, `externalCalendarProvider`) and `habit_check_ins` (`habitId`, `userId`, `localDate`).
- Endpoints: `GET /habits`, `POST /habits`, `PATCH /habits/:id`, `DELETE /habits/:id`, `POST /habits/:id/check-ins`, `DELETE /habits/:id/check-ins/:date`.
- Settings used: `timeZone` (civil day), `language` (tip text), connected calendar provider (block).
- Voice commands: `habit_create`, `habit_update`, `habit_delete`, `habit_check_in`, `habit_uncheck`.
- Code: `habits.service.ts`, `habit-stats.util.ts`, `habit-achievements.util.ts`, `habit-streak-tip*.ts`, `HabitsPage`, `HabitGrid`, `CalendarHabits`, `HabitNowStrip`.

## Out of scope

- What habits should become next (roadmap Later).
- Weekly or custom frequencies, targets, reminders, and notes per check-in.
- RPG mechanics and social leaderboards.
- Streak freezes or "grace" days.

## Known gaps

- Achievements and the streak tip are never revoked or cleared after an uncheck, so a badge can describe a streak that no longer exists.
- The API allows check-ins older than the visible grid; only the UI limits history.
- Voice can only check in or uncheck today.
- The tip language follows Settings `language`, not the voice speech language.
- Habit blocks are not padded by the fixed-event buffer.
- Provider write failures other than "not connected" fail the whole habit save.

## Related

- [now-next.md](now-next.md)
- [multi-calendar.md](multi-calendar.md)
- [fixed-event-buffer.md](fixed-event-buffer.md)
- [api-reference.md](../api-reference.md)
