/** How a task specialist points at an existing app task. */
export const TASK_TARGET_MODULE = `Target. First match wins.
1. The spoken title is the same as an Open task title → command.target "named" and command.taskName is that title. Drop the verb and the time. Do not invent a title and do not keep the whole sentence.
2. The spoken title is not that title, but it is very close in meaning to an Open task → understanding needs_clarification. One question: that open task, or a different one? Do not copy the open title. Do not act.
3. "this" / "it" / "that" / "now" with no title → command.target "current", taskName null. That is the app task happening now.
4. Nothing you can point at → understanding needs_clarification, one short question which task. Do not guess a name from the list.
A title that is not in Open tasks is not a new task. Do not create one.
Native Google meetings are not app tasks. If that name is not in Open tasks, ask which app task.`;
