# Рев'ю двигуна посадки

**Дата:** 29 жовтня 2026.
**Гілка:** `feat/stt-groq-fallback` (робоче дерево з незакоміченими змінами schedule).
**Мова:** українська.

Список дефектів двигуна посадки і план виправлень. Контракт, з яким порівнюємо: [spec-incremental-placement.md](spec-incremental-placement.md), [spec-conflict-rules.md](spec-conflict-rules.md). Пункт у [roadmap](roadmap.md): §50.

**Що переглянуто:** `PlacementStepService` і `planPlacement` (крок посадки), горизонт і extend серій, `DisplayedEventMoveService` (drag), `ProblematicPlaceService`, гілка посадки в `TasksService` (create / update / skip / status), фоновий тік `RecurringExtendProcessor`, побудова Google RRULE.

**Як перевіряли:** читання коду і порівняння зі спекою. Пункти, позначені **[probe]**, підтверджені прогоном `planPlacement` / `seriesOccurrenceYmds` на конкретних входах (тимчасовий spec, після прогону видалений). Решта знайдена читанням коду, і для кожної наведено конкретний шлях виконання.

Номери рядків відповідають робочому дереву на дату рев'ю.

**Статус (29 жовтня, гілка `fix/placement-engine`).** Виправлено, з регресійними тестами: PE-01…PE-23, PE-25, PE-26, PE-28, PE-29. PE-18 закрито для запису серії; `moveSeriesDay`, `moveSeriesTail` і `placeSeriesDay` ще пишуть кількома кроками. Відкрито: PE-24 (потрібне рішення), PE-27, PE-30. Залишок — у [roadmap](roadmap.md) §50.

---

## 1. Підсумок

- Чиста частина планування (`placement-step.util.ts`) покрита добре, але має логічні дірки у правилах для фіксованих, автопосадки і рекурентності.
- **Уся частина, що пише в базу, не має жодного тесту**: `persist`, `applyMove`, горизонт серії, `expand`, re-merge, `seatOpenHoles`, purge. Майже всі серйозні баги саме там.
- Найбільше ризиків у серіях: годинник майстра, якір рекурентності, розрізання серії drag-ом і розбіжність між базою і Google.
- Запис плану не атомарний. `tasksService` зберігає застарілу сутність після `place` і затирає зміни, які зробив двигун.
- Є шляхи, які пишуть слоти в обхід двигуна: legacy `PATCH /schedule/:id` і голосовий `rescheduleTask`.

---

## 2. Покриття тестами

260 тестів, усі зелені (`jest src/modules/schedule src/modules/tasks`).

| Файл | Lines | Що не покрито |
|------|-------|---------------|
| `placement-step.util.ts` | 96% | BIWEEKLY і MONTHLY у `seriesOccurrenceYmds`, частина гілок recurring claim |
| `placement-step.service.ts` | **30%** | рядки 865–2008 і 2035–2345: увесь запис (`persist`, `applyMove`), горизонт серії, `expandSeriesDays`, `parkFailedSeriesDay`, re-merge, `attachSeriesHomeClocks`, `seatOpenHoles`, `purgePastProblematicCopies` |
| `displayed-event-move.service.ts` | 88% | `moveSeriesTail` / `moveSeriesAll` перевіряються лише з мокнутим `place` |
| `tasks.service.ts` | 72% | revert після `commit:'preferred'` для серій, `updateStatus` |
| `recurring-extend.processor.ts` | 0% | — |
| `intelligent-scheduling.engine.ts` | 90% | мертвий код (див. PE-30), покриття вводить в оману |

`placement-step.service.spec.ts` переважно запускає `dryRun`. Зараз немає жодного тесту, який перевіряв би, що саме опинилось у таблицях після посадки.

---

## 3. Дефекти

Пріоритет: **H** означає втрату або дублювання даних чи порушення інваріанта (фіксована з'їжджає, розбіжність з Google). **M** — неправильне місце або порушення спеки без втрати даних. **L** — край, продуктивність, гігієна.

### Індекс

| ID | P | Коротко |
|----|---|---------|
| PE-01 | H | Зміна годинника серії: майстер відкочується, а слоти лишаються на новому годиннику; skip-дні затираються |
| PE-02 | H | Drag «цей і наступні дні» дублює дні між сьогодні і днем розрізу |
| PE-03 | H | Фіксована на `resolved` переїжджає в іншу дірку **[probe]** |
| PE-04 | H | Фіксована серія на іншій серії переїжджає **[probe]** |
| PE-05 | H | Re-merge поглинає копію, перенесену на інший день: день губиться |
| PE-06 | H | Drag фіксованої на фіксовану: годинник у задачі і в слоті розходяться |
| PE-07 | H | Зсув «якірного» дня серії переписує годинник майстра |
| PE-08 | H | BIWEEKLY: парність через `Math.round` **[probe]** |
| PE-09 | H | MONTHLY з 31-го зсувається на 3-тє **[probe]** |
| PE-10 | H | Перепосадка серії бере за якір «сьогодні», а не DTSTART |
| PE-11 | M | Автопосадка Problematic зсуває заседжених **[probe]** |
| PE-12 | M | Скасовані й виконані задачі зсуваються і паркуються як живі |
| PE-13 | M | Витіснена задача ігнорує свої дедлайн і вікно |
| PE-14 | M | Витіснення може посадити задачу вночі (00:00–24:00) |
| PE-15 | M | Пир без фази при витісненні обмежений об'єднанням фаз |
| PE-16 | M | `expandSeriesDays` дописує минулі дні |
| PE-17 | M | Створення серії без preferred губить сьогоднішній день |
| PE-18 | M | Запис серії і drag-операції не атомарні |
| PE-19 | M | Нуль днів серії: у Problematic майстер + N копій |
| PE-20 | M | Drag гнучкої: фаза змінюється до посадки і не відкочується; дроп поза фазою ніколи не паркується |
| PE-21 | M | Голосовий move пише слот в обхід двигуна |
| PE-22 | M | Зсунутий день серії лишається в серії (shift замість detach) |
| PE-23 | M | Витіснена задача йде в найранішу дірку, а не ближче до старого часу **[probe]** |
| PE-24 | L | Копія дня завжди `ADMIN`, губить deadline / From |
| PE-25 | L | Google BYDAY fallback бере TZ сервера |
| PE-26 | L | Повернення в `todo` не саджає задачу (спека §40) |
| PE-27 | L | `seatOpenHoles` тягне зовнішні календарі на кожну задачу |
| PE-28 | L | Замок користувача лише в пам'яті; `update` пише поза ним |
| PE-29 | L | Purge і фоновий тік мають ліміти, які голодують |
| PE-30 | L | Legacy engine і CRUD `/schedule` — мертвий або обхідний код |

### H — висока

#### PE-01. Зміна годинника серії розсинхронізує майстер і слоти

- **Де:** [placement-step.service.ts:514-522](../backend/src/modules/schedule/placement-step.service.ts#L514-L522), [tasks.service.ts:295-318](../backend/src/modules/tasks/tasks.service.ts#L295-L318).
- **Шлях:** для серії форма ставить `commit:'preferred'` і `expandSeries`. `placeUnlocked` іде в `seatRecurringHorizonUnlocked`, який не дивиться на `commit` і переписує всі відкриті дні. Далі `placeSavedTask` порівнює `plan.start` з `preferredStart`. Вони не збігаються, якщо перший день серії — завтра (сьогоднішній час уже минув) або якщо `scheduledStartTime` у формі стоїть на минулій даті. Тоді код повертає майстру старі `scheduledStartTime/End` і зберігає **застарілу** сутність `task`.
- **Наслідок:** відкриті слоти стоять на новому годиннику, майстер — на старому. `expandSeriesDays` бере годинник майстра, тож нові дні на краю горизонту сідають на старий час. Застарілий `save` затирає `skippedOccurrenceYmds`, які двигун записав для днів-сиблінгів і невдалих днів. Ці дні потрапляють і в майстер, і в сиблінг, а в Google вони без EXDATE.
- **Виправлення:** для серії або виконувати `commit:'preferred'` (dry-run → перевірка → запис), або не ставити його. Після `place` не зберігати сутність, отриману до нього: перечитати її або оновлювати лише конкретні колонки.

#### PE-02. Drag «цей і наступні дні» дублює дні

- **Де:** [displayed-event-move.service.ts:381-463](../backend/src/modules/schedule/displayed-event-move.service.ts#L381-L463), [placement-step.service.ts:1218-1235](../backend/src/modules/schedule/placement-step.service.ts#L1218-L1235).
- **Шлях:** `moveSeriesTail` спрацьовує, коли перед днем розрізу є відкриті дні. Він обрізає стару серію `deadline = початок дня розрізу`, створює нову серію і викликає `place(..., expandSeries)`. `seatRecurringHorizonUnlocked` бере за якір **сьогодні** і фільтрує лише за `now` і `deadline` нової серії. `earliestStartTime` у неї немає.
- **Наслідок:** на днях від сьогодні до дня розрізу стоять і стара серія (старий годинник), і нова (новий годинник або найближча дірка, бо `fallbackOffSeries` обходить стару).
- **Виправлення:** передавати в горизонт якір серії (`earliestStartTime = початок дня розрізу` або явний `anchorYmd`). Тест: перетягнути середину серії → дні до розрізу лишаються з одним слотом.

#### PE-03. Фіксована на `resolved` переїжджає

- **Де:** [placement-step.util.ts:660-673](../backend/src/modules/schedule/placement-step.util.ts#L660-L673).
- **Шлях:** гілка `resolvedHit` не перевіряє тип заявника. Для фіксованої `commit` — `always`, тому `allowResolvedOverlap` = false.
- **[probe]:** фіксована 10:00–11:00 поверх `resolved` 10:00–11:00 → `seated` о 08:00.
- **Наслідок:** фіксована задача мовчки отримує інший час.
- **Виправлення:** для `mustFitWindow === false` (фіксована) `resolved` не є приводом шукати дірку. Або сідати другим шаром, або повертати conflict.

#### PE-04. Фіксована серія на іншій серії переїжджає

- **Де:** [placement-step.util.ts:679-721](../backend/src/modules/schedule/placement-step.util.ts#L679-L721).
- **Шлях:** `claim.recurring` + перетин із `series` → `fallbackOffSeries` → pack або найближча дірка. Тип заявника не перевіряється.
- **[probe]:** фіксована серія 10:00 поверх series 10:00 → `seated` о 09:00.
- **Виправлення:** фіксований заявник ніколи не йде у fallback. Чужий день серії витісняється (detach) або повертається conflict.

#### PE-05. Re-merge поглинає копію з іншого дня

- **Де:** [placement-step.service.ts:1935-2009](../backend/src/modules/schedule/placement-step.service.ts#L1935-L2009).
- **Шлях:** `tryReMergeSeriesMember` порівнює лише `HH:mm` і тривалість. День входження не зберігається: `persist` викликає `clearParkMetadata` і стирає `problematicDay`.
- **Сценарій:** день серії вівторок 10:00 відірвався в копію. Копію перетягли на середу 10:00. Re-merge видаляє копію і саджає серію на середу, де в неї вже є слот (`persist` замінює рядок). Вівторок лишається skip. **Одне входження зникло.** Для щопонеділкової серії копія, кинута в четвер, створює четверговий рядок поза RRULE.
- **Виправлення:** зберігати `originalOccurrenceYmd` на копії і не стирати його при посадці. Re-merge лише коли `ymd === originalOccurrenceYmd`.

#### PE-06. Drag фіксованої на фіксовану розсинхронізує годинник

- **Де:** [displayed-event-move.service.ts:115-132](../backend/src/modules/schedule/displayed-event-move.service.ts#L115-L132), [tasks.service.ts:229-242, 294-326](../backend/src/modules/tasks/tasks.service.ts#L229-L242).
- **Шлях:** `tasksService.update` зберігає новий `scheduledStartTime` і ставить посадку в асинхронний job. Для фіксованої `commit:'always'`. Посадка повертає `conflict` і нічого не пише, а revert спрацьовує лише для `commit:'preferred'`. Перевірка `sitsAt(saved...)` у drag порівнює значення до посадки, тому завжди проходить.
- **Наслідок:** `Task` каже «новий час», `ScheduledTask` — «старий». Залежно від того, що читає UI чи sync, подія двоїться або «стрибає».
- **Виправлення:** при `conflict` відкочувати годинник задачі для будь-якого `commit`. Для drag чекати план, а не відповідь `update`.

#### PE-07. Зсув якірного дня серії переписує годинник майстра

- **Де:** [placement-step.service.ts:2228-2248](../backend/src/modules/schedule/placement-step.service.ts#L2228-L2248), [tasks.service.ts:1084-1109](../backend/src/modules/tasks/tasks.service.ts#L1084-L1109).
- **Шлях:** `applyMove(shift)` для рядка, що збігається з `owner.scheduledStartTime`, переносить майстер на новий час. `refreshTaskScheduleAfterSkip` ставить майстру час наступного відкритого рядка, який теж міг бути зсунутий.
- **Наслідок:** `expandSeriesDays` і `attachSeriesHomeClocks` беруть `HH:mm` з майстра. Усі нові дні серії сідають на годинник одного витісненого дня, а home-clock для копій стає хибним.
- **Виправлення:** розділити «годинник серії» (окреме поле або DTSTART) і «найближчий відкритий слот для показу». Зсув одного дня ніколи не змінює годинник серії.

#### PE-08. BIWEEKLY: парність тижня

- **Де:** [placement-step.util.ts:820-824, 859-865](../backend/src/modules/schedule/placement-step.util.ts#L859-L865).
- **[probe]:** Пн/Пт кожні 2 тижні, якір пт 2026-10-30 → `11-02, 11-13, 11-16, 11-27`. Понеділки 2 і 16 листопада припадають на «вихідні» тижні.
- **Наслідок:** локальні слоти не збігаються з Google `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR` (WKST=MO).
- **Виправлення:** номер тижня рахувати через початок тижня: `floor((weekStart(ymd) − weekStart(anchor)) / 7)`.

#### PE-09. MONTHLY з 31-го

- **Де:** [voice-local-date.util.ts:108-112](../backend/src/modules/voice/voice-local-date.util.ts#L108-L112), `stepSeriesYmd`.
- **[probe]:** `2027-01-31 → 03-03 → 04-03 → 05-03`. Лютий пропущено, далі 3-тє число.
- **Наслідок:** Google `FREQ=MONTHLY` з DTSTART 31-го показує лише місяці з 31 днем, а база — 3-тє число.
- **Виправлення:** рахувати кожен місяць від DTSTART (`anchor + k місяців`) із clamp до останнього дня, а не ланцюжком. В RRULE явно писати `BYMONTHDAY` (або `-1` для «останнього дня»).

#### PE-10. Якір рекурентності — «сьогодні»

- **Де:** [placement-step.service.ts:1218-1228](../backend/src/modules/schedule/placement-step.service.ts#L1218-L1228).
- **Шлях:** `seriesHorizonYmds({ anchorYmd: today })` для WEEKLY/BIWEEKLY без `recurrenceWeekDays` і для MONTHLY.
- **Сценарій:** місячна серія на 15-те, змінили годинник 20-го → серія стає «20-го щомісяця». Щотижнева серія в понеділок, відредагована в четвер, стає четверговою.
- **Виправлення:** якір — DTSTART серії. Сьогодні лише відсікає минуле.

### M — середня

#### PE-11. Автопосадка Problematic зсуває заседжених

- **Де:** [placement-step.service.ts:432-456](../backend/src/modules/schedule/placement-step.service.ts#L432-L456), [placement-step.util.ts:626-631](../backend/src/modules/schedule/placement-step.util.ts#L626-L631).
- **Шлях:** `seatOpenHoles` → `searchHole` → гілка без interval → `packMovablesForHole`.
- **[probe]:** вікно 08–20, гнучкі 08–09:30, 10–12, 12:30–20; Problematic на 60 хв → дві заседжені зсунуті.
- **Наслідок:** суперечить docstring («не рухає заседжених») і спеці §66. `seatOpenHoles` викликається після кожного drag, delete і skip.
- **Виправлення:** опція `allowPack: false` для автопосадки, Schedule і Do now.

#### PE-12. Скасовані й виконані задачі беруть участь у посадці

- **Де:** [placement-step.service.ts:555-621](../backend/src/modules/schedule/placement-step.service.ts#L555-L621).
- **Шлях:** seats будуються з усіх відкритих рядків без фільтра за `status`. `completed` / `canceled` стають `flexible` або `series`.
- **Наслідок:** нова заявка зсуває або паркує скасовану задачу. `applyMove(park)` ставить їй `PROBLEMATIC`, а спека §32/§39 каже «слоти не переписуємо».
- **Виправлення:** такі задачі або не враховувати взагалі, або подавати як нерухомі (`anchor` без conflict). Потрібне продуктове рішення: чи блокує скасована задача час.

#### PE-13. Витіснена задача ігнорує свої обмеження

- **Де:** [placement-step.service.ts:563-564](../backend/src/modules/schedule/placement-step.service.ts#L563-L564).
- **Шлях:** `seat.windows` будуються лише з фаз. `deadline`, `earliestStartTime` і `eligibleWeekDays` пира не враховуються.
- **Наслідок:** чужий preferred зсуває задачу за її дедлайн або раніше From.
- **Виправлення:** обрізати `seat.windows` тим самим `flexibleSearchSpan`, що й для заявника.

#### PE-14. Нічне витіснення

- **Де:** [placement-step.service.ts:683-691](../backend/src/modules/schedule/placement-step.service.ts#L683-L691).
- **Шлях:** якщо вікна пира на цей день порожні (змінилися фаза, wake/sleep чи weekdays, а слот лишився, як каже §51), йому дають `civilDayBounds` = 00:00–24:00.
- **Наслідок:** витіснену задачу можуть посадити о 00:00.
- **Виправлення:** fallback — wake/sleep цього дня.

#### PE-15. Пир без фази при витісненні

- **Де:** [placement-step.service.ts:564](../backend/src/modules/schedule/placement-step.service.ts#L564).
- **Шлях:** `windowsFor(linked.length ? linked : phases)`: пир без фази отримує об'єднання **всіх** фаз користувача, а заявник без фази отримує wake/sleep.
- **Наслідок:** одна й та сама задача шукає місце за різними правилами залежно від того, заявник вона чи пир. Проміжки між фазами для пира закриті.
- **Виправлення:** `windowsFor(linked)` для обох.

#### PE-16. `expandSeriesDays` дописує минуле

- **Де:** [placement-step.service.ts:1671-1701](../backend/src/modules/schedule/placement-step.service.ts#L1671-L1701), [715-725](../backend/src/modules/schedule/placement-step.service.ts#L715-L725).
- **Шлях:** якщо в серії немає відкритих рядків (простій сервера довший за горизонт або всі дні пропущені), якорем стає `task.scheduledStartTime` у минулому. Минулі дні проходять через ранній `return seated` (він спрацьовує ще до перевірки `dryRun`) і записуються як слоти в минулому.
- **Виправлення:** фільтр `ymd >= today` (як у create). Ранній `return` для минулого interval не повинен давати `seated` у dry-run серії.

#### PE-17. Створення серії без preferred губить сьогоднішній день

- **Де:** [placement-step.service.ts:1229-1235](../backend/src/modules/schedule/placement-step.service.ts#L1229-L1235).
- **Шлях:** чи минув день, перевіряється пробою о 09:00. О 14:00 вечірня фаза сьогодні вільна, а день відкинуто.
- **Виправлення:** фільтрувати за кінцем вікна дня (фаза ∩ wake/sleep), а не за 09:00.

#### PE-18. Неатомарний запис

- **Де:** [placement-step.service.ts:1368-1555](../backend/src/modules/schedule/placement-step.service.ts#L1368-L1555), `moveSeriesDay`, `moveSeriesTail`, `ProblematicPlaceService.placeSeriesDay`.
- **Шлях:** зсуви пирів комітяться окремою транзакцією на кожен день. Далі окремо `deleteOpenSlots`, вставки, сиблінги, park. Drag дня серії робить `skipOccurrence`, а потім окремо `create`.
- **Наслідок:** помилка посередині лишає пирів зсунутими, серію — записаною наполовину, а день — пропущеним без копії.
- **Виправлення:** committer, який пише весь план однією транзакцією. Google іде лише після коміту.

#### PE-19. Нуль днів серії → майстер + N копій

- **Де:** [placement-step.service.ts:1414-1437](../backend/src/modules/schedule/placement-step.service.ts#L1414-L1437).
- **Шлях:** `parkFailedSeriesDay` на кожен день, а потім ще `persist(task, problematic)` для майстра.
- **Наслідок:** в інбоксі N+1 записів на одну подію.
- **Виправлення:** або копії по днях, або майстер, а не обидва (спека §64: копія на день).

#### PE-20. Drag гнучкої: фаза

- **Де:** [displayed-event-move.service.ts:264-278](../backend/src/modules/schedule/displayed-event-move.service.ts#L264-L278).
- **Шлях:** фаза дропа зберігається до `place`. Якщо посадка не вдалась («That time is already taken»), фаза не відкочується. Дроп поза фазами знімає фазу, тому задача шукає по wake/sleep і ніколи не паркується.
- **Наслідок:** спека §20: «дроп поза фазою паркує задачу як Problematic». Після невдалого drag задача сидить на старому слоті з новою фазою.
- **Виправлення:** фазу писати разом із планом у одному кроці. Узгодити зі спекою, що робить дроп поза фазою (§20 проти §37).

#### PE-21. Голосовий move в обхід двигуна

- **Де:** [executeVoiceCommand.ts:221](../frontend/src/modules/voice/executeVoiceCommand.ts#L221) → `PATCH /schedule/:id` → [schedule.service.ts:148-183](../backend/src/modules/schedule/schedule.service.ts#L148-L183).
- **Шлях:** рядок `ScheduledTask` переписується напряму. Перевіряється лише перетин із тією ж задачею. Немає замка, перевірки якорів, витіснення, дзеркала годинника в `Task` і Google sync.
- **Наслідок:** порушені спека §26 і §53 («голос = drag»). Задача може лягти на фіксовану, а `Task.scheduledStartTime` розходиться зі слотом.
- **Виправлення:** голосовий move — через `POST /schedule/move-event`. Legacy CRUD `/schedule` прибрати (PE-30).

#### PE-22. Зсунутий день серії лишається в серії

- **Де:** [placement-step.util.ts:206-215](../backend/src/modules/schedule/placement-step.util.ts#L206-L215).
- **Шлях:** `moveFor` для `series` з діркою повертає `shift`, а не `detach`.
- **Наслідок:** спека §4.4 і §8 вимагає «день прибирається з серії, створюється копія». Серія отримує дні з чужим годинником, що потім доводиться латати голосуванням за годинник більшості для DTSTART. Разом із PE-07 це псує годинник серії.
- **Виправлення:** `detach` з `start/end` дірки. Або змінити спеку, якщо shift — свідоме рішення.

#### PE-23. Витіснена задача йде в найранішу дірку

- **Де:** `reseat` / `reseatDirectOnly`, [placement-step.util.ts:266-272](../backend/src/modules/schedule/placement-step.util.ts#L266-L272).
- **[probe]:** заявка 17:00 на гнучку 17:00 → гнучку перенесено на 08:00.
- **Виправлення:** `preferNearMs: seat.homeStart ?? seat.start`.

### L — низька

- **PE-24.** `parkFailedSeriesDay` і `applyMove(detach)` створюють копію з `eventType: ADMIN` і без `deadline` / `earliestStartTime`. День фіксованої серії стає гнучким ([placement-step.service.ts:1148-1178, 2310-2341](../backend/src/modules/schedule/placement-step.service.ts#L1148-L1178)).
- **PE-25.** `weekdayFallback = firstStart.getDay()` бере TZ сервера ([google-recurrence.util.ts:51](../backend/src/modules/schedule/google-recurrence.util.ts#L51)). Задача о 00:30 за Києвом на UTC-сервері отримує BYDAY=SU.
- **PE-26.** `updateStatus` не саджає задачу при поверненні в `todo` зі слотом, що вже не валідний (спека §40) ([tasks.service.ts:1157-1166](../backend/src/modules/tasks/tasks.service.ts#L1157-L1166)).
- **PE-27.** `seatOpenHoles` викликає повний `placeUnlocked` (із запитом до зовнішніх календарів) на кожну проблемну задачу. `DisplayedEventMoveService.move` на кожен drag вантажить усі задачі й усі слоти користувача, включно з минулими.
- **PE-28.** `withUserLock` живе в пам'яті процесу, а map `locks` не чиститься. `tasks.service.update` і revert з PE-01 пишуть поза замком.
- **PE-29.** `purgePastProblematicCopies` бере `take: limit*4` без фільтра за днем, тому минулі копії можуть ніколи не дійти до обробки. Тік розширює максимум 10 користувачів на годину. `lastAppendAt` живе в пам'яті. Серії зі статусом `in_progress` не розширюються.
- **PE-30.** `IntelligentSchedulingEngine` (~1600 рядків + 1743 рядки тестів) більше не викликає `run`. Живими лишились лише `captureAutoSegmentsSnapshot` і кілька хелперів, тож тести покривають мертвий код. CRUD `POST/PATCH/DELETE /schedule` пише слоти в обхід двигуна. [spec-intelligent-scheduling.md](spec-intelligent-scheduling.md) §4–§5 і діаграма в [spec-conflict-rules.md](spec-conflict-rules.md) досі описують `engine.run` як живий.

---

## 4. Покращення логіки

1. **Три шари замість одного сервісу на 2800 рядків.**
   - `LandscapeBuilder` читає базу і зовнішні календарі, будує seats **з усіма обмеженнями кожного пира** (фаза, wake/sleep, From/Until, дедлайн, weekdays). Закриває PE-13, PE-14, PE-15.
   - `Planner` — чиста функція: claim + seats → plan. Без I/O і без Nest.
   - `Committer` пише весь план однією транзакцією під замком користувача, а Google іде після коміту. Закриває PE-18.
   - Двигун лишається модулем у моноліті. Окремий сервіс не потрібен: він додасть розподілені транзакції, а виграшу не дасть.
2. **Явні режими пошуку дірки:** `hole` (лише сира дірка), `pack` (ущільнення), `claim` (заявка з витісненням). Автопосадка, Schedule і Do now використовують лише `hole` (PE-11).
3. **Інваріанти фіксованих у Planner:** фіксована ніколи не змінює свій інтервал. Можливі лише `seated` на своєму годиннику, `conflict` або витіснення гнучких (PE-03, PE-04).
4. **Один модуль рекурентності з семантикою RFC 5545**, спільний для локального розгортання і Google RRULE: якір DTSTART, WKST, BYMONTHDAY, TZ користувача. Варто розглянути бібліотеку `rrule`. Закриває PE-08, PE-09, PE-10, PE-25.
5. **Годинник серії окремо від показу.** Окреме поле (або DTSTART) для годинника серії, а `scheduledStartTime` майстра — лише для показу (PE-07). Копія дня зберігає `originalOccurrenceYmd` (PE-05).
6. **Витіснення ближче до старого часу** (PE-23). Пошук без preferred обмежити найближчими N днями або зважити відстань: зараз «спершу зайняті дні» може посадити задачу за три тижні при порожньому сьогодні.
7. **`TasksService` не торкається слотів:** не зберігає сутність після `place`, не відкочує частково, лише формує claim і читає результат (PE-01, PE-06).
8. **Один вхід для всіх записів слотів.** Прибрати CRUD `/schedule` і legacy engine, голосовий move перевести на `move-event` (PE-21, PE-30).

---

## 5. Тести, яких бракує

- **Інтеграційні тести на in-memory SQLite** для `persist`, `applyMove` (shift / park / detach / in_progress), горизонту серії, `expand`, re-merge, `seatOpenHoles`, purge, `moveSeriesTail` / `moveSeriesAll`. Перевіряти вміст таблиць, а не план.
- **Property-тест Planner** на випадкових ландшафтах. Інваріанти:
  - відкриті не-`resolved` слоти не перетинаються;
  - фіксовані й зовнішні не рухаються;
  - кожен гнучкий слот лежить у своїх вікнах і своєму From/Until;
  - заявник або `seated` на своєму interval, або `conflict` / `problematic`.
- **Паритет рекурентності:** локальні дні з `seriesOccurrenceYmds` дорівнюють розгортанню згенерованого RRULE на 3 місяці для DAILY / WEEKLY / BIWEEKLY / MONTHLY × weekDays × день якоря.
- **Регресії на кожен PE-H** до виправлення: спершу червоний тест, потім фікс.

---

## 6. Порядок виправлень

1. Регресійні тести на PE-01…PE-10. Без них виправлення серій небезпечні.
2. Committer з однією транзакцією і прибраний застарілий `save` у `TasksService` (PE-01, PE-06, PE-18).
3. Інваріанти фіксованих і режим `hole` для автопосадки (PE-03, PE-04, PE-11).
4. Модуль рекурентності і годинник серії (PE-07…PE-10, PE-02, PE-05, PE-16, PE-17).
5. Обмеження пирів у LandscapeBuilder (PE-12…PE-15, PE-23).
6. Голосовий move і видалення legacy (PE-21, PE-30), потім решта L.
