# Voice series scope

Status: shipped

## Purpose

Voice commands on a repeating task are ambiguous: "delete Gym" could mean today's session, every session from now on, or the whole series. The resolver never guesses. It asks which one, then runs exactly that scope.

## User-facing behavior

- A voice command that targets a **repeating** task (the task has `isRecurring`) needs a scope for **delete**, **complete**, **reschedule (move)**, and **field update**:
  - **This day** (`occurrence`): only that day's occurrence.
  - **This day and following** (`series`): the series ends from that day on; earlier days stay.
  - **Whole series** (`all`): the task itself.
- If the user already said the scope in the command ("delete Gym just this day", "move Gym, the whole series"), the command runs without a question.
- Otherwise the voice sheet asks a clarifying question that names the task. The user answers by **speaking or typing** in the sheet. There is no tap menu for voice scope.
- If the answer still does not name a scope, the sheet shows a refusal with the same question text and nothing changes. The user starts again.
- A non-repeating task never asks about scope.
- Calendar chip menus and Tasks series menus are separate entry points with the same three scopes ([event-preview.md](event-preview.md)).

What each scope does:

| Intent | This day | This day and following | Whole series |
|--------|----------|------------------------|--------------|
| Delete | Skip that occurrence | End the series from that day (`end_series`) | Delete the task |
| Complete | Skip that occurrence | End the series from that day | Mark the task completed |
| Reschedule | Move that day's slot | Move this day and the following days | Move the whole series, or re-window it when no open slot exists |
| Update fields | Refused | Refused | Update the task |

## Logic

Pipeline (`VoiceService.parseTask` → `resolveVoiceCommand`):

1. Router and specialist prompts classify the intent and return a draft. The recurring-task prompt module (`SERIES_SCOPE_MODULE`) tells the model to include `command.seriesScope` and to leave it out when the user did not say it.
2. The resolver picks the task (named match, or the one in progress).
3. For a repeating task, `seriesScopeFor` decides the scope:
   1. Scan the transcript. When the turn is a clarification answer, the scanned text is the previous utterance plus the answer. `sniffSeriesScope` checks "this day and following" phrases first, then "entire / whole series / all days" phrases, then "this day only / just this" phrases (English, Ukrainian, Russian).
   2. If nothing matched and this is a clarification answer, use the model's `command.seriesScope`.
   3. If nothing matched on the first turn, the model's scope is **not** used.
   4. No scope: first turn returns `needs_clarification` with the question; second turn returns a `refuse` command carrying the same question.
4. The command is built from the scope:
   - Delete: `occurrence` → `skip`, `series` → `end_series`, `all` → `delete`.
   - Complete: `occurrence` → `skip`, `series` → `end_series`, `all` → `complete`.
   - Update: only `all` builds an `update`; any other scope returns a refusal ("field changes apply to the whole series").
   - Reschedule: the scope is required, then the usual move logic runs. A Google-synced slot becomes a `move` command carrying `seriesScope`. A slot with no Google event id becomes a `shift` of that slot. With no open future slot, a repeating task can only be re-windowed under `all`; other scopes are refused ("no open time to move").
5. The sheet shows the summary (optionally asks for confirmation), then the client runs the command.

What is written, per command: `skip` → `POST /tasks/:id/skip-occurrence` (day added to `skippedOccurrenceYmds`, its Google instance removed); `end_series` → `POST /tasks/:id/end-series-from`; `delete` → `DELETE /tasks/:id`; `complete` → status `completed`; `update` → `PATCH /tasks/:id`; `move` → `POST /schedule/move-event` with `seriesScope`; `shift` → reschedule of one slot.

## Edge cases

- **Skip intent** ("skip Gym") on a repeating task does not ask for scope; it skips the open occurrence.
- **Update is all-or-nothing.** Any patch on a repeating task (not just name, priority, phase, description) needs `all`. An empty patch asks "what to change" before scope.
- **Reopen / status edits** through update follow the same rule.
- **Fixed and imported events** cannot be skipped or ended by voice and return a refusal; imported (fixed-external) events are refused for complete, delete, and update as "not an app task".
- **Do now** on a repeating task is refused unless the scope is `all`.
- **Clarification answers** are combined with the first utterance, so "…Gym" then "just this day" resolves in one step.
- **No scope on the second try** ends in a refusal, not a third question.
- **Typed answers** work the same as spoken ones because the resolver only sees text.

## Data / settings / API

- `POST /voice/parse-task` and `POST /voice/turn` return `understanding: complete | needs_clarification` and, for commands, `command.kind` plus `seriesScope` on `move`.
- `VoiceSeriesScope = 'occurrence' | 'series' | 'all'`.
- Related endpoints: `/tasks/:id/skip-occurrence`, `/tasks/:id/end-series-from`, `/schedule/move-event` (a recurring move without `seriesScope` returns a `series-choice` result instead of moving).
- Settings: speech language selects the clarification wording; `confirmVoiceCommands` asks before running.

## Out of scope

- Calendar and Tasks series menus.
- Placement and clock-split rules ([spec-incremental-placement.md](../spec-incremental-placement.md)).
- Scope for habits (habits are daily check-ins, not series).
- The agent contract for Q&A turns ([spec-voice-agent.md](../spec-voice-agent.md)).

## Known gaps

- On the first turn the model's `seriesScope` is ignored unless a built-in phrase matches the transcript; a paraphrase gets a clarification question even when the model understood it.
- The built-in phrase list is English, Ukrainian, and Russian only.
- Skip on a repeating task has no scope question and cannot end the series.
- A reschedule on a task with no Google event id becomes a single-slot `shift`, so the chosen scope does not widen the move.
- Field updates cannot target a single day; the user must say whole series.
- A second unclear answer ends the flow without a retry.

## Related

- [spec-voice-agent.md](../spec-voice-agent.md)
- [event-preview.md](event-preview.md)
- [task-series-group.md](task-series-group.md)
- [language.md](language.md)
