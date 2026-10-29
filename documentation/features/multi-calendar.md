# Multi-calendar busy time and chips

Status: shipped

## Purpose

Users keep real commitments in Google, Microsoft (Outlook) and Apple iCloud calendars. The app treats those calendars as the source of fixed commitments: it draws them on one grid, plans around them, and writes its own tasks and habit blocks to one named "app calendar" on a chosen account. All three providers sit behind one `CalendarProvider` surface so product logic never branches on the vendor.

Code: `backend/src/modules/calendar-providers/` (registry, providers, `external-calendar-busy.service.ts`, `app-calendar-write.service.ts`), `backend/src/modules/calendar-overlays/`, `backend/src/modules/schedule/external-calendar-busy.util.ts`, and `frontend/src/modules/calendar/` (`schedulingKind.ts`, `components/CalendarChipMeta.tsx`).

## User-facing behavior

- Connected calendars appear on the Calendar page together. Each chip shows a **type icon**, a **provider logo**, and the **calendar name** (provider name when the name is unknown).
- **Type** (fixed / flexible / unscheduled) is changed from the chip's icon menu. The icon is read-only for recurring tasks and habit blocks.
  - An external event without an overlay is **fixed**.
  - *Fixed* / *Flexible* on an external event store a thin overlay row. On a linked app task they set `eventType` (`fixed` or `admin`).
  - *Unscheduled* on an external event **deletes it from the provider** and creates a local Unscheduled inbox task named after it; on a linked app task it clears the slot and sets `isUnscheduled`.
  - Switching to Flexible or Unscheduled first shows a warning modal with a "don't show again" checkbox (`dismissWarnFlexibleMove`, `dismissWarnUnscheduleExternal`).
- External events can be dragged and resized like app blocks; the new time is written back to the provider ([calendar-drag.md](calendar-drag.md)).
- Automatic placement never moves an external event; it plans around it.
- New app tasks and habit blocks are written to the app calendar on the account chosen in Settings (`appCalendarProvider`, calendar name `appGoogleCalendarName`, default "AI Calendar Assistant"). Connecting accounts is covered in [integrations.md](../integrations.md).

## Logic

**Which providers exist.** `CalendarProvidersRegistry.all()` always has Google and adds Microsoft / Apple only when their server config is present. Listing skips a provider that is not connected or throws; the others still load.

**Visible-event pipeline.** `ExternalCalendarBusyService.listVisibleEvents` loads every provider's events for a range, then drops events whose calendar is in `hiddenGoogleCalendarIds` (see [calendar-visibility.md](calendar-visibility.md)). Everything below consumes that list.

**What counts as busy** (`providerEventToBusyInterval`), in order:
1. Cancelled events are ignored.
2. Transparent events ("free" in Outlook, `transparent` in Google, `TRANSPARENT` in Apple) are ignored.
3. Events whose id or `recurringEventId` matches the app's own synced events (task and slot ids, plus habit ids for callers that pass them) are ignored, so the app does not block itself.
4. Timed events with `end > start` become an interval with the title as label.
5. All-day events become full-day intervals only when the caller sets `includeAllDay`.

**Who consumes it**

| Consumer | All-day events | Source file |
|----------|----------------|-------------|
| Incremental placement anchors | not busy | `placement-step.service.ts` `externalAnchors` |
| Problematic free-slot picker | not busy | `free-slots.service.ts` |
| Voice agenda / gaps / Now-Next | not busy | `voice-agent.tools.ts` |
| Full-replan scheduling engine | busy | `intelligent-scheduling.engine.ts` |
| Reminders | skipped by the reminder rules | `reminders.service.ts` |
| Schedule suggestions | sent to the model as `all-day` rows | `schedule-recommendations.service.ts` |

Placement treats external intervals as anchors with the fixed-event buffer around them ([fixed-event-buffer.md](fixed-event-buffer.md)). If listing throws as a whole, placement continues with no external anchors.

**Overlays.** `calendar_event_overlays` is unique per `(userId, provider, externalEventId)` and holds `schedulingMode` `fixed | flexible` and the external calendar id. `PUT /calendar-overlays/:provider/:eventId` creates or updates it lazily (calendar id defaults to `primary`). The client matches an overlay by event id or by `recurringEventId`. **Nothing outside the overlay controller reads the table**: not the engine, not placement, not the drag endpoint.

**Unschedule an external event** (`CalendarOverlaysService.unschedule`): delete on the provider, delete the overlay row, create a task `{ name: title (≤500, fallback "Untitled event"), isUnscheduled: true, eventType: admin }`.

**App-calendar target** (`resolveAppCalendarProvider`): the stored `appCalendarProvider` wins while that account stays connected; otherwise Google if linked, then Microsoft, then Apple; none means writes fail with "No calendar account is connected for app writes". `ensure` creates or reuses the named calendar and stores its id (`appGoogleCalendarId`, `appMicrosoftCalendarId`, `appAppleCalendarId`). Changing the target does not move events already written elsewhere. Disconnecting the target account retargets to the next connected one.

## Edge cases

- **Flexible on an external event is a label only.** The chip and the overlay say flexible, but the engine, placement and the move endpoint behave exactly as for fixed. Dragging works for fixed and flexible externals alike; placement never moves them.
- A provider that fails to list (expired token, network) is skipped silently for that request, so its events are not busy and placement can overlap them. No status is surfaced to the user.
- The same calendar id can exist on two providers; hide keys, overlay lookups and chip labels are namespaced by provider (`microsoft:<id>`, `apple:<id>`), Google ids stay bare.
- Recurring external events: the overlay is looked up by instance id first and then by series id.
- Microsoft and Apple events are never marked `isAppGenerated` by their providers; the app's own copies on those accounts are excluded from busy time only through the synced-id exclusion.
- Unscheduling a recurring Microsoft/Apple event calls that provider's `deleteEvent` on the id the grid holds; instance vs whole series is provider behavior.
- The overlay `DELETE` endpoint drops the overlay only and returns 404 when none exists; the UI does not call it today.

## Data / settings / API

- Settings: `hiddenGoogleCalendarIds`, `appCalendarProvider`, `appGoogleCalendarName`, `appGoogleCalendarId` / `appMicrosoftCalendarId` / `appAppleCalendarId`, `dismissWarnFlexibleMove`, `dismissWarnUnscheduleExternal`, `fixedEventBufferMinutes`.
- `GET /calendar-providers/calendars` → `{ providers, sections, calendars }`; `GET /calendar-providers/events`; `PUT` / `DELETE /calendar-providers/:provider/events/:eventId`.
- `GET /calendar-overlays`, `PUT /calendar-overlays/:provider/:eventId`, `POST /calendar-overlays/:provider/:eventId/unschedule`, `DELETE /calendar-overlays/:provider/:eventId`.
- Table `calendar_event_overlays`.
- Client kinds: `SchedulingKind = fixed | flexible | recurring | habit | unscheduled`; only fixed, flexible and unscheduled are editable.

## Out of scope

- OAuth and CalDAV setup walkthroughs ([integrations.md](../integrations.md)).
- The **Hide app calendar** product decision (roadmap Later).
- Whether Unschedule on a Microsoft/Apple series removes one instance or the whole series (provider `deleteEvent`).
- Making flexible externals movable by placement.

## Known gaps

- Flexible externals are not actually flexible (see Edge cases); the warning text and `dismissWarnFlexibleMove` imply a movement the engine never performs.
- Busy treatment of all-day events is inconsistent: the full-replan engine blocks the whole day, while incremental placement, the Problematic picker and voice ignore them.
- Silent provider failure can hide real conflicts.
- Habit exclusion differs by consumer: the engine and voice exclude habit Google ids from external busy time; incremental placement and schedule suggestions pass only task and slot ids, so a synced habit block can show up as an external event there.
- The overlay `DELETE` route is unused.

## Related

- [calendar-visibility.md](calendar-visibility.md)
- [calendar-drag.md](calendar-drag.md)
- [event-preview.md](event-preview.md)
- [fixed-event-buffer.md](fixed-event-buffer.md)
- [integrations.md](../integrations.md)
- [spec-conflict-rules.md](../spec-conflict-rules.md)
- [spec-incremental-placement.md](../spec-incremental-placement.md)
