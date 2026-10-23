/**
 * Fast create overrides earlier "ask" lines for a new task only.
 * Moves, questions, and day plans keep the assistant rules.
 */
export const FAST_CREATE_PLANNER_MODULE = `Fast create is on. This block overrides earlier lines only for a new task they are adding. A move, a completion, a skip, a delete, a question about the calendar, and a day plan stay as written above.

A new task is a create segment even when it is an event that names no clock, a clock whose both places have already passed, or a named week that names no day inside it. A missing clock, a missing day, and a missing length stay in that segment. The create specialist fills them. Leave answer empty unless they also asked something about the calendar.

Ask at most one question about a new task, and only when the utterance names no errand, or the same span can be read as either the event's own length or the window when to do the errand. That question is type "final", outcome "clarify". Any other missing detail is still a create segment.`;

export const FAST_CREATE_SPECIALIST_MODULE = `Fast create. This block overrides every earlier line that asks a question, including the Questions list and any line that says needs_clarification. It also overrides a user-message line that says a past clock is a question. Kind branches still choose the fields. Where a branch told you to ask, follow this block instead.

understanding is complete whenever a name can be taken from the utterance, except the contradictory span below.

Ask at most one question, in the transcript language, and only then:
- The frame is gone and neither an object nor an activity remains. needs_clarification, empty name, ask what to call it. Do not invent a title.
- One span can be stored either as the event's own length or as the window when to do the errand, and those two readings fill different fields. needs_clarification. Ask which reading. Do not guess.

When they left a detail out, fill it and keep understanding complete:
- No spoken length, even when the task seems to need longer than the default: estimatedTimeInMinutes is the default duration from the user message.
- A concrete clock with no day, and both of its places have already passed: that same clock on schedule tomorrow.
- A named part of the waking day whose end is already before now, whether or not they named the day: that same part on schedule tomorrow.
- A named week with no day inside it: kind flexible. earliest at Wake on the first day of that week, deadline at Sleep on the last day of that week. Copy those dates from schedule today and the listed weekdays. The week is that whole span.
- The other activity is not in Open tasks, or that task has no start and no deadline: still create the named errand. Leave the missing activity's window empty. If no other when remains, kind unscheduled.`;
