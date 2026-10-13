/**
 * First-message eval for non-create router intents (UK only).
 * Fixtures: open tasks Звіт/Молоко/Gym(recurring); habits Вода/Розтяжка.
 * Assert agent parse response (command/clarify) — not DB mutations.
 */
export const INTENT_EVAL_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-13T10:00:00.000Z',
  todayYmd: '2026-10-13',
  tomorrowYmd: '2026-10-14',
  wakeTime: '08:00',
  sleepTime: '23:00',
} as const;

export const INTENT_EVAL_FIXTURES = {
  tasks: [
    { name: 'Звіт', isRecurring: false },
    { name: 'Молоко', isRecurring: false },
    { name: 'Gym', isRecurring: true },
  ],
  habits: [{ name: 'Вода' }, { name: 'Розтяжка' }],
} as const;

export type IntentEvalIntent =
  | 'update'
  | 'delete'
  | 'complete'
  | 'skip'
  | 'reschedule'
  | 'habit_create'
  | 'habit_check_in'
  | 'habit_update'
  | 'habit_delete'
  | 'habit_uncheck'
  | 'needs_clarification';

export type IntentEvalExpect = {
  understanding: 'complete' | 'needs_clarification';
  /** Resolved command.kind, or null when clarify / create-like habit_create fields only. */
  commandKind?: string | null;
  taskNameIncludes?: string;
  habitNameIncludes?: string;
  /** habit_create: habit name substring */
  newHabitNameIncludes?: string;
  patchPriority?: string;
  renameIncludes?: string;
  hasSpokenStart?: boolean;
  scheduledYmd?: string;
};

export type IntentEvalScenario = {
  id: string;
  intent: IntentEvalIntent;
  construction: string;
  transcript: string;
  language: 'uk';
  expect: IntentEvalExpect;
};

export const INTENT_EVAL_BLOCK_SIZE = 50;

export const INTENT_EVAL_SCENARIOS: IntentEvalScenario[] = [
  // —— update ——
  { id: 'up01', intent: 'update', language: 'uk', construction: 'upd.rename.named', transcript: 'перейменуй молоко на хліб', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Молок', renameIncludes: 'хліб' } },
  { id: 'up02', intent: 'update', language: 'uk', construction: 'upd.priority.urgent.named', transcript: 'зроби звіт терміновим', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Звіт', patchPriority: 'urgent' } },
  { id: 'up03', intent: 'update', language: 'uk', construction: 'upd.priority.low.named', transcript: 'звіт не горить, низький пріоритет', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Звіт', patchPriority: 'low' } },
  { id: 'up04', intent: 'update', language: 'uk', construction: 'upd.deadline.tomorrow.named', transcript: 'дедлайн звіту на завтра', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Звіт' } },
  { id: 'up05', intent: 'update', language: 'uk', construction: 'upd.duration.named', transcript: 'звіт на годину', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Звіт' } },
  { id: 'up06', intent: 'update', language: 'uk', construction: 'upd.current.no.target.clarify', transcript: 'зроби її терміновою', expect: { understanding: 'needs_clarification' } },
  { id: 'up07', intent: 'update', language: 'uk', construction: 'upd.noise.rename.then.correct', transcript: 'перейменуй молоко на кефір… ні, на хліб', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Молок', renameIncludes: 'хліб' } },
  { id: 'up08', intent: 'update', language: 'uk', construction: 'upd.time.change.no.when.clarify', transcript: 'зміни час звіту', expect: { understanding: 'needs_clarification' } },
  { id: 'up09', intent: 'update', language: 'uk', construction: 'upd.nothing.changed.clarify', transcript: 'онови звіт', expect: { understanding: 'needs_clarification' } },
  { id: 'up10', intent: 'update', language: 'uk', construction: 'upd.description.named', transcript: 'додай до звіту опис фінальна версія', expect: { understanding: 'complete', commandKind: 'update', taskNameIncludes: 'Звіт' } },

  // —— delete ——
  { id: 'del01', intent: 'delete', language: 'uk', construction: 'del.named.oneoff', transcript: 'видали звіт', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Звіт' } },
  { id: 'del02', intent: 'delete', language: 'uk', construction: 'del.named.milk', transcript: 'видали молоко', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Молок' } },
  { id: 'del03', intent: 'delete', language: 'uk', construction: 'del.current.this', transcript: 'видали це', expect: { understanding: 'needs_clarification' } },
  { id: 'del04', intent: 'delete', language: 'uk', construction: 'del.series.all.gym', transcript: 'видали всю серію gym', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Gym' } },
  { id: 'del05', intent: 'delete', language: 'uk', construction: 'del.recurring.no.scope.clarify', transcript: 'видали gym', expect: { understanding: 'needs_clarification' } },
  { id: 'del06', intent: 'delete', language: 'uk', construction: 'del.noise.named', transcript: 'ну коротше… видали звіт вже', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Звіт' } },
  { id: 'del07', intent: 'delete', language: 'uk', construction: 'del.habit.trap.clarify', transcript: 'видали звичку вода', expect: { understanding: 'needs_clarification' } },
  { id: 'del08', intent: 'delete', language: 'uk', construction: 'del.remove.synonym', transcript: 'прибери задачу молоко', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Молок' } },
  { id: 'del09', intent: 'delete', language: 'uk', construction: 'del.unknown.name.clarify', transcript: 'видали квантову фізику', expect: { understanding: 'needs_clarification' } },
  { id: 'del10', intent: 'delete', language: 'uk', construction: 'del.please.named', transcript: 'будь ласка видали звіт', expect: { understanding: 'complete', commandKind: 'delete', taskNameIncludes: 'Звіт' } },

  // —— complete ——
  { id: 'cmp01', intent: 'complete', language: 'uk', construction: 'cmp.named.report', transcript: 'закінчив звіт', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Звіт' } },
  { id: 'cmp02', intent: 'complete', language: 'uk', construction: 'cmp.named.done.milk', transcript: 'готово молоко', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Молок' } },
  { id: 'cmp03', intent: 'complete', language: 'uk', construction: 'cmp.bare.done.clarify', transcript: 'готово', expect: { understanding: 'needs_clarification' } },
  { id: 'cmp04', intent: 'complete', language: 'uk', construction: 'cmp.zrobyv.named', transcript: 'зробив звіт', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Звіт' } },
  { id: 'cmp05', intent: 'complete', language: 'uk', construction: 'cmp.habit.word.to.checkin', transcript: 'зробив звичку воду', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },
  { id: 'cmp06', intent: 'complete', language: 'uk', construction: 'cmp.noise.named', transcript: 'ура, нарешті закінчив звіт', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Звіт' } },
  { id: 'cmp07', intent: 'complete', language: 'uk', construction: 'cmp.mark.done.named', transcript: 'познач звіт виконаним', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Звіт' } },
  { id: 'cmp08', intent: 'complete', language: 'uk', construction: 'cmp.unknown.clarify', transcript: 'закінчив марсіанський звіт', expect: { understanding: 'needs_clarification' } },
  { id: 'cmp09', intent: 'complete', language: 'uk', construction: 'cmp.series.gym.scope', transcript: 'закінчив gym на сьогодні', expect: { understanding: 'complete', commandKind: 'complete', taskNameIncludes: 'Gym' } },
  { id: 'cmp10', intent: 'complete', language: 'uk', construction: 'cmp.this.bare.clarify', transcript: 'закінчив це', expect: { understanding: 'needs_clarification' } },

  // —— skip ——
  { id: 'skp01', intent: 'skip', language: 'uk', construction: 'skp.named.report', transcript: 'пропусти звіт', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Звіт' } },
  { id: 'skp02', intent: 'skip', language: 'uk', construction: 'skp.named.gym', transcript: 'пропусти gym', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Gym' } },
  { id: 'skp03', intent: 'skip', language: 'uk', construction: 'skp.this.clarify', transcript: 'пропусти це', expect: { understanding: 'needs_clarification' } },
  { id: 'skp04', intent: 'skip', language: 'uk', construction: 'skp.today.named', transcript: 'пропусти сьогоднішній gym', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Gym' } },
  { id: 'skp05', intent: 'skip', language: 'uk', construction: 'skp.noise.named', transcript: 'ну сьогодні не встигну, пропусти звіт', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Звіт' } },
  { id: 'skp06', intent: 'skip', language: 'uk', construction: 'skp.skip.synonym', transcript: 'пропустити молоко', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Молок' } },
  { id: 'skp07', intent: 'skip', language: 'uk', construction: 'skp.unknown.clarify', transcript: 'пропусти орбіту', expect: { understanding: 'needs_clarification' } },
  { id: 'skp08', intent: 'skip', language: 'uk', construction: 'skp.please.named', transcript: 'будь ласка пропусти gym', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Gym' } },
  { id: 'skp09', intent: 'skip', language: 'uk', construction: 'skp.hedge.then.named', transcript: 'може скасувати… ні, просто пропусти звіт', expect: { understanding: 'complete', commandKind: 'skip', taskNameIncludes: 'Звіт' } },
  { id: 'skp10', intent: 'skip', language: 'uk', construction: 'skp.bare.skip.clarify', transcript: 'пропусти', expect: { understanding: 'needs_clarification' } },

  // —— reschedule ——
  { id: 'rsch01', intent: 'reschedule', language: 'uk', construction: 'rsch.to.tomorrow.named', transcript: 'перенеси звіт на завтра', expect: { understanding: 'complete', commandKind: 'window', taskNameIncludes: 'Звіт', scheduledYmd: '2026-10-14' } },
  { id: 'rsch02', intent: 'reschedule', language: 'uk', construction: 'rsch.to.clock.named', transcript: 'перенеси молоко на 15:00', expect: { understanding: 'complete', commandKind: 'shift', taskNameIncludes: 'Молок', hasSpokenStart: true } },
  { id: 'rsch03', intent: 'reschedule', language: 'uk', construction: 'rsch.do.now.named', transcript: 'зроби звіт зараз', expect: { understanding: 'complete', commandKind: 'shift', taskNameIncludes: 'Звіт', hasSpokenStart: true } },
  { id: 'rsch04', intent: 'reschedule', language: 'uk', construction: 'rsch.window.named', transcript: 'перенеси звіт між 14 і 18', expect: { understanding: 'complete', commandKind: 'window', taskNameIncludes: 'Звіт' } },
  { id: 'rsch05', intent: 'reschedule', language: 'uk', construction: 'rsch.bare.no.when.clarify', transcript: 'перенеси звіт', expect: { understanding: 'needs_clarification' } },
  { id: 'rsch06', intent: 'reschedule', language: 'uk', construction: 'rsch.this.tomorrow', transcript: 'перенеси це на завтра', expect: { understanding: 'needs_clarification' } },
  { id: 'rsch07', intent: 'reschedule', language: 'uk', construction: 'rsch.noise.then.tomorrow', transcript: 'не сьогодні… перенеси звіт на завтра', expect: { understanding: 'complete', commandKind: 'window', taskNameIncludes: 'Звіт', scheduledYmd: '2026-10-14' } },
  { id: 'rsch08', intent: 'reschedule', language: 'uk', construction: 'rsch.friday.named', transcript: 'перенеси молоко на пʼятницю', expect: { understanding: 'complete', commandKind: 'window', taskNameIncludes: 'Молок', scheduledYmd: '2026-10-16' } },
  { id: 'rsch09', intent: 'reschedule', language: 'uk', construction: 'rsch.do.now.bare.clarify', transcript: 'зроби зараз', expect: { understanding: 'needs_clarification' } },
  { id: 'rsch10', intent: 'reschedule', language: 'uk', construction: 'rsch.mind.change.day', transcript: 'перенеси звіт на сьогодні… ні, на завтра', expect: { understanding: 'complete', commandKind: 'window', taskNameIncludes: 'Звіт', scheduledYmd: '2026-10-14' } },

  // —— habit_create ——
  { id: 'hc01', intent: 'habit_create', language: 'uk', construction: 'hc.bare.name', transcript: 'створи звичку пити воду', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'вод' } },
  { id: 'hc02', intent: 'habit_create', language: 'uk', construction: 'hc.daily.block.full', transcript: 'звичка розтяжка щодня о 7 ранку на 20 хвилин', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'розтяж' } },
  { id: 'hc03', intent: 'habit_create', language: 'uk', construction: 'hc.time.no.duration.clarify', transcript: 'зроби звичку біг о сьомій', expect: { understanding: 'needs_clarification' } },
  { id: 'hc04', intent: 'habit_create', language: 'uk', construction: 'hc.duration.no.time.clarify', transcript: 'нова звичка медитація на 15 хвилин', expect: { understanding: 'needs_clarification' } },
  { id: 'hc05', intent: 'habit_create', language: 'uk', construction: 'hc.no.name.clarify', transcript: 'створи звичку', expect: { understanding: 'needs_clarification' } },
  { id: 'hc06', intent: 'habit_create', language: 'uk', construction: 'hc.noise.name', transcript: 'хочу нову звичку… читати щовечора, без блоку', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'чит' } },
  { id: 'hc07', intent: 'habit_create', language: 'uk', construction: 'hc.add.habit.synonym', transcript: 'додай звичку холодна вода', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'вод' } },
  { id: 'hc08', intent: 'habit_create', language: 'uk', construction: 'hc.mind.change.name', transcript: 'звичка йога… ні, краще розтяжка', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'розтяж' } },
  { id: 'hc09', intent: 'habit_create', language: 'uk', construction: 'hc.english.loan.name', transcript: 'створи звичку journaling', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'journal' } },
  { id: 'hc10', intent: 'habit_create', language: 'uk', construction: 'hc.daily.block.evening', transcript: 'звичка щоденник щодня о 22 на 10 хвилин', expect: { understanding: 'complete', commandKind: 'habit_create', newHabitNameIncludes: 'щоденник' } },

  // —— habit_check_in ——
  { id: 'hci01', intent: 'habit_check_in', language: 'uk', construction: 'hci.named.water', transcript: 'відміть звичку вода', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },
  { id: 'hci02', intent: 'habit_check_in', language: 'uk', construction: 'hci.named.stretch', transcript: 'чек-ін розтяжка', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Розтяж' } },
  { id: 'hci03', intent: 'habit_check_in', language: 'uk', construction: 'hci.done.habit.named', transcript: 'зробив розтяжку', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Розтяж' } },
  { id: 'hci04', intent: 'habit_check_in', language: 'uk', construction: 'hci.bare.clarify', transcript: 'відміть звичку', expect: { understanding: 'needs_clarification' } },
  { id: 'hci05', intent: 'habit_check_in', language: 'uk', construction: 'hci.noise.named', transcript: 'а, майже забув — відміть воду', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },
  { id: 'hci06', intent: 'habit_check_in', language: 'uk', construction: 'hci.unknown.clarify', transcript: 'відміть звичку марафон', expect: { understanding: 'needs_clarification' } },
  { id: 'hci07', intent: 'habit_check_in', language: 'uk', construction: 'hci.check.synonym', transcript: 'познач що зробив воду', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },
  { id: 'hci08', intent: 'habit_check_in', language: 'uk', construction: 'hci.today.explicit', transcript: 'сьогодні відміть розтяжку', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Розтяж' } },
  { id: 'hci09', intent: 'habit_check_in', language: 'uk', construction: 'hci.please.named', transcript: 'будь ласка відміть воду', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },
  { id: 'hci10', intent: 'habit_check_in', language: 'uk', construction: 'hci.task.trap.named.habit', transcript: 'звичка вода виконана', expect: { understanding: 'complete', commandKind: 'habit_check_in', habitNameIncludes: 'Вод' } },

  // —— habit_update ——
  { id: 'hu01', intent: 'habit_update', language: 'uk', construction: 'hu.rename', transcript: 'перейменуй звичку розтяжка на пробіжку', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Розтяж', renameIncludes: 'пробіж' } },
  { id: 'hu02', intent: 'habit_update', language: 'uk', construction: 'hu.clear.block', transcript: 'прибери час у розтяжки', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Розтяж' } },
  { id: 'hu03', intent: 'habit_update', language: 'uk', construction: 'hu.no.change.clarify', transcript: 'онови звичку вода', expect: { understanding: 'needs_clarification' } },
  { id: 'hu04', intent: 'habit_update', language: 'uk', construction: 'hu.noise.rename', transcript: 'звичка розтяжка… краще назвемо пробіжка', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Розтяж', renameIncludes: 'пробіж' } },
  { id: 'hu05', intent: 'habit_update', language: 'uk', construction: 'hu.unknown.clarify', transcript: 'перейменуй звичку йога на пілатес', expect: { understanding: 'needs_clarification' } },
  { id: 'hu06', intent: 'habit_update', language: 'uk', construction: 'hu.set.block', transcript: 'звичка вода щодня о 8 на 5 хвилин', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Вод' } },
  { id: 'hu07', intent: 'habit_update', language: 'uk', construction: 'hu.bare.clarify', transcript: 'зміни звичку', expect: { understanding: 'needs_clarification' } },
  { id: 'hu08', intent: 'habit_update', language: 'uk', construction: 'hu.description', transcript: 'додай опис до води: два літри', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Вод' } },
  { id: 'hu09', intent: 'habit_update', language: 'uk', construction: 'hu.mind.change.rename', transcript: 'перейменуй розтяжку на йогу… ні, на пробіжку', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Розтяж', renameIncludes: 'пробіж' } },
  { id: 'hu10', intent: 'habit_update', language: 'uk', construction: 'hu.please.rename', transcript: 'будь ласка перейменуй воду на гідратацію', expect: { understanding: 'complete', commandKind: 'habit_update', habitNameIncludes: 'Вод', renameIncludes: 'гідрат' } },

  // —— habit_delete ——
  { id: 'hd01', intent: 'habit_delete', language: 'uk', construction: 'hd.named.water', transcript: 'видали звичку вода', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Вод' } },
  { id: 'hd02', intent: 'habit_delete', language: 'uk', construction: 'hd.named.stretch', transcript: 'видали звичку розтяжка', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Розтяж' } },
  { id: 'hd03', intent: 'habit_delete', language: 'uk', construction: 'hd.bare.clarify', transcript: 'видали звичку', expect: { understanding: 'needs_clarification' } },
  { id: 'hd04', intent: 'habit_delete', language: 'uk', construction: 'hd.noise.named', transcript: 'більше не треба — видали звичку вода', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Вод' } },
  { id: 'hd05', intent: 'habit_delete', language: 'uk', construction: 'hd.unknown.clarify', transcript: 'видали звичку плавання', expect: { understanding: 'needs_clarification' } },
  { id: 'hd06', intent: 'habit_delete', language: 'uk', construction: 'hd.task.trap.clarify', transcript: 'видали звичку звіт', expect: { understanding: 'needs_clarification' } },
  { id: 'hd07', intent: 'habit_delete', language: 'uk', construction: 'hd.remove.synonym', transcript: 'прибери звичку розтяжка', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Розтяж' } },
  { id: 'hd08', intent: 'habit_delete', language: 'uk', construction: 'hd.please.named', transcript: 'будь ласка видали звичку вода', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Вод' } },
  { id: 'hd09', intent: 'habit_delete', language: 'uk', construction: 'hd.mind.change.target', transcript: 'видали звичку розтяжка… ні, воду', expect: { understanding: 'complete', commandKind: 'habit_delete', habitNameIncludes: 'Вод' } },
  { id: 'hd10', intent: 'habit_delete', language: 'uk', construction: 'hd.this.habit.clarify', transcript: 'видали цю звичку', expect: { understanding: 'needs_clarification' } },

  // —— habit_uncheck ——
  { id: 'huk01', intent: 'habit_uncheck', language: 'uk', construction: 'huk.named.water', transcript: 'зняти відмітку зі звички вода', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Вод' } },
  { id: 'huk02', intent: 'habit_uncheck', language: 'uk', construction: 'huk.named.stretch', transcript: 'скасуй чек-ін розтяжка', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Розтяж' } },
  { id: 'huk03', intent: 'habit_uncheck', language: 'uk', construction: 'huk.bare.clarify', transcript: 'зняти відмітку зі звички', expect: { understanding: 'needs_clarification' } },
  { id: 'huk04', intent: 'habit_uncheck', language: 'uk', construction: 'huk.noise.named', transcript: 'ой помилково — зніми відмітку вода', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Вод' } },
  { id: 'huk05', intent: 'habit_uncheck', language: 'uk', construction: 'huk.unknown.clarify', transcript: 'зняти відмітку звички йога', expect: { understanding: 'needs_clarification' } },
  { id: 'huk06', intent: 'habit_uncheck', language: 'uk', construction: 'huk.uncheck.synonym', transcript: 'відміни виконання розтяжки', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Розтяж' } },
  { id: 'huk07', intent: 'habit_uncheck', language: 'uk', construction: 'huk.please.named', transcript: 'будь ласка зніми чек-ін вода', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Вод' } },
  { id: 'huk08', intent: 'habit_uncheck', language: 'uk', construction: 'huk.today.explicit', transcript: 'сьогодні зніми відмітку розтяжка', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Розтяж' } },
  { id: 'huk09', intent: 'habit_uncheck', language: 'uk', construction: 'huk.mind.change.target', transcript: 'зніми відмітку розтяжка… ні, вода', expect: { understanding: 'complete', commandKind: 'habit_uncheck', habitNameIncludes: 'Вод' } },
  { id: 'huk10', intent: 'habit_uncheck', language: 'uk', construction: 'huk.bare.uncheck.clarify', transcript: 'зніми відмітку', expect: { understanding: 'needs_clarification' } },

  // —— needs_clarification (router) ——
  { id: 'ncl01', intent: 'needs_clarification', language: 'uk', construction: 'ncl.garbage', transcript: 'ааа ммм', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl02', intent: 'needs_clarification', language: 'uk', construction: 'ncl.huh', transcript: 'що', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl03', intent: 'needs_clarification', language: 'uk', construction: 'ncl.ellipsis', transcript: '…', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl04', intent: 'needs_clarification', language: 'uk', construction: 'ncl.only.please', transcript: 'будь ласка', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl05', intent: 'needs_clarification', language: 'uk', construction: 'ncl.only.help', transcript: 'допоможи', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl06', intent: 'needs_clarification', language: 'uk', construction: 'ncl.noise.only', transcript: 'ну як би то…', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl07', intent: 'needs_clarification', language: 'uk', construction: 'ncl.incomplete.verb', transcript: 'треба', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl08', intent: 'needs_clarification', language: 'uk', construction: 'ncl.only.tomorrow', transcript: 'завтра', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl09', intent: 'needs_clarification', language: 'uk', construction: 'ncl.random.words', transcript: 'синій слон під столом', expect: { understanding: 'needs_clarification' } },
  { id: 'ncl10', intent: 'needs_clarification', language: 'uk', construction: 'ncl.half.thought', transcript: 'я хотів би може якщо', expect: { understanding: 'needs_clarification' } },
];

export function intentEvalBlockCount(
  scenarios: readonly IntentEvalScenario[] = INTENT_EVAL_SCENARIOS,
): number {
  return Math.max(1, Math.ceil(scenarios.length / INTENT_EVAL_BLOCK_SIZE));
}

export function selectIntentEvalBlock(
  which: number | 'latest',
  scenarios: readonly IntentEvalScenario[] = INTENT_EVAL_SCENARIOS,
): IntentEvalScenario[] {
  const count = intentEvalBlockCount(scenarios);
  const index = which === 'latest' ? count - 1 : which;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(
      `Intent-eval block ${String(which)} out of range (0–${count - 1}).`,
    );
  }
  const start = index * INTENT_EVAL_BLOCK_SIZE;
  return scenarios.slice(start, start + INTENT_EVAL_BLOCK_SIZE);
}

export function selectIntentEvalByIntent(
  intent: IntentEvalIntent,
): IntentEvalScenario[] {
  return INTENT_EVAL_SCENARIOS.filter((s) => s.intent === intent);
}
