/** Kind, when, and duration. First matching branch wins. Dates come from the user message. */
export const CREATE_KIND_WHEN_MODULE = `Decide kind in this order. First match wins. Then fill only that branch's fields.

1. Recurring — щодня, по буднях, по вихідних, щовівторка, every Monday, weekdays, weekends.
   "у суботу" / "on Saturday" once is a single day, not a repeat.
   kind recurring, isRecurring true. A clock does not make it fixed: the clock is a preferred time.
   No clock → scheduledStart/End null. Deadline only if they named a series end ("до кінця місяця").

2. Fixed — one concrete clock, no hedge and no repeat: "о 15:00", "at 3", "через дві години" / "in 2 hours".
   Hedge words (десь, приблизно, ближче до, around, about) are not this branch.
   If the span is the event itself ("зустріч з 15 до 16", "from 3 to 4"), that length IS the duration: scheduledStart at the start, scheduledEnd at the end, estimatedTimeInMinutes = that many minutes, kind fixed.
   Otherwise scheduledStart at the clock, scheduledEnd = start + duration. earliestStartTime and deadline null.

3. Flexible preferred — a soft clock: "десь о третій", "ближче до вечора", "after lunch", "around 3".
   kind flexible. scheduledStart/End = that clock + duration. If they also named a day, earliest 00:00 and deadline 23:59 that day.

4. Flexible window — a span of WHEN it may be done, not how long it lasts: "між 14 і 18", "з 14 до 18", "between 2 and 6".
   kind flexible. earliestStartTime = span start, deadline = span end. scheduledStart/End null.
   If they also named a preferred clock inside the span ("краще о 15"), set scheduledStart/End too.
   The span length is not estimatedTimeInMinutes.

5. Day only — "завтра", "tomorrow", "у п'ятницю", no clock and no repeat.
   kind flexible. earliest 00:00, deadline 23:59 that schedule day. scheduledStart/End null.

6. No day, clock, span, or repeat — kind unscheduled, isUnscheduled true, all schedule fields null, understanding complete. Do not ask which day.

Hours (copy schedule today/tomorrow from the user message; do not calculate dates):
- Bare hours 1–7 without ранку/am/ночі/night → afternoon (2 → 14:00). "ранку" stays morning. "ночі" stays night.
- A number that is not a clock ("дві справи", "task 2") is not a time.
- Clock with no day: if it is still ahead of now on schedule today, use schedule today. If that clock is already past, do not move it to tomorrow; use branch 6.
- "tomorrow"/"завтра" = schedule tomorrow. After sleep those anchors are already the new wake-day.
- Never put scheduledStart before now ISO.

Duration:
- Spoken length ("на годину", "пів години", "for 20 minutes") wins. A placement window is not a length, unless branch 2 says the span is the event itself.
- No length, and a normal task fits the default → estimatedTimeInMinutes = Default task duration from the user message.
- No length, and the task clearly needs longer than that default (прибрати квартиру, поїздка, тренування) → one question how long. estimatedTimeInMinutes null.
- Not sure whether a span is the event's length or the window when to do it → one question. Do not guess.

Questions — at most one, in the transcript language:
- Allowed: no action/name; length missing on a clearly long task; span might be either the event length or the placement window.
- Not allowed: which day, which phase, which priority.

Examples:
- "завтра о 15:00 до стоматолога" → fixed, 15:00, name "Стоматолог"
- "щовівторка о 15:00 до стоматолога" → recurring WEEKLY day 2, preferred 15:00, not fixed
- "десь о третій зайти в магазин" → flexible preferred 15:00
- "між 14 і 18 купити продукти" → flexible window 14:00–18:00, duration = default
- "зустріч з 15 до 16" → fixed 15:00–16:00, duration 60
- "треба купити молоко" → unscheduled, name "Купити молоко"`;
