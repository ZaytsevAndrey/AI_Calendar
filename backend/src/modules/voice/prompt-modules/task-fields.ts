/**
 * Field catalog shared by create and update.
 * Create still chooses a kind first. Update writes only the keys this utterance changed.
 */
export const TASK_FIELDS_MODULE = `Fields. A key you omit is left alone. On an update, a present key is saved and null clears it. Do not invent a value they did not give, and do not require a special word when the meaning is already clear.

- name: the errand heading. Create stores it on task.name. Update stores a new title on command.newName with command.rename true, and keeps the old title in command.taskName.
- description: extra detail that is not already in the name, or null when they clear the note.
- location: the place, or null when they clear it.
- phaseId: an id from the phases list, or null to clear. Never invent an id. A time that merely falls inside a phase does not change the phase.
- eventType: "fixed" when the task is tied to a start and an end. "admin" when it may move. Otherwise omit it.
- estimatedTimeInMinutes: how long the task takes. A placement window is not a length. Create uses the spoken length, or the default duration when they gave none and the task is an ordinary one. Update sets this only when they said the length changed.
- priority: low, medium, high, or urgent, only when they named it. Create uses medium when they named none. Update omits it when they named none.
- deadline: when the task must be done by, or the end of the span when it may be done. "By Friday", "until evening", and "by end of day" are a deadline. The word "deadline" is not required. A day and no clock is Sleep that day.
- earliestStartTime: the moment it must not start before. "Not before 17" and "after 18" are this field, not a deadline.
- scheduledStartTime and scheduledEndTime: a committed start and end. A clock and no end keeps the current duration: set the start and leave the end null on an update. Create fills the end from the duration.
- isUnscheduled: true when there is no day, clock, window, or repeat. Clearing the time on an update sets scheduledStartTime, scheduledEndTime, earliestStartTime, and deadline to null.
- status, update only: command.status. completed when they report the task done. canceled when it will not happen. todo reopens it. in_progress when they said it is in progress. Omit task.status.
- Repeat, only when they set or clear it: isRecurring, recurrencePattern DAILY | WEEKLY | BIWEEKLY | MONTHLY or null, recurrenceWeekDays (Sunday 0 … Saturday 6) or null. Every day is DAILY and days null. Named weekdays are WEEKLY on those days. Turning a repeat off is isRecurring false and both pattern and days null.
- eligibleWeekDays: only when they limit which days a flexible task may land. allowSplit: only when they said it can or cannot be split.
- googleColorId, googleVisibility, googleTransparency, googleReminders: only when they named that Google field.

A name, priority, phase, or description change on a series is the whole series: seriesScope "all".`;
