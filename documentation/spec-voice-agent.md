# Specification: Voice Agent

**Status:** the only product contract for Companion.  
**Language:** English  
**Last updated:** 23 October 2026

Companion (Ukrainian: Помічник) talks with the user and returns write intents. The server does not change the calendar. The client applies intents through the existing task, habit, and placement APIs. Placement and conflict stay in [spec-conflict-rules.md](spec-conflict-rules.md) and [spec-incremental-placement.md](spec-incremental-placement.md). The screen is [features/companion-panel.md](features/companion-panel.md). HTTP fields are in [api-reference.md](api-reference.md).

Other voice files do not add product rules. [spec-voice-commander.md](spec-voice-commander.md) is the old one-shot commander. [voice-agent-dialogue-test-plan.md](voice-agent-dialogue-test-plan.md) is how the dialogue eval runs. [voice-fix-flow.md](voice-fix-flow.md) is how a rule change is edited. [voice-prompt-next.md](voice-prompt-next.md) is a work queue.

---

## 1. A turn

`POST /voice/turn` takes the transcript, or a button (`confirm`, `cancel`, `build_plan`, `report`).

| Outcome | What it means |
|---------|----------------|
| `answer` | A reply from a read tool or from the chat. No write. |
| `clarify` | One question. Nothing in that question is written. |
| `confirm` | Preview cards. The client waits for Apply or a spoken yes. |
| `act` | The client runs `intents[]`. |
| `refuse` | The agent cannot do this. |

Every write waits for Apply or a spoken yes. Spoken yes and `confirm` are the same. Spoken no and `cancel` are the same. After a successful write the panel stays open.

The agent states only what the user said or a tool returned. It does not invent a task, a gap, a clock, a duration, or a travel time.

---

## 2. Questions

`assistant` asks one question only when the utterance does not determine a single value the calendar can store, and no default fills that hole.

A default fills the hole. A task that is not an event and has no time is Unscheduled. A normal length is the default duration. A clock that is still ahead and has no day is today.

The question proposes the likelier reading. When the readings are equal, it asks which and does not pick. A proposal is not a write.

A placement that needs another task's time is not created when that task has none.

An event with no time is a question when. A meal with other people is an event.

### Ignored questions

This replaces a cap of two questions. Ignoring a question means the next utterance does not answer it.

- Several questions, and the user ignored some of them: the ignored ones go into a question queue.
- Several questions, and the user ignored all of them: skip those questions.
- One question, and the user ignored it: skip that question.

Skip means that piece is not written and is not asked again. The queue is the set of ignored questions that are still waiting. A day-plan interview is not this queue: it has no question cap, and the user ends it with Apply.

---

## 3. How a turn is split

One planner call, then each write goes through the router and one specialist. The planner does not choose the action. The router chooses `create`, `update`, `delete`, `skip`, or `needs_clarification`. Time, other fields, and done on one existing task are one `update`. The specialist fills only that intent's fields.

A calendar question is answered from a read tool before the planner speaks. At most two tool rounds. A question and a write in one utterance: the answer is spoken, and each write is its own segment. The spoken reply does not describe the writes. The app summarizes those.

A planner reply that is not a known decision, a tool request with no calls, tools still requested on the last round, or any other planner failure is a refusal. That utterance is not parsed as a task. Rate limit and timeout are still those errors. An open day plan stays on screen. The server log is `planner.fault` with `invalid_decision`, `tool_limit_exceeded`, or `planner_execution_error`. An accepted decision is `planner.decision`.

A segment is one self-contained command, in the transcript's language, in the user's words. At most six, in spoken order.

- Every write is its own segment: create, one update of one task, skip, cancel, delete. An update carries that task's fields, its time, and whether it is done.
- Dates named once are one segment each. A clock they share is repeated in each and does not join them. A repeat on those days is one segment.
- Two errands are two segments. One errand with several objects of the same action is one segment.
- A field change and a placement of the same task are one update. The clock is not copied onto a different task that is only being removed.
- A later correction of a task this utterance is creating is merged into that one create. The last values win. That is not a separate move.
- A pronoun that points at a task already in the chat or in a tool result becomes that task's name. When the planner cannot tell which task, it still emits the segment. The specialist asks.
- A clear piece is held while an unclear piece is a question. The ignore rule in §2 decides a question the user does not answer.
- While a clarification is open, the next utterance is the answer only when it gives the missing fact. A reply that does not is the ignore rule in §2, and the utterance is decided on its own.
- Phases and settings are not available. That is `refuse`.

A new errand is `create` even when an open title is close in meaning, and even when the verb sounds like update or delete ("update the resume", "delete the photos", "close the ticket"). Update, delete, and skip are only for a task they are already pointing at.

---

## 4. Create

The specialist picks the first matching kind, then fills only that kind's fields.

1. **Recurring.** The utterance is already a repeat: every day, every morning, every evening, weekdays, named weekdays, every N days, every other week, monthly, the last or first day of the month. Every N days is `DAILY` (there is no interval field). Every other week is `BIWEEKLY`. A weekday named once is not a repeat. Dates named once are not a series. A clock does not make a repeat. When the utterance is a repeat and names a clock, that clock is the series clock. No clock leaves the series start empty. Do not ask for a clock.
2. **Fixed.** One spoken concrete clock and no repeat. An unspoken clock is not this kind. A softened hour is not this kind. "In N hours" is this kind: add N hours to now. A span that is the event itself (a meeting from one clock to another) is fixed: the span is the duration, not a placement window.
3. **Flexible preferred.** A soft clock (around an hour, after lunch, after work, about noon, closer to evening). Morning is not this kind. A named day that is still ahead also sets earliest at Wake and deadline at Sleep that day. No named day leaves earliest and deadline empty.
4. **Flexible window.** A span of when the errand may be done: between two clocks, after a clock, not before a clock, until a part of day, by end of day. Earliest and deadline are that span. The span length is not the task length. End of the day with no clock is deadline at Sleep today. A window with no named day is today. A preferred clock inside the window is stored too and does not make the task fixed.
5. **Day only.** A named day and no clock. Earliest at Wake, deadline at Sleep. A named week with no day inside it is a question which day. Do not pick a weekday. An event that fills the whole day is fixed from Wake to Sleep. Do not ask for a start or an end clock.
6. **Unscheduled.** No day, clock, span, or repeat. Do not ask which day. A place with no clock is this kind.

A spoken hour has two places twelve hours apart. A named morning locks the earlier place. A named afternoon or a bare hour from 1 to 7 locks the later place. A named night locks the night place. Otherwise use the place still ahead of now. If both have passed, ask. Do not write that start and do not move it to the next day. Twelve is noon. Midnight is not the other place. A clock on a named day stays on that day. A fraction toward an hour is the clock, not the length.

Morning is the first three hours after wake. A part that has not ended is still ahead, including before wake. They named that day and the morning has already ended: ask whether they still want that morning. No named day and the morning has ended: the same morning on the next day.

The schedule day lasts through three hours after sleep and begins three hours before wake. That choice only picks the date.

Spoken length wins. A normal task with no length uses the default duration. A clocked event or a placement window with no spoken length uses that default and does not ask how long. No length, no clock, no window, and the task clearly needs longer than the default: one question how long. A span that might be either the event length or the placement window: one question which reading. Do not guess.

The title is the errand, in the transcript's language, not the request around it. Drop politeness, the create verb, the day, the clock, and the length. Two objects of one errand stay one title. Two errands are not one title. When neither an object nor an activity remains, ask what to call it. Do not invent a title. Priority is medium unless they named urgency.

Before or after another activity, with no clock of its own, looks up Open tasks. Before a task that has a start, the deadline is that start. After a task that has an end, earliest is that end. No match, or a match with no time: ask. Do not create and do not invent a clock. After work and after lunch are soft clocks, not this lookup.

Phase is chosen after kind. A named phase is used only when its window contains the time already set. Otherwise the narrowest phase that contains that time. No time: a phase only when the title matches a phase name.

---

## 5. An existing task

The spoken title is the same as an Open task title: that task. "This", "it", or "that" with no title is the app task happening now. The word for the present moment is a time. Anything else, including a merely similar title: one question which task. Do not copy the open title and do not create a task here.

A new errand they asked to add is created as they said, even when an open task is similar.

A repeating Open task needs a scope. One day they already named, including today, is that occurrence. This day and following is the series from that day. The whole series is all. They did not say which: ask, and do not delete or edit yet. A name, priority, phase, or description change is the whole series. One day of those fields does not exist.

A bound is a time field on that same update. "By" or "until" a day or a part of day is the deadline. "Not before" or "after" a clock is the earliest start. The word "deadline" is not required. A day and no clock is that day's Sleep.

### Update

One existing task. Fields, where it sits in time, and whether it is done are one update. A present field is saved. Null clears it. Nothing changed: ask what to change.

Rename keeps the old title as the target and stores the new title beside it. A length is the duration only when they said how long the task takes. A window is not a length. Priority is set only when they said it. Clearing the time clears start, end, earliest, and deadline.

Do now is the start at the current clock. A start and an end are that window. A day and no clock is Wake to Sleep that day. A clock that is already past, with no day, is a question when. A clock and no end keeps the current duration. Morning is wake plus three hours. No day and no clock, when they asked to place the task: ask when.

Done on a one-off sets status completed. Done on a series uses the scope above: one occurrence, from this day on, or the whole series. A name that is not an open task, said as close or finish, is a new errand. A time change with no other field still seats the task. A time change together with another field is the same update.

### Delete

Removes the task. It does not ask "are you sure". The app asks before it writes. It does not invent a replacement. Deleting something that is not an open task (photos, files) is a new errand.

### Skip

Drops the next open occurrence, or the one happening now. Another day is a question: skip only drops the next open time. The whole series is a question: skip is this occurrence only. An Unscheduled task is cancelled, not deleted. A fixed event cannot be skipped: the app refuses.

---

## 6. Habits

Companion does not create, edit, check, or delete habits.

## 6.1 Day reminders

A day reminder is not a task and is not seated. Companion creates one only when the utterance has an explicit remind phrase: `нагадай`, `напомни`, `remind me`, `постав нагадування`, `поставь напоминание`. Without that phrase, an errand stays a task, including a bill or an unsubscribe.

Done, a change, or a delete that names an open reminder uses that reminder. The same name on an open task asks which one. Resolve closes one occurrence. A missing name or a missing day is the one question. A missing clock uses the settings default. A missing repeat stays off. A week with no day asks which day.

`list_reminders` answers which reminders are open. That is not a write. During a day plan, a reminder is its own segment and is not a draft item.

Apply calls `/day-reminders`. There is no placement and no conflict sheet.

---

## 7. Several writes in one utterance

Covered by the split in §3. Writes about another day, while a day plan is open, are normal intents beside the plan. The following execution report re-seats the plan. The client runs intents one by one and stops on a conflict or an error. After a batch with no conflict sheet, the client sends `report` with each status. That call does not use the model.

---

## 8. Fast create

`mode` is `assistant` or `fast_create`. The panel switch stores it in `localStorage`.

Fast create overrides the ask lines for a new task only. Moves, completions, skips, deletes, calendar questions, and day plans stay on the sections above.

A new task is a create even when it is an event with no clock, a clock whose both places have passed, or a named week with no day. The only questions are a missing name, or a span that cannot be stored both as the event length and as the placement window.

Anything else is filled. No spoken length, even on a long task, uses the default duration. A past clock with no day is that clock tomorrow. A past part of the day is that part tomorrow. A named week with no day is the whole week, Wake on the first day through Sleep on the last. Do not pick one weekday. Before or after a task that is missing or has no time: still create the errand, and if no other when remains it is Unscheduled.

The preview card and Apply stay.

---

## 9. Day plan

`plan_start` only when the user asks to plan, arrange, or organize a whole day. A list of errands for a day is §3, not a plan. One event that fills a whole day is a create, not a plan.

The draft holds the open Unscheduled tasks for that day and the flexible one-offs already on it. Fixed tasks, series, and external events are never moved. The planner receives this unapplied draft on every turn: day, stage, each item, and whether a proposal has seated it. `plan_edits` changes that draft. Nothing is written until Apply.

The opening says what a tool just returned: a free gap, the tasks already there, or that the day has no gap. It does not invent a gap, a clock, or a task.

While the plan is open, a write about that day is a plan edit, not a segment. A question is answered and the plan stays open. The agent never ends the dialogue.

Edits are: add a task that does not exist yet, include an existing open task, remove an item, set a preferred start, set a window, set a duration, set the order. Earlier items get the better slots. A bare hour in a window uses the place still ahead. A named morning or night locks that half. Midday as a deadline is 12:00.

1. **Interview.** `clarify`, `plan.stage = interview`, actions `build_plan` and `cancel`. Each answer edits the draft. One question at a time. Never repeat a question. The server does not close the interview by itself.
2. **Proposal.** The placement engine seats the draft in a dry run, in draft order. A seated item blocks the next. Items that do not fit are `unplaced` (`no_room`, `deadline_passed`, `conflict`). An empty proposal returns to the interview.
3. **Review.** `confirm`, `plan.stage = review`. The mic stays on. An utterance edits the plan and the server re-seats it. Changed items are marked.
4. **Apply.** `confirm` or a spoken yes returns `act` with the mapped intents and drops the draft. `cancel` drops the draft. A pending write confirm during review cancels back to the plan first. Closing the panel discards it.

Apply mapping: an Unscheduled task becomes `window` with `clearUnscheduled`; a flexible task becomes `shift` of its slot; a new task is a flexible create at the proposed slot with an end-of-day deadline.

---

## 10. Session and screen

The session is in memory, one per open panel, a new `sessionId` on every open. Close discards the session and any pending question or confirm. There is no wake word. The turn response is text. Spoken audio is `POST /voice/speak`: Azure Speech when configured, otherwise Piper, otherwise the browser.

Phone is a bottom sheet. Desktop is a floating panel. The thread shows the user and Companion. Confirm and the day plan show calendar-style cards.

`skip_speak` stops speech only. `cancel` dismisses the pending confirm or the plan.

---

## 11. API

`POST /voice/turn`

- In: `transcript`, `sessionId`, `actionId`, `executionReport`, `mode`. Time zone comes from settings.
- Out: `outcome`, `assistantMessage`, `intents[]`, `actions[]`, `plan`, `segments[]`.

`POST /voice/transcribe` is speech to text. `POST /voice/parse-task` remains for tests and when a planner decision does not fit the session: a segment, an edit with no open draft, or an answer with no open question. A planner fault does not call it. It is not the Companion path.

Read tools used to ground an answer: `get_now_next`, `get_day_agenda`, `list_unscheduled`, `list_problematic`, `find_free_gaps`, `match_task`, `match_habit`, `get_habit_status`, `get_task`, `list_reminders`.

Write intents the client runs: create, update, delete, complete, skip, cancel, move, window. A done-only update becomes complete. A time-only update seats the task. No phases and no settings.

---

## 12. Tests

Live dialogue tests are `npm run voice:eval:dialogue`. The corpus is `backend/src/modules/voice/dialogue-corpus`. An expectation is an instance of a sentence in this file. A write turn is `confirm`. Spoken yes is `act`.
