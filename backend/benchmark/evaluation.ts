/**
 * How a diagnostic Planner C run should read each existing scenario.
 * Ambiguous and unsettled gold stays in the run. Their verdict is not an automatic acceptance.
 */

export type EvalClass = 'auto' | 'manual' | 'ambiguous' | 'unsettled';

export const EVALUATION: Record<string, EvalClass> = {
  'crud-create-unscheduled': 'auto',
  'crud-create-call': 'auto',
  'crud-update-duration': 'auto',
  'crud-rename': 'auto',
  'crud-delete-named': 'auto',
  'crud-delete-unknown': 'auto',
  'crud-create-similar': 'auto',
  'crud-delete-photos': 'auto',
  'crud-note': 'auto',
  'crud-nothing-to-change': 'unsettled',
  'time-tomorrow-clock': 'auto',
  'time-day-only': 'auto',
  'time-hour-ahead': 'auto',
  'time-past-morning': 'auto',
  'time-in-hours': 'auto',
  'time-window': 'ambiguous',
  'time-event-span': 'ambiguous',
  'time-whole-day': 'auto',
  'time-named-week': 'auto',
  'time-end-of-day': 'auto',
  'ctx-explicit-current': 'auto',
  'ctx-bare-pronoun': 'auto',
  'ctx-pronoun-after-chat': 'auto',
  'ctx-close-title': 'manual',
  'ctx-move-named': 'auto',
  'ctx-now-is-time': 'auto',
  'ctx-unsettled-pointer': 'ambiguous',
  'ctx-update-verb-is-create': 'auto',
  'dep-create-then-time': 'auto',
  'dep-several-changes': 'auto',
  'dep-create-cancel': 'auto',
  'dep-cancel-then-create': 'auto',
  'dep-independent': 'auto',
  'dep-same-name': 'auto',
  'dep-remind-separate': 'auto',
  'dep-existing-two-fields': 'auto',
  'dep-pronoun-two-antecedents': 'auto',
  'rem-create': 'auto',
  'rem-list': 'auto',
  'rem-missing-day': 'auto',
  'rem-resolve': 'manual',
  'rem-daily': 'ambiguous',
  'rem-complete-task': 'auto',
  'clar-event-no-clock': 'unsettled',
  'clar-move-no-when': 'auto',
  'clar-ambiguous-span': 'auto',
  'clar-no-name': 'auto',
  'clar-new-during-pending': 'auto',
  'clar-answer-pending': 'auto',
  'tool-agenda-tomorrow': 'auto',
  'tool-now': 'auto',
  'tool-unscheduled': 'auto',
  'tool-when-named': 'auto',
  'tool-empty-tomorrow': 'manual',
  'tool-gaps': 'auto',
  'plan-today': 'manual',
  'plan-not-a-list': 'auto',
  'plan-edit-add': 'auto',
  'plan-other-day': 'auto',
  'plan-confirm-yes': 'auto',
  'plan-confirm-no': 'auto',
  'date-tickets': 'auto',
  'clock-call': 'auto',
  'duration-cleaning': 'auto',
  'several-yoga': 'auto',
  'cancel-laundry': 'auto',
  'delete-draft': 'auto',
  'independent-bread': 'auto',
  'two-errands': 'auto',
  'same-budget': 'auto',
  'pronoun-taxi': 'auto',
  'pronoun-taxi-meeting': 'auto',
  'pronoun-bare': 'auto',
  'plain-coat': 'auto',
  'replace-dentist': 'auto',
  'existing-length': 'ambiguous',
  'existing-both': 'auto',
};

export const PRODUCT_QUESTIONS: Array<{ id: string; question: string }> = [
  {
    id: 'ctx-unsettled-pointer',
    question: 'Does feminine «ту» select «нарада», or must the planner keep the pointer when two tasks were named?',
  },
  {
    id: 'existing-length',
    question: 'Is «Зроби нараду на півтори години» an update of the existing Нарада, or a new 90-minute meeting?',
  },
  {
    id: 'rem-daily',
    question: 'Is «Щодня медитація» one task series, or a daily reminder?',
  },
  {
    id: 'time-window',
    question: 'Does «між 14 і 16» have to stay a placement window, or may the planner leave that reading to the specialist?',
  },
  {
    id: 'time-event-span',
    question: 'Does «з 15 до 16» have to be stored as the event length, or is keeping both clocks enough?',
  },
  {
    id: 'clar-event-no-clock',
    question: 'Does «Постав зустріч» stay a planner question, or a segment whose time the specialist asks?',
  },
  {
    id: 'crud-nothing-to-change',
    question: 'Does «Зміни щось у звіті» stay a planner question, or a segment that must not invent a field?',
  },
];

export function assertEvaluation(ids: string[]): string[] {
  const failures: string[] = [];
  const known = new Set(Object.keys(EVALUATION));
  for (const id of ids) if (!known.has(id)) failures.push(`evaluation missing ${id}`);
  for (const id of known) if (!ids.includes(id)) failures.push(`evaluation has unknown ${id}`);
  const questioned = new Set(PRODUCT_QUESTIONS.map((item) => item.id));
  for (const [id, klass] of Object.entries(EVALUATION)) {
    if ((klass === 'ambiguous' || klass === 'unsettled') && !questioned.has(id)) {
      failures.push(`${id} is ${klass} without a product question`);
    }
  }
  return failures;
}
