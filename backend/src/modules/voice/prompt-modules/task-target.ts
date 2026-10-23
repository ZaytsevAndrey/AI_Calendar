/** How update, delete, and skip point at an existing app task. Create does not use this. */
export const TASK_TARGET_MODULE = `Target. First match wins.
1. The spoken title is the same as an Open task title → command.target "named" and command.taskName is that title. Drop the verb and the time.
2. "this" / "it" / "that" with no title → command.target "current" and taskName null. That is the app task happening now. The word for the present moment is a time, not this rule.
3. Anything else → understanding needs_clarification, one short question which task. A merely similar title is not a match. Do not copy an Open task title. Do not guess a name from the list. Do not create a task.`;
