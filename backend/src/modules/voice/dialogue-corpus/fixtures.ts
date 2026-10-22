/** Open tasks the dialogue eval seeds before each run. */
export const VOICE_EVAL_FIXTURES = {
  tasks: [
    { name: 'Звіт', isRecurring: false },
    { name: 'Нарада', isRecurring: false },
    { name: 'Gym', isRecurring: true },
  ],
} as const;

/**
 * "Now" is tomorrow 07:30 Kyiv, before wake. A fixed past anchor would leave
 * every plan day behind the real clock the placement engine uses.
 */
function evalNowIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 4, 30),
  ).toISOString();
}

export const VOICE_EVAL_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: evalNowIso(),
  wakeTime: '08:00',
  sleepTime: '23:00',
} as const;
