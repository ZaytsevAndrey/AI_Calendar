/** Open tasks the planner dialogue eval seeds before each run. */
export const INTENT_EVAL_FIXTURES = {
  tasks: [
    { name: 'Звіт', isRecurring: false },
    { name: 'Молоко', isRecurring: false },
    { name: 'Gym', isRecurring: true },
  ],
} as const;
