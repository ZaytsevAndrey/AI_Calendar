import { localHm, localYmd } from './voice-local-date.util';
import { buildVoiceParseResultLog } from './voice-parse-result-log.util';
import type { VoiceParseResult } from './voice-parse.types';
import type { CreateEvalExpect, CreateEvalScenario } from './voice-create-eval.scenarios';
import { CREATE_EVAL_ANCHORS } from './voice-create-eval.scenarios';

export type CreateEvalActual = {
  understanding: VoiceParseResult['understanding'];
  kind: string | null;
  taskName: string | null;
  clarifyingQuestion: string | null;
  scheduleNotice: string | null;
  isUnscheduled: boolean | null;
  recurrencePattern: string | null;
  recurrenceWeekDays: number[] | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  earliestStartTime: string | null;
  deadline: string | null;
  commandKind: string | null;
  scheduledYmd: string | null;
  scheduledHour: number | null;
  earliestYmd: string | null;
  deadlineYmd: string | null;
};

export type CreateEvalMatchResult = {
  ok: boolean;
  failures: string[];
  actual: CreateEvalActual;
};

export function harvestCreateEvalActual(
  result: VoiceParseResult,
  timeZone = CREATE_EVAL_ANCHORS.timeZone,
  nowIso = CREATE_EVAL_ANCHORS.nowIso,
): CreateEvalActual {
  const log = buildVoiceParseResultLog({
    parseId: 'eval',
    transcript: '',
    timeZone,
    nowIso,
    routerIntent: 'create',
    sniffed: null,
    intent: 'create',
    specialistIntent: 'create',
    language: null,
    result: { ...result, command: result.command ?? null },
  });

  return {
    understanding: result.understanding,
    kind: log.kind,
    taskName: log.taskName,
    clarifyingQuestion: result.clarifyingQuestion,
    scheduleNotice: result.scheduleNotice ?? null,
    isUnscheduled: log.isUnscheduled,
    recurrencePattern: log.recurrencePattern,
    recurrenceWeekDays: log.recurrenceWeekDays,
    scheduledStartTime: log.scheduledStartTime,
    scheduledEndTime: log.scheduledEndTime,
    earliestStartTime: log.earliestStartTime,
    deadline: log.deadline,
    commandKind: log.commandKind,
    scheduledYmd: log.scheduledStartTime
      ? localYmd(log.scheduledStartTime, timeZone)
      : null,
    scheduledHour: hourFromIso(log.scheduledStartTime, timeZone),
    earliestYmd: log.earliestStartTime
      ? localYmd(log.earliestStartTime, timeZone)
      : null,
    deadlineYmd: log.deadline ? localYmd(log.deadline, timeZone) : null,
  };
}

export function matchCreateEvalScenario(
  scenario: CreateEvalScenario,
  result: VoiceParseResult,
  timeZone = CREATE_EVAL_ANCHORS.timeZone,
  nowIso = CREATE_EVAL_ANCHORS.nowIso,
): CreateEvalMatchResult {
  const actual = harvestCreateEvalActual(result, timeZone, nowIso);
  const failures: string[] = [];
  const exp = scenario.expect;

  if (actual.commandKind) {
    failures.push(`expected create (command null), got command=${actual.commandKind}`);
  }

  if (actual.understanding !== exp.understanding) {
    failures.push(
      `understanding: expected ${exp.understanding}, got ${actual.understanding}`,
    );
  }

  if (exp.understanding === 'needs_clarification') {
    if (!actual.clarifyingQuestion?.trim()) {
      failures.push('clarifyingQuestion: expected a non-empty question');
    }
    return { ok: failures.length === 0, failures, actual };
  }

  assertKind(exp, actual, failures);
  assertName(exp, actual, failures);
  assertRecurring(exp, actual, failures);
  assertWhen(exp, actual, failures);
  if (exp.scheduleNoticeIncludes) {
    const notice = actual.scheduleNotice || '';
    if (!notice.includes(exp.scheduleNoticeIncludes)) {
      failures.push(
        `scheduleNotice: expected to include "${exp.scheduleNoticeIncludes}", got "${notice || 'null'}"`,
      );
    }
  }

  return { ok: failures.length === 0, failures, actual };
}

function assertKind(
  exp: CreateEvalExpect,
  actual: CreateEvalActual,
  failures: string[],
): void {
  if (exp.kind && actual.kind !== exp.kind) {
    failures.push(`kind: expected ${exp.kind}, got ${actual.kind}`);
  }
  if (exp.isUnscheduled === true && !actual.isUnscheduled) {
    failures.push('isUnscheduled: expected true');
  }
}

function assertName(
  exp: CreateEvalExpect,
  actual: CreateEvalActual,
  failures: string[],
): void {
  if (!exp.nameIncludes) return;
  const name = (actual.taskName || '').toLocaleLowerCase('uk');
  const needle = exp.nameIncludes.toLocaleLowerCase('uk');
  if (!name.includes(needle)) {
    failures.push(
      `nameIncludes: expected to include "${exp.nameIncludes}", got "${actual.taskName}"`,
    );
  }
}

function assertRecurring(
  exp: CreateEvalExpect,
  actual: CreateEvalActual,
  failures: string[],
): void {
  if (exp.recurrencePattern && actual.recurrencePattern !== exp.recurrencePattern) {
    failures.push(
      `recurrencePattern: expected ${exp.recurrencePattern}, got ${actual.recurrencePattern}`,
    );
  }
  if (exp.recurrenceWeekDays) {
    const got = [...(actual.recurrenceWeekDays || [])].sort((a, b) => a - b);
    const want = [...exp.recurrenceWeekDays].sort((a, b) => a - b);
    if (got.join(',') !== want.join(',')) {
      failures.push(
        `recurrenceWeekDays: expected [${want.join(',')}], got [${got.join(',')}]`,
      );
    }
  }
}

function assertWhen(
  exp: CreateEvalExpect,
  actual: CreateEvalActual,
  failures: string[],
): void {
  if (exp.noScheduleFields) {
    if (actual.scheduledStartTime || actual.earliestStartTime || actual.deadline) {
      failures.push(
        `noScheduleFields: expected null clocks, got start=${actual.scheduledStartTime} earliest=${actual.earliestStartTime} deadline=${actual.deadline}`,
      );
    }
  }

  if (exp.hasScheduledStart && !actual.scheduledStartTime) {
    failures.push('hasScheduledStart: expected scheduledStartTime');
  }
  if (exp.hasEarliest && !actual.earliestStartTime) {
    failures.push('hasEarliest: expected earliestStartTime');
  }
  if (exp.hasDeadline && !actual.deadline) {
    failures.push('hasDeadline: expected deadline');
  }

  if (exp.scheduledYmd && actual.scheduledYmd !== exp.scheduledYmd) {
    failures.push(
      `scheduledYmd: expected ${exp.scheduledYmd}, got ${actual.scheduledYmd}`,
    );
  }
  if (
    exp.scheduledHour != null &&
    actual.scheduledHour !== exp.scheduledHour
  ) {
    failures.push(
      `scheduledHour: expected ${exp.scheduledHour}, got ${actual.scheduledHour}`,
    );
  }
  if (exp.earliestYmd && actual.earliestYmd !== exp.earliestYmd) {
    failures.push(
      `earliestYmd: expected ${exp.earliestYmd}, got ${actual.earliestYmd}`,
    );
  }
  if (exp.deadlineYmd && actual.deadlineYmd !== exp.deadlineYmd) {
    failures.push(
      `deadlineYmd: expected ${exp.deadlineYmd}, got ${actual.deadlineYmd}`,
    );
  }
  if (exp.dayWindowYmd) {
    if (actual.earliestYmd !== exp.dayWindowYmd) {
      failures.push(
        `dayWindow earliestYmd: expected ${exp.dayWindowYmd}, got ${actual.earliestYmd}`,
      );
    }
    if (actual.deadlineYmd !== exp.dayWindowYmd) {
      failures.push(
        `dayWindow deadlineYmd: expected ${exp.dayWindowYmd}, got ${actual.deadlineYmd}`,
      );
    }
  }
}

function hourFromIso(iso: string | null, timeZone: string): number | null {
  if (!iso) return null;
  const hm = localHm(iso, timeZone);
  const hour = Number(hm.slice(0, 2));
  return Number.isFinite(hour) ? hour : null;
}
