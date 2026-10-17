# Phone layout

Status: shipped

## Purpose

Make the app usable one-handed on a phone browser or installed PWA. Below 768px the desktop header and side lists give way to a bottom tab bar, a day-first calendar, collapsed secondary chrome, and bottom sheets. The shell is shipped; end-to-end polish of the daily path on it is unfinished (see Known gaps).

## User-facing behavior

The phone layout applies at `max-width: 767px` (Tailwind `max-md`, and `usePhoneLayout()` in code). From 768px up the desktop chrome is unchanged, including the sideways week grid between 768px and the wide layout.

**Shell**

- A **bottom tab bar** (`BottomNav`) with five tabs: Calendar, Tasks, Phases, Habits, Settings. Each tab is at least 44px tall, shows the active tab, respects the iOS safe area, and prefetches its route on hover or focus.
- The top header shrinks to a thin bar showing only the current section name; the brand and the inline nav appear only from 768px.
- Neither bar shows on `/setup/phases` ([first-run-phases.md](first-run-phases.md)).
- The PWA install banner and Tasks floating buttons sit above the tab bar through the `--phone-tab-offset` offset.
- The page area does not scroll as a whole on phone; each page scrolls its own content.

**Calendar**

- A first visit opens the **day** view (desktop opens week). A view the user chose before is remembered and wins.
- The header is compact: previous / next, a date picker, **Today**, and an icon-only day / week / month switch, plus a list button and the calendar visibility menu.
- **Week** on phone shows a seven-day strip to pick a day, with the grid below showing that one day. **Month** shows day cells with dots; tapping a day opens that day in the day view.
- The Now strip collapses to one line ("Now" plus the current block). Tapping expands it into Now, Next, and the unscheduled list.
- Habits for the day show as a one-row checklist under the header.
- A bottom bar under the calendar holds **Create**, **Voice** (mic), and a **More** button. More opens a sheet with **Suggestions**; there is no schedule dropdown on phone.
- The side events list is hidden on phone; the list button opens the period's events in a modal instead.
- Dragging and resizing calendar blocks is off on any coarse (touch) pointer.

**Tasks**

- The page lead text is hidden. Create and voice are two floating buttons at the bottom right above the tab bar.
- Each task section shows search plus a filter icon that opens a filters sheet ([task-filters.md](task-filters.md)).
- Scheduled task cards show their actions in a row at the bottom of the card instead of on the right side.

**Other pages**

- Habits: Create is an icon button in the header ([habits.md](habits.md)). The Now strip on the calendar does not show the habit strip on phone; habits come from the calendar checklist and the Habits page.
- Phases: Edit and Delete are icon-only buttons; the phase calendar is a tappable list with a hint.
- Settings: a short footer line appears under Logout.
- Voice sheet: full width with a tall minimum height.
- Modal footer buttons are compact.

## Logic

- `useMediaQuery('(max-width: 767px)')` drives behavior that CSS alone cannot: the compact calendar header, week-as-day grid, phone month, Now strip collapse, Tasks floating buttons and filter sheet, voice sheet width, and the habit checklist layout.
- Everything else uses `max-md` and `md:` utilities so layout switches with no JavaScript.
- `--phone-tab-offset` is `0` normally and `3.5rem + safe-area bottom` at 767px and below, so fixed elements clear the tab bar.
- On phone with the week view, `CalendarPage` swaps the grid view to `day` and renders `PhoneWeekStrip`.
- `useCoarsePointer()` (`pointer: coarse`) is independent of width: it removes the time-change drag handler, so a touch laptop at desktop width also cannot drag ([calendar-drag.md](calendar-drag.md)).
- The tab list lives in `mainNav.ts` and feeds both `BottomNav` and the desktop `Header`, so the two stay in step. The Phases tab is also active on `/setup/*`.

What is written: nothing. The one remembered value is the chosen calendar view in local storage.

## Edge cases

- **Rotation or resize across 768px** switches layouts live; the calendar view stays as chosen, but a phone-width week renders as a one-day grid.
- **Touch at desktop width** keeps the desktop layout but has no drag.
- **A mouse at phone width** (a narrow desktop window) gets the phone layout and keeps drag.
- **Safe-area devices** pad the tab bar and the offset by the bottom inset.
- **Expanded Now strip** state is not remembered; it starts collapsed after each page load.
- **No habits strip** in the Now strip on phone; habit blocks that are current can still be completed from the Now block row.
- **Event list and More actions** are modals, not draggable sheets.

## Data / settings / API

- No settings or API fields.
- Local storage: the stored calendar view (read by `defaultCalendarView`).
- CSS variable `--phone-tab-offset` in `tailwind.css`.
- Code: `useMediaQuery.ts`, `BottomNav.tsx`, `mainNav.ts`, `Header.tsx`, `App.tsx`, `CalendarPage.tsx`, `NowStrip.tsx`, `EventsPage`, `TaskSectionFilters.tsx`, `VoiceTaskSheet.tsx`.

## Out of scope

- Roadmap §32 daily-path completion (see today, create or speak, mark done, check in a habit, polished end to end).
- Desktop layout redesign.
- A native mobile app and offline mode.
- Landscape or tablet-specific layouts.

## Known gaps

- §32 is open: the shell exists, but the full daily path on phone is not yet finished or polished.
- Drag is disabled on touch, and there is no touch alternative to reschedule by gesture; users reschedule through the editor or voice.
- Habits are not in the phone Now strip, so a habit check-in needs a calendar checklist or the Habits page.
- The route-gate loading and error cards are hard-coded English.
- Events list and the actions menu are plain modals, not swipeable sheets.

## Related

- [now-next.md](now-next.md)
- [calendar-drag.md](calendar-drag.md)
- [task-filters.md](task-filters.md)
- [roadmap.md](../roadmap.md)
