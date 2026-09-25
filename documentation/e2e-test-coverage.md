# E2E test coverage plan

Complete inventory of **existing** product behavior to cover with automated tests. Cases describe **current code** (September 2026), not the roadmap.

Related docs: [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md) (engine Given/When/Then → unit), [task-creation-rules.md](task-creation-rules.md), [api-reference.md](api-reference.md), [overview.md](overview.md).

---

## 1. Goal

Protect the daily loop: **sign in → settings/phases gate → capture a task → Generate / Undo / Clear → Now/Done → habits**. Every live HTTP route and every user-facing screen has named cases. Engine placement math stays in unit tests; E2E asserts the HTTP/UI contract around that math.

Out of scope until a later cycle: snooze, text-add, in-app guide, real Google OAuth in CI, real Groq in CI. Day/week drag-and-drop math and the move plan are unit-tested (`eventDrag.spec.ts`, `move-displayed-event.util.spec.ts`, `displayed-event-move.service.spec.ts`). A browser drag needs a live Google event, which CI does not have.

---

## 2. Layers

| Layer | Tool | What it proves |
|-------|------|----------------|
| **Unit** | Jest `*.spec.ts` next to the module | Pure rules: engine, stats, schema, appearance. |
| **API E2E** | Nest `AppModule` + Fastify `app.inject()` + temp SQLite (`backend` `test:e2e`) | JWT, DTO/service validation, TypeORM, jobs, filters, per-user isolation. |
| **UI E2E** | Playwright against webpack + API | Routing, forms, toasts, Calendar chrome, localStorage, 401 retry. |

Default: **API E2E first**. UI E2E only for glue that unit/API cannot see. Do not copy every unit assertion into E2E.

**Nest naming:** `*.e2e-spec.ts` here means HTTP integration, not a browser.

---

## 3. Harness (API)

- Boot `AppModule` with `FastifyAdapter`. No Swagger, no CORS from `main.ts`.
- Requests via **`app.inject()`** (Fastify). Do not use `supertest`.
- Isolated SQLite file per file (or `beforeAll`); `TYPEORM_SYNC=true`. Never touch dev `db.sqlite`.
- **Auth helper:** insert `User` + `UserSettings`, sign JWT with `JWT_SECRET`. Do not add a production `/login` password route.
- Google Calendar + Groq: in-process **stubs** (no network).
- Clock: inject or freeze `now` where jobs/habits/civil days depend on it; default fixture TZ `Europe/Kyiv`.
- Two users `A` and `B` in isolation cases.
- English names in `describe` / `it`.

### Harness (UI)

- Playwright: start frontend + backend (`e2e/playwright.config.ts`, ports **3100** / **3101**, isolated SQLite). **One worker**; each test starts after the previous one finishes. Default viewport is Desktop Chrome **1280×720**. `U-CAL-017` is the phone case (**390×844**). `U-CAL-023` checks **1024×700**, **1100×800**, and **1279×768**, the widths where the calendar used to collapse. The iOS install hint changes the user agent only.
- Seed JWT into Redux persist / `localStorage` (`auth` slice + `access_token`). Skip the real Google redirect. Backend `E2E_BOOTSTRAP=1` writes `e2e/.tmp/auth.json` (onboarded / needs-settings / needs-phases users).
- Stub Google on the API with `E2E_STUB_EXTERNAL=1` (`checkConnection` false, empty event lists). No real Groq in P0 smoke.
- One headed debug run is optional; CI is headless (`npm run test:e2e:ui`).

### External systems

| System | In E2E |
|--------|--------|
| Google OAuth + Calendar API | Stub. Ticket/callback covered only as HTTP redirects + redeem with a test ticket helper if the in-memory map is exposable; otherwise seed a linked user. |
| Groq Whisper / LLM | Stub. Transcribe/parse return fixtures. |
| SMTP / email verification | Dead with Google-only auth — do not test. |
| Real Postgres | Not required for the first waves (SQLite matches local). |

---

## 4. IDs and priority

`{LAYER}-{DOMAIN}-{NNN}`

- Layer: `A` API, `U` UI, `X` isolation/security, `N` unit (pointer only).
- Priority: **P0** CI smoke every PR, **P1** full API/UI suite, **P2** rare edges.

Status column in implementation: `todo` until a spec exists.

---

## 5. Implementation waves

| Wave | Scope | CI |
|------|--------|-----|
| **0** | Harness: `create-test-app`, JWT seed, Google stub | **done** (`backend/test/helpers`) |
| **1** | P0 API: health, 401, settings+phases bootstrap, task create, generate poll, habits today, isolation sample | **done** (`backend/test/p0.e2e-spec.ts`, CI `test:e2e`) |
| **2** | P1 API: remaining HTTP + edge cases in this file | **done** (`backend/test/*.e2e-spec.ts`, same CI job) |
| **3** | Playwright P0: login bypass → calendar; create task; Generate; Done; habit chip | **done** (`e2e/tests/p0.smoke.spec.ts`, CI `test:e2e:ui`) |
| **4** | Remaining Playwright P0 UI: wizard, undo/clear, Now strip, habits CRUD, auth glue | **done** (`e2e/tests/p0.*.spec.ts`, same CI `test:e2e:ui`) |
| **5** | Playwright P1 screens (filters, voice sheet with stub, day/week/month chrome) | **done** (`e2e/tests/p1.*.spec.ts`, same CI `test:e2e:ui`) |
| **6** | Remaining Playwright P1: settings debounce/TZ/Google status, phase CRUD/drag, task Google options, generate hang/alerts, nav/onboarding | **done** (`e2e/tests/p1.settings.spec.ts`, `p1.phases.spec.ts`, extras in `p1.auth/tasks/calendar`) |
| **7** | Playwright P2: PWA banner, empty states, mic-denied / transcribe error, overnight phase, clear-empty | **done** (`e2e/tests/p2.*.spec.ts`, same CI `test:e2e:ui`) |

Engine cases **T\*** / **W\*** stay in [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md) as **unit**. Wave 1 generate E2E is one happy path + unscheduled exclusion, not the full T10–T41 grid.

---

## 6. Global fixtures

Unless a case overrides:

- User A: `timeZone=Europe/Kyiv`, `wakeTime=07:00`, `sleepTime=22:00`, `googleCalendarLinked=true`, `allowSplitScheduling=true`, `minSplitMinutes=30`, `recurringScheduleHorizonDays=14`, `weekendWorkEnabled=false`.
- Default phases via `POST /phases/setup-defaults` (Sleep + Focus). Focus/`main_phase` is hidden from `GET /phases`.
- Google stub: connected, app calendar id `app-cal`, primary `primary`. Creates/updates/deletes are recorded, not sent to Google.
- Groq stub: configurable transcript + parse JSON.

---

## 7. Cases — infrastructure

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-INFRA-001 | A | P0 | App booted | `GET /health` | 200 `{ status: 'ok' }`, no JWT |
| A-INFRA-002 | A | P1 | Protected route | No `Authorization` | 401, body includes `INVALID_JWT` (JwtExceptionFilter) |
| A-INFRA-003 | A | P1 | Protected route | Garbage Bearer | 401 `INVALID_JWT` |
| A-INFRA-004 | A | P2 | Origin `http://localhost:3000` | CORS preflight / credentialed GET | Allowed (if CORS registered in test app; if harness skips CORS, skip this case) |
| A-INFRA-005 | A | P2 | Disallowed origin | CORS | Rejected |
| A-INFRA-006 | A | P2 | Handler throws generic Error | Any route | 500 via AllExceptionsFilter, no stack in body |
| A-INFRA-007 | A | P2 | `GET /api` Swagger | Only if test app mounts Swagger | 200; default harness **does not** mount it |

---

## 8. Cases — auth and routing

Email/password (`POST /auth/register`, `/login`, forgot/reset) **do not exist**. Frontend `/register`, `/forgot-password`, `/reset-password` redirect to `/login`. Do not write E2E that expects those APIs.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-AUTH-001 | A | P0 | Google env set | `GET /auth/google` | 200 `{ url }` contains Google OAuth host |
| A-AUTH-002 | A | P1 | Same | `GET /google-calendar/auth-url` | Same shape as A-AUTH-001 |
| A-AUTH-003 | A | P1 | Callback `?error=access_denied` | `GET /google-calendar/callback` | 302 to frontend `/login?error=access_denied` |
| A-AUTH-004 | A | P1 | Callback without `code` | same | 302 `/login?error=no_code` |
| A-AUTH-005 | A | P1 | Callback `code` but stub sign-in throws | same | 302 `/login?error=…` encoded message |
| A-AUTH-006 | A | P1 | Valid one-time ticket (helper) | `POST /auth/google/session` `{ ticket }` | 200 `access_token` + `refresh_token` |
| A-AUTH-007 | A | P0 | Empty/missing ticket | `POST /auth/google/session` | 4xx / 401, no tokens |
| A-AUTH-008 | A | P1 | Ticket already redeemed | Second redeem | Fail; first tokens still work |
| A-AUTH-009 | A | P1 | Ticket older than 120s | Redeem | Fail |
| A-AUTH-010 | A | P0 | Valid refresh in DB | `POST /auth/refresh` `{ refresh_token }` | New pair; old refresh rejected |
| A-AUTH-011 | A | P0 | Unknown refresh | `POST /auth/refresh` | 401 `INVALID_REFRESH_TOKEN` |
| A-AUTH-012 | A | P1 | Valid access JWT | `POST /auth/logout` with Bearer | 200; refresh in DB cleared |
| A-AUTH-013 | A | P1 | Logout then refresh | `POST /auth/refresh` with old refresh | 401 |
| A-AUTH-014 | A | P2 | Logout **without** Authorization | `POST /auth/logout` | **Current:** uncaught missing header → **500** (not 401). Assert actual status; do not “fix” in the test. |
| A-AUTH-015 | A | P1 | Access expired, refresh valid | Call protected API (UI does this) | API itself does not auto-refresh; 401. Refresh endpoint still works. |
| U-AUTH-001 | U | P0 | Logged-out | Open `/` | Redirect `/login` |
| U-AUTH-002 | U | P0 | Logged-out | Click Continue with Google | Navigates to `/auth/google` URL (or stubbed redirect) |
| U-AUTH-003 | U | P1 | `/login?error=access_denied` | Render login | Error visible |
| U-AUTH-004 | U | P0 | Callback `?ticket=` | GoogleCallbackPage | Redeems, stores tokens, leaves `/login` |
| U-AUTH-005 | U | P0 | Authenticated, required filled, has phases | Open `/login` | PublicRoute → `/` |
| U-AUTH-006 | U | P0 | Authenticated, `requiredFilled=false` | Open `/` | Redirect `/settings` |
| U-AUTH-007 | U | P0 | Required filled, `hasPhases=false` | Open `/` | Redirect `/setup/phases` |
| U-AUTH-008 | U | P1 | Required not filled | Open `/settings` | Stays (exempt) |
| U-AUTH-009 | U | P1 | Has settings, no phases | Open `/setup/phases` | Stays (exempt) |
| U-AUTH-010 | U | P0 | Authenticated | Open `/register`, `/forgot-password`, `/reset-password` | `/login` or `/` per PublicRoute |
| U-AUTH-011 | U | P0 | Any auth | Open `/events`, `/schedule`, `/calendar` | Canonical `/tasks` or `/` |
| U-AUTH-012 | U | P1 | Unknown path | Open `/nope` | `/` (then ProtectedRoute gates) |
| U-AUTH-013 | U | P1 | Access 401 then refresh fails | Any API call | Logout + `/login` |
| U-AUTH-014 | U | P1 | Access 401, refresh OK | Any API call | Retries once, stays logged in |
| U-AUTH-015 | U | P1 | Settings Sign out | Click | `POST /auth/logout`, toast, `/login` |
| U-AUTH-016 | U | P1 | `GET /user-settings/required` fails | Protected page | Retry UI, no silent blank calendar |

---

## 9. Cases — user settings and onboarding

`requiredFilled` = `wakeTime` && `sleepTime` && `googleCalendarLinked`. Default phases are **not** created on `GET /user-settings`; only `POST /phases/setup-defaults`.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-SET-001 | A | P0 | New user, no settings row | `GET /user-settings` | 200; defaults created (`wakeTime`/`sleepTime` filled) |
| A-SET-002 | A | P1 | Second GET | `GET /user-settings` | Same row, no duplicate |
| A-SET-003 | A | P0 | Valid PATCH | `wakeTime`, `sleepTime`, `timeZone`, split, horizon | 200 merged |
| A-SET-004 | A | P1 | `minSplitMinutes` > `maxSplitMinutes` | PATCH | max bumped to min |
| A-SET-005 | A | P1 | Valid IANA `Europe/Kyiv` | PATCH `timeZone` | Persisted |
| A-SET-006 | A | P1 | Invalid IANA `Not/AZone` | PATCH | **Record actual status.** DTO validator exists; **no global ValidationPipe**. If 200, that is current behavior. |
| A-SET-007 | A | P1 | Empty `timeZone` already saved | GET then PATCH other fields | Empty zone is **not** auto-filled by GET |
| A-SET-008 | A | P0 | Linked + wake + sleep | `GET /user-settings/required` | `{ requiredFilled: true, hasPhases: … }` |
| A-SET-009 | A | P0 | `googleCalendarLinked=false` | required | `requiredFilled: false` |
| A-SET-010 | A | P1 | No phases | required | `hasPhases: false` |
| A-SET-011 | A | P1 | After setup-defaults | required | `hasPhases: true` |
| A-SET-012 | A | P2 | PATCH `appGoogleCalendarName` | Google stub rename fails | Settings still 200 (warn-only) |
| A-SET-013 | A | P2 | PATCH fields with no Settings UI (`weekendWorkEnabled`, `allowSplitScheduling`, lunch defaults) | API | Persisted; engine reads them (covered by unit + A-SCH generate) |
| A-SET-014 | A | P1 | PATCH `hiddenGoogleCalendarIds` | Trim, dedupe, drop app calendar id; non-array | 200 with the cleaned list; non-array is 400 |
| A-REM-001 | A | P1 | VAPID keys unset | `GET /reminders/vapid-public-key` | 503 |
| A-REM-002 | A | P1 | Cron secret set, VAPID unset | `POST /reminders/tick` | 401 without/with a bad secret; 200 `{ users: 0, sent: 0 }` with the secret |
| A-REM-003 | A | P1 | Settings | PATCH `remindersEnabled: true` | 200 and the flag persists |
| A-REM-004 | A | P1 | Two users | POST/DELETE subscription | https stored; other user cannot delete it; owner delete removes the row |
| U-SET-001 | U | P1 | Settings page | Change wake/sleep/TZ/horizon/fixed-event buffer | Debounced auto-save (~1s), toast |
| U-SET-002 | U | P1 | Empty TZ on first login | App loads | Client PATCHes browser IANA **once** |
| U-SET-003 | U | P1 | TZ already set | Reload | No overwrite |
| U-SET-004 | U | P1 | Google status | Settings | Shows connected from `check-connection` (no disconnect button — feature missing) |
| U-SET-005 | U | P2 | Settings loading / error | Slow/fail API | Loading then retry |
| U-ONB-001 | U | P0 | `/setup/phases` | Save with ≥1 weekday | PATCH settings + `setup-defaults` → calendar |
| U-ONB-002 | U | P0 | `/setup/phases` | Skip | `setup-defaults` all days → calendar |
| U-ONB-003 | U | P1 | Weekday picker empty | Save | Blocked (client: ≥1 day) |
| U-ONB-004 | U | P1 | Phases already exist | Save/skip again | API 400; UI surfaces error |

---

## 10. Cases — phases

Backend **does not** reject overlapping phases. Frontend `usePhaseValidation` blocks phases outside the wake–sleep window. E2E must not assume backend overlap errors.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-PH-001 | A | P0 | No phases | `POST /phases/setup-defaults` | 201 Sleep (`sleep_time`, sleep→wake) + Focus (`main_phase`, wake→sleep) |
| A-PH-002 | A | P0 | Phases exist | setup-defaults again | 400 |
| A-PH-003 | A | P1 | No settings row | setup-defaults | 400 |
| A-PH-004 | A | P0 | After defaults | `GET /phases` | Sleep visible; Focus / `main_phase` **hidden** |
| A-PH-005 | A | P1 | — | `GET /phases/time-phases` | Only `time_phase` |
| A-PH-006 | A | P1 | — | `GET /phases/sleep-time` | Sleep only |
| A-PH-007 | A | P1 | Phase weekDays Mon–Fri | `GET /phases/time-phases/date/:saturday` | Empty or no that phase |
| A-PH-008 | A | P1 | weekDays null (all days) | date weekday any | Phase returned |
| A-PH-009 | A | P0 | Valid body | `POST /phases` time_phase | 201 |
| A-PH-010 | A | P1 | Overnight `22:00`–`06:00` | POST | 201; stored as given |
| A-PH-011 | A | P1 | Overlapping window with existing phase | POST | **201** (allowed) |
| A-PH-012 | A | P1 | Empty `weekDays` | POST/PATCH | Stored as all days (`null`) |
| A-PH-013 | A | P0 | Own id | `GET /PATCH /phases/:id` | 200 |
| A-PH-014 | A | P0 | Unknown id | GET/PATCH/DELETE | 404 |
| A-PH-015 | A | P0 | Phase with assigned task | `DELETE /phases/:id` | **409** |
| A-PH-016 | A | P0 | Phase with no tasks | DELETE | 200; gone from list |
| A-PH-017 | A | P1 | `weekDays` with duplicates | POST | Deduped sorted |
| A-PH-018 | A | P1 | Settings, no phases | `POST /phases/apply-preset` `working` | 201; Deep work / Meetings / Life admin; Focus hidden |
| A-PH-019 | A | P1 | Phases exist, then a task on one | apply `student`, then apply again | First replace succeeds; second is 400 and phases stay |
| A-PH-020 | A | P1 | No settings, or unknown preset id | `POST /phases/apply-preset` | 400 |
| U-PH-001 | U | P1 | `/phases` | List + weekly grid | Sleep/custom visible; Focus hours hidden |
| U-PH-002 | U | P1 | Add modal | Valid create | Appears on grid; toast |
| U-PH-003 | U | P1 | Phase outside wake–sleep | Submit | **Client** validation blocks |
| U-PH-004 | U | P1 | Drag/edit times | Save | PATCH, grid updates |
| U-PH-005 | U | P1 | Delete with confirm | Confirm | Deleted or 409 toast if tasks |
| U-PH-006 | U | P2 | Overnight phase | Display | Wraps midnight on calendar |

---

## 11. Cases — tasks (API)

Silent replan: `jobId` on create/update when `shouldReplanAfterSave`. Unscheduled create → `jobId` null. Unscheduled **from scheduled** → replan (free slot). Fixed → no replan. `completed`/`canceled` → no replan.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-TSK-001 | A | P0 | Flexible: name + optional duration | `POST /tasks` | 201 `eventType=admin`, default 30 min if omitted, `jobId` set |
| A-TSK-002 | A | P0 | Missing name | POST | 4xx or empty-name service error — **record actual** (no global ValidationPipe) |
| A-TSK-003 | A | P0 | Fixed without start/end | POST `eventType=fixed` | 400 start/end required |
| A-TSK-004 | A | P0 | Fixed end ≤ start | POST | 400 if service checks; else client-only — **record actual** |
| A-TSK-005 | A | P0 | Unscheduled + `eventType=fixed` | POST | 400 cannot be fixed |
| A-TSK-006 | A | P0 | Unscheduled name only | POST `isUnscheduled=true` | 201 inbox; times/recurrence cleared; `jobId` null |
| A-TSK-007 | A | P1 | Recurring DAILY | POST `isRecurring` + pattern | 201 + `jobId` |
| A-TSK-008 | A | P0 | `phaseIds` length 2 | POST | 400 only one phase |
| A-TSK-009 | A | P0 | Foreign or unknown phase id | POST | 400 |
| A-TSK-010 | A | P1 | Own phase | POST `phaseIds: [id]` | Linked; `phaseId` set |
| A-TSK-011 | A | P1 | `phaseIds: []` on PATCH | Clear phase | `phaseId` null |
| A-TSK-012 | A | P1 | `deadline: null` PATCH | Clear deadline | null persisted |
| A-TSK-013 | A | P1 | From/Until + `timeZone` | POST | Window persisted **before** job; `scheduleTimeZone` set |
| A-TSK-014 | A | P1 | Google fields (location, color, visibility, show-as, reminders) | POST | Stored on row |
| A-TSK-015 | A | P0 | `GET /tasks` | List | Only caller’s tasks, newest first |
| A-TSK-016 | A | P1 | `?status=completed` | GET | Only that status (`status` wins over `phaseId` if both sent) |
| A-TSK-017 | A | P1 | `?phaseId=` only | GET | Tasks on that phase |
| A-TSK-018 | A | P0 | Own id | GET/PATCH/DELETE `/tasks/:id` | 200 |
| A-TSK-019 | A | P0 | Unknown id | same | 404 |
| A-TSK-020 | A | P0 | Flexible TODO | PATCH times/name | 200 + `jobId` |
| A-TSK-021 | A | P0 | Fixed | PATCH | 200, `jobId` null |
| A-TSK-022 | A | P0 | Move scheduled → unscheduled | PATCH `isUnscheduled=true` | Times cleared; Google event deleted (stub); `jobId` set (free slot) |
| A-TSK-023 | A | P0 | Unscheduled → flexible (`isUnscheduled=false`) | PATCH | Becomes schedulable; `jobId` set |
| A-TSK-024 | A | P0 | `PATCH /tasks/:id/status` `completed` | Done | Status completed; no new Google event for unscheduled/flexible Done |
| A-TSK-025 | A | P1 | Status `canceled` | PATCH status | Persisted; no replan |
| A-TSK-026 | A | P1 | Status `in_progress` / `todo` | PATCH status | OK; replan if movable incomplete |
| A-TSK-027 | A | P2 | Invalid status string | PATCH status | **Record actual** (no enum guard on controller) |
| A-TSK-028 | A | P0 | DELETE unscheduled | DELETE | Gone; **no** replan |
| A-TSK-029 | A | P0 | DELETE scheduled flexible | DELETE | Gone; Google stub delete; replan enqueued |
| A-TSK-030 | A | P1 | DELETE fixed with `googleEventId` | DELETE | Stub delete; no replan |
| A-TSK-031 | A | P1 | Google disconnected | POST fixed | 201; sync skipped (stub no-op / warn) |
| A-TSK-032 | A | P1 | Completed while replan running | Status completed mid-job | Engine must not write a new slot (poll job result) |
| A-TSK-033 | A | P1 | Preferred start on flexible | POST scheduledStart/End = preferred window | Persisted; engine may move on generate |
| A-TSK-034 | A | P1 | `eligibleWeekDays` | POST | Persisted; generate respects (see N-SCH / T matrix) |
| A-TSK-035 | A | P1 | `allowSplit` false vs settings true | POST + generate | No split for that task |
| A-TSK-036 | A | P2 | `estimatedTimeInMinutes` 0 | POST non-fixed | **Record actual** (client blocks 1–1440; API may default) |
| A-TSK-037 | A | P0 | `POST /tasks/:id/skip-occurrence` still-open slot | Skip | 200; task stays `todo`; `jobId` null; local slot gone |
| A-TSK-038 | A | P0 | Skip unscheduled inbox | POST skip-occurrence | 400 |

---

## 12. Cases — tasks (UI)

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| U-TSK-001 | U | P0 | `/tasks` | Open create | Wizard; default Flexible |
| U-TSK-002 | U | P0 | Flexible | Name + duration submit | Toast `Task created` with name/when; appears in list; calendar refresh after job |
| U-TSK-003 | U | P0 | Fixed | Missing end | Client error; no POST |
| U-TSK-004 | U | P0 | Fixed | Valid slot | Created; Google stub event if connected |
| U-TSK-005 | U | P0 | Recurring | No pattern | Client blocks |
| U-TSK-006 | U | P0 | Recurring Daily Mon–Fri | Submit | Created |
| U-TSK-007 | U | P0 | Unscheduled | Name only | Inbox section; not on Generate |
| U-TSK-008 | U | P1 | Unscheduled with deadline soon/overdue | List | Tone highlight (overdue/today/soon) |
| U-TSK-009 | U | P0 | Inbox **Schedule** | Opens form as Flexible/Fixed | Save without `isUnscheduled` |
| U-TSK-010 | U | P0 | Inbox **Done** | Confirm path | `completed`; disappears from inbox; **no** calendar block |
| U-TSK-011 | U | P1 | Uncheck Fixed | Form | Allow split restored (preset rules) |
| U-TSK-012 | U | P1 | Clear phase / deadline on edit | Save `phaseIds: []` / `deadline: null` | Deadline clears. **Current:** GET still returns previous `phaseId` after `phaseIds: []` |
| U-TSK-013 | U | P1 | Expand Google options | location/color/visibility/reminders | Persisted |
| U-TSK-014 | U | P1 | Filter active / todo / in_progress / completed / canceled / all | Change filter | List matches |
| U-TSK-015 | U | P1 | Sort name / priority / deadline / duration | Change sort | Order matches |
| U-TSK-020 | U | P1 | Search inside Unscheduled or Scheduled | Type in one box | The other section is unchanged |
| U-TSK-016 | U | P1 | Delete confirm | Cancel | Still there |
| U-TSK-017 | U | P1 | Delete confirm | Confirm | Toast `Task deleted`; gone |
| U-TSK-018 | U | P1 | API error on save | Fail POST | Toast `Could not create task` + API detail |
| U-TSK-019 | U | P2 | Empty list | No tasks | Empty state, not a spinner forever |

---

## 13. Cases — voice

Do **not** hit real Groq. Stub transcribe + parse.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-VOI-001 | A | P1 | Valid base64 audio | `POST /voice/transcribe` | 201 `{ transcript }` from stub |
| A-VOI-002 | A | P1 | Empty / invalid base64 | transcribe | 4xx |
| A-VOI-003 | A | P1 | Payload > 8MB | transcribe | 4xx |
| A-VOI-004 | A | P1 | Groq stub 503 | transcribe | 503 surfaced |
| A-VOI-005 | A | P0 | Transcript with name | `POST /voice/parse-task` | `understanding=complete`, task payload has name; defaults 30 min / medium / no phase |
| A-VOI-006 | A | P0 | No usable name | parse | `needs_clarification` + one question |
| A-VOI-007 | A | P0 | After clarification answer | parse with `previousTranscript` + `clarificationAnswer` | No **second** question; creates or sufficient |
| A-VOI-008 | A | P1 | “tomorrow” + settings TZ | parse | Civil day in settings IANA, not host UTC |
| A-VOI-009 | A | P1 | Day-only, no clock | parse complete | From/Until day window, not fixed slot |
| A-VOI-010 | A | P1 | LLM invalid phase ids | parse | Stripped in normalize |
| A-VOI-011 | A | P1 | Empty transcript | parse | 4xx |
| A-VOI-012 | A | P2 | LLM non-JSON | parse | Error, not 500 HTML |
| U-VOI-001 | U | P1 | Mic on Tasks/Calendar | Open sheet, stub complete | Task created immediately; toast |
| U-VOI-002 | U | P1 | Stub `sufficient` | After parse | Wizard opens prefilled |
| U-VOI-003 | U | P1 | Stub `needs_clarification` | Answer once | Completes; no second question UI |
| U-VOI-004 | U | P2 | Mic permission denied | Start | Error in sheet, no crash |
| U-VOI-005 | U | P2 | `GROQ` stub missing | Transcribe | **Current:** error text in the voice sheet (`Could not transcribe audio`), not a toast |
| A-VOI-013 | A | P1 | Named incomplete task, intent complete | `POST /voice/parse-task` | `command.kind=complete`, that task id, `task` null |
| U-VOI-006 | U | P1 | Stub `command.complete` | Setting off, then on | Off completes immediately. On shows Confirm, then completes. Setting is restored off |

---

## 14. Cases — schedule slots and jobs

Generate body `{ startDate, endDate }` is **ignored**. Horizon = today → `recurringScheduleHorizonDays` in settings TZ. Undo snapshot exists **only** for Calendar Generate, not silent replan. Clear **drops** undo.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-SCH-001 | A | P1 | Valid task | `POST /schedule` slot | 201 |
| A-SCH-002 | A | P1 | end ≤ start | POST slot | 400 |
| A-SCH-003 | A | P1 | Overlapping slot same task | POST | 400 already scheduled |
| A-SCH-004 | A | P1 | Unknown taskId | POST | 404 |
| A-SCH-005 | A | P1 | Range query | `GET /schedule?startDate&endDate` | Only overlapping rows; date-only endDate includes that UTC day |
| A-SCH-006 | A | P2 | `phaseId` query | GET | Filter by task phase (`categoryId` from old frontend must not be required) |
| A-SCH-007 | A | P1 | Own slot | GET/PATCH/DELETE `/schedule/:id` | 200 |
| A-SCH-008 | A | P1 | PATCH overlap / end ≤ start | PATCH | 400 |
| A-SCH-009 | A | P0 | Flexible TODO in inbox? no — movable TODO | `POST /schedule/generate` | `{ jobId, status }`; poll → `done`; slot created |
| A-SCH-010 | A | P0 | Unscheduled only | generate | No slot for that task |
| A-SCH-011 | A | P0 | Poll `GET /schedule-jobs/:id` | While running | `progressStage` preparing → computing → syncing_google → done |
| A-SCH-012 | A | P1 | Failed job (stub engine throw) | poll | `failed` + `errorMessage` |
| A-SCH-013 | A | P1 | Unknown job / other user | GET job | 404 |
| A-SCH-014 | A | P1 | Second generate while running | enqueue | **409** job already running |
| A-SCH-015 | A | P0 | After successful generate | `GET /schedule-jobs/undo` | `{ available: true, jobId, generatedAt }` |
| A-SCH-016 | A | P0 | `POST /schedule-jobs/undo` | Once | Still-open slots restored; ended stay; `available` false |
| A-SCH-017 | A | P0 | Undo twice | Second POST | 400 nothing to undo |
| A-SCH-018 | A | P1 | Undo while job running | POST undo | 409 |
| A-SCH-019 | A | P1 | Silent replan after task save | GET undo | **Not** available from that job |
| A-SCH-020 | A | P0 | Open + ended auto slots | `DELETE /schedule` | `{ deleted: n }` only still-open; ended remain; undo invalidated |
| A-SCH-021 | A | P1 | Clear with nothing open | DELETE | `{ deleted: 0 }` |
| A-SCH-022 | A | P1 | Google disconnected | generate / clear | Local rows still change; Google stub skipped |
| A-SCH-023 | A | P1 | `POST /schedule-jobs/replan` | Direct | Job like silent replan; no undo snapshot |
| A-SCH-024 | A | P1 | `GET /schedule-jobs/latest/done` | After generate | Parsed `result` with `diff` / `warnings` / `errors` |
| A-SCH-025 | A | P1 | No jobs | latest/done | `{ job: null }` |
| A-SCH-026 | A | P1 | Task does not fit deadline/horizon | generate | Job `done` with warning codes (see matrix); **not** forced past deadline |
| A-SCH-027 | A | P1 | Past-deadline TODO | generate | Skipped, no error “cannot fit” |
| A-SCH-028 | A | P1 | Fully ended auto slot | generate | Kept as busy; remaining minutes only |
| A-SCH-029 | A | P1 | Recurring Google series (stub) | replan | Old series `UNTIL` + new series recorded on stub |
| A-SCH-030 | A | P2 | Job poll timeout on UI (120s) | Hang stub | UI error toast — UI case U-CAL-007 |
| A-SCH-031 | A | P1 | Movable TODO, replan not drained | `POST /schedule/preview` | `diff` places the task; `/schedule` stays empty; undo stays unavailable |
| A-SCH-032 | A | P1 | Groq stub | `POST /schedule/recommendations` | 401 without JWT. Empty user skips Groq and returns no suggestions. A task returns only suggestions whose `taskId` exists. `/schedule` stays empty |

---

## 15. Cases — Google Calendar

`POST /google-calendar/disconnect` is **not** routed. `POST /google-calendar/save-token` is unused by the UI. `GET /google-calendar/check-all-users` and `test-config` are **public**.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-GGL-001 | A | P1 | JWT | `GET /google-calendar/check-connection` | `{ connected: true/false }` |
| A-GGL-002 | A | P1 | Expired access in stub | check-connection | Refresh path; still `{ connected }` |
| A-GGL-003 | A | P1 | JWT | `GET /google-calendar/calendars` | List from stub |
| A-GGL-004 | A | P0 | JWT + range | `GET /google-calendar/events` no calendarId | Display merge: primary + app + selected |
| A-GGL-005 | A | P1 | `calendarId` query | GET events | Single calendar only |
| A-GGL-006 | A | P1 | Event id | GET `/events/:id` | Body; `phaseId` if event-phases link |
| A-GGL-007 | A | P1 | Unknown event | GET | 404 |
| A-GGL-008 | A | P1 | Create event in sleep window | `POST /google-calendar/events` | 4xx rejected |
| A-GGL-009 | A | P1 | Create outside sleep | POST | 201; optional `phaseId` → event-phases row |
| A-GGL-010 | A | P1 | Fixed task sync | Internal skipSleepWindowCheck | Allowed even in sleep |
| A-GGL-011 | A | P1 | PUT event | Update | 200; phase link updated |
| A-GGL-012 | A | P1 | DELETE event | Delete | 200; gone from stub |
| A-GGL-013 | A | P2 | Not connected | GET events | 401 or empty — **record actual** |
| A-GGL-014 | A | P1 | `GET /google-calendar/test-config` no JWT | — | 200; secrets shown as SET/NOT SET only |
| A-GGL-015 | X | P1 | `GET /google-calendar/check-all-users` no JWT | — | **Current: public list of users with tokens.** Assert actual; flag as security risk, do not expand. |
| A-GGL-016 | A | P2 | `POST /google-calendar/save-token` with JWT | Unused UI path | Stub accepts code |
| A-GGL-017 | A | P2 | Disconnect | — | **No route** — document skip; do not invent UI |
| U-GGL-001 | U | P1 | Calendar click **app** event with linked task | Click | TaskForm |
| U-GGL-002 | U | P1 | Click native Google event | Click | EventForm |
| U-GGL-003 | U | P1 | Edit/delete Google event in EventForm | Save/delete confirm | PUT/DELETE; toast |
| U-GGL-004 | U | P1 | Cancelled Google events | Render | Filtered out |
| U-GGL-005 | U | P0 | Ended **app-generated** event | Calendar | Gray `#9e9e9e` |
| U-GGL-006 | U | P0 | Ended **external** event | Calendar | Keeps Google color |

---

## 16. Cases — habits

Civil today from **settings `timeZone`**. Check-in for today and the previous 13 days. Older dates stay on `checkInDates` but return 400 if edited. Points: +1/day +1 every 7 consecutive in history. Streak: consecutive ending today, or yesterday if today unchecked. Optional daily block is both `blockStartTime` and `blockMinutes`, or neither. Generate treats that window as busy (engine unit test). When Google Calendar is linked, creating or saving the block creates a daily recurring event (`habits.service.spec.ts`). Listing habits backfills a block that has no `googleEventId`. Renaming, recoloring, or changing the clock replaces the series. Clearing the block or deleting the habit deletes it. An unchanged save and a check-in do not call Google. A missing token does not fail the save or the delete. Generate reserves the habit interval and does not treat that Google series as extra busy (engine unit test). The in-app calendar still draws the chip and hides that Google series.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-HAB-001 | A | P0 | Empty | `GET /habits` | `{ today, editableFrom, editableTo, timeZone, habits: [] }` |
| A-HAB-002 | A | P0 | Valid name | `POST /habits` | 201; default color if omitted |
| A-HAB-003 | A | P1 | Empty name | POST | 400 (service `requireName`) |
| A-HAB-004 | A | P1 | Name > 80 | POST | 400 |
| A-HAB-005 | A | P1 | Color `#22c55e` | POST | Stored |
| A-HAB-006 | A | P1 | Color `red` / `#fff` | POST | 400 hex |
| A-HAB-007 | A | P1 | Description > 500 | POST | 400 |
| A-HAB-008 | A | P0 | Own habit | PATCH name/color/description | 200 |
| A-HAB-009 | A | P0 | Unknown id | PATCH/DELETE/check-in | 404 |
| A-HAB-010 | A | P0 | DELETE | DELETE | Gone; check-ins cascaded |
| A-HAB-011 | A | P0 | `date=today` | POST check-in | `checkedToday=true`; streak/points update |
| A-HAB-012 | A | P0 | `date=yesterday` | check-in | Date is in `checkInDates` |
| A-HAB-013 | A | P0 | 14 days before today | check-in | 400 outside the window |
| A-HAB-014 | A | P1 | Invalid YMD `2026-13-40` | check-in | 400 |
| A-HAB-015 | A | P1 | Idempotent today twice | check-in | Still one row; stats unchanged |
| A-HAB-016 | A | P0 | Uncheck today | `DELETE .../check-ins/:today` | Flag false; streak may fall back to yesterday |
| A-HAB-017 | A | P1 | Uncheck too-old date | DELETE | 400 |
| A-HAB-018 | A | P1 | 7 consecutive days in history | GET | points include +1 bonus |
| A-HAB-019 | A | P1 | Today unchecked, yesterday checked | GET | streak counts from yesterday |
| A-HAB-020 | A | P1 | TZ `Pacific/Auckland` near midnight UTC | GET today | Civil date in that TZ, not UTC |
| U-HAB-001 | U | P0 | `/habits` | CRUD modal | Create/edit/delete; list updates |
| U-HAB-002 | U | P0 | 14-day grid | Toggle today and an earlier day | `aria-pressed` matches |
| U-HAB-003 | U | P1 | Summary bar | Streak/points | Matches GET |
| U-HAB-004 | U | P0 | Calendar Now habit chips | Toggle today | One tap per habit; link to `/habits` |
| U-HAB-005 | U | P2 | Empty habits | Page | Empty state |
| U-HAB-006 | U | P1 | Calendar week, today cell | Habit dots | Day dialog toggles that habit |
| U-HAB-007 | U | P1 | New habit | Reserve a daily block | Row shows start and minutes |
| A-HAB-021 | A | P1 | Start + minutes | PATCH | Stored as `HH:mm` and minutes (`habits.service.spec`) |
| A-HAB-022 | A | P1 | Minutes without a start | PATCH | 400 (`habits.service.spec`) |
| A-HAB-023 | A | P1 | Linked, block on create | POST | Daily Google series from today (`habits.service.spec`) |
| A-HAB-024 | A | P1 | Linked, block already saved, no `googleEventId` | GET | Series created (`habits.service.spec`) |
| A-HAB-025 | A | P1 | Linked, clock or duration changes | PATCH | Old series deleted, new series at the new time |
| A-HAB-026 | A | P1 | Linked, same name and block | PATCH | Google is not called |
| A-HAB-027 | A | P1 | Linked, clear block or DELETE habit | PATCH / DELETE | Google series deleted; DELETE still removes the habit if Google is disconnected |
| A-HAB-028 | A | P1 | Linked, check-in | POST check-in | Google is not called |
| A-HAB-029 | A | P1 | Habit series returned by Google, longer than the block | Generate | Task is placed after the habit block, not after the Google copy (engine spec) |

---

## 17. Cases — event-phases

No first-class UI. Covered via API and Google create with `phaseId`.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| A-EP-001 | A | P1 | Own phase | `POST /event-phases` | 201 link |
| A-EP-002 | A | P1 | Foreign phase | POST | 4xx |
| A-EP-003 | A | P1 | `GET /event-phases/event/:eventId` | — | Link or null |
| A-EP-004 | A | P1 | `GET .../phase/:phaseId` | — | List |
| A-EP-005 | A | P1 | PATCH/DELETE own | — | 200 |
| A-EP-006 | A | P1 | Unknown id | — | 404 |
| A-EP-007 | A | P1 | Google POST with `phaseId` | createEvent | Link created (A-GGL-009) |

---

## 18. Cases — Calendar UI (beyond Google)

Personal-day hour order (wake until sleep, 00:00–sleep at the end of that day, sleep and hours outside schedulable phases hidden) is covered by `frontend/src/modules/calendar/calendarView.spec.ts`, not a Playwright case.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| U-CAL-001 | U | P0 | Authenticated onboarded | Open `/` | Calendar + NowStrip + Generate menu |
| U-CAL-002 | U | P1 | Day / week / month | Switch views + date picker + prev/next | Range changes; events reload |
| U-CAL-003 | U | P0 | Click empty civil day | Create | From/Until = that day in **Settings** TZ (not browser TZ) |
| U-CAL-004 | U | P0 | Generate | Preview, then Apply | Progress panel stages; toast by outcome; events refresh |
| U-CAL-005 | U | P0 | After generate | Undo confirm | Slots restored; toast |
| U-CAL-006 | U | P0 | Clear confirm | Confirm | Upcoming app blocks gone; finished stay gray |
| U-CAL-007 | U | P1 | Generate job hang | Timeout | Error toast; not infinite spinner |
| U-CAL-008 | U | P1 | Last generate warnings | Banner | Dismiss stores `scheduleGenerateAlertsDismissedJobId`; stays dismissed on reload |
| U-CAL-009 | U | P1 | Alerts older than 24h | Load | Banner not shown |
| U-CAL-016 | U | P1 | No open tasks, schedule cleared | Schedule → Suggestions | Dialog shows the empty review message and Close dismisses it |
| U-CAL-017 | U | P1 | Phone viewport 390×844 | Calendar day, week, Tasks | Header does not cover the grid. Day fits the width. Week scrolls sideways. Tasks heading is on screen |
| U-CAL-010 | U | P0 | Now overlapping block | Strip | Now title; Done if `canCompleteNowBlock` |
| U-CAL-011 | U | P0 | Next start later today | Strip | Next shown |
| U-CAL-012 | U | P0 | Flexible waiting for slot **today** | Strip Unscheduled | Transitional inbox (not `isUnscheduled` Tasks inbox) |
| U-CAL-013 | U | P0 | Now **Done** on non-recurring app task | Click | `completed`; block leaves Now; **no** new Google event |
| U-CAL-014 | U | P0 | Recurring / external Google in Now | Strip | **No** Done; Skip on recurring; no Skip on external |
| U-CAL-015 | U | P1 | All-day event today | Now | Eligible for Now if no timed current |
| U-CAL-016 | U | P1 | Voice on Calendar | Same as U-VOI-\* | |
| U-CAL-017 | U | P1 | Generate / Clear / Undo while busy | Menu | Actions disabled |
| U-CAL-018 | U | P2 | Clear with deleted=0 | Confirm | Info toast nothing cleared |
| U-CAL-019 | U | P0 | Now **Skip** on movable timed app task | Click | Slot gone; task stays `todo`; block leaves Now |
| U-CAL-020 | U | P0 | Recurring overlapping Now | Strip | Skip; **no** Done |
| U-CAL-021 | U | P1 | Generate preview | Cancel | Moves and fit messages shown; Generate is not posted |
| U-CAL-022 | U | P1 | Calendars menu | Uncheck a selected Google calendar | `hiddenGoogleCalendarIds` stores that id |
| U-CAL-023 | U | P1 | Viewports 1024×700, 1100×800, 1279×768, then 1280×720 | Week, day, month | Hour grid stays on screen, including 08:00 and 20:00. Month grid has height. Event list can be scrolled into view. Desktop hour grid still has height |

`canCompleteNowBlock`: has linked task, not recurring, not `isFixedExternal`, not completed/canceled.

Tasks-page Unscheduled (`isUnscheduled`) **≠** Calendar strip Unscheduled (flexible without a slot today). Both need U-CAL-012 vs U-TSK-007.

---

## 19. Cases — isolation and security (all domains)

Every resource is scoped by `userId`. Repeat the pattern; one failing case is enough to block merge.

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| X-ISO-001 | X | P0 | User B’s task id | User A GET/PATCH/DELETE `/tasks/:id` | 404 |
| X-ISO-002 | X | P0 | B’s phase | A GET/PATCH/DELETE | 404 |
| X-ISO-003 | X | P0 | B’s habit | A PATCH/DELETE/check-in | 404 |
| X-ISO-004 | X | P0 | B’s schedule slot | A GET/PATCH/DELETE | 404 |
| X-ISO-005 | X | P0 | B’s job id | A GET `/schedule-jobs/:id` | 404 |
| X-ISO-006 | X | P0 | A generate | B’s calendar/tasks | Unchanged |
| X-ISO-007 | X | P1 | A lists | GET tasks/phases/habits/schedule | Never includes B |
| X-ISO-008 | X | P1 | A assigns B’s phaseId on task | POST | 400 |
| X-ISO-009 | X | P1 | Event-phases with B’s phase | POST | 4xx |
| X-ISO-010 | X | P2 | Public `check-all-users` | Unauthenticated | See A-GGL-015 |

---

## 20. Cases — PWA and chrome

| ID | Layer | P | Given | When | Then |
|----|-------|---|-------|------|------|
| U-PWA-001 | U | P2 | Authenticated, `beforeinstallprompt` | Banner | Shown |
| U-PWA-002 | U | P2 | Dismiss | Click dismiss | `pwa-install-dismissed` set; hidden on reload |
| U-PWA-003 | U | P2 | iOS | No beforeinstallprompt | Share hint (smoke) |
| U-NAV-001 | U | P1 | Header | Calendar / Tasks / Phases / Habits / Settings | Routes match `Header.tsx` |

---

## 21. Engine unit cases (not duplicated as E2E)

Keep these in Jest as in [task-scheduling-test-matrix.md](task-scheduling-test-matrix.md). E2E only needs A-SCH-009/010/026–028 as smoke.

| ID | Topic |
|----|--------|
| N-SCH-T01–T05 | Create validation |
| N-SCH-T10–T12 | Displacement, FIFO, fixed anchor |
| N-SCH-T20–T24 | Recurring capacity / fixed conflict |
| N-SCH-T30–T33 | Weekdays, next day, deadline/horizon warnings |
| N-SCH-T40–T41 | Overnight phase, weekend vs phase |
| N-SCH-T50–T56 | Pipeline, Google skip, completed events, undo, clear, gray UI |
| N-SCH-W01–W04 | Settings TZ vs host UTC, day-only 00:00, wake `HH:mm:ss` |
| N-SCH-B01 | Fixed-event buffer: both sides of fixed tasks and external Google events; habits unpadded; gap filled only when the task would not fit |

Frontend unit (keep, do not E2E): `taskFormSchema`, `buildPayload`, `nowBlocks`, `eventAppearance`, `deadlineTone`, `usePhases`, `formatDate`, `ianaDateTime`.

---

## 22. Docs vs code (do not test as if live)

| Claim | Reality | Test |
|-------|---------|------|
| `POST /auth/register` / `/login` / password reset | Removed | UI redirects only (U-AUTH-010) |
| `GET /user-settings` creates default phases | Only `POST /phases/setup-defaults` | A-PH-001 |
| Phase overlap rejected | Allowed | A-PH-011 |
| Generate uses request date range | Ignored; Settings horizon | A-SCH-009 |
| `POST /google-calendar/disconnect` | No controller route | Skip |
| Global ValidationPipe | Not registered | Assert service-level errors; record DTO-only gaps |
| `weekendWorkEnabled` / `allowSplitScheduling` in Settings UI | API/engine only | A-SET-013 |
| Email verification SMTP | Unused with Google login | Skip |

---

## 23. P0 CI smoke (minimum)

API (wave 1):

1. A-INFRA-001 health  
2. A-INFRA-002 401  
3. A-SET-001 / A-SET-008 settings + required  
4. A-PH-001 / A-PH-002 defaults once  
5. A-TSK-001 flexible create + jobId  
6. A-TSK-006 unscheduled, no job  
7. A-SCH-009 generate places flexible  
8. A-SCH-010 unscheduled excluded  
9. A-SCH-016 undo once  
10. A-SCH-020 clear keeps ended  
11. A-HAB-002 / A-HAB-011 / A-HAB-013 habits  
12. X-ISO-001 task isolation  

UI (wave 3):

1. U-AUTH-001 / U-AUTH-006–007 gates  
2. U-CAL-001 calendar loads  
3. U-TSK-002 create flexible  
4. U-CAL-004 generate  
5. U-CAL-013 Now Done  
6. U-CAL-019 Now Skip  
7. U-HAB-004 habit chip  

---

## 24. Suggested files

```text
backend/test/helpers/create-test-app.ts
backend/test/helpers/auth.ts
backend/test/helpers/google.stub.ts
backend/test/helpers/groq.stub.ts
backend/test/infra.e2e-spec.ts
backend/test/auth.e2e-spec.ts
backend/test/user-settings.e2e-spec.ts
backend/test/phases.e2e-spec.ts
backend/test/tasks.e2e-spec.ts
backend/test/schedule.e2e-spec.ts
backend/test/habits.e2e-spec.ts
backend/test/voice.e2e-spec.ts
backend/test/google-calendar.e2e-spec.ts
backend/test/event-phases.e2e-spec.ts
backend/test/isolation.e2e-spec.ts

e2e/                          # Playwright, wave 3
  playwright.config.ts
  constants.ts
  helpers/auth.ts
  helpers/fixtures.ts
  tests/p0.smoke.spec.ts
  tests/p0.auth.spec.ts
  tests/p0.tasks.spec.ts
  tests/p0.calendar.spec.ts
  tests/p0.habits.spec.ts
  tests/p1.auth.spec.ts
  tests/p1.tasks.spec.ts
  tests/p1.calendar.spec.ts
  tests/p1.voice.spec.ts
  tests/p1.habits.spec.ts
  tests/p1.settings.spec.ts
  tests/p1.phases.spec.ts
  tests/p2.pwa.spec.ts
  tests/p2.voice.spec.ts
  tests/p2.chrome.spec.ts
```

Root CI: after backend unit, `npm run test:e2e --workspace=backend`, then `npm run test:e2e:ui`. Named live-product UI/API waves 0–7 are in that job.

---

## 25. Count (planning)

Approximate named cases in this file: **~220** API/UI/isolation + **~40** engine unit pointers. P0 is **~25**. That is the full existing product; do not add cases for Later roadmap items.

When behavior changes, update the row in this file in the same PR as the spec.
