# Calendar visibility

Status: shipped

## Purpose

A user can connect many calendars (work, family, holidays, birthdays) and does not want all of them on the grid or treated as busy. The **Calendars** filter on the Calendar page turns individual calendars on and off. One switch controls both what is drawn and what the scheduler, reminders, suggestions and voice treat as busy, so the grid always matches what placement respects.

Code: `frontend/src/modules/calendar/components/CalendarVisibilityMenu.tsx`, `calendarVisibility.ts`; `backend/src/modules/user-settings/hidden-google-calendars.util.ts`, `user-settings.service.ts`; `backend/src/modules/google-calendar/display-calendar-ids.util.ts`; `backend/src/modules/calendar-providers/calendar-visibility.util.ts`, `external-calendar-busy.service.ts`.

## User-facing behavior

- The **Calendars** button (an eye icon on phone) sits in the Calendar header. It is not rendered until some account is connected.
- The panel loads the calendars of every connected provider and groups them into **Google**, **Microsoft** and **Apple** sections with a logo. Each calendar is a checkbox; checked means visible.
- Within the list, the app calendar comes first (checked and disabled with an "Always shown" note), then rows sort by provider and label.
- A toggle saves immediately (the checkbox flips at once, the request follows). On failure the checkbox reverts and "could not update calendars" appears.
- After a save the event queries refetch, so hidden events leave the grid, the side list and the Now strip.
- Hiding does not disconnect the account or delete tokens, and does not change what is written to the app calendar.
- The panel footer shows the hint string `calendar.calendarsHint`.

**Default visible set** (nothing hidden):
- Google: Primary, the app calendar, and every calendar the Google calendar list marks selected (`selected !== false`) with access role owner, writer or reader.
- Microsoft and Apple: every listed calendar.

## Logic

**Storage.** `UserSettings.hiddenGoogleCalendarIds` (legacy name) holds *hidden* keys. A Google calendar is stored by its bare id. A Microsoft or Apple calendar is stored as `provider:id` (`calendarHideKey`). The list is "hidden calendar keys", not Google-only.

**Listing rows** (`calendarVisibilityRows`): skip rows without an id; always keep Primary; drop calendars with `selected === false` or a non-readable role; label falls back to "Primary" or the id; de-duplicate by key. If the app calendar id is known but absent from the list, a disabled row is added for it.

**Saving** (`PATCH /user-settings` with `hiddenGoogleCalendarIds`):
1. Must be an array, otherwise 400 "must be an array of calendar ids".
2. The protected key is the app calendar of the target provider (the DTO's `appCalendarProvider`, else the stored one): the Google id as is, or `microsoft:<id>` / `apple:<id>`.
3. `normalizeHiddenCalendarIds` trims, drops blanks, entries over 1024 characters, duplicates, and the protected key, and keeps at most **50** entries (extra entries are cut silently).

**Applying the list** (everything uses the same list):
- **Grid and list, client:** `isCalendarVisible(provider, calendarId, hidden)` filters events whose key is hidden. For non-Google providers a bare id is also honoured.
- **Google fetch, server:** `displayCalendarIds` builds the calendar ids to read: `primary` unless `primary` or the Primary calendar's real id is hidden; the app calendar always (its key is removed from the hidden set); other calendars when selected, readable and not hidden. If the Google calendar list cannot be read, only Primary and the app calendar are fetched.
- **All providers, server:** `GET /calendar-providers/events` and `ExternalCalendarBusyService.listVisibleEvents` drop events for which `isHiddenCalendar(provider, calendarId, hidden)` is true (Google bare id; others `provider:id` or bare id).
- `listVisibleEvents` is the single source for placement anchors, the Problematic slot picker, reminders, schedule suggestions, voice agenda / gaps, and the Now strip's events (via the same provider endpoint), so hidden calendars are not busy anywhere.
- **Habit blocks** are local data and are not filtered by this list.

## Edge cases

- Hiding every non-app calendar is allowed; the grid then shows app blocks, habit blocks and completed-task chips only.
- A hide key whose calendar disappears (disconnect, deleted calendar) is left in the list; it is harmless but counts toward the 50 limit.
- Completed-task chips (`local-completed:`) have no calendar id and are always visible.
- If the user changes the write target to another provider, the stored list is re-normalized against the new protected key the next time the list is saved, not at the moment the target changes.
- The Microsoft or Apple *app* calendar is not locked in the panel (see Known gaps). A hide attempt is accepted by the UI, stripped by the server, and the checkbox stays unchecked until the next successful save.
- For Microsoft and Apple, a bare id in the list also hides that provider's calendar (`isHiddenCalendar` accepts both forms), so a legacy bare entry keeps working.
- A failed calendar listing shows a load error inside the panel; the saved list is unchanged.

## Data / settings / API

- Setting: `hiddenGoogleCalendarIds: string[]` (max 50, unique, non-empty); also `appCalendarProvider`, `appGoogleCalendarId`, `appMicrosoftCalendarId`, `appAppleCalendarId`.
- `GET /calendar-providers/calendars` for the panel rows; `GET /auth/providers/status` for "anything connected".
- `PATCH /user-settings` to save; invalidates the `Event` cache tag on the client.
- Strings: `calendar.calendars`, `calendar.visibleCalendars`, `calendar.alwaysShown`, `calendar.providerSection.*`, `calendar.calendarsHint`, `calendar.updateCalendarsFailed`.

## Out of scope

- The product decision **Hide app calendar** (roadmap Later).
- Connect and disconnect flows ([integrations.md](../integrations.md)).
- Per-event hiding and per-calendar colors.

## Known gaps

- **Panel only locks the Google app calendar.** The row builder compares against `appGoogleCalendarId` and `provider === 'google'`; when the write target is Microsoft or Apple, that calendar is a normal checkbox. The server still refuses to hide it, so the UI can show it unchecked while it stays visible.
- **Stale hint copy.** `calendar.calendarsHint` still says "Hides events on this page. Generate still treats Primary and the app calendar as busy." The Generate action was removed from the product (the Schedule menu only has Suggestions), and a hidden Primary calendar is not busy, so the string does not match the behavior.
- Over-limit lists are truncated without telling the user.
- Stale keys are never pruned.

## Related

- [multi-calendar.md](multi-calendar.md)
- [now-next.md](now-next.md)
- [schedule-suggestions.md](schedule-suggestions.md)
- [integrations.md](../integrations.md)
