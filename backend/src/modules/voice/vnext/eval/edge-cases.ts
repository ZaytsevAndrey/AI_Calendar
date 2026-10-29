import type { PlanDraft } from '../../voice-agent.types';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from '../contracts/types';
import type { EvidenceNeed } from '../evidence/evidence';
import type { EntityRecord } from '../reference/reference-resolver';
import type { VNextSession } from '../session/session';
import type { RubricExpectation } from './rubric';

export const FIXTURE_VERSION = '2026-10-27.1';
const NOW = '2026-10-18T06:00:00.000Z';
const TZ = 'Europe/Kyiv';
const USER = 'user-1';

export type EdgeCase = {
  id: string;
  category: string;
  rationale: string;
  transcript: string;
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  defaultDurationMinutes: number;
  language: 'uk' | 'en';
  entities: EntityRecord[];
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  evidenceNeed?: EvidenceNeed;
  sessionPatch?: Partial<VNextSession>;
  envelope: SemanticEnvelopeV1 | null;
  failureCode?: string;
  requiredReads: string[];
  clarificationNecessary: boolean;
  postApply: string;
  expect: RubricExpectation;
  fixtureVersion: typeof FIXTURE_VERSION;
};

function task(id: string, name: string, userId = USER, type: EntityRecord['type'] = 'task'): EntityRecord {
  return { id, userId, type, name, status: 'open' };
}

function src(transcript: string, text: string): SemanticOperationV1['source'] {
  const at = transcript.indexOf(text);
  if (at < 0) throw new Error(`${text} missing`);
  return { text, span: [at, at + text.length] };
}

function operation(
  transcript: string,
  text: string,
  fields: Omit<SemanticOperationV1, 'source'>,
): SemanticOperationV1 {
  return { ...fields, source: src(transcript, text) };
}

function envelope(transcript: string, operations: SemanticOperationV1[], extra: Partial<SemanticEnvelopeV1> = {}): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations, ...extra };
}

function base(partial: Omit<EdgeCase, 'nowIso' | 'timeZone' | 'wakeHm' | 'sleepHm' | 'language' | 'history' | 'fixtureVersion' | 'clarificationNecessary' | 'defaultDurationMinutes'> & { defaultDurationMinutes?: number; language?: 'uk' | 'en'; nowIso?: string; timeZone?: string }): EdgeCase {
  return {
    nowIso: partial.nowIso ?? NOW,
    timeZone: partial.timeZone ?? TZ,
    wakeHm: '08:00',
    sleepHm: '23:00',
    defaultDurationMinutes: partial.defaultDurationMinutes ?? 30,
    language: partial.language ?? 'uk',
    history: [],
    fixtureVersion: FIXTURE_VERSION,
    clarificationNecessary: partial.expect.outcome === 'clarify',
    ...partial,
  };
}

const reportTomorrow = 'Створи звіт на завтра. Ні, на п\'ятницю';
const cancelReminder = 'Додай нагадування про квитки. Ні, скасуй це';
const moveEvening = 'Перенеси його на вечір';
const reportHour = 'Додай звіт. Зроби його на годину';
const callAndMeeting = 'Створи дзвінок, а зустріч перенеси';
const taskAndRemind = 'Створи задачу й нагадай про неї завтра';
const inTwoHours = 'Через дві години зателефонувати';
const walkEvening = 'Прогулянка ввечері';
const meetingSpan = 'Зустріч із 7 до 9';
const windowSpan = 'Забрати посилку між 7 і 9';
const gapClock = 'Постав дзвінок на 02:30';
const foldClock = 'Постав дзвінок на 01:30';
const maria = 'Коли наступна зустріч із Марією?';
const gaps = 'Коли є вільна година завтра?';
const twoReports = 'Перенеси звіт на понеділок';
const deleteAll = 'Видали всі зустрічі';
const planWalk = 'Додай прогулянку на вечір';
const yes = 'Так';
const habit = 'Відміть звичку розтяжку';
const wholeDay = 'Завтра весь день відрядження';
const externalEdit = 'Перенеси політ';
const stale = 'Закрий задачу task-missing';
const week = 'Наступного тижня ретроспектива';
const morph = 'Перенеси звіту на понеділок';
const englishReport = 'Move the report to Friday';
const corrections = 'Створи нотатку на завтра. Ні, на п\'ятницю. Ні, на четвер';
const pills = 'Нагадуй про ліки щодня';
const allDayEvent = 'У неділю цілий день конференція';
const ignored = 'Купи хліб';
const cycleText = 'Створи альфу і бета залежить від альфи';
const seven = 'один два три чотири пять шість сім';

const reviewDraft: PlanDraft = {
  day: '2026-10-18',
  stage: 'review',
  interviewAsked: 1,
  items: [],
  revision: 1,
  nextNewId: 1,
  lastProposal: null,
};

export const EDGE_CASES: EdgeCase[] = [
  base({
    id: 'edge-correct-date',
    category: 'new-correction',
    rationale: 'A later named day replaces the earlier day on the same new object.',
    transcript: reportTomorrow,
    entities: [],
    requiredReads: [],
    postApply: 'One create on Friday. Tomorrow is not stored.',
    envelope: envelope(reportTomorrow, [
      operation(reportTomorrow, "на п'ятницю", {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-report' },
        changes: { title: 'Звіт' },
        constraints: [{ kind: 'weekday', weekday: 5, which: 'next' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-23', excludesDate: '2026-10-19' },
  }),
  base({
    id: 'edge-cancel-new',
    category: 'new-deletion',
    rationale: 'Canceling a new reminder in the same utterance leaves no write.',
    transcript: cancelReminder,
    entities: [],
    requiredReads: [],
    postApply: 'No reminder and no task.',
    envelope: envelope(cancelReminder, [
      operation(cancelReminder, 'Додай нагадування про квитки', {
        opId: 'op-1',
        action: 'remind',
        target: { kind: 'new', localId: 'local-tickets' },
        changes: { title: 'квитки', reminder: { op: 'create', name: 'квитки' } },
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 0, unit: 'day' }],
        dependsOn: [],
      }),
      operation(cancelReminder, 'скасуй це', {
        opId: 'op-2',
        action: 'cancel',
        target: { kind: 'operation_result', opId: 'op-1' },
        changes: {},
        constraints: [],
        dependsOn: ['op-1'],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'answer', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-pronoun-ambiguous',
    category: 'pronoun',
    rationale: 'A pronoun with two open tasks asks which one and keeps evening unresolved.',
    transcript: moveEvening,
    entities: [task('task-a', 'Звіт'), task('task-b', 'Нарада')],
    requiredReads: [],
    postApply: 'No move until the target is chosen. Evening is not a clock.',
    envelope: envelope(moveEvening, [
      operation(moveEvening, 'Перенеси його на вечір', {
        opId: 'op-1',
        action: 'move',
        target: { kind: 'unresolved', phrase: 'його' },
        changes: {},
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, forbidClock: '18:00', blockedIncludes: 'unresolved', questionIncludes: ['Звіт', 'Нарада'] },
  }),
  base({
    id: 'edge-pronoun-clear',
    category: 'pronoun',
    rationale: 'A pronoun whose only antecedent is the new object folds the duration into that create.',
    transcript: reportHour,
    entities: [],
    requiredReads: [],
    postApply: 'One create named Звіт lasting 60 minutes.',
    envelope: envelope(reportHour, [
      operation(reportHour, 'Додай звіт', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-report' },
        changes: { title: 'Звіт' },
        constraints: [],
        dependsOn: [],
      }),
      operation(reportHour, 'Зроби його на годину', {
        opId: 'op-2',
        action: 'update',
        target: { kind: 'operation_result', opId: 'op-1' },
        changes: {},
        constraints: [{ kind: 'duration', minutes: 60 }],
        dependsOn: ['op-1'],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, durationMinutes: 60 },
  }),
  base({
    id: 'edge-independent-held',
    category: 'partial-ambiguity',
    rationale: 'A clear create is held while an unnamed meeting is a question. Nothing is applied.',
    transcript: callAndMeeting,
    entities: [task('task-a', 'Звіт'), task('task-b', 'Нарада')],
    requiredReads: [],
    postApply: 'No write until the meeting target is answered.',
    envelope: envelope(callAndMeeting, [
      operation(callAndMeeting, 'Створи дзвінок', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'дзвінок' },
        constraints: [],
        dependsOn: [],
      }),
      operation(callAndMeeting, 'зустріч перенеси', {
        opId: 'op-2',
        action: 'move',
        target: { kind: 'unresolved', phrase: 'зустріч' },
        changes: {},
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, heldCount: 1 },
  }),
  base({
    id: 'edge-dependency-remind',
    category: 'dependency',
    rationale: 'The reminder refers to the new object and does not receive a database id.',
    transcript: taskAndRemind,
    entities: [],
    requiredReads: [],
    postApply: 'Create plus reminder sharing the spoken name. No invented task id.',
    envelope: envelope(taskAndRemind, [
      operation(taskAndRemind, 'Створи задачу', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-task' },
        changes: { title: 'задача' },
        constraints: [],
        dependsOn: [],
      }),
      operation(taskAndRemind, 'нагадай про неї завтра', {
        opId: 'op-2',
        action: 'remind',
        target: { kind: 'operation_result', opId: 'op-1' },
        changes: { reminder: { op: 'create', name: 'задача' } },
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 1, unit: 'day' }],
        dependsOn: ['op-1'],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 2, includesDate: '2026-10-19', forbidClock: 'task-zvit' },
  }),
  base({
    id: 'edge-relative-hours',
    category: 'relative-time',
    rationale: 'Two hours after the frozen clock, not a model timestamp.',
    transcript: inTwoHours,
    entities: [],
    requiredReads: [],
    postApply: 'One call at 2026-10-18T08:00:00.000Z.',
    envelope: envelope(inTwoHours, [
      operation(inTwoHours, 'Через дві години зателефонувати', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'зателефонувати' },
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 2, unit: 'hour' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-18T08:00:00.000Z' },
  }),
  base({
    id: 'edge-qualitative-evening',
    category: 'qualitative-time',
    rationale: 'Evening stays a label. 18:00 is not invented.',
    transcript: walkEvening,
    entities: [],
    requiredReads: [],
    postApply: 'Unscheduled walk. Evening remains a constraint.',
    envelope: envelope(walkEvening, [
      operation(walkEvening, 'Прогулянка ввечері', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-walk' },
        changes: { title: 'Прогулянка' },
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, unscheduled: true, forbidClock: '18:00', preservedLabel: 'evening' },
  }),
  base({
    id: 'edge-event-span',
    category: 'time-span',
    rationale: 'A meeting span whose start clock has already passed asks for the date. It is not stored.',
    transcript: meetingSpan,
    entities: [],
    requiredReads: [],
    postApply: 'No meeting until the date is named.',
    envelope: envelope(meetingSpan, [
      operation(meetingSpan, 'Зустріч із 7 до 9', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-meet' },
        changes: { title: 'Зустріч', spanRole: 'event' },
        constraints: [
          { kind: 'clock', value: '07:00', role: 'start' },
          { kind: 'clock', value: '09:00', role: 'end' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'past', questionIncludes: ['день'] },
  }),
  base({
    id: 'edge-window-span',
    category: 'time-span',
    rationale: 'A window whose earliest clock has already passed asks for the date. It is not stored.',
    transcript: windowSpan,
    entities: [],
    requiredReads: [],
    postApply: 'No window until the date is named.',
    envelope: envelope(windowSpan, [
      operation(windowSpan, 'Забрати посилку між 7 і 9', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-parcel' },
        changes: { title: 'посилку', spanRole: 'window' },
        constraints: [
          { kind: 'clock', value: '07:00', role: 'earliest' },
          { kind: 'clock', value: '09:00', role: 'deadline' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'past', questionIncludes: ['день'] },
  }),
  base({
    id: 'edge-dst-gap',
    category: 'dst',
    rationale: 'A clock without a date that is already past asks for the day. It is not stored and it is not rolled forward.',
    transcript: gapClock,
    nowIso: '2026-03-08T06:00:00.000Z',
    timeZone: 'America/New_York',
    language: 'en',
    entities: [],
    requiredReads: [],
    postApply: 'No task.',
    envelope: envelope(gapClock, [
      operation(gapClock, 'Постав дзвінок на 02:30', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'дзвінок' },
        constraints: [
          { kind: 'clock', value: '02:30', role: 'start' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'past', questionIncludes: ['date'] },
  }),
  base({
    id: 'edge-dst-fold',
    category: 'dst',
    rationale: 'A clock without a date that is already past asks for the day. It is not stored and it does not pick an offset.',
    transcript: foldClock,
    nowIso: '2026-11-01T05:00:00.000Z',
    timeZone: 'America/New_York',
    language: 'en',
    entities: [],
    requiredReads: [],
    postApply: 'No task until the occurrence is chosen.',
    envelope: envelope(foldClock, [
      operation(foldClock, 'Постав дзвінок на 01:30', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'дзвінок' },
        constraints: [
          { kind: 'clock', value: '01:30', role: 'start' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'past', questionIncludes: ['date'] },
  }),
  base({
    id: 'edge-dst-gap-dated',
    category: 'dst',
    rationale: 'An explicit spring-forward date is a gap. The resolver does not pick an offset or another day.',
    transcript: 'Постав дзвінок на 2026-03-08 о 02:30',
    nowIso: '2026-03-08T06:00:00.000Z',
    timeZone: 'America/New_York',
    language: 'en',
    entities: [],
    requiredReads: [],
    postApply: 'No task.',
    envelope: envelope('Постав дзвінок на 2026-03-08 о 02:30', [
      operation('Постав дзвінок на 2026-03-08 о 02:30', 'Постав дзвінок на 2026-03-08 о 02:30', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'дзвінок' },
        constraints: [
          { kind: 'date', value: '2026-03-08', precision: 'day' },
          { kind: 'clock', value: '02:30', role: 'start' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'gap' },
  }),
  base({
    id: 'edge-dst-fold-dated',
    category: 'dst',
    rationale: 'An explicit fall-back date asks which occurrence and does not pick an offset.',
    transcript: 'Постав дзвінок на 2026-11-01 о 01:30',
    nowIso: '2026-11-01T05:00:00.000Z',
    timeZone: 'America/New_York',
    language: 'en',
    entities: [],
    requiredReads: [],
    postApply: 'No task until the occurrence is chosen.',
    envelope: envelope('Постав дзвінок на 2026-11-01 о 01:30', [
      operation('Постав дзвінок на 2026-11-01 о 01:30', 'Постав дзвінок на 2026-11-01 о 01:30', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-call' },
        changes: { title: 'дзвінок' },
        constraints: [
          { kind: 'date', value: '2026-11-01', precision: 'day' },
          { kind: 'clock', value: '01:30', role: 'start' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'fold' },
  }),
  base({
    id: 'edge-calendar-search',
    category: 'read-coverage',
    rationale: 'A later meeting is not answered from a today-only agenda.',
    transcript: maria,
    entities: [task('ext-maria', 'Марія', USER, 'external_event')],
    requiredReads: ['get_day_agenda'],
    evidenceNeed: { scope: 'week' },
    postApply: 'No absence claim.',
    envelope: {
      version: '1',
      kind: 'answer',
      operations: [],
      answer: { text: 'Сьогодні зустрічі немає.', evidenceRefs: ['r1'] },
    },
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0, blockedIncludes: 'today_only' },
  }),
  base({
    id: 'edge-tool-timeout',
    category: 'tool-failure',
    rationale: 'A timed-out gap search is not an empty gap.',
    transcript: gaps,
    entities: [],
    requiredReads: ['find_free_gaps'],
    postApply: 'No gap is stated.',
    envelope: {
      version: '1',
      kind: 'answer',
      operations: [],
      answer: { text: 'Є вікно о 10.', evidenceRefs: ['r1'] },
    },
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0, blockedIncludes: 'tool_error', forbidClock: '10' },
  }),
  base({
    id: 'edge-two-reports',
    category: 'existing-task',
    rationale: 'Two open tasks with the same title are not an arbitrary choice.',
    transcript: twoReports,
    entities: [task('task-1', 'Звіт'), task('task-2', 'Звіт')],
    requiredReads: [],
    postApply: 'No move.',
    envelope: envelope(twoReports, [
      operation(twoReports, 'Перенеси звіт на понеділок', {
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'Звіт' },
        changes: {},
        constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'ambiguous', questionIncludes: ['Звіт'] },
  }),
  base({
    id: 'edge-delete-all',
    category: 'destructive',
    rationale: 'A bulk delete without one settled target is not previewed as a write.',
    transcript: deleteAll,
    entities: [task('task-a', 'Нарада'), task('task-b', 'Звіт')],
    requiredReads: [],
    postApply: 'No deletion.',
    envelope: envelope(deleteAll, [
      operation(deleteAll, 'Видали всі зустрічі', {
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'unresolved', phrase: 'всі зустрічі' },
        changes: {},
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-dayplan-evening',
    category: 'day-plan',
    rationale: 'An evening add during review keeps the label and does not store 18:00.',
    transcript: planWalk,
    entities: [],
    requiredReads: [],
    sessionPatch: { planDraft: reviewDraft },
    postApply: 'Draft item without a preferred clock. Apply would create it unscheduled.',
    envelope: {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: {
        phase: 'edit',
        day: '2026-10-18',
        edits: [{ op: 'add_task', name: 'Прогулянка', durationMinutes: 30, preferredHm: '18:00', earliestHm: null, deadlineHm: null, qualitative: 'evening' }],
      },
    },
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 0, forbidClock: '18:00', preservedLabel: 'evening' },
  }),
  base({
    id: 'edge-confirm-yes',
    category: 'confirmation',
    rationale: 'Spoken yes applies only a pending preview, still without a server write.',
    transcript: yes,
    entities: [],
    requiredReads: [],
    sessionPatch: {
      pendingIntents: [{ type: 'create', summary: 'хліб', task: { name: 'хліб', isUnscheduled: true } }],
      pendingSummary: 'хліб',
    },
    postApply: 'Client would create хліб. Server write count stays zero.',
    envelope: { version: '1', kind: 'control', operations: [], control: 'confirm_pending' },
    expect: { adjudication: 'authored', outcome: 'act', serverWrites: 0, intentCount: 1 },
  }),
  base({
    id: 'edge-confirm-none',
    category: 'confirmation',
    rationale: 'Spoken yes with nothing pending does not apply.',
    transcript: yes,
    entities: [],
    requiredReads: [],
    postApply: 'No write.',
    envelope: { version: '1', kind: 'control', operations: [], control: 'confirm_pending' },
    expect: { adjudication: 'authored', outcome: 'answer', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-cross-user',
    category: 'cross-user',
    rationale: 'Another user id is rejected and not written.',
    transcript: 'Видали звіт',
    entities: [task('task-foreign', 'Звіт', 'user-2')],
    requiredReads: [],
    postApply: 'No write.',
    envelope: envelope('Видали звіт', [
      operation('Видали звіт', 'Видали звіт', {
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-foreign' },
        changes: {},
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'cross_user', questionIncludes: ['немає'] },
  }),
  base({
    id: 'edge-repeat-confirm',
    category: 'confirmation',
    rationale: 'The second confirm finds nothing pending.',
    transcript: yes,
    entities: [],
    requiredReads: [],
    postApply: 'No second write.',
    envelope: { version: '1', kind: 'control', operations: [], control: 'confirm_pending' },
    expect: { adjudication: 'authored', outcome: 'answer', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-morphology',
    category: 'ukrainian-morphology',
    rationale: 'One inflected match previews the stored task. Confirmation is still required.',
    transcript: morph,
    entities: [task('task-zvit', 'Звіт')],
    requiredReads: [],
    postApply: 'No move.',
    envelope: envelope(morph, [
      operation(morph, 'Перенеси звіту на понеділок', {
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'звіту' },
        changes: {},
        constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-19' },
  }),
  base({
    id: 'edge-multilingual',
    category: 'multilingual',
    rationale: 'One translated match previews the stored Ukrainian task. The model id is not the authority.',
    transcript: englishReport,
    language: 'en',
    entities: [task('task-zvit', 'Звіт')],
    requiredReads: [],
    postApply: 'No move.',
    envelope: envelope(englishReport, [
      operation(englishReport, 'Move the report to Friday', {
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'report' },
        changes: {},
        constraints: [{ kind: 'weekday', weekday: 5, which: 'next' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-23' },
  }),
  base({
    id: 'edge-repeated-correction',
    category: 'correction',
    rationale: 'The last explicit day wins. Earlier days are not stored.',
    transcript: corrections,
    entities: [],
    requiredReads: [],
    postApply: 'One note on Thursday.',
    envelope: envelope(corrections, [
      operation(corrections, 'на четвер', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-note' },
        changes: { title: 'нотатку' },
        constraints: [{ kind: 'weekday', weekday: 4, which: 'next' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-22', excludesDate: '2026-10-23' },
  }),
  base({
    id: 'edge-recurring-reminder',
    category: 'recurrence',
    rationale: 'A daily reminder without a start date asks which date it begins. The pattern is kept and the date is not invented.',
    transcript: pills,
    entities: [],
    requiredReads: [],
    postApply: 'No reminder until the start date is named.',
    envelope: envelope(pills, [
      operation(pills, 'Нагадуй про ліки щодня', {
        opId: 'op-1',
        action: 'remind',
        target: { kind: 'new', localId: 'local-pills' },
        changes: { reminder: { op: 'create', name: 'ліки', notificationTime: '08:00', recurrencePattern: 'DAILY' } },
        constraints: [
          { kind: 'recurrence', expression: 'daily' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'missing_day', questionIncludes: ['якого дня'] },
  }),
  base({
    id: 'edge-habit-unsupported',
    category: 'habit',
    rationale: 'Habit check-in is outside the contract and is refused.',
    transcript: habit,
    entities: [],
    requiredReads: [],
    postApply: 'No habit write.',
    envelope: null,
    failureCode: 'invalid_model_output',
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-all-day',
    category: 'all-day',
    rationale: 'A whole-day event is a create from wake to sleep, not a day plan.',
    transcript: wholeDay,
    entities: [],
    requiredReads: [],
    postApply: 'One event covering wake to sleep tomorrow.',
    envelope: envelope(wholeDay, [
      operation(wholeDay, 'Завтра весь день відрядження', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-trip' },
        changes: { title: 'відрядження', spanRole: 'event' },
        constraints: [
          { kind: 'relative_time', anchor: 'now', direction: 'after', amount: 1, unit: 'day' },
          { kind: 'day_bound', edge: 'wake', role: 'earliest' },
          { kind: 'day_bound', edge: 'sleep', role: 'deadline' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-19' },
  }),
  base({
    id: 'edge-external-readonly',
    category: 'external-calendar',
    rationale: 'An external event is not edited.',
    transcript: externalEdit,
    entities: [task('ext-flight', 'політ', USER, 'external_event')],
    requiredReads: [],
    postApply: 'No edit.',
    envelope: envelope(externalEdit, [
      operation(externalEdit, 'Перенеси політ', {
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'політ' },
        changes: {},
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 1, unit: 'day' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'external_readonly' },
  }),
  base({
    id: 'edge-stale-id',
    category: 'stale-snapshot',
    rationale: 'An id that is not in the authorized snapshot is forged.',
    transcript: stale,
    entities: [task('task-zvit', 'Звіт')],
    requiredReads: [],
    postApply: 'No write.',
    envelope: envelope(stale, [
      operation(stale, 'Закрий задачу task-missing', {
        opId: 'op-1',
        action: 'complete',
        target: { kind: 'existing', proposedId: 'task-missing' },
        changes: {},
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'forged', questionIncludes: ['не знайшов'] },
  }),
  base({
    id: 'edge-invalid-date',
    category: 'invalid-date',
    rationale: '31 February is rejected and is not rolled into March.',
    transcript: 'Постав на 2026-02-31',
    entities: [],
    requiredReads: [],
    postApply: 'No write.',
    envelope: null,
    failureCode: 'invalid_model_output',
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-week-only',
    category: 'week-reference',
    rationale: 'A named week does not pick a weekday.',
    transcript: week,
    entities: [],
    requiredReads: [],
    postApply: 'No create.',
    envelope: envelope(week, [
      operation(week, 'Наступного тижня ретроспектива', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-retro' },
        changes: { title: 'ретроспектива' },
        constraints: [{ kind: 'date', value: '', precision: 'week' }],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, blockedIncludes: 'needs_day', questionIncludes: ['день'] },
  }),
  base({
    id: 'edge-settings-duration',
    category: 'settings-default',
    rationale: 'A missing length uses the configured default, not a hard-coded 30.',
    transcript: 'Додай лист',
    entities: [],
    defaultDurationMinutes: 45,
    requiredReads: [],
    postApply: 'Unscheduled letter of 45 minutes.',
    envelope: envelope('Додай лист', [
      operation('Додай лист', 'Додай лист', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-letter' },
        changes: { title: 'лист' },
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, durationMinutes: 45, unscheduled: true },
  }),
  base({
    id: 'edge-ignored-question',
    category: 'clarification-lifecycle',
    rationale: 'A new command does not replace an open clarification.',
    transcript: ignored,
    entities: [],
    requiredReads: [],
    sessionPatch: { openQuestion: 'Яку задачу?' },
    postApply: 'The stored question remains. Bread is not created.',
    envelope: envelope(ignored, [
      operation(ignored, 'Купи хліб', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-bread' },
        changes: { title: 'хліб' },
        constraints: [],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'clarify', serverWrites: 0, intentCount: 0, heldCount: 0 },
  }),
  base({
    id: 'edge-interrupt-plan',
    category: 'day-plan',
    rationale: 'Cancel drops the open draft and does not write it.',
    transcript: 'Скасуй',
    entities: [],
    requiredReads: [],
    sessionPatch: { planDraft: reviewDraft },
    postApply: 'No plan and no tasks.',
    envelope: { version: '1', kind: 'control', operations: [], control: 'cancel_pending' },
    expect: { adjudication: 'authored', outcome: 'answer', serverWrites: 0, intentCount: 0 },
  }),
  base({
    id: 'edge-cycle',
    category: 'dependency',
    rationale: 'A dependency cycle fails closed.',
    transcript: cycleText,
    entities: [],
    requiredReads: [],
    postApply: 'No write.',
    envelope: envelope(cycleText, [
      operation(cycleText, 'Створи альфу', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-a' },
        changes: { title: 'альфа' },
        constraints: [],
        dependsOn: ['op-2'],
      }),
      operation(cycleText, 'бета залежить від альфи', {
        opId: 'op-2',
        action: 'create',
        target: { kind: 'new', localId: 'local-b' },
        changes: { title: 'бета' },
        constraints: [],
        dependsOn: ['op-1'],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0, blockedIncludes: 'cycle' },
  }),
  base({
    id: 'edge-segment-limit',
    category: 'limit',
    rationale: 'More than six writes apply nothing.',
    transcript: seven,
    entities: [],
    requiredReads: [],
    postApply: 'No write.',
    envelope: envelope(
      seven,
      ['один', 'два', 'три', 'чотири', 'пять', 'шість', 'сім'].map((word, index) =>
        operation(seven, word, {
          opId: `op-${index + 1}`,
          action: 'create',
          target: { kind: 'new', localId: `local-${index}` },
          changes: { title: word },
          constraints: [],
          dependsOn: [],
        }),
      ),
    ),
    expect: { adjudication: 'authored', outcome: 'refuse', serverWrites: 0, intentCount: 0, blockedIncludes: 'segment_limit' },
  }),
  base({
    id: 'edge-sunday-conference',
    category: 'all-day',
    rationale: 'Another whole-day paraphrase still does not become a day plan.',
    transcript: allDayEvent,
    entities: [],
    requiredReads: [],
    postApply: 'One create on Sunday, not a plan draft.',
    envelope: envelope(allDayEvent, [
      operation(allDayEvent, 'У неділю цілий день конференція', {
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-conference' },
        changes: { title: 'конференція', spanRole: 'event' },
        constraints: [
          { kind: 'weekday', weekday: 0, which: 'next' },
          { kind: 'day_bound', edge: 'wake', role: 'earliest' },
          { kind: 'day_bound', edge: 'sleep', role: 'deadline' },
        ],
        dependsOn: [],
      }),
    ]),
    expect: { adjudication: 'authored', outcome: 'confirm', serverWrites: 0, intentCount: 1, includesDate: '2026-10-25' },
  }),
];
