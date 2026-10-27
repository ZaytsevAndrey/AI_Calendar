/** How update, delete, and skip point at an existing app task. Create does not use this. */
export const TASK_TARGET_MODULE = `Target. Use a target only when this request itself supplies the ground. First match wins.
1. The spoken title is the same as one Open task title → command.target "named" and command.taskName is that title. Drop the verb and the time.
2. The request explicitly selects the current task (current task, the task happening now, поточну задачу) → command.target "current" and taskName null. A task that is in progress is not that selection.
3. One antecedent is named in this request — the transcript, or the previous utterance together with the clarification answer — and it is one open task → command.target "named" and that title. A bare pronoun does not name it.
4. A bare pronoun with no antecedent in this request (this, it, that, це, його, її, цю, and their case forms) → understanding needs_clarification, one short question which task. Do not use the task happening now. Do not copy an open title.
5. More than one possible antecedent → needs_clarification. Do not pick one.
6. Anything else → understanding needs_clarification, one short question which task. A merely similar title is not a match. Do not guess a name from the list. Do not create a task.
The word for the present moment is a time, not a target.`;
