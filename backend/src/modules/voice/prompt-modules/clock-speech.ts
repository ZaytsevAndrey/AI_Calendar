/** Spoken clocks for specialists that emit ISO times. Dates come from the user message. */
export const BARE_HOUR_RULE = `Bare hours 1–7 without ранку/am/ночі/night → afternoon (2 → 14:00). "ранку" stays morning. "ночі" stays night. A number that is not a clock is not a time.`;

export const CLOCK_ISO_MODULE = `Clocks. Copy dates from Local calendar in the user message. Do not invent a day.
- ISO-8601 with a numeric offset. "today" / "сьогодні" = schedule today. "tomorrow" / "завтра" = schedule tomorrow. After sleep those anchors are already the new wake-day.
- ${BARE_HOUR_RULE}
- "in N hours" / "через N годин" = now ISO plus N hours.
- Clock with no day: if it is still ahead of now on schedule today, use schedule today. If that clock is already past, do not move it to tomorrow.
- Never put a new start before now ISO.
- 00:00 is not a clock. Use it only for a whole-day window, paired with 23:59.`;
