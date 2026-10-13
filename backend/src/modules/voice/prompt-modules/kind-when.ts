import { BARE_HOUR_RULE } from './clock-speech';

/** Kind, when, and duration. First matching branch wins. Dates come from the user message. */
export const CREATE_KIND_WHEN_MODULE = `Decide kind in this order. First match wins. Then fill only that branch's fields. Interpret the speaker's language yourself — do not rely on English/Ukrainian word lists.

1. Recurring — repeats: daily, every weekday, every weekend, every Tuesday, every Mon+Fri, etc. (any language).
   A one-off weekday ("on Saturday" once) is a single day, not a repeat.
   kind recurring, isRecurring true. A clock does not make it fixed: the clock is a preferred time — you MUST still set scheduledStart/End to that clock (+ duration) on schedule today.
   No clock → scheduledStart/End null. Deadline only if they named a series end.

2. Fixed — one concrete clock, no hedge and no repeat: stamped times, bare hours, ordinal hours, "in N hours".
   Hedge words (around / about / closer to / roughly — any language) are not this branch.
   Relative "in N hours" = now ISO + N hours (fixed). Never unscheduled.
   If the span is the event itself (meeting from 15 to 16), that length IS the duration: scheduledStart at the start, scheduledEnd at the end, estimatedTimeInMinutes = that many minutes, kind fixed.
   Otherwise scheduledStart at the clock, scheduledEnd = start + duration. earliestStartTime and deadline null.

3. Flexible preferred — a soft clock: around 3, closer to evening, after lunch, about noon (any language).
   Map soft phrases yourself to a wall clock (after lunch → ~14:00, about noon → 12:00, closer to evening → ~18:00, morning without a number → ~09:00).
   kind flexible. scheduledStart/End = that clock + duration. If they also named a day, earliest 00:00 and deadline 23:59 that day. Never unscheduled when a soft clock is present.

4. Flexible window — a span of WHEN it may be done, not how long it lasts: between 14 and 18, from 14 to 18 (errand window).
   kind flexible. earliestStartTime = span start, deadline = span end. scheduledStart/End null.
   If they also named a preferred clock inside the span, set scheduledStart/End too.
   The span length is not estimatedTimeInMinutes.

5. Day only — tomorrow / Friday / next week (any language), no clock and no repeat.
   kind flexible. earliest 00:00, deadline 23:59 that schedule day. scheduledStart/End null.

6. No day, clock, span, or repeat — kind unscheduled, isUnscheduled true, all schedule fields null, understanding complete. Do not ask which day.

Hours (copy schedule today/tomorrow from the user message; do not invent offsets):
- Copy the numeric offset from schedule today/tomorrow lines in the user message (e.g. +03:00). Do not emit +02:00 when the anchors say +03:00.
- ${BARE_HOUR_RULE}
- A number that is not a clock is not a time.
- Clock with no day: if it is still ahead of now on schedule today, use schedule today. If that clock is already past, do not move it to tomorrow; use branch 6.
- Soft clock already past today → schedule tomorrow same HM (or ask), never a past start.
- "tomorrow" (any language) = schedule tomorrow. After sleep those anchors are already the new wake-day.
- Never put scheduledStart before now ISO.

Duration:
- Spoken length wins. A placement window is not a length, unless branch 2 says the span is the event itself.
- No length, and a normal task fits the default → estimatedTimeInMinutes = Default task duration from the user message.
- No length, and the task clearly needs longer than that default → one question how long. estimatedTimeInMinutes null.
- Not sure whether a span is the event's length or the window when to do it → one question. Do not guess.

Questions — at most one, in the transcript language:
- Allowed: no action/name; length missing on a clearly long task; span might be either the event length or the placement window.
- Not allowed: which day, which phase, which priority.

Examples (any language works the same way):
- "tomorrow at 15:00 dentist" → fixed, 15:00
- "every Tuesday at 15:00 dentist" → recurring WEEKLY day 2, preferred 15:00, not fixed
- "around 3 go to the shop" → flexible preferred 15:00
- "between 14 and 18 buy groceries" → flexible window 14:00–18:00, duration = default
- "meeting from 15 to 16" → fixed 15:00–16:00, duration 60
- "need to buy milk" → unscheduled
- "every morning stretch at 7" → recurring DAILY, preferred 07:00 (morning context keeps 7 AM)`;
