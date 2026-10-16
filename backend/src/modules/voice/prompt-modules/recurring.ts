export const CREATE_RECURRING_MODULE = `Recurring pattern (only on branch 1). Interpret the speaker's language yourself:
- daily / every day / every morning / every evening → DAILY, recurrenceWeekDays null. Not one occurrence today.
- weekdays / workdays → WEEKLY, days 1,2,3,4,5.
- weekends → WEEKLY, days 6 and 0. Sunday is 0.
- one named weekday → WEEKLY and that day (Sunday 0 … Saturday 6).
- two named weekdays → WEEKLY and BOTH days.
- A short "from A to B" clock span on a recurring errand (≤90 minutes) is preferred start A with duration to B — still recurring, not a placement window.
- every other week → BIWEEKLY. monthly → MONTHLY.
Do not ask for a clock. If they spoke one, kind stays recurring AND scheduledStart/End MUST be that preferred clock (+ duration) using schedule today's date and the zone offset from the user message. Morning/AM wording keeps bare 1–7 as morning. A bare hour ("at 19") counts. Do not leave scheduledStart null because that weekday is not schedule today.`;
