export const CREATE_RECURRING_MODULE = `Recurring pattern (only on branch 1):
- щодня / daily → DAILY, recurrenceWeekDays null.
- по буднях / weekdays → WEEKLY, days 1,2,3,4,5.
- по вихідних / weekends → WEEKLY, days 6 and 0. Sunday is 0.
- one named weekday ("щовівторка" / "every Tuesday") → WEEKLY and that day (Sunday 0 … Saturday 6).
- every other week → BIWEEKLY. щомісяця / monthly → MONTHLY.
Do not ask for a clock. If they spoke one, it is a preferred scheduledStart/End, and the kind stays recurring.`;
