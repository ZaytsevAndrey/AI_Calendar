import { BARE_HOUR_RULE } from './clock-speech';

/** Kind, when, and duration. First matching branch wins. Dates come from the user message. */
export const CREATE_KIND_WHEN_MODULE = `Decide kind in this order. First match wins. Then fill only that branch's fields. Interpret the speaker's language yourself — do not rely on English/Ukrainian word lists.

1. Recurring — repeats: daily, every morning, every evening, every weekday, every weekend, every Tuesday, every Mon+Fri, etc. (any language). Every morning or every evening is a daily series, not one clock today.
   A one-off weekday ("on Saturday" once) is a single day, not a repeat.
   kind recurring, isRecurring true. A time of day is not part of the name and does not make this fixed: set scheduledStart/End to that time (+ duration) on schedule today. No time of day → scheduledStart/End null. Deadline only if they named a series end.

2. Fixed — one concrete clock, no uncertainty and no repeat: stamped times, bare hours, ordinal hours, "in N hours".
   Concrete means they commit to that instant. Approximate means they soften it: the hour is a preference, not a promise. Approximate is not this branch, even when a number sits next to the softener. Judge that meaning in the speaker's language. A digit does not make the time concrete. Do not look for the English word "around".
   Exception: they named a clock and then cancelled it ("at 15? no, better at 17"). The last clock is a commitment, so it is concrete fixed. Not flexible and not a day envelope.
   A from–to span plus a preferred clock stays branch 4, even when they also named a duration. Do not collapse that to a fixed block at the preferred clock.
   Relative "in N hours" = now ISO + N hours (fixed). Never unscheduled.
   If the span is the event itself (meeting from 15 to 16, a conference from 9 to 18), that length IS the duration even when it is many hours: scheduledStart at the start, scheduledEnd at the end, estimatedTimeInMinutes = that many minutes, kind fixed. Not a placement window and not the default 30 minutes.
   Otherwise scheduledStart at the clock, scheduledEnd = start + duration. earliestStartTime and deadline null.

3. Flexible preferred — a soft clock: around 3, closer to evening, after lunch, about noon, "two in the afternoon" (any language).
   Map soft phrases yourself to a wall clock (after lunch → ~14:00, about noon → 12:00, closer to evening → ~18:00, morning without a number → ~09:00). An ordinal hour with afternoon/daytime ("the second of the day") is 14:00, not a whole calendar day and not 02:00.
   kind flexible. scheduledStart/End = that clock + duration. This branch must set scheduledStart. Do not replace the clock with only a 00:00–23:59 day. If they also named a day ("today", "tomorrow", a weekday), also set earliest 00:00 and deadline 23:59 that day. A bare part of day with no numbered clock still counts: evening ~18:00, morning ~09:00. The day envelope is only when they named a day. No named day → preferred clock only, earliest and deadline null. If that part of day is already past, use the nearest upcoming one: morning already past → tomorrow ~09:00, not today and not a today envelope. Never unscheduled when a soft clock is present.

4. Flexible window — a span of WHEN an errand may be done, not an event that occupies those hours: between 14 and 18, from 14 to 18, after 18, not before 15, by end of day, until evening.
   kind flexible. earliestStartTime = span start, deadline = span end. "after 18" sets earliest only. "by end of day" sets deadline 23:59 on schedule today and earliest null. scheduledStart/End null. Not unscheduled.
   If they also named a preferred clock inside the span ("better at"), set scheduledStart/End too. A spoken duration is estimatedTimeInMinutes of the errand. It does not drop the window and it does not make the task fixed.
   The span length is not estimatedTimeInMinutes.

5. Day only — tomorrow / Friday / next week (any language), no clock and no repeat. An afternoon ordinal hour is a clock, so it is not this branch.
   kind flexible. earliest 00:00, deadline 23:59 that schedule day. scheduledStart/End null.

6. No day, clock, span, or repeat — kind unscheduled, isUnscheduled true, all schedule fields null, understanding complete. Do not ask which day.

Hours (copy schedule today/tomorrow from the user message; do not invent offsets):
- Copy the numeric offset from schedule today/tomorrow lines in the user message (e.g. +03:00). Do not emit +02:00 when the anchors say +03:00.
- ${BARE_HOUR_RULE}
- A number that is not a clock is not a time.
- Concrete clock with no day (no hedge): put it on schedule today, even when that clock is already before now. Do not move it to tomorrow and do not use branch 6.
- A clock on a named day stays on that day, even when the instant is already before now.
- A soft clock still ahead of now stays on schedule today. Do not move it to tomorrow.
- Soft clock already past today, with no placement window → the nearest upcoming same part of day. Morning already past → tomorrow at that morning clock. Never a past start and never a today envelope. A preferred clock inside a window that is already past: keep the window, leave scheduledStart null.
- "Half before six" / half past five is 17:30 in the afternoon, not 05:30, unless they said morning or night.
- "tomorrow" (any language) = schedule tomorrow. After sleep those anchors are already the new wake-day.
- A named weekday with no "last" is the next one. "on Monday at 9" when schedule today is Tuesday → next Monday 09:00, not the previous Monday. "on Saturday" is the listed Saturday, not Thursday. "next Tuesday" when schedule today is Tuesday is seven days later, not today.

Duration:
- Spoken length wins. A placement window is not a length, unless branch 2 says the span is the event itself.
- No length, and a normal task fits the default → estimatedTimeInMinutes = Default task duration from the user message.
- A clocked event with no spoken length uses that default. understanding complete. Do not ask how long, including dinner, a visit, or a meeting.
- A placement window with no spoken length also uses that default. understanding complete. Do not ask how long the errand or the trip takes.
- No length, no clock, no placement window, and the task clearly needs longer than that default → one question how long. estimatedTimeInMinutes null.
- Not sure whether a span is the event's length or the window when to do it → one question. Do not guess.

Questions — at most one, in the transcript language:
- Allowed: no action/name; length missing on a clearly long task; span might be either the event length or the placement window.
- Not allowed: which day, which phase, which priority.

Examples (any language works the same way):
- "tomorrow at 15:00 dentist" → fixed, 15:00
- "tomorrow at 3 dentist" → fixed 15:00 (bare 1–7 is afternoon unless morning or night)
- "in three hours a short call" when the local clock is 13:00 → fixed 16:00, not 13:00
- "in four hours dinner" when the local clock is 13:00 → fixed 17:00, default duration, understanding complete. Do not ask how long. Not 14:00.
- "at 4 a marketing meeting" → fixed 16:00, not 04:00
- "half an hour before six, dinner" → fixed 17:30, not 05:30
- "about noon" when it is already afternoon → flexible preferred tomorrow 12:00, not fixed
- "after 18 go to the gym" → earliest 18:00, scheduledStart null
- "by end of day close the ticket" → flexible, deadline 23:59 schedule today, not unscheduled
- "every Tuesday at 15:00 dentist" → recurring WEEKLY day 2, preferred 15:00, not fixed
- "around 3 go to the shop" → flexible preferred 15:00
- "around two in the afternoon" when the local clock is 13:00 → flexible preferred today 14:00, scheduledStart set, earliest and deadline null. Not a whole-day window.
- "pizza around 16" → flexible preferred 16:00, name is the errand. The 16 does not make it fixed. The same softening in any other language is the same parse. "three" is 15:00, 16 stays 16:00.
- "around after three" → flexible preferred 15:00, scheduledStart set. Not an earliest-only bound.
- "after work stop by the pharmacy" → flexible preferred ~18:00
- "today in the evening sort mail" → flexible preferred ~18:00, earliest 00:00 and deadline 23:59 today. Not only the 18:00 slot.
- "call the client today… at 15? no, better at 17" → fixed 17:00 today. The first clock is cancelled. Not flexible and not a day envelope.
- "tomorrow morning water the flowers" → flexible preferred ~09:00, earliest 00:00 and deadline 23:59 tomorrow.
- "between 14 and 18 buy groceries" → flexible window 14:00–18:00, duration = default
- "between two and four fuel the car" → flexible window 14:00–16:00
- "from 22:00 to 23:00 prepare for an exam" → flexible window, not a meeting
- "tomorrow from 16 to 20 edit a video" → flexible window 16:00–20:00, scheduledStart null. The span is when the errand may be done, not a four-hour meeting.
- "tomorrow from 10 to 14 make calls, better at 11, for half an hour" → flexible window earliest 10:00 deadline 14:00, scheduledStart 11:00, duration 30. Not a fixed 11:00–11:30 block.
- "on Saturday between 10 and 14 go to the dacha" when schedule today is Tuesday → flexible window on the listed Saturday, default duration, understanding complete. Do not ask how long. Not Thursday.
- "next Tuesday file an application" when schedule today is Tuesday → flexible day window seven days later, not today.
- "after work until nine tidy the closet" → window from ~18:00 until 21:00
- "on the weekend clean the garage" once, no "every" → one window, not recurring
- "meeting from 15 to 16" → fixed 15:00–16:00, duration 60
- "tomorrow a conference from 9 to 18" → fixed 09:00–18:00, duration 540, not a window
- "need to buy milk" → unscheduled
- "every morning stretch at 7" → recurring DAILY, preferred 07:00 (morning context keeps 7 AM)
- "every Wednesday English at 19" → recurring WEEKLY day 3, scheduledStart 19:00, not null`;
