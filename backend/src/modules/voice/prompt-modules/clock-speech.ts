/** Spoken clocks for specialists that emit ISO times. Dates come from the user message. */
export const BARE_HOUR_RULE = `Bare clock hours 1–7 (any language): if the utterance has morning / AM / dawn / before-noon meaning → keep morning (7 → 07:00). If it has night / late-night meaning → keep night. Otherwise treat as afternoon/evening (2 → 14:00, 7 → 19:00). Explicit afternoon/evening/PM words keep afternoon. A number that is not a clock is not a time.`;

export const CLOCK_ISO_MODULE = `Clocks. Copy dates from Local calendar in the user message. Do not invent a day.
- ISO-8601 with a numeric offset. Words for today / tomorrow (any language) = schedule today / schedule tomorrow. After sleep those anchors are already the new wake-day.
- ${BARE_HOUR_RULE}
- Relative "in N hours" (any language) = now ISO plus N hours.
- Clock with no day: if it is still ahead of now on schedule today, use schedule today. If that clock is already past, do not move it to tomorrow.
- Soft clocks already past today ("about noon" when it is afternoon): use schedule tomorrow at the same clock, or clarify — never leave a past start.
- Never put a new start before now ISO.
- 00:00 is not a clock. Use it only for a whole-day window, paired with 23:59.`;
