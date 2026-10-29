# Schedule suggestions

Status: shipped

## Purpose

Give the user a second opinion on the coming week without touching it. A language model reads a compact snapshot of open tasks, seated slots and busy time on connected calendars, and returns a few concrete observations: a day that is overloaded, an empty stretch that could hold waiting work, a task outside its phase, a deadline at risk. The feature is **advice only**: it never edits tasks, slots, provider calendars, or the undo stack, so it cannot fight placement.

Code: `backend/src/modules/schedule/schedule-recommendations.service.ts`, `schedule-recommendations.util.ts`, route `POST /schedule/recommendations` in `schedule.controller.ts`; `frontend/src/modules/schedule/components/ScheduleSuggestionsDialog.tsx`, `ScheduleMenu.tsx`.

## User-facing behavior

- **Entry.** Desktop: the Calendar header **Schedule** menu has one item, *Suggestions*. Phone: the `…` button in the bottom bar opens a Schedule sheet with the same item.
- Opening the dialog starts a request every time (nothing is cached). A spinner with "Reviewing…" shows while it runs.
- The result is one summary sentence plus up to **five** notes. Each note shows a kind label (*Overload*, *Gap*, *Phase mismatch*, *Deadline risk*), a short title, and a detail line that names the task.
- An empty list with a summary means "looks fine". With nothing to review the summary says so in the user's language.
- Errors (model unavailable, unreadable reply) appear as plain red text in the dialog. Close dismisses it.
- Notes are read-only text. They have no Apply or Open-task buttons, and the intro line says nothing changes until the user edits a task.
- Language follows Settings `language`: `uk` gives Ukrainian text and prompt; `en` and every other value give English.

## Logic

**Window.** From local midnight today through 7 local days ahead, in Settings `timeZone` (`HORIZON_DAYS = 7`).

**Snapshot** sent to the model as JSON:
- `timeZone`, `now`, `from`, `to`, `wake`, `sleep`, `weekendWork`.
- `phases`: name, type, start, end, weekdays.
- `tasks`: open tasks only (`todo`, `in_progress`), including unscheduled and recurring ones; ordered by deadline (soonest first, no deadline last) then creation time; **at most 30**. Each carries id, name, priority, status, minutes, deadline, earliest start, flags `unscheduled` / `fixed` / `recurring`, and phase names.
- `slots`: seated blocks overlapping the window, ordered by start, **at most 40**, with task id, name, start and end.
- `externalEvents`: titles (cut at 80 characters, "Busy" when empty) with start and end, **at most 30**, in provider order. All-day events appear as `<date> all-day`.
- `externalCalendar`: `connected`, `not_connected`, or `unavailable`.

**External events** come from `ExternalCalendarBusyService.listVisibleEvents`, so **only visible calendars** contribute; hidden ones are absent ([calendar-visibility.md](calendar-visibility.md)). Cancelled and transparent ("free") events are skipped, and so are events whose id or `recurringEventId` equals an event id of a snapshot slot or task (the app's own copies).

**Short circuit.** If tasks, slots and external events are all empty, the model is **not called**; the response is `{ summary: <localized "nothing to review yet">, suggestions: [] }`.

**Prompt rules** (`scheduleRecommendationsSystemPrompt`): reply with one JSON object; at most 5 suggestions; four kinds with fixed meanings (overload, gap, phase_mismatch, deadline_risk); advice only, never claim a change; do not treat sleep as work; times are wall clocks in the snapshot zone; if `externalCalendar` is `unavailable` do not claim there are no meetings; write in the chosen language.

**Parsing** (`parseScheduleRecommendations`): JSON must be an object. Summary is cut to 280 characters (default "No concrete changes suggested."). A suggestion is kept only if its kind is one of the four, title and detail are non-empty, and `taskId` is null or an id from the snapshot's tasks; titles are cut to 120, details to 400, and at most five are kept. Invalid entries are dropped one by one. If the whole reply is not parseable the request returns **503** "Could not read schedule suggestions". Groq failures also surface as errors.

## Edge cases

- Only calendars listed as connected count: with none, `externalCalendar` is `not_connected` and the model sees tasks and slots only.
- Provider failures are swallowed inside the registry, so a single failing provider yields fewer events with status `connected`. `unavailable` appears only when the whole external load throws.
- If the model returns a `taskId` it was not given, that note is dropped.
- A user with only unscheduled inbox tasks still gets a real model call (tasks exist).
- Tasks beyond the first 30 and slots beyond the first 40 are invisible to the model; the notes may miss them.
- Two quick opens: a stale response is ignored; only the latest request fills the dialog.
- Model output is not deterministic; the same calendar can give different wording.

## Data / settings / API

- `POST /schedule/recommendations` (JWT, empty body) → `{ summary, suggestions: [{ kind, title, detail, taskId }] }`. Writes nothing. Documented in [api-reference.md](../api-reference.md).
- Settings read: `timeZone`, `language`, `wakeTime`, `sleepTime`, `weekendWorkEnabled`, `hiddenGoogleCalendarIds` (indirectly).
- Dependencies: Groq JSON completion (`GroqClient.completeJson`), phases, tasks, scheduled slots.
- Kinds: `overload`, `gap`, `phase_mismatch`, `deadline_risk`.

## Out of scope

- Applying suggestions automatically or per note.
- Voice question-and-answer day plans ([spec-voice-agent.md](../spec-voice-agent.md)).
- Persisting or comparing past suggestions.
- Languages other than `en` and `uk`.

## Known gaps

- Provider outages mostly do not reach the model as `unavailable`, so the model may state an empty day when a calendar simply failed to load.
- Habit blocks synced to a provider calendar are not excluded as the app's own events, so they can appear in `externalEvents`.
- The returned `taskId` is not used by the UI: a note cannot jump to the task.
- The `externalCalendar` status is not shown to the user.
- The 30 / 40 / 30 caps cut data silently.

## Related

- [language.md](language.md)
- [calendar-visibility.md](calendar-visibility.md)
- [multi-calendar.md](multi-calendar.md)
- [api-reference.md](../api-reference.md)
