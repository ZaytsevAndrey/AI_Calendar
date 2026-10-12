/** Habit specialists identify the habit with command.taskName, not a separate id. */
export const HABIT_TARGET_MODULE = `Target. First match wins.
1. They named a habit → command.taskName copied from Habits (the closest title). Drop "звичку" / "habit" / "привычку". Do not invent a title.
2. No name, and Habits has exactly one line → taskName null. The app uses that habit.
3. No name and several habits, or the title is not in Habits → understanding needs_clarification, one short question which habit. Do not pick the first. Do not create a habit.`;
