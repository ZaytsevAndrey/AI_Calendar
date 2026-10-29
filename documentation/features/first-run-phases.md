# First run and day presets

Status: shipped

## Purpose

A new account has no day structure, so placement has nowhere to put work. First run walks the user through the minimum needed to schedule anything: wake and sleep times, then a set of day phases. A day-shape preset tiles the awake hours into ready-made phases so the user starts with a plausible day instead of an empty one.

## User-facing behavior

**The gate.** After sign-in, every protected page runs `GET /user-settings/required`. It returns `requiredFilled` (wake time, sleep time, and `googleCalendarLinked` all set) and `hasPhases` (at least one phase).

- `requiredFilled` false: the user is sent to `/settings` (and may stay only there).
- `requiredFilled` true and no phases: the user is sent to `/setup/phases` and may stay only there.
- Both true: the app opens normally.
- While the check loads the page shows "Loading…"; if the API is unreachable it shows a retry card (the production instance may still be waking up). These two strings are not translated.

**Setup page (`/setup/phases`).** No header, bottom nav, or other app chrome is shown until phases exist. Logout stays available.

1. **Step 1: sleep.** Wake and sleep time inputs, prefilled from saved settings (new settings rows default to 08:00 / 23:00; a Microsoft sign-up creates its row with 07:00 / 22:00). **Continue** saves both and moves to step 2.
2. **Step 2: day shape.** Weekday selector (default Monday–Friday, at least one day) and a preset picker: **defaults** (Sleep plus hidden Focus only), **working**, **student**, **open**. Buttons: **Save and create**, **Skip**, and **Back** (to step 1).
   - Save and create with `defaults` calls `POST /phases/setup-defaults`; with a preset it calls `POST /phases/apply-preset`.
   - **Skip** saves wake/sleep and calls setup-defaults without a weekday list (all days).
3. On success the user lands on `/`. If phases already exist when the page opens, it redirects to `/` at once.

**Preset catalog** (blocks are sized from the awake window):

| Preset | Blocks |
|--------|--------|
| working | Deep work (3 h from wake), Meetings (next 3 h), Work (fills the middle), Life admin (last 2 h before sleep) |
| student | Classes (first 4 h), Study (fills until Free time), Free time (last 2 h before sleep) |
| open | Morning focus (first 3 h), Errands (next 2 h), Personal projects (fills the middle), Wind down (last 2 h before sleep) |

Names and descriptions come from the user's `language` (en or uk). Every preset also creates Sleep and a hidden Focus phase.

The same preset action is available later from the Phases page with the same rules.

## Logic

**Sizing** (`buildLifestylePresetBlocks`): the awake window runs from wake to sleep (equal clocks mean 24 h; sleep earlier than wake wraps past midnight).

1. After-wake blocks keep their offset (0 h, 3 h) but start no earlier than the end of the previous placed block, and shrink at the sleep edge.
2. Before-sleep blocks take the last N minutes, shrinking or starting later when an earlier block already covers that time.
3. The fill block runs from the end of the last after-wake block to the start of the before-sleep block (or to sleep when none was placed). It is skipped when no after-wake block was placed.
4. Any block shorter than 30 minutes is dropped. Blocks are sorted by start time.

**Apply preset** (`PhasesService.applyPreset`), in one transaction:

1. Settings must exist and the preset id must be one of the three. Weekdays are normalized (empty means every day).
2. If the user has phases, any task linked to any of them (direct phase or linked phases) blocks the action with 400 "Cannot apply a preset while a phase has tasks…".
3. Otherwise event-phase links are cleared, parent links are removed, and every phase is deleted.
4. Sleep and hidden Focus rows (`basePhaseRows`) plus the preset blocks are inserted, all with the chosen weekdays.

**Setup defaults** (`setupDefaultPhases`): refuses with 400 when any phase exists ("Phases already exist for this user"); otherwise creates Sleep and Focus from the saved clocks and weekdays.

Phases are created only by these two calls and by explicit phase CRUD, never by reading settings or listing phases.

What is written: `user_settings.wakeTime` and `sleepTime` (step 1), and `phases` rows.

## Edge cases

- **Replace-while-tasks.** A second apply is refused while any phase has tasks, so a user who already scheduled work must move or delete those tasks first.
- **Repeat setup-defaults** is rejected once phases exist; the page then redirects away.
- **Short windows.** A very short awake window can drop every preset block, leaving only Sleep and Focus.
- **Wake equal to sleep** is treated as 24 hours awake.
- **Reload mid-setup** returns to step 1 with the saved clocks.
- **Settings save fails** in step 1 or 2: an error toast shows and nothing advances.
- **Weekdays empty:** Save and create is disabled, and an error toast appears if forced.
- **Hidden Focus** and Sleep (system main phases) are filtered out of phase lists.
- **Microsoft-only sign-up.** `ensureSettings` creates settings with `googleCalendarLinked = false`, and the gate needs it true. The callback sends such users to `/settings`, and they cannot reach `/setup/phases` until Google Calendar is linked.

## Data / settings / API

- `GET /user-settings/required` → `{ requiredFilled, hasPhases }`.
- `PATCH /user-settings` with `wakeTime`, `sleepTime`.
- `POST /phases/setup-defaults` (optional `weekDays`), `POST /phases/apply-preset` (`presetId`, optional `weekDays`).
- Tables: `user_settings`, `phases`, `event_phases` / `task_phases` links.
- Frontend: `ProtectedRoute`, `PhaseSetupPage`, `phaseSetupStep.ts` (app shell hidden on `/setup/phases`), `PhasePresetPicker`. The Google and Microsoft callback pages route to `/settings`, `/setup/phases`, or `/` from the same gate.
- Backend: `phases.service.ts`, `lifestyle-presets.ts`.

## Out of scope

- Phase CRUD validation and the core phases model ([personal-day.md](personal-day.md)).
- Editing presets or defining custom preset catalogs.
- Onboarding for calendars beyond the Google link, and the Microsoft-only gate fix.

## Known gaps

- Microsoft-only sign-ups are held on Settings because the gate requires `googleCalendarLinked`; the multi-provider gate is not implemented.
- The gate loading and error messages are hard-coded English.
- A preset cannot be applied over phases that still have tasks, and there is no merge option.
- Wake/sleep defaults differ by sign-up path (08:00/23:00 for a plain settings row versus 07:00/22:00 for Microsoft sign-ups).
- Skip leaves the user with only Sleep and a hidden Focus phase, so there are no visible work phases until they add some.

## Related

- [personal-day.md](personal-day.md)
- [language.md](language.md)
- [integrations.md](../integrations.md)
- [multi-calendar.md](multi-calendar.md)
