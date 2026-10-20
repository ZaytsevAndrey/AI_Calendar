import { BARE_HOUR_RULE } from './clock-speech';
import { QUESTION_PROPOSAL_MODULE } from './question-proposal';

/** Kind, when, and duration. First matching branch wins. Dates come from the user message. */
export const CREATE_KIND_WHEN_MODULE = `Decide kind in this order. First match wins. Then fill only that branch's fields. Interpret the speaker's language yourself — do not rely on English/Ukrainian word lists.

1. Recurring — repeats: daily, every morning, every evening, every weekday, every weekend, every Tuesday, every Mon+Fri, every N days, the last day of the month, etc. (any language). Every morning or every evening is a daily series, not one clock today. Every N days is still a repeat: set recurrencePattern DAILY. There is no every-N-days field. Never leave the pattern null. The last day of the month, with no "this month" and no single civil date, is MONTHLY, not one window on the 31st.
   A weekday named once is a single day, not a repeat.
   Dates named once, as many as were named, are not this branch: each date is its own one-off task. A clock on those dates does not make a repeat. It is the time of each one-off. A repeat on those days is this branch, one series. A clock makes a series only when the utterance is already a repeat.
   kind recurring, isRecurring true. A time of day is not part of the name and does not make this fixed: set scheduledStart/End to that time (+ duration) on schedule today. No time of day → scheduledStart/End null. Deadline only if they named a series end.

2. Fixed — one concrete clock, no uncertainty and no repeat: stamped times, bare hours, ordinal hours, "in N hours".
   Concrete means they commit to that instant. Approximate means they soften it: the hour is a preference, not a promise. Approximate is not this branch, even when a number or an ordinal sits next to the softener. A softened "six" / "the sixth" is still approximate: kind flexible with scheduledStart 18:00, never fixed. Judge that meaning in the speaker's language. A digit does not make the time concrete. Do not look for the English word "around".
   Exception: they named a clock and then cancelled it ("at 15? no, better at 17"). The last clock is a commitment, so it is concrete fixed. Not flexible and not a day envelope.
   A from–to span plus a preferred clock stays branch 4, even when they also named a duration. Do not collapse that to a fixed block at the preferred clock.
   Relative "in N hours" = now ISO + N hours (fixed). Never unscheduled.
   If the span is the event itself (meeting from 15 to 16, a conference from 9 to 18), that length IS the duration even when it is many hours: scheduledStart at the start, scheduledEnd at the end, estimatedTimeInMinutes = that many minutes, kind fixed. Not a placement window and not the default 30 minutes.
   Otherwise scheduledStart at the clock, scheduledEnd = start + duration. earliestStartTime and deadline null.

3. Flexible preferred — a soft clock: around 3, closer to evening, after lunch, about noon, "two in the afternoon" (any language).
   Map soft phrases yourself to a wall clock (after lunch → ~14:00, about noon → 12:00, closer to evening → ~18:00, after work → ~18:00). Morning, the first three hours after wake, is not this branch. An ordinal hour is a clock: "the second of the day" is 14:00, "around the sixth" is 18:00. Not a whole calendar day, not 02:00, and not a word in the task name. A softener plus that ordinal still sets scheduledStart. A spoken length next to it is only the duration. Never unscheduled and never put the ordinal into the name.
   kind flexible. scheduledStart/End = that clock + duration. This branch must set scheduledStart. Do not replace the clock with only a Wake–Sleep day. If they also named a day ("today", "tomorrow", a weekday) and that part of day is still ahead, also set earliest at Wake and deadline at Sleep that day. The day envelope is only when they named a day. No named day → preferred clock only, earliest and deadline null. Never unscheduled when a soft clock is present, except the past-time question below.

4. Flexible window — a span of WHEN an errand may be done, not an event that occupies those hours: between 14 and 18, from 14 to 18, after 18, not before 15, by end of day, until evening.
   kind flexible. earliestStartTime = span start, deadline = span end. "after 18" sets earliest only. End of the day, with no clock, sets deadline at Sleep on schedule today and earliest null. "from now until 18" sets earliest to now and deadline 18:00 on schedule today. scheduledStart/End null. Not unscheduled.
   A window with no named day is schedule today. Do not ask which day.
   Morning is the first three hours after wake, not a guessed clock. A morning whose end is still after now is ahead, even when now is before wake. They named that day and the morning has already ended → needs_clarification. Ask whether they still want that past morning. Do not keep the rest of the day. No named day and the morning has ended → the same morning on the next day.
   Before or after another activity, with no clock of its own, is a lookup in Open tasks, not a guessed window, and never an unscheduled task. Match by meaning. Before a matched task that has a start: deadline is that start. After a matched task that has an end: earliest is that end. The new name is the errand. No match: say that task is not open and ask. A match with no start and no deadline: say that task has no time and ask. Do not create in either case. Do not invent 23:59, now, or a clock. After work and after lunch are soft clocks, not this lookup.
   If they also named a preferred clock inside the span ("better at"), set scheduledStart/End too. A spoken duration is estimatedTimeInMinutes of the errand. It does not drop the window and it does not make the task fixed.
   The span length is not estimatedTimeInMinutes.

5. Day only — tomorrow / Friday (any language), no clock and no repeat. An afternoon ordinal hour is a clock, so it is not this branch. A named week with no day inside it is not this branch: needs_clarification, one question which day. Do not choose a weekday and do not set a day envelope.
   kind flexible. earliest at Wake, deadline at Sleep that schedule day. scheduledStart/End null.
   The event fills a whole day and they gave no clocks → kind fixed. scheduledStart at Wake and scheduledEnd at Sleep on the named day, or on schedule today when they named no day. estimatedTimeInMinutes is that span. Do not ask for a start or an end clock. Not a placement window.
   Dates named once are one-off tasks, not a series. A repeat on those days is one series.

6. No day, clock, span, or repeat — kind unscheduled, isUnscheduled true, all schedule fields null, understanding complete. Do not ask which day. A place with no clock is this branch. A new errand placed before or after a named task is not this branch: use the lookup above.

Hours (copy schedule today/tomorrow from the user message; do not invent offsets):
- Copy the numeric offset from schedule today/tomorrow lines in the user message (e.g. +03:00). Do not emit +02:00 when the anchors say +03:00.
- ${BARE_HOUR_RULE}
- A number that is not a clock is not a time.
- A concrete clock with no day that is still ahead is schedule today. A concrete clock with no day that is already past is a question. Do not write that start. Do not move it to the next day. Do not use branch 6.
- A clock on a named day stays on that day, even when the instant is already before now.
- A soft clock still ahead of now stays on schedule today. Do not move it to tomorrow.
- A waking-day part is past only when its end is before now. Now before that part starts, including before wake, is not past. Soft clock already past today, with no placement window → the nearest upcoming same part of day. A waking-day part already past, with no named day → the same part next day. Never a past start and never a today envelope. A preferred clock inside a window that is already past: keep the window, leave scheduledStart null.
- "half an hour before six" / a quarter to five, with no morning or night word, is the afternoon hour: half to six is 17:30, a quarter to five is 16:45. Not 05:30 and not 04:45.
- "tomorrow" (any language) = schedule tomorrow.
- A named weekday with no "last" is the next one. "on Monday at 9" when schedule today is Tuesday → next Monday 09:00, not the previous Monday. "on Saturday" is the listed Saturday, not Thursday. "next Tuesday" when schedule today is Tuesday is seven days later, not today.

Duration:
- Spoken length wins. A placement window is not a length, unless branch 2 says the span is the event itself.
- A quarter or a half said with an hour is the clock, not the task length. Do not set estimatedTimeInMinutes to 15 from that quarter.
- No length, and a normal task fits the default → estimatedTimeInMinutes = Default task duration from the user message.
- A clocked event with no spoken length uses that default. understanding complete. Do not ask how long, including dinner, a visit, or a meeting.
- A placement window with no spoken length also uses that default. understanding complete. Do not ask how long the errand or the trip takes.
- No length, no clock, no placement window, and the task clearly needs longer than that default → one question how long. estimatedTimeInMinutes null.
- Not sure whether a span is the event's length or the window when to do it → one question. Do not guess.

Questions — at most one, in the transcript language. ${QUESTION_PROPOSAL_MODULE}
- Allowed: no action/name; length missing on a clearly long task; span might be either the event length or the placement window; the other activity is not in Open tasks; a named part of day on that day is already past; a named week with no day inside it; a clock with no day that is already past.
- Not allowed: which day when they simply gave no day, which phase, which priority, a start or end clock when the event fills the whole day.

Examples (any language works the same way):
- "tomorrow at 15:00 dentist" → fixed, 15:00
- "tomorrow at 3 dentist" / "in four hours dinner" at 13:00 → fixed 15:00 / 17:00
- "a run around six, for forty minutes" → flexible preferred 18:00, duration 40, name is the run. Kind flexible, not fixed.
- "around 3 go to the shop" / "pizza around 16" → flexible preferred; digit does not make fixed
- "about noon" already afternoon → flexible preferred tomorrow 12:00
- "after 18 go to the gym" → earliest 18:00. "by end of day close the ticket" → deadline at Sleep today
- "finish the slides before the meeting" with no meeting in Open tasks → needs_clarification
- "today in the morning send the invoice" when the morning window has ended → needs_clarification
- "every Tuesday at 15:00 dentist" → recurring WEEKLY day 2, preferred 15:00
- "every morning stretch at 7" → recurring DAILY 07:00. "every Wednesday English at 19" → WEEKLY day 3, scheduledStart 19:00
- "after work" → preferred ~18:00. "after work until nine" → window 18:00–21:00
- "tomorrow morning…" → morning window on tomorrow. "today in the morning…" while that window is still ahead, even before wake → morning window on today
- "at 15? no, better at 17" → fixed 17:00. "better at" inside from–to stays preferred inside the window
- "between 14 and 18 buy groceries" → window. "tomorrow from 16 to 20 edit a video" → window, not a meeting
- "tomorrow from 10 to 14 make calls, better at 11, for half an hour" → window + preferred 11:00, duration 30
- "meeting from 15 to 16" → fixed 60. "tomorrow a conference from 9 to 18" → fixed 540
- "need to buy milk" → unscheduled. "next Tuesday file an application" on a Tuesday → day window +7`;

