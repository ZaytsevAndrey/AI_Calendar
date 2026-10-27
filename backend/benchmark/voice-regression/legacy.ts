/**
 * Notes on the 163-scenario dialogue corpus. Nothing here deletes or edits it.
 * Deterministic unit tests are a separate layer and stay.
 */
export const LEGACY_CORPUS = {
  total: 163,
  counts: {
    create: 53,
    update: 18,
    delete: 8,
    complete: 7,
    skip: 6,
    reschedule: 16,
    dialogue: 44,
    'fast-create': 11,
  },
  keepAsIdeas: [
    'event with no clock asks when',
    'named week asks which day',
    'similar title is not the open task',
    'series scope is a question',
    'explicit remind phrase is not a task',
    'a list of errands is not a day plan',
    'spoken yes applies and spoken no cancels',
    'bare pronoun does not write an open task in the old HTTP assertion',
  ],
  weaknesses: [
    'The clock is tomorrow 07:30 computed from the real date, so past-clock and morning cases drift.',
    'Most rows assert outcome plus a name substring. A wrong day or a wrong duration still passes.',
    'nameIncludes on a multi-intent turn can pass when only one of the names appears.',
    'window|shift|update is a storage detail, not the behavior the user asked for.',
    'Create is 53 of 163 rows and many of them share one assertion shape.',
    'The corpus never checks that a later change of a new task folds into one create.',
    'Pronoun-without-context allows clarify or refuse, which disagrees with spec §5 and does not record which contract won.',
    'Fast-create repeats assistant rows under another mode instead of covering a new behavior axis.',
    'The eval stops on the first mismatch unless --minutes is set, so it is a poor regression report.',
  ],
} as const;
