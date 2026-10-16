/** How a task specialist points at an existing app task. */
export const TASK_TARGET_MODULE = `Target. First match wins.
1. They named a task → command.target "named" and command.taskName copied from Open tasks (the closest title). Drop the verb and the time. Do not invent a title and do not keep the whole sentence.
2. "this" / "it" / "that" / "now" with no title → command.target "current", taskName null. That is the app task happening now.
3. Nothing you can point at → understanding needs_clarification, one short question which task. Do not guess a name from the list.
A title that is not in Open tasks is not a new task. Do not create one. Ask which task, unless the closest Open tasks title is clearly the same task.
Native Google meetings are not app tasks. If that name is not in Open tasks, ask which app task.`;
