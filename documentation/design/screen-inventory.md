# Реєстр екранів і станів

Частина roadmap **§71**. Кожен рядок — те, що має бути перероблено і перевірено за [design-system.md](design-system.md) та [mobile-plan.md](mobile-plan.md). Рядок закрито, коли він знятий інструментом скріншотів (етап 0) у матриці **1440×900 · 1920×1080 · 768×1024 · 390×844 · 320×568 × світла/темна** і виглядає за правилами. Мови: **uk і en** (ключові екрани знімаються в обох).

Позначки: **D** — десктоп, **M** — телефон, **—** — не існує на цій платформі, **☑** — перероблено й знято (`npm run design:shots`, 30 Oct 2026: 360 кадрів uk у 5 розмірах × 2 темах, en — десктоп і телефон; без горизонтального переповнення й без незамоканих запитів).

Ще не знято окремим сценарієм (їх важко відтворити на моках; стиль успадковують від `Modal` / `ActionMenu` / токенів): колбеки OAuth, банер PWA, конфлікт при створенні, форма зовнішньої події, вибір «цей / наступні / усі», перетягування серії, попередження на чіпі, автодоповнення місця, картки змін Помічника.

## Оболонка й загальне

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Шапка | `common/components/Header.tsx` | ☑ | ☑ | активний пункт, без перемикача теми |
| Нижня навігація | `common/components/BottomNav.tsx` | — | ☑ | 4 пункти, safe-area |
| FAB «Створити» / голос | `voice/components/VoiceTaskButton.tsx`, сторінки | — | ☑ | тап, довгий тап |
| Футер з білдом | `common/components/BuildFooter.tsx` | ☑ | ☑ | прибрати → Налаштування › Акаунт |
| Завантаження сторінки | `AppRoutes.tsx`, `ProtectedRoute.tsx` («Loading…» англійською) | ☑ | ☑ | скелетон, i18n, холодний старт API |
| Тости | `utils/toast.tsx`, `styles/toastify-ide.css` | ☑ | ☑ | success / error / warning / info / прогрес мутації / undo |
| Банер встановлення PWA | `pwa/PwaInstallBanner.tsx` | ☐ | ☐ | Android, iOS-підказка |
| Іконки, маніфест, `theme-color` | `public/`, `index.html` | ☑ | ☑ | під нову палітру, обидві теми |

## Вхід і онбординг

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Логін | `pages/LoginPage`, `auth/components/LoginForm` | ☑ | ☑ | Google, Microsoft, помилка, завантаження |
| Колбеки OAuth | `auth/pages/GoogleCallbackPage.tsx`, `MicrosoftCallbackPage.tsx` | ☐ | ☐ | очікування, помилка, повтор |
| Онбординг 1 — підйом і сон | `pages/PhaseSetupPage` | ☑ | ☑ | крок 1 з 2, TimeWheel на телефоні |
| Онбординг 2 — фази | `pages/PhaseSetupPage`, `phases/components/PhasePresetPicker.tsx` | ☑ | ☑ | пресети з мінісмужкою, пропуск |

## Календар

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Тулбар, навігація датою | `pages/CalendarPage/CalendarPage.tsx` | ☑ | ☑ | день / тиждень (3 дні на M) / місяць |
| Пікер дати в тулбарі | `calendar/components/CalendarDatePicker.tsx` | ☑ | ☑ | поповер D, шторка M |
| Меню «Календарі» | `calendar/components/CalendarVisibilityMenu.tsx` | ☑ | ☑ | Google / Microsoft / Apple, не обрізається |
| Смуга днів | `calendar/components/PhoneWeekStrip.tsx` | — | ☑ | сьогодні, вибраний день |
| Сьогодні: панель D / смуга + шторка M | `now/components/NowStrip.tsx` → нові `TodayBar`, `TodaySheet` | ☑ | ☑ | зараз, далі, порожньо, прострочене |
| Банер проблемних | `schedule/components/ProblematicInboxBanner.tsx` | ☑ | ☑ | → лічильник у «Сьогодні» |
| Нагадування над сіткою | `day-reminders/ReminderList.tsx` | ☑ | ☑ | → «Сьогодні» |
| Сітка дня/тижня | `calendar/components/CalendarTimeGrid.tsx` | ☑ | ☑ | фази фоном, лінія «зараз», минуле, перекриття, 15-хв події, all-day, багатоденні all-day |
| Чіпи подій | `CalendarTimeGrid.tsx`, `CalendarChipMeta.tsx` | ☑ | ☑ | фіксована / гнучка / повтор / виконана / минула / зовнішня Google / Outlook / Apple |
| Меню типу на чіпі | `CalendarChipMeta.tsx` (поповер) | ☐ | ☐ | фіксована ↔ гнучка, попередження |
| Перетягування й зміна розміру | `calendar/eventDrag.ts`, `CalendarTimeGrid.tsx` | ☑ | ☑ | миша D, довгий тап M |
| Виділення діапазону для створення | `CalendarTimeGrid.tsx` | ☑ | ☑ | миша D, довгий тап M |
| Місяць | `calendar/components/CalendarGrid.tsx` | ☑ | ☑ | чіпи D, крапки + агенда M, «Жовтень 2026» |
| Порожній календар | — | ☑ | ☑ | немає подій, немає фаз |

## Діалоги календаря

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Превʼю події | `calendar/components/EventPreview.tsx` | ☑ | ☑ | задача, зовнішня Google / Outlook / Apple, повтор, виконана, з посиланнями, з HTML-описом |
| Вибір «цей / наступні / усі» | `calendar/components/SeriesScopeMenu.tsx` | ☐ | ☐ | видалення, перенесення |
| Підтвердження видалення | `CalendarPage.tsx` (`deleteConfirmDialog`), `SeriesDeleteHost.tsx` | ☑ | ☑ | одна, серія, зовнішня |
| Перетягування серії | `schedule/components/SeriesDragHost.tsx` | ☐ | ☐ | вибір обсягу |
| Попередження (запис у зовнішній календар, переміщення гнучкої, «на потім» для зовнішньої) | `CalendarChipMeta.tsx`, `CalendarPage.tsx` (`dismissWarn*`) | ☐ | ☐ | «Більше не показувати» |
| Конфлікт при створенні/переміщенні | `schedule/components/ConflictOptionsSheet.tsx`, `ConflictChoiceHost.tsx` | ☐ | ☐ | preferred_on_fixed, phase_full, усі 5 варіантів |
| Форма зовнішньої події | `calendar/components/EventForm.tsx`, `EmojiPickerPanel.tsx`, `GoogleEventSettingsFields.tsx` | ☐ | ☐ | Google, Outlook, нагадування, колір, видимість |
| Поле місця з автодоповненням | `calendar/components/LocationField.tsx` | ☐ | ☐ | список, порожньо, помилка |

## Задачі

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Сторінка задач | `pages/EventsPage/index.tsx` | ☑ | ☑ | сегменти: заплановані / на потім / нагадування / виконані |
| Рядок задачі | `events/components/EventItem.tsx` | ☑ | ☑ | пріоритети, прострочена, виконана, повтор, проблемна |
| Група серії | `events/components/SeriesGroupRow.tsx` | ☐ | ☐ | згорнута / розгорнута |
| Пошук і фільтри | `events/components/TaskSectionFilters.tsx` | ☑ | ☑ | шторка M, порожній результат |
| Свайпи і ⋯ | нові `SwipeRow`, `ActionSheet` | — | ☑ | виконано, пропустити, зараз, undo |
| Видалення задачі | `useEventEditor.tsx`, `EventsPage` | ☑ | ☑ | підтвердження / undo |
| Порожні стани | — | ☑ | ☑ | для кожного сегмента |

## Форма задачі

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Створення / редагування | `tasks/components/TaskForm.tsx`, `events/hooks/useEventEditor.tsx` | ☑ | ☑ | 5 типів, «Більше опцій», помилки після сабміту |
| Пояснення типу | `tasks/components/TaskTypeInfo.tsx` | ☑ | ☑ | згорнуте «Що це?» |
| Фіксований слот | `tasks/components/FixedSlotFields.tsx`, `ui/DateTimeRangeField.tsx` | ☑ | ☑ | PickerSheet M |
| Вікно дат, бажаний початок, тривалість | `TaskForm.tsx`, `ui/DateRangeField.tsx` | ☑ | ☑ | чипи M |
| Налаштування події Google | `GoogleEventSettingsFields.tsx` | ☐ | ☐ | колір, нагадування, видимість |
| Запланувати з «На потім» | `TaskForm` → нова `SlotSheet` | ☑ | ☑ | слоти, таймлайн |

## Проблемні

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Список проблемних | `schedule/components/ProblematicInboxSheet.tsx` | ☑ | ☑ | одна, кілька днів, серія |
| Картка | `schedule/components/ProblematicItemCard.tsx` | ☑ | ☑ | є пропозиція / немає, ActionSheet |
| Інший час | `schedule/components/MoveOccurrenceSheet.tsx`, `SlotPickTimeline.tsx` | ☑ | ☑ | DateStrip, слоти, таймлайн, без підказок клавіш на дотику |

## Нагадування

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Список | `day-reminders/ReminderList.tsx` | ☑ | ☑ | сьогодні, прострочене, повтор |
| Форма | `day-reminders/ReminderForm.tsx` | ☑ | ☑ | `DatePicker` замість нативної дати, TimeWheel M |

## Налаштування

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Каркас розділів | `pages/SettingsPage/index.tsx` | ☑ | ☑ | ліва навігація D, список → розділ M |
| Загальні | `user-settings/components/UserSettingsForm.tsx` | ☑ | ☑ | мова, тема (Системна / Світла / Темна), часовий пояс з пошуком |
| Мій день + Фази | `UserSettingsForm.tsx`, `phases/components/PhasesCalendar.tsx`, `PhaseForm.tsx`, `ColorField.tsx`, `WeekDaysSelector.tsx`, `TimeRangeField.tsx`, `PhasePresetPicker.tsx` | ☑ | ☑ | шаблон + список + бічна шторка D; мінітиждень + список дня + шторка M; пресети; без фаз |
| Планування | `UserSettingsForm.tsx` | ☑ | ☑ | чипи для чисел, людські підказки |
| Календарі | `user-settings/components/CalendarAccountsSection.tsx` | ☑ | ☑ | підключено / ні, Apple CalDAV форма, відключення з підтвердженням, «куди синкати» |
| Сповіщення | `pwa/ReminderSettingsSection.tsx` | ☑ | ☑ | дозвіл браузера, iOS-підказка |
| Помічник | `voice/components/VoiceSettingsSection.tsx` | ☑ | ☑ | мова, озвучування, підтвердження |
| Акаунт | `auth/components/DeleteAccountSection.tsx` | ☑ | ☑ | вихід, версія, видалення з підтвердженням |

## Помічник

| Елемент | Файл | D | M | Стани |
|---|---|---|---|---|
| Плаваюча панель | `voice/components/CompanionPanel.tsx` | ☑ | — | слухає, думає, відповідь, превʼю змін |
| Шторка | `voice/components/VoiceTaskSheet.tsx` | ☑ | ☑ | на всю висоту M, швидке створення |
| Картки змін | `voice/components/ChangePreviewCards.tsx` | ☐ | ☐ | створити / перенести / видалити, статуси |
| Візуалізація голосу | `voice/components/VoiceAudioVisual.tsx` | ☐ | ☐ | — |
| Помилка мікрофона | `VoiceTaskSheet.tsx` | ☐ | ☐ | дія «Дозволити», iOS-пояснення |

## Поза скоупом

- `pages/HabitsPage`, `habits/components/*`, `now/components/HabitNowStrip.tsx` — маршрут `/habits` редіректить на календар, у застосунку не використовується. Не переробляємо.
