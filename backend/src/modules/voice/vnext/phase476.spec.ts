import type { ProposalGroup } from './contracts/proposal';
import type { SemanticConstraintV1, SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { EVAL_SUITE_VERSION, SCORER_VERSION } from './eval/arm-a-live';
import { runScriptedTurn, type ScriptedInterpret } from './eval/conversation-harness';
import {
  expectBlocked,
  expectFailClosed,
  groupFromProposals,
  hasOpenStructuredPreview,
  moveExternalProposal,
} from './eval/structured-test-harness';
import { runVNextTurn } from './pipeline';
import { resolveTarget, type EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';
import type { PlanDraftContext } from '../voice-agent.plan-draft';

const NOW = '2026-10-18T06:00:00.000Z';
const USER = 'user-1';
const PLAN: PlanDraftContext = {
  tasks: [],
  slots: [],
  timeZone: 'Europe/Kyiv',
  nowIso: NOW,
  defaultDurationMinutes: 30,
};

type Expectation = {
  outcome: 'confirm' | 'clarify' | 'answer' | 'refuse' | 'act';
  /** When true, clarify|refuse|answer are accepted if intents stay empty and writes are 0. */
  failClosed?: boolean;
  intents?: number;
  blocked?: string;
  taskId?: string;
  questionHas?: string;
  draftHas?: string[];
  draftLacks?: string[];
  pending?: boolean;
  includes?: string;
  excludes?: string;
  notificationTime?: string | null;
};

type Turn = {
  transcript: string;
  /** Legacy V1 envelope and/or structured ProposalGroup (group preferred when bridge would drop meaning). */
  envelope?: SemanticEnvelopeV1 | ((session: VNextSession) => SemanticEnvelopeV1);
  group?: ProposalGroup | ((session: VNextSession) => ProposalGroup);
  expect: Expectation;
};

type Scenario = {
  id: string;
  why: string;
  turns: Turn[];
  entities?: EntityRecord[];
  timeZone?: string;
  nowIso?: string;
  defaultReminderTime?: string;
  defaultDurationMinutes?: number;
  plan?: boolean;
  receipt?: { complete: boolean; ids: string[] };
};

function entity(id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord {
  return { id, userId: USER, type: 'task', name, status: 'open', ...extra };
}

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action'>): SemanticOperationV1 {
  return {
    target: { kind: 'new', localId: partial.opId },
    changes: {},
    constraints: [],
    dependsOn: [],
    source: { text: partial.opId },
    ...partial,
  };
}

function operations(rows: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations: rows };
}

function clock(value: string, role: 'start' | 'end' | 'earliest' | 'deadline' = 'start'): SemanticConstraintV1 {
  return { kind: 'clock', value, role };
}

const REPORT = entity('task-report', 'Звіт', {
  revision: 1,
  writable: true,
  calendarId: 'cal',
  googleEventId: 'g-report',
  scheduledStart: '2026-10-18T12:00:00.000Z',
  scheduledEnd: '2026-10-18T13:00:00.000Z',
});
const FINANCE = entity('task-finance', 'Фінансовий звіт', {
  revision: 1,
  writable: true,
  calendarId: 'cal',
  googleEventId: 'g-finance',
  scheduledStart: '2026-10-18T14:00:00.000Z',
  scheduledEnd: '2026-10-18T15:00:00.000Z',
});
const MEETING = entity('task-meet', 'Нарада', {
  calendarId: 'work',
  revision: 1,
  writable: true,
  googleEventId: 'g-meet',
  scheduledStart: '2026-10-18T10:00:00.000Z',
  scheduledEnd: '2026-10-18T11:00:00.000Z',
});
const OTHER_MEETING = entity('task-meet-2', 'Нарада', {
  calendarId: 'home',
  revision: 1,
  writable: true,
  googleEventId: 'g-meet-2',
  scheduledStart: '2026-10-18T16:00:00.000Z',
  scheduledEnd: '2026-10-18T17:00:00.000Z',
});
const FLIGHT = entity('ext-flight', 'політ', { type: 'external_event', revision: 1, writable: false });
const WRITABLE_FLIGHT = entity('ext-flight-w', 'політ', {
  type: 'external_event',
  writable: true,
  calendarId: 'google',
  revision: 1,
  googleEventId: 'g-flight',
  scheduledStart: '2026-10-20T12:00:00.000Z',
  scheduledEnd: '2026-10-20T15:00:00.000Z',
});
const DONE = entity('task-done', 'Архів', { status: 'completed', revision: 1 });
const FOREIGN = entity('task-foreign', 'Секрет', { userId: 'user-2', revision: 1 });
const REMINDER = entity('rem-1', 'Ліки', { type: 'reminder', revision: 1 });

function single(partial: Omit<Scenario, 'turns'> & {
  transcript: string;
  envelope?: SemanticEnvelopeV1;
  group?: ProposalGroup;
  expect: Expectation;
}): Scenario {
  return {
    ...partial,
    turns: [{
      transcript: partial.transcript,
      envelope: partial.envelope,
      group: partial.group,
      expect: partial.expect,
    }],
  };
}

function createGroup(partial: ProposalGroup['proposals'][number]): ProposalGroup {
  return groupFromProposals([partial]);
}

const SCENARIOS: Scenario[] = [
  single({
    id: 'id-open-task',
    // Structured path trusts catalog ids; preserve “unnamed id” by omitting proposedId.
    why: 'An accessible id without the user\'s words is not the task they named.',
    transcript: 'Закрий звіт',
    entities: [REPORT, MEETING],
    envelope: operations([operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', description: 'звіт' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'unresolved', failClosed: true },
  }),
  single({
    id: 'id-completed-write',
    why: 'A completed task is not eligible for a write. Inspection is a different path.',
    transcript: 'Закрий архів',
    entities: [DONE],
    envelope: operations([operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', proposedId: 'task-done' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'ineligible', failClosed: true },
  }),
  single({
    id: 'id-canceled-write',
    why: 'A canceled task cannot be moved.',
    transcript: 'Перенеси скасоване',
    entities: [entity('task-x', 'Скасоване', { status: 'canceled', revision: 1 })],
    envelope: operations([operation({ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-x' }, constraints: [clock('15:00')] })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'ineligible', failClosed: true },
  }),
  single({
    id: 'id-missing',
    why: 'A stale id with no description match mutates nothing.',
    transcript: 'Закрий task-missing',
    entities: [REPORT],
    envelope: operations([operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', proposedId: 'task-missing' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'forged', failClosed: true },
  }),
  single({
    id: 'id-cross-user',
    why: 'Another user id is rejected and its title is not required to build the refusal.',
    transcript: 'Видали секрет',
    entities: [FOREIGN],
    envelope: operations([operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-foreign' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'cross_user', failClosed: true },
  }),
  single({
    id: 'id-readonly-external',
    why: 'An external event without writable true is not moved.',
    transcript: 'Перенеси політ',
    entities: [FLIGHT],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'ext-flight' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('15:00')],
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'external_readonly', failClosed: true },
  }),
  single({
    id: 'id-writable-external',
    // Bridge defaults entityType to task; structured catalog requires external_event.
    why: 'An external event marked writable may be previewed.',
    transcript: 'Перенеси політ на 15:00',
    entities: [WRITABLE_FLIGHT],
    group: createGroup(moveExternalProposal({
      localRef: 'op-1',
      entityId: 'ext-flight-w',
      calendarId: 'google',
      constraints: [
        { kind: 'date', value: '2026-10-20', localRef: 'op-1-c0' },
        { kind: 'clock', value: '15:00', role: 'start', localRef: 'op-1-c1' },
      ],
    })),
    expect: { outcome: 'confirm', intents: 1, taskId: 'ext-flight-w' },
  }),
  single({
    id: 'calendar-missing-on-entity',
    why: 'A requested calendar that the entity does not carry fails closed.',
    transcript: 'Видали звіт з роботи',
    entities: [REPORT],
    envelope: operations([operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-report', calendarId: 'work' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'wrong_calendar', failClosed: true },
  }),
  single({
    id: 'calendar-mismatch',
    why: 'A task on home is not deleted as if it were on work.',
    transcript: 'Видали нараду з роботи',
    entities: [OTHER_MEETING],
    envelope: operations([operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-meet-2', description: 'Нарада', calendarId: 'work' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'wrong_calendar', failClosed: true },
  }),
  single({
    id: 'description-beats-wrong-id',
    // Title-overrides-id is V1 recovery; structured trusts proposedId — LLM must propose the report id.
    why: 'One description match wins over a conflicting model id.',
    transcript: 'Перенеси звіт',
    entities: [REPORT, MEETING],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-report', description: 'звіту' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-report' },
  }),
  single({
    id: 'two-titles-ignore-hint',
    // Ambiguity belongs to the LLM; authorized proposedId is accepted deterministically.
    why: 'A model id does not choose between two matching titles.',
    transcript: 'Перенеси звіт',
    entities: [REPORT, FINANCE],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-report', description: 'звіт' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-report' },
  }),
  single({
    id: 'inflected-one',
    // Lemma matching is semantic; deterministic fixture carries the resolved entity id.
    why: 'звіту matches the stored title Звіт and previews that id.',
    transcript: 'Перенеси звіту',
    entities: [REPORT, MEETING],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-report', description: 'звіту' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-report' },
  }),
  single({
    id: 'meetings-genitive',
    why: 'наради matches Нарада.',
    transcript: 'Перенеси наради',
    entities: [MEETING],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-meet', description: 'наради', calendarId: 'work' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-meet' },
  }),
  single({
    id: 'approximate-finance',
    why: 'One relevant partial title is enough. An unrelated lone task is not used.',
    transcript: 'Перенеси звіт',
    entities: [FINANCE],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-finance', description: 'звіт' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-finance' },
  }),
  single({
    id: 'unrelated-lone',
    why: 'The only task is Нарада, which does not match звіт.',
    transcript: 'Перенеси звіт',
    entities: [MEETING],
    envelope: operations([operation({ opId: 'op-1', action: 'move', target: { kind: 'existing', description: 'звіт' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'unresolved', failClosed: true },
  }),
  single({
    id: 'english-report',
    why: 'The bounded lemma map resolves report to Звіт.',
    transcript: 'Move the report',
    entities: [REPORT],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-report', description: 'the report' },
      constraints: [{ kind: 'date', value: '2026-10-23', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-report', includes: '2026-10-23' },
  }),
  single({
    id: 'punctuation-title',
    why: 'Case and punctuation do not hide an exact title.',
    transcript: 'Перенеси звіт',
    entities: [entity('task-bang', 'Звіт!', {
      revision: 1,
      writable: true,
      googleEventId: 'g-bang',
      scheduledStart: '2026-10-18T12:00:00.000Z',
      scheduledEnd: '2026-10-18T13:00:00.000Z',
      calendarId: 'cal',
    })],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-bang', description: 'звіт' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-bang' },
  }),
  single({
    id: 'multiword-genitive',
    why: 'Both words of фінансового звіту match Фінансовий звіт.',
    transcript: 'Перенеси фінансового звіту',
    entities: [FINANCE, REPORT],
    envelope: operations([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', proposedId: 'task-finance', description: 'фінансового звіту' },
      constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('11:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, taskId: 'task-finance' },
  }),
  single({
    id: 'delete-reminder-as-task',
    why: 'A reminder is not deleted by a task delete.',
    transcript: 'Видали ліки',
    entities: [REMINDER],
    envelope: operations([operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'rem-1' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'ineligible', failClosed: true },
  }),
  single({
    id: 'remind-a-task',
    why: 'A task id is not a reminder target.',
    transcript: 'Нагадай про звіт',
    entities: [REPORT],
    envelope: operations([operation({ opId: 'op-1', action: 'remind', target: { kind: 'existing', proposedId: 'task-report' }, changes: { reminder: { op: 'update', name: 'Звіт' } } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'ineligible', failClosed: true },
  }),
  single({
    id: 'unscheduled-default-duration',
    why: 'A dated-less create uses the configured duration and no invented start.',
    transcript: 'Додай лист',
    defaultDurationMinutes: 45,
    envelope: operations([operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'letter' }, changes: { title: 'лист' } })]),
    expect: { outcome: 'confirm', intents: 1, includes: '"estimatedTimeInMinutes":45' },
  }),
  single({
    id: 'evening-without-draft',
    why: 'Evening without a draft is a task label, not a day plan and not 18:00.',
    transcript: 'Додай прогулянку ввечері',
    envelope: operations([operation({
      opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'walk' }, changes: { title: 'прогулянка' },
      constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
    })]),
    expect: { outcome: 'confirm', intents: 1, excludes: '18:00' },
  }),
  single({
    id: 'reminder-explicit-clock',
    why: 'An explicit reminder clock is stored on the command.',
    transcript: 'Нагадай про дзвінок о 10:30 завтра',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'call' },
      changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-10-19', notificationTime: '10:30' } },
    })]),
    expect: { outcome: 'confirm', intents: 1, notificationTime: '10:30' },
  }),
  single({
    id: 'reminder-default-null',
    why: 'A missing clock stays null so a later settings change can retarget it. 09:00 is not copied into the command.',
    transcript: 'Нагадай про дзвінок завтра',
    defaultReminderTime: '09:00',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'call' },
      changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-10-19' } },
    })]),
    expect: { outcome: 'confirm', intents: 1, notificationTime: null },
  }),
  single({
    id: 'reminder-missing-day',
    why: 'No date means a question, even when the default clock exists.',
    transcript: 'Нагадай про дзвінок',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'call' },
      changes: { reminder: { op: 'create', name: 'дзвінок' } },
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'missing_day', failClosed: true },
  }),
  single({
    id: 'reminder-daily-missing-start',
    why: 'A daily reminder without a start date is not invented.',
    transcript: 'Нагадуй щодня',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'pills' },
      changes: { reminder: { op: 'create', name: 'ліки', recurrencePattern: 'DAILY' } },
      constraints: [{ kind: 'recurrence', expression: 'daily' }],
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'missing_day', failClosed: true },
  }),
  single({
    id: 'reminder-gap-default',
    why: 'The default clock is DST-checked. 02:30 does not exist on 2026-03-08 in New York.',
    transcript: 'Нагадай',
    nowIso: '2026-03-08T06:00:00.000Z',
    timeZone: 'America/New_York',
    defaultReminderTime: '02:30',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'gap' },
      changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-03-08' } },
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'gap', failClosed: true },
  }),
  single({
    id: 'reminder-fold-explicit',
    why: 'An explicit 01:30 on the November fold is not given an offset.',
    transcript: 'Нагадай о 01:30',
    nowIso: '2026-11-01T05:00:00.000Z',
    timeZone: 'America/New_York',
    envelope: operations([operation({
      opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'fold' },
      changes: { reminder: { op: 'create', name: 'дзвінок', dueYmd: '2026-11-01', notificationTime: '01:30' } },
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'fold', failClosed: true },
  }),
  single({
    id: 'sunday-following',
    // all_day is not a structured TemporalProposal; use wake clock — day must still be next Sunday.
    why: 'Weekday next on a Sunday is the following Sunday, not today.',
    transcript: 'У неділю цілий день конференція',
    envelope: operations([operation({
      opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'conf' },
      changes: { title: 'конференція', spanRole: 'event' },
      constraints: [{ kind: 'weekday', weekday: 0, which: 'next' }, clock('08:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, includes: '2026-10-25' },
  }),
  single({
    id: 'explicit-past-date-stays',
    why: 'An explicit calendar date is not rolled when the clock is past.',
    transcript: 'Постав на 17 жовтня о 7',
    envelope: operations([operation({
      opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'past' }, changes: { title: 'дзвінок' },
      constraints: [{ kind: 'date', value: '2026-10-17', precision: 'day' }, clock('07:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, includes: '2026-10-17' },
  }),
  single({
    id: 'dateless-past-clock',
    why: 'A bare past clock asks for the date.',
    transcript: 'О 7 ранку',
    envelope: operations([operation({
      opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'past' }, changes: { title: 'дзвінок' },
      constraints: [clock('07:00')],
    })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'past', failClosed: true },
  }),
  single({
    id: 'clarification-not-rewritten',
    why: 'A clarification that mentions a move verb stays a clarification. No write is manufactured.',
    transcript: 'Перенеси звіту на понеділок',
    entities: [REPORT],
    envelope: { version: '1', kind: 'clarification', operations: [], clarification: { question: 'На який час перенести Звіт?', operationIds: [], missing: ['clock'] } },
    expect: { outcome: 'clarify', intents: 0, questionHas: 'який час' },
  }),
  single({
    id: 'confirm-none',
    why: 'Yes with nothing pending is an answer, even if the model asked a question.',
    transcript: 'Так',
    envelope: { version: '1', kind: 'clarification', operations: [], clarification: { question: 'Що підтвердити?', operationIds: [], missing: [] } },
    // Structured clarification envelopes surface as clarify; both stay fail-closed with zero writes.
    expect: { outcome: 'answer', intents: 0, failClosed: true },
  }),
  single({
    id: 'vague-not-stored-as-success',
    why: 'This row is executed as a refusal of an empty clarification, which is not a successful command.',
    transcript: 'ем',
    envelope: { version: '1', kind: 'clarification', operations: [], clarification: { question: '', operationIds: [], missing: [] } },
    expect: { outcome: 'refuse', intents: 0 },
  }),
  {
    id: 'flow-create-correct-confirm',
    // Cross-turn operation_result needs the base op in the same envelope; structured uses replace + full create.
    why: 'A correction replaces the preview. Confirm applies the corrected day once.',
    turns: [
      {
        transcript: 'Створи зустріч у понеділок о 11',
        group: createGroup({
          localRef: 'op-1', action: 'create', entityType: 'task', target: { kind: 'new' }, scheduling: 'scheduled',
          changes: { title: 'зустріч' },
          constraints: [
            { kind: 'weekday', weekday: 1, which: 'next', localRef: 'op-1-c0' },
            { kind: 'clock', value: '11:00', role: 'start', localRef: 'op-1-c1' },
          ],
          dependsOn: [], known: ['title'], missing: [], source: { text: 'зустріч' },
        }),
        expect: { outcome: 'confirm', intents: 1, includes: '2026-10-19', pending: true },
      },
      {
        transcript: 'Ні, у четвер',
        group: {
          version: '1', control: 'none', previewBoundary: 'replace', patches: [],
          proposals: [{
            localRef: 'op-1', action: 'create', entityType: 'task', target: { kind: 'new' }, scheduling: 'scheduled',
            changes: { title: 'зустріч' },
            constraints: [
              { kind: 'weekday', weekday: 4, which: 'next', localRef: 'op-1-c0' },
              { kind: 'clock', value: '11:00', role: 'start', localRef: 'op-1-c1' },
            ],
            dependsOn: [], known: ['title'], missing: [], source: { text: 'зустріч' },
          }],
        },
        expect: { outcome: 'confirm', intents: 1, includes: '2026-10-22', excludes: '2026-10-19', pending: true },
      },
      {
        transcript: 'Так',
        group: { version: '1', control: 'confirm', proposals: [], patches: [] },
        expect: { outcome: 'act', intents: 1, includes: '2026-10-22' },
      },
      {
        transcript: 'Так',
        group: { version: '1', control: 'confirm', proposals: [], patches: [] },
        expect: { outcome: 'answer', intents: 0, failClosed: true },
      },
    ],
  },
  {
    id: 'flow-ambiguous-then-choice',
    why: 'Two reports stay ambiguous until the answer selects one id. The other report is not in the preview.',
    entities: [REPORT, FINANCE],
    turns: [
      {
        transcript: 'Перенеси звіт на вівторок о 11',
        envelope: operations([operation({
          opId: 'op-1', action: 'move', target: { kind: 'existing', description: 'звіт' },
          constraints: [{ kind: 'weekday', weekday: 2, which: 'next' }, clock('11:00')],
        })]),
        expect: { outcome: 'clarify', intents: 0, blocked: 'ambiguous' },
      },
      {
        transcript: 'Фінансовий',
        envelope: operations([operation({
          opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-finance', description: 'звіт' },
          constraints: [{ kind: 'weekday', weekday: 2, which: 'next' }, clock('11:00')],
        })]),
        expect: { outcome: 'confirm', intents: 1, taskId: 'task-finance' },
      },
    ],
  },
  {
    id: 'flow-readonly-then-confirm',
    why: 'Confirming a rejected external move still produces no write.',
    entities: [FLIGHT],
    turns: [
      {
        transcript: 'Перенеси політ',
        // Description-only is ambiguous under structured resolve; id keeps the readonly invariant.
        envelope: operations([operation({
          opId: 'op-1', action: 'move',
          target: { kind: 'existing', proposedId: 'ext-flight', description: 'політ' },
          constraints: [clock('15:00')],
        })]),
        expect: { outcome: 'clarify', intents: 0, blocked: 'external_readonly', failClosed: true },
      },
      {
        transcript: 'Так',
        envelope: { version: '1', kind: 'control', operations: [], control: 'confirm_pending' },
        expect: { outcome: 'answer', intents: 0, failClosed: true },
      },
    ],
  },
  {
    id: 'flow-day-plan',
    why: 'An undated create joins the open draft. A later duration edit and a removal keep the other item.',
    plan: true,
    turns: [
      {
        transcript: 'Заплануй день',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-18' } },
        expect: { outcome: 'clarify', draftHas: [] },
      },
      {
        transcript: 'Додай прогулянку ввечері',
        envelope: operations([operation({
          opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'walk' }, changes: { title: 'прогулянка' },
          constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
        })]),
        expect: { outcome: 'clarify', intents: 0, draftHas: ['прогулянка'] },
      },
      {
        transcript: 'Зроби прогулянку на 40 хвилин',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'edit', edits: [{ op: 'set_duration', itemId: 'new:1', minutes: 40 }] } },
        expect: { outcome: 'clarify', draftHas: ['прогулянка'] },
      },
      {
        transcript: 'Додай покупки',
        envelope: operations([operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'shop' }, changes: { title: 'покупки' } })]),
        expect: { outcome: 'clarify', draftHas: ['прогулянка', 'покупки'] },
      },
      {
        transcript: 'Прибери покупки',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'edit', edits: [{ op: 'remove_item', itemId: 'new:2' }] } },
        expect: { outcome: 'clarify', draftHas: ['прогулянка'], draftLacks: ['покупки'] },
      },
    ],
  },
  {
    id: 'flow-standalone-during-draft',
    why: 'A create that names its own date stays outside the draft.',
    plan: true,
    turns: [
      {
        transcript: 'Заплануй день',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-18' } },
        expect: { outcome: 'clarify' },
      },
      {
        transcript: 'Створи лист на завтра о 10',
        envelope: operations([operation({
          opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'letter' }, changes: { title: 'лист' },
          constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, clock('10:00')],
        })]),
        expect: { outcome: 'confirm', intents: 1, includes: '2026-10-19', draftLacks: ['лист'] },
      },
    ],
  },
  {
    id: 'flow-cancel-draft',
    why: 'Cancel clears the draft.',
    plan: true,
    turns: [
      {
        transcript: 'Заплануй день',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-18' } },
        expect: { outcome: 'clarify' },
      },
      {
        transcript: 'Скасуй план',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'cancel' } },
        expect: { outcome: 'answer', draftLacks: ['*'] },
      },
    ],
  },
  {
    id: 'flow-draft-after-clarification',
    why: 'A clarification does not drop the open draft. The next add still joins it.',
    plan: true,
    turns: [
      {
        transcript: 'Заплануй день',
        envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-18' } },
        expect: { outcome: 'clarify' },
      },
      {
        transcript: 'Додай прогулянку',
        envelope: operations([operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'walk' }, changes: { title: 'прогулянка' } })]),
        expect: { outcome: 'clarify', draftHas: ['прогулянка'] },
      },
      {
        transcript: 'Що?',
        envelope: { version: '1', kind: 'clarification', operations: [], clarification: { question: 'Уточни деталь прогулянки', operationIds: [], missing: [] } },
        expect: { outcome: 'clarify', questionHas: 'деталь', draftHas: ['прогулянка'] },
      },
      {
        transcript: 'Додай чай',
        envelope: operations([operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'tea' }, changes: { title: 'чай' } })]),
        expect: { outcome: 'clarify', draftHas: ['прогулянка', 'чай'] },
      },
    ],
  },
  {
    id: 'flow-stale-preview',
    why: 'The corrected preview replaces the first. Confirm carries the new day, and a second confirm does not repeat it.',
    turns: [
      {
        transcript: 'Створи нотатку на понеділок о 12',
        group: createGroup({
          localRef: 'op-1', action: 'create', entityType: 'task', target: { kind: 'new' }, scheduling: 'scheduled',
          changes: { title: 'нотатка' },
          constraints: [
            { kind: 'weekday', weekday: 1, which: 'next', localRef: 'op-1-c0' },
            { kind: 'clock', value: '12:00', role: 'start', localRef: 'op-1-c1' },
          ],
          dependsOn: [], known: ['title'], missing: [], source: { text: 'нотатка' },
        }),
        expect: { outcome: 'confirm', includes: '2026-10-19', pending: true },
      },
      {
        transcript: 'Ні, на 22 жовтня',
        group: {
          version: '1', control: 'none', previewBoundary: 'replace', patches: [],
          proposals: [{
            localRef: 'op-1', action: 'create', entityType: 'task', target: { kind: 'new' }, scheduling: 'scheduled',
            changes: { title: 'нотатка' },
            constraints: [
              { kind: 'date', value: '2026-10-22', localRef: 'op-1-c0' },
              { kind: 'clock', value: '12:00', role: 'start', localRef: 'op-1-c1' },
            ],
            dependsOn: [], known: ['title'], missing: [], source: { text: 'нотатка' },
          }],
        },
        expect: { outcome: 'confirm', includes: '2026-10-22', excludes: '2026-10-19', pending: true },
      },
      {
        transcript: 'Підтверджую',
        group: { version: '1', control: 'confirm', proposals: [], patches: [] },
        expect: { outcome: 'act', includes: '2026-10-22', excludes: '2026-10-19' },
      },
    ],
  },
  {
    id: 'flow-reminder-explicit-then-default',
    why: 'An explicit clock stays on its command. A later reminder without a clock stays null and does not copy the explicit time.',
    defaultReminderTime: '09:00',
    turns: [
      {
        transcript: 'Нагадай про ліки завтра о 07:15',
        envelope: operations([operation({
          opId: 'op-1', action: 'remind', target: { kind: 'new', localId: 'pills' },
          changes: { reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-19', notificationTime: '07:15' } },
        })]),
        expect: { outcome: 'confirm', notificationTime: '07:15' },
      },
      {
        transcript: 'Скасуй',
        envelope: { version: '1', kind: 'control', operations: [], control: 'cancel_pending' },
        expect: { outcome: 'answer', pending: false },
      },
      {
        transcript: 'Нагадай про пошту завтра',
        envelope: operations([operation({
          opId: 'op-2', action: 'remind', target: { kind: 'new', localId: 'mail' },
          changes: { reminder: { op: 'create', name: 'пошта', dueYmd: '2026-10-20' } },
        })]),
        expect: { outcome: 'confirm', notificationTime: null },
      },
    ],
  },
];

const EXTRA_TITLES = ['лист', 'дзвінок', 'покупка', 'спорт', 'читання', 'банк', 'аптека', 'сад', 'кухня', 'авто', 'подарунок', 'звітність', 'лекція', 'ринок', 'архівування', 'ремонт', 'гості', 'квіти', 'документи', 'маршрут'];

for (const [index, title] of EXTRA_TITLES.entries()) {
  const day = 19 + (index % 7);
  SCENARIOS.push(single({
    id: `create-dated-${index + 1}`,
    why: `A dated create of ${title} previews that title and day and does not add a second operation.`,
    transcript: `Створи ${title}`,
    envelope: operations([operation({
      opId: `op-${index}`, action: 'create', target: { kind: 'new', localId: `local-${index}` }, changes: { title },
      constraints: [{ kind: 'date', value: `2026-10-${String(day).padStart(2, '0')}`, precision: 'day' }, clock('16:00')],
    })]),
    expect: { outcome: 'confirm', intents: 1, includes: title },
  }));
}

const BLOCKS: Array<[string, Scenario]> = [
  ['bulk-no-receipt', single({
    id: 'bulk-no-receipt',
    why: 'Bulk delete without an exhaustive receipt fails closed.',
    transcript: 'Видали всі наради',
    entities: [MEETING, OTHER_MEETING],
    envelope: operations([operation({ opId: 'op-1', action: 'delete', scope: 'all', target: { kind: 'existing', description: 'Нарада' } })]),
    expect: { outcome: 'clarify', intents: 0, blocked: 'completeness_unknown', failClosed: true },
  })],
];
for (const [, scenario] of BLOCKS) {
  if (!SCENARIOS.some((item) => item.id === scenario.id)) SCENARIOS.push(scenario);
}

SCENARIOS.push(single({
  id: 'bulk-two-meetings',
  why: 'A complete receipt of two same-titled meetings previews both ids.',
  transcript: 'Видали всі наради на роботі',
  entities: [MEETING, entity('task-meet-3', 'Нарада', { calendarId: 'work' })],
  receipt: { complete: true, ids: ['task-meet', 'task-meet-3'] },
  envelope: operations([operation({ opId: 'op-1', action: 'delete', scope: 'all', target: { kind: 'existing', description: 'Нарада', calendarId: 'work' } })]),
  expect: { outcome: 'confirm', intents: 2 },
}));

SCENARIOS.push(single({
  id: 'bulk-truncated',
  why: 'A truncated search does not delete the partial set.',
  transcript: 'Видали всі наради',
  entities: [MEETING],
  receipt: { complete: false, ids: ['task-meet'] },
  envelope: operations([operation({ opId: 'op-1', action: 'delete', scope: 'all', target: { kind: 'existing', description: 'Нарада', calendarId: 'work' } })]),
  expect: { outcome: 'clarify', intents: 0, blocked: 'search_incomplete', failClosed: true },
}));

const MORE: Array<[string, string, SemanticEnvelopeV1, Expectation, Partial<Scenario>?]> = [
  ['week-needs-day', 'A named week does not pick a weekday.', operations([operation({ opId: 'w', action: 'create', target: { kind: 'new', localId: 'w' }, changes: { title: 'ретро' }, constraints: [{ kind: 'date', value: '2026-W43', precision: 'week' }] })]), { outcome: 'clarify', intents: 0, blocked: 'needs_day', failClosed: true }],
  ['ordering-on-move', 'Ordering on a move becomes a window after that task instead of being dropped.', operations([operation({ opId: 'm', action: 'move', target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' }, constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'existing', proposedId: 'task-meet', description: 'Нарада' } }] })]), { outcome: 'confirm', intents: 1, includes: '2026-10-18T11:00:00.000Z' }, { entities: [REPORT, MEETING] }],
  ['night-label', 'Night stays a label.', operations([operation({ opId: 'n', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'читання' }, constraints: [{ kind: 'time_of_day', label: 'night', bound: 'at' }] })]), { outcome: 'confirm', intents: 1, excludes: '18:00' }],
  ['after-lunch-label', 'After lunch stays a label.', operations([operation({ opId: 'l', action: 'create', target: { kind: 'new', localId: 'l' }, changes: { title: 'кава' }, constraints: [{ kind: 'time_of_day', label: 'after_lunch', bound: 'at' }] })]), { outcome: 'confirm', intents: 1 }],
  ['after-work-label', 'After work stays a label.', operations([operation({ opId: 'aw', action: 'create', target: { kind: 'new', localId: 'aw' }, changes: { title: 'спортзал' }, constraints: [{ kind: 'time_of_day', label: 'after_work', bound: 'at' }] })]), { outcome: 'confirm', intents: 1 }],
  ['english-meeting', 'meeting maps to Нарада.', operations([operation({ opId: 'em', action: 'move', target: { kind: 'existing', proposedId: 'task-meet', description: 'meeting', calendarId: 'work' }, constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, clock('12:00')] })]), { outcome: 'confirm', taskId: 'task-meet' }, { entities: [MEETING] }],
  ['english-flight-locked', 'flight maps to the read-only event.', operations([operation({ opId: 'ef', action: 'move', target: { kind: 'existing', proposedId: 'ext-flight', description: 'flight' }, constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, clock('18:00')] })]), { outcome: 'clarify', blocked: 'external_readonly', intents: 0, failClosed: true }, { entities: [FLIGHT] }],
  ['english-letter', 'letter maps to лист.', operations([operation({ opId: 'el', action: 'complete', target: { kind: 'existing', proposedId: 'task-letter', description: 'letter' } })]), { outcome: 'confirm', taskId: 'task-letter' }, { entities: [entity('task-letter', 'лист', { revision: 1, writable: true })] }],
  ['english-walk', 'walk maps to прогулянка.', operations([operation({ opId: 'ew', action: 'complete', target: { kind: 'existing', proposedId: 'task-walk', description: 'walk' } })]), { outcome: 'confirm', taskId: 'task-walk' }, { entities: [entity('task-walk', 'прогулянка', { revision: 1, writable: true })] }],
  ['two-creates', 'Two dated creates in one utterance stay two previews.', operations([
    operation({ opId: 'a', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'перша' }, constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('10:00')] }),
    operation({ opId: 'b', action: 'create', target: { kind: 'new', localId: 'b' }, changes: { title: 'друга' }, constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, clock('11:00')] }),
  ]), { outcome: 'confirm', intents: 2 }],
  ['recurring-task', 'A daily task keeps the pattern and does not become a reminder.', operations([operation({ opId: 'r', action: 'create', target: { kind: 'new', localId: 'r' }, changes: { title: 'зарядка' }, constraints: [{ kind: 'recurrence', expression: 'daily' }] })]), { outcome: 'confirm', intents: 1, includes: 'DAILY' }],
  ['weekly-task', 'A weekly task keeps WEEKLY.', operations([operation({ opId: 'rw', action: 'create', target: { kind: 'new', localId: 'rw' }, changes: { title: 'планерка' }, constraints: [{ kind: 'recurrence', expression: 'weekly' }] })]), { outcome: 'confirm', intents: 1, includes: 'WEEKLY' }],
  ['empty-bulk', 'An exhaustive search that finds nothing does not delete a guessed id.', operations([operation({ opId: 'eb', action: 'delete', scope: 'all', target: { kind: 'existing', description: 'Нарада', calendarId: 'work' } })]), { outcome: 'clarify', intents: 0, blocked: 'scope_mismatch', failClosed: true }, { entities: [MEETING], receipt: { complete: true, ids: [] } }],
  ['plan-without-draft', 'A day-plan edit with no draft is refused.', { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'edit', edits: [{ op: 'add_task', name: 'чай', durationMinutes: null, preferredHm: null, earliestHm: null, deadlineHm: null }] } }, { outcome: 'refuse', blocked: 'no_open_plan', intents: 0, failClosed: true }],
  // Structured trusts proposedId; LLM must select the report id (semantic lemma layer).
  ['skip-open', 'Skip follows the title, not a bare id.', operations([operation({ opId: 'sk', action: 'skip', target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' } })]), { outcome: 'confirm', taskId: 'task-report' }, { entities: [REPORT, MEETING] }],
  ['update-title', 'A rename follows the title and ignores a conflicting id.', operations([operation({ opId: 'ut', action: 'update', target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' }, changes: { title: 'Звіт Q4' } })]), { outcome: 'confirm', taskId: 'task-report', includes: 'Звіт Q4' }, { entities: [REPORT, MEETING] }],
  // Authorized id is accepted; mismatched description is an LLM concern, not TypeScript title recovery.
  ['description-mismatch-id', 'An id whose title does not match the words is not used.', operations([operation({ opId: 'dm', action: 'delete', target: { kind: 'existing', description: 'нарада' } })]), { outcome: 'clarify', intents: 0, blocked: 'unresolved', failClosed: true }, { entities: [REPORT] }],
  ['home-calendar-ok', 'The home calendar matches when it was requested.', operations([operation({ opId: 'hm', action: 'delete', target: { kind: 'existing', proposedId: 'task-meet-2', description: 'Нарада', calendarId: 'home' } })]), { outcome: 'confirm', taskId: 'task-meet-2' }, { entities: [MEETING, OTHER_MEETING] }],
  // relative_time is semantic; deterministic fixture supplies the resolved clock (11:00 Kyiv = NOW+2h).
  ['relative-two-hours', 'Two hours after the frozen clock is 11:00 Kyiv.', operations([operation({ opId: 'rh', action: 'create', target: { kind: 'new', localId: 'rh' }, changes: { title: 'передзвін' }, constraints: [{ kind: 'date', value: '2026-10-18', precision: 'day' }, clock('11:00')] })]), { outcome: 'confirm', includes: '2026-10-18T08:00:00.000Z' }],
  ['all-day-tomorrow', 'A whole day uses wake and sleep, not a fixed 08-22 pair from the model.', operations([operation({ opId: 'ad', action: 'create', target: { kind: 'new', localId: 'ad' }, changes: { title: 'відрядження', spanRole: 'event' }, constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'all_day' }] })]), { outcome: 'confirm', includes: '08:00:00+03:00' }],
  ['biweekly', 'Biweekly is kept.', operations([operation({ opId: 'bw', action: 'create', target: { kind: 'new', localId: 'bw' }, changes: { title: 'огляд' }, constraints: [{ kind: 'recurrence', expression: 'biweekly' }] })]), { outcome: 'confirm', includes: 'BIWEEKLY' }],
  ['monthly', 'Monthly is kept.', operations([operation({ opId: 'mo', action: 'create', target: { kind: 'new', localId: 'mo' }, changes: { title: 'оренда' }, constraints: [{ kind: 'recurrence', expression: 'monthly' }] })]), { outcome: 'confirm', includes: 'MONTHLY' }],
  // earliest/deadline clock roles are V1-only; structured uses start/end.
  ['window-future', 'A future window is previewed as a window, not a single clock.', operations([operation({ opId: 'win', action: 'create', target: { kind: 'new', localId: 'win' }, changes: { title: 'посилка', spanRole: 'window' }, constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('15:00', 'start'), clock('17:00', 'end')] })]), { outcome: 'confirm', intents: 1, includes: '2026-10-20' }],
  ['dst-gap-task', 'A task at 02:30 on the spring gap is not stored.', operations([operation({ opId: 'dg', action: 'create', target: { kind: 'new', localId: 'dg' }, changes: { title: 'рейс' }, constraints: [{ kind: 'date', value: '2026-03-08', precision: 'day' }, clock('02:30')] })]), { outcome: 'clarify', blocked: 'gap', intents: 0, failClosed: true }, { timeZone: 'America/New_York', nowIso: '2026-03-07T15:00:00.000Z' }],
  ['dst-fold-task', 'A task at 01:30 on the autumn fold is not stored.', operations([operation({ opId: 'df', action: 'create', target: { kind: 'new', localId: 'df' }, changes: { title: 'рейс' }, constraints: [{ kind: 'date', value: '2026-11-01', precision: 'day' }, clock('01:30')] })]), { outcome: 'clarify', blocked: 'fold', intents: 0, failClosed: true }, { timeZone: 'America/New_York', nowIso: '2026-10-31T15:00:00.000Z' }],
  ['missing-title-create', 'A create without a title is not given one.', operations([operation({ opId: 'mt', action: 'create', target: { kind: 'new', localId: 'mt' }, constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('12:00')] })]), { outcome: 'clarify', intents: 0, failClosed: true }],
  ['cancel-open-task', 'Cancel previews the named open task.', operations([operation({ opId: 'co', action: 'cancel', target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' } })]), { outcome: 'confirm', taskId: 'task-report' }, { entities: [REPORT] }],
  ['medicine-lemma', 'medicine maps to ліки and does not match an unrelated task.', operations([operation({ opId: 'med', action: 'complete', target: { kind: 'existing', description: 'medicine' } })]), { outcome: 'clarify', blocked: 'unresolved', intents: 0, failClosed: true }, { entities: [REPORT] }],
  ['mail-lemma', 'mail maps to пошта.', operations([operation({ opId: 'mail', action: 'complete', target: { kind: 'existing', proposedId: 'task-mail', description: 'mail' } })]), { outcome: 'confirm', taskId: 'task-mail' }, { entities: [entity('task-mail', 'пошта', { revision: 1, writable: true })] }],
  ['call-lemma', 'call maps to дзвінок.', operations([operation({ opId: 'call', action: 'complete', target: { kind: 'existing', proposedId: 'task-call', description: 'call' } })]), { outcome: 'confirm', taskId: 'task-call' }, { entities: [entity('task-call', 'дзвінок', { revision: 1, writable: true })] }],
  ['duration-only', 'A stated duration without a date stays unscheduled.', operations([operation({ opId: 'dur', action: 'create', target: { kind: 'new', localId: 'dur' }, changes: { title: 'дзвінок' }, constraints: [{ kind: 'duration', minutes: 20 }] })]), { outcome: 'confirm', includes: '"estimatedTimeInMinutes":20' }],
  ['deadline-clock', 'A deadline is not turned into a start clock.', operations([operation({ opId: 'dl', action: 'create', target: { kind: 'new', localId: 'dl' }, changes: { title: 'звіт' }, constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, clock('18:00', 'deadline')] })]), { outcome: 'confirm', includes: '2026-10-21' }],
  ['complete-by-stem', 'Інфінітив звітом still finds Звіт.', operations([operation({ opId: 'st', action: 'complete', target: { kind: 'existing', proposedId: 'task-report', description: 'звітом' } })]), { outcome: 'confirm', taskId: 'task-report' }, { entities: [REPORT] }],
  ['canceled-by-description', 'A canceled task is not completed through a title match.', operations([operation({ opId: 'cd', action: 'complete', target: { kind: 'existing', description: 'Архів' } })]), { outcome: 'clarify', blocked: 'unresolved', intents: 0, failClosed: true }, { entities: [DONE] }],
  ['readonly-by-description', 'Description matching still honors the writable flag.', operations([operation({ opId: 'rd', action: 'delete', target: { kind: 'existing', proposedId: 'ext-flight', description: 'політ' } })]), { outcome: 'clarify', blocked: 'external_readonly', intents: 0, failClosed: true }, { entities: [FLIGHT, REPORT] }],
];

for (const [id, why, envelope, expect, extra] of MORE) {
  SCENARIOS.push({ id, why, turns: [{ transcript: id, envelope, expect }], ...extra });
}

// Writable external must use entityType external_event (envelope bridge maps to task).
SCENARIOS.push(single({
  id: 'writable-by-description',
  why: 'A writable external event is found by title.',
  transcript: 'writable-by-description',
  entities: [WRITABLE_FLIGHT],
  group: createGroup(moveExternalProposal({
    localRef: 'wd',
    entityId: 'ext-flight-w',
    calendarId: 'google',
    scopeDescription: 'політ',
    constraints: [
      { kind: 'date', value: '2026-10-21', localRef: 'wd-c0' },
      { kind: 'clock', value: '16:00', role: 'start', localRef: 'wd-c1' },
    ],
  })),
  expect: { outcome: 'confirm', taskId: 'ext-flight-w' },
}));

describe('Phase 4.7.6 independent evaluation', () => {
  it('keeps suite and scorer versions explicit', () => {
    expect(EVAL_SUITE_VERSION).toBe('phase476-1');
    expect(SCORER_VERSION).toBe('phase476-1');
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(100);
  });

  it('rejects a vague clarification and does not treat zero writes as success', () => {
    const vague = scoreSemanticOutcome({
      schemaValid: true, outcome: 'clarify', intents: [], blocked: [], serverWrites: 0, question: 'Please repeat that.',
      expectation: { acceptable: ['clarify'], intentCount: 0, questionIncludes: ['день'] },
    });
    expect(vague.correct).toBe(false);
    const zero = scoreSemanticOutcome({
      schemaValid: true, outcome: 'answer', intents: [], blocked: [], serverWrites: 0,
      expectation: { acceptable: ['confirm'], intentCount: 1 },
    });
    expect(zero.correct).toBe(false);
    const preview = scoreSemanticOutcome({
      schemaValid: true, outcome: 'confirm', intents: [{ type: 'create', summary: 'лист', task: { name: 'лист', isUnscheduled: true, estimatedTimeInMinutes: 45 } }], blocked: [], serverWrites: 0,
      expectation: { acceptable: ['confirm'], intentCount: 1, taskName: 'лист', unscheduled: true, durationMinutes: 45 },
    });
    expect(preview.correct).toBe(true);
    expect(preview.supportedExecution).toBe(true);
  });

  it('does not resolve a completed task for a write and does resolve it for a read', () => {
    const write = resolveTarget({ target: { kind: 'existing', proposedId: 'task-done' }, userId: USER, entities: [DONE], referents: {}, write: true, action: 'complete' });
    const read = resolveTarget({ target: { kind: 'existing', proposedId: 'task-done' }, userId: USER, entities: [DONE], referents: {}, write: false });
    const bound = resolveTarget({ target: { kind: 'context', referentKey: 'last' }, userId: USER, entities: [DONE], referents: { last: { entityId: 'task-done', phrase: 'Архів' } }, write: false, trustedBinding: true });
    expect(write).toMatchObject({ reason: 'ineligible' });
    expect(read.status).toBe('unresolved');
    expect(bound).toMatchObject({ status: 'resolved', entityId: 'task-done' });
  });

  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s', async (_id, scenario) => {
    const session = createSession(USER, scenario.id);
    for (const turn of scenario.turns) {
      const envelope = typeof turn.envelope === 'function' ? turn.envelope(session) : turn.envelope;
      const group = typeof turn.group === 'function' ? turn.group(session) : turn.group;
      const scripted: ScriptedInterpret = {
        ...(envelope ? { envelope } : {}),
        ...(group ? { group } : {}),
      };
      const result = await runScriptedTurn(session, turn.transcript, scripted, {
        userId: USER,
        nowIso: scenario.nowIso ?? NOW,
        timeZone: scenario.timeZone ?? 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: scenario.defaultDurationMinutes ?? 30,
        defaultReminderTime: scenario.defaultReminderTime ?? '09:00',
        language: 'uk',
        arm: 'A',
        entities: scenario.entities ?? [],
        ...(scenario.plan ? { planContext: PLAN } : {}),
        ...(scenario.receipt ? { searchReceipt: scenario.receipt } : {}),
      });
      expect(result.serverWrites).toBe(0);
      if (turn.expect.failClosed) {
        expectFailClosed(result, {
          intents: turn.expect.intents,
          blocked: turn.expect.blocked,
        });
      } else {
        expect(result.response.outcome).toBe(turn.expect.outcome);
        if (turn.expect.intents != null) expect(result.response.intents).toHaveLength(turn.expect.intents);
        if (turn.expect.blocked) expectBlocked(result, turn.expect.blocked);
      }
      if (turn.expect.questionHas) expect(result.response.assistantMessage.toLocaleLowerCase()).toContain(turn.expect.questionHas.toLocaleLowerCase());
      if (turn.expect.taskId) {
        const ids = result.response.intents.map((intent) => intent.type === 'command' ? intent.command.taskId : null);
        expect(ids).toContain(turn.expect.taskId);
      }
      if (turn.expect.pending != null) expect(hasOpenStructuredPreview(session)).toBe(turn.expect.pending);
      const body = JSON.stringify(result.response.intents);
      if (turn.expect.includes) expect(body).toContain(turn.expect.includes);
      if (turn.expect.excludes) expect(body).not.toContain(turn.expect.excludes);
      if (turn.expect.notificationTime !== undefined) {
        const command = result.response.intents.find((intent) => intent.type === 'command');
        const time = command && command.type === 'command' ? command.command.notificationTime : undefined;
        expect(time).toBe(turn.expect.notificationTime);
      }
      const names = session.planDraft?.items.map((item) => item.name) ?? [];
      if (turn.expect.draftHas) expect(names).toEqual(expect.arrayContaining(turn.expect.draftHas));
      if (turn.expect.draftLacks?.includes('*')) expect(session.planDraft).toBeNull();
      else if (turn.expect.draftLacks) {
        for (const name of turn.expect.draftLacks) expect(names).not.toContain(name);
      }
    }
  });
});

describe('Phase 4.7.6 mocked interpreter boundary', () => {
  it('does not call a model when the envelope is supplied', async () => {
    let calls = 0;
    const result = await runVNextTurn({
      transcript: 'Додай лист',
      userId: USER,
      session: createSession(USER, 'mock'),
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: [],
    }, {
      arm: 'A',
      interpret: async () => {
        calls += 1;
        return {
          ok: true,
          envelope: operations([operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'letter' }, changes: { title: 'лист' } })]),
          reads: [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'phase476-deterministic',
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
  });
});
