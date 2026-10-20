export const CREATE_RECURRING_MODULE = `Recurring pattern (only on branch 1). Interpret the speaker's language yourself:
- daily / every day / every morning / every evening → DAILY, recurrenceWeekDays null. Not one occurrence today.
- weekdays / workdays → WEEKLY, days 1,2,3,4,5.
- A repeat on named weekdays is WEEKLY on those days (Sunday 0 … Saturday 6). Dates named once are not this pattern.
- A short "from A to B" clock span on a recurring errand (≤90 minutes) is preferred start A with duration to B — still recurring, not a placement window.
- every other week → BIWEEKLY. monthly → MONTHLY.
- every N days (every two days, every three days) → DAILY, days null. There is no interval field. A null pattern is dropped, so the pattern must be DAILY. Not unscheduled and not WEEKLY.
- the last day of the month, or the first of the month, with no "this month" and no single civil date → MONTHLY. That place in the month repeats. Not one window on the 31st.
Do not ask for a clock. A clock does not make this a repeat. Only when the utterance is already a repeat, kind stays recurring AND scheduledStart/End MUST be that preferred clock (+ duration) using schedule today's date and the zone offset from the user message. Morning/AM wording keeps bare 1–7 as morning. A bare hour ("at 19") counts. Do not leave scheduledStart null because that weekday is not schedule today.`;
