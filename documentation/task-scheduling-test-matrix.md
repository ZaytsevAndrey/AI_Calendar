# Task Scheduling Test Matrix (Given/When/Then)

Цей документ фіксує тест-специфікації для перевірки коректного розподілу задач під час створення.
Формат орієнтований на пряме перенесення в unit/integration тести.

## Conventions

- Час у прикладах **T\***: UTC, якщо не вказано інакше.
- Кейси **W\*** (From/Until): час у TZ клієнта (`Asia/Nicosia`), хост UTC як на Render.
- Крок слотів: 15 хв.
- Фаза за замовчуванням: `09:00-17:00`, якщо не вказано інакше.
- Алгоритм очікування: `priority DESC`, далі FIFO, далі `earliest available`.
- Warnings перевіряються по `code`, не по тексту.

Рекомендовані коди (використай фактичні enum з бекенду, якщо назви інші):
- `SCHEDULING_DEADLINE_EXCEEDED`
- `SCHEDULING_HORIZON_EXCEEDED`
- `SCHEDULING_NO_VALID_SLOT`
- `SCHEDULING_OCCURRENCE_SKIPPED`

---

## T01 — Validation: required fields

**Given**
- Payload без `name`.

**When**
- Виклик create task endpoint.

**Then**
- 4xx помилка валідації.
- Запис задачі не створено.

`eventType` і `priority` опційні (дефолти: `admin`, `medium`).

## T02 — Validation: only one phase

**Given**
- Payload з невалідною конфігурацією фази (більше однієї `phaseId`).

**When**
- Create task.

**Then**
- 4xx помилка валідації.

## T03 — Validation: estimatedTime for non-fixed

**Given**
- Non-fixed task без `estimatedTimeInMinutes` у **формі**.

**When**
- Submit create form.

**Then**
- Клієнтська валідація не пускає.
- API без поля підставляє дефолт 30 хв (не 4xx).

## T04 — Validation: estimatedTime <= 0

**Given**
- Non-fixed task з `estimatedTimeInMinutes = 0` або від’ємним.

**When**
- Create task.

**Then**
- 4xx помилка валідації.

## T05 — Validation: fixed start/end

**Given**
- Fixed task без `scheduledStartTime`/`scheduledEndTime` або `end <= start`.

**When**
- Create task.

**Then**
- 4xx помилка валідації.

---

## T10 — Displacement by higher priority with exact target slot

**Given**
- Вікно фази: `2026-04-21 09:00-12:00`.
- В календарі вже є задача `A` (priority=2), `09:00-10:00`.
- Створюється задача `B` (priority=4), `estimated=60`, preferred `09:00`.

**When**
- Виконується планування.

**Then**
- `B` отримує точний слот `09:00-10:00`.
- `A` зміщується у точний слот `10:00-11:00`.
- Перетинів немає.

## T11 — FIFO for same priority with exact target slots

**Given**
- Вікно фази: `09:00-12:00`.
- Створюються дві flexible задачі однакового priority=3:
  - `A` (createdAt раніше), 60 хв, preferred `09:00`
  - `B` (createdAt пізніше), 60 хв, preferred `09:00`

**When**
- Планування.

**Then**
- `A`: `09:00-10:00`.
- `B`: `10:00-11:00`.

## T12 — Fixed anchor is never moved

**Given**
- Fixed task `F`: `09:30-10:30`.
- Створюється recurring/flexible `X` priority higher, preferred `09:30`, duration 60.

**When**
- Планування.

**Then**
- `F` лишається `09:30-10:30`.
- `X` переходить у найближчий валідний слот (очікуваний точний слот фіксуємо в тесті, напр. `10:30-11:30`).

---

## T20 — Two recurring tasks in same slot, different priority

**Given**
- Recurring `R1`: DAILY, priority=5, duration=60, preferred `09:00`.
- Recurring `R2`: DAILY, priority=3, duration=60, preferred `09:00`.
- Горизонт: 3 валідні дні (2026-04-20..2026-04-22), фаза `09:00-12:00`.

**When**
- Створення обох задач + розклад occurrence.

**Then**
- На кожен день:
  - `R1` -> `09:00-10:00`
  - `R2` -> `10:00-11:00`
- Всі 6 occurrence створені.

## T21 — Two recurring tasks in same slot, same priority (FIFO)

**Given**
- Recurring `R1` і `R2`, обидві DAILY, priority=4, duration=60, preferred `09:00`.
- `R1` створена раніше.
- Горизонт: 2 дні, фаза `09:00-12:00`.

**When**
- Планування occurrence.

**Then**
- Для кожного дня:
  - `R1` -> `09:00-10:00`
  - `R2` -> `10:00-11:00`

## T22 — Three recurring tasks, enough capacity

**Given**
- `R1`, `R2`, `R3`: DAILY, duration=60, preferred `09:00`.
- Priority: `R1=5`, `R2=4`, `R3=3`.
- Фаза: `09:00-12:00`, горизонт: 2 дні.

**When**
- Планування.

**Then**
- На кожен день:
  - `R1` -> `09:00-10:00`
  - `R2` -> `10:00-11:00`
  - `R3` -> `11:00-12:00`
- Всі occurrence створені, без overlap.

## T23 — Three recurring tasks, not enough capacity

**Given**
- `R1`, `R2`, `R3`: DAILY, duration=60, preferred `09:00`, однаковий priority/FIFO.
- Фаза: `09:00-11:00` (лише 2 години на день), горизонт: 2 дні.

**When**
- Планування.

**Then**
- На кожен день створено лише 2 occurrence (для перших двох за priority/FIFO).
- Для третьої задачі occurrence пропущені.
- Є warnings з кодом `SCHEDULING_OCCURRENCE_SKIPPED` (або відповідним enum).
- Перевіряємо точну кількість створених/пропущених occurrence.

## T24 — Recurring + fixed conflict

**Given**
- Fixed `F`: щодня `09:00-10:00` (або конкретний fixed у день перевірки).
- Recurring `R`: DAILY, priority high, preferred `09:00`, duration=60.
- Фаза: `09:00-12:00`, горизонт: 2 дні.

**When**
- Планування.

**Then**
- `F` не зрушений.
- `R` у кожен день стає в `10:00-11:00`.

---

## T30 — DAILY recurrence trimmed by phase weekDays

**Given**
- Recurring `R`: DAILY, duration=60, preferred `09:00`.
- Фаза обмежена днями `Mon-Fri`.
- Горизонт: 7 днів (пн-нд).

**When**
- Планування occurrence.

**Then**
- Occurrence створені тільки в `Mon-Fri`.
- Загальна кількість = 5.
- Для `Sat/Sun` occurrence не створюються.

## T30b — DAILY recurrence trimmed by task recurrenceWeekDays ∩ phase

**Given**
- Recurring `R`: DAILY, `recurrenceWeekDays=[1,3]` (Mon, Wed), duration=60.
- Фаза `Mon-Fri`.
- Горизонт: 7 днів (пн–нд).

**When**
- Планування occurrence.

**Then**
- Occurrence лише в Mon і Wed.
- Загальна кількість = 2.

## T31 — No window today -> move to next valid day

**Given**
- Recurring `R`: duration=60.
- У поточний день вікно фази повністю зайняте.
- Наступного дня є вільний слот.

**When**
- Планування occurrence.

**Then**
- Для поточного дня occurrence відсутній.
- Створення відбувається на наступний валідний день у конкретний слот.

## T32 — Deadline exceeded warning by code

**Given**
- Flexible/Recurring задача, що фізично не вміщується до дедлайну.

**When**
- Планування.

**Then**
- Задача/occurrence не форситься поза обмеження.
- Є warning кодом `SCHEDULING_DEADLINE_EXCEEDED`.

## T33 — Horizon exceeded with occurrence correctness

**Given**
- Recurring DAILY на 10 днів.
- Горизонт планування: 5 днів.

**When**
- Планування.

**Then**
- Створені occurrence тільки для перших 5 валідних днів.
- Для решти є warning кодом `SCHEDULING_HORIZON_EXCEEDED` або `SCHEDULING_OCCURRENCE_SKIPPED`.
- Перевіряється точна кількість створених occurrence.

---

## T40 — Overnight phase exact sloting

**Given**
- Фаза: `22:00-06:00`.
- Recurring `R1`: duration=120, preferred `22:00`.
- Recurring `R2`: duration=120, preferred `22:00`, нижчий priority.

**When**
- Планування на 1 день.

**Then**
- `R1` -> `22:00-00:00`.
- `R2` -> `00:00-02:00`.
- Обидва слоти валідні в межах overnight вікна.

## T41 — Weekend rule overridden by phase

**Given**
- Глобально `weekendWork=true`.
- Фаза має `weekDays=Mon-Fri`.
- Recurring DAILY.

**When**
- Планування на тиждень із вихідними.

**Then**
- Створення тільки в `Mon-Fri`, незалежно від глобального weekendWork.

---

## T50 — Pipeline integration after create (non-fixed)

**Given**
- Створюється non-fixed задача.

**When**
- Create endpoint завершився успішно.

**Then**
- Replan job для користувача поставлено в чергу.
- HTTP відповідь **не чекає** завершення replan / Google sync.
- Covered by `tasks.service.spec.ts` (`returns from create without waiting for replan to finish`).

## T51 — Google disconnected: sync skipped safely

**Given**
- У користувача немає підключеного Google Calendar.

**When**
- Create/update task trigger sync pipeline.

**Then**
- Sync пропускається.
- Операція create/update успішна.
- Логується warning (код/тип, якщо підтримується).

## T52 — completed/canceled does not auto-delete event

**Given**
- Існує задача з вже синхронізованою подією.

**When**
- Статус задачі змінено на `completed` або `canceled`.

**Then**
- Подія в Google не видаляється автоматично.

## T53 — Replan keeps fully ended auto slots

**Given**
- Movable TODO task has an auto-generated slot that already ended (`scheduledEndTime <= now`).

**When**
- Generate / replan.

**Then**
- That row is **not** deleted (`scheduledEndTime > now` filter).
- It is treated as a busy anchor.
- Covered by `intelligent-scheduling.engine.spec.ts` (`keeps completed auto segments as busy and only deletes still-open ones`).

## T54 — Clear keeps finished blocks, including earlier today

**Given**
- Auto slots: one ended this morning, one still open later today.

**When**
- `DELETE /schedule`.

**Then**
- Only the still-open row is removed locally.
- Google wipe receives the ended series id in `keepEventIds` and caps it (`UNTIL`), instead of deleting the master.
- Covered by `schedule.service.spec.ts` and `schedule-job.service.spec.ts`.

## T55 — Calendar grays only our finished app events

**Given**
- Display events mix: app calendar (ended + future) and primary/other calendars (ended).

**When**
- Calendar day/week/month render.

**Then**
- Gray fill only if `isAppGenerated` and `end <= now`.
- External calendars keep Google `colorId`.
- Covered by `frontend/src/modules/calendar/hooks/eventAppearance.spec.ts`.

---

## W01 — From/Until: day-only 00:00 in settings TZ (UTC host)

**Given**
- Host TZ = UTC (production).
- Settings `timeZone` = `Asia/Nicosia` (`+03:00`).
- `wakeTime` from Postgres = `09:00:00`.
- Now = `2026-09-07T18:47:00.000Z`.
- Flexible task: `earliestStartTime = 2026-09-08T00:00:00+03:00`, `deadline = 2026-09-08T23:59:00+03:00`.

**When**
- Replan / create pipeline.

**Then**
- No segment starts on `2026-09-07` UTC.
- Placement is on local 8 Sep (UTC date 8).
- Covered by `intelligent-scheduling.engine.spec.ts` (`+03:00` midnight + Postgres `HH:mm:ss` wakeTime).

## W02 — From 00:01 is an instant (not snapped)

**Given**
- Same TZ as W01.
- `earliestStartTime` is local `00:01`, not `00:00`.

**When**
- Replan.

**Then**
- Engine does **not** treat it as day-only; the instant is the not-before bound.
- Must still fall on the intended local day (not the previous UTC calendar day).

## W03 — Create persists the window before replan

**Given**
- Client sends `earliestStartTime`, `deadline`, `timeZone`, optional `eligibleWeekDays`.

**When**
- `POST /tasks`.

**Then**
- Row saved with those fields (`scheduleTimeZone` = `timeZone`) **before** the replan job runs.
- Covered by `tasks.service.spec.ts` (`create schedule window`).

## W04 — Wake/phase clocks use settings timeZone, not the host clock

**Given**
- Host TZ = UTC.
- Settings `timeZone` = `Asia/Nicosia`, `wakeTime`/`phase` = `09:00`–`12:00`.
- Now = `2026-04-20T00:00:00.000Z`.
- Flexible 60-minute task, no From/Until.

**When**
- Replan.

**Then**
- First slot is `2026-04-20T06:00:00.000Z`–`07:00:00.000Z` (09:00–10:00 Nicosia), not 09:00 UTC.
- Covered by `intelligent-scheduling.engine.spec.ts` (`places wake and phase windows in the settings time zone`).
- Horizon midnight in `Asia/Nicosia` is covered by `planningHorizonRange`.
- PATCH `timeZone` validation: `update-user-settings.dto.spec.ts`. Empty zone is not overwritten on GET: `user-settings.service.spec.ts`.

---

## Мінімальний smoke-набір для CI (швидкий прогін)

- `T05`, `T10`, `T20`, `T23`, `T30`, `T33`, `T40`, `T50`, `T53`, `T54`, `T55`, `W01`, `W03`, `W04`.
