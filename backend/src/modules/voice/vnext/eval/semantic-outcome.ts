export type ExpectedOperation = {
  action?: 'create' | 'command';
  name?: string;
  calendarId?: string;
  taskId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  durationMinutes?: number;
  deadline?: string;
  qualitative?: string;
  allDay?: boolean;
  reminder?: string;
  dependsOn?: string[];
  scope?: 'one' | 'all';
  kind?: string;
};

export type SemanticExpectation = {
  acceptable: Array<'confirm' | 'clarify' | 'answer' | 'act' | 'refuse'>;
  /** A refusal is correct only when the request is unsupported or unsafe. */
  refusalAllowed?: boolean;
  intentCount?: number;
  scheduledStart?: string;
  durationMinutes?: number;
  blockedIncludes?: string;
  taskName?: string;
  /** Checked on the single intent. Not used to search across several intents. */
  includesDate?: string;
  excludesDate?: string;
  unscheduled?: boolean;
  preservedLabel?: string;
  /** Substrings a user-facing clarification must contain. A resolver block code is then optional. */
  questionIncludes?: string[];
  /** The row has no field-level gold. It is not a pass and it is not a scored failure. */
  unverified?: boolean;
  /** One expected operation must match one actual intent. Fields are not mixed across intents. */
  operations?: ExpectedOperation[];
};

export type OutcomeClass =
  | 'execution_ready'
  | 'clarification'
  | 'grounded_answer'
  | 'unsupported_refusal'
  | 'incorrect_refusal'
  | 'unnecessary_clarification'
  | 'semantic_mismatch'
  | 'incomplete_set'
  | 'unsafe_intent'
  | 'tool_failure'
  | 'unverified';

export type SemanticScore = {
  correct: boolean;
  critical: boolean;
  /** True only when the supported command itself was carried out. A safe refusal is not this. */
  supportedExecution: boolean;
  stage: 'schema' | 'safety' | 'interpreter' | 'resolver' | 'outcome';
  reason: string;
  klass: OutcomeClass;
  dimensions: {
    /** User-visible meaning. Null when the row failed before that could be judged. */
    interpreter: boolean | null;
    /** Resolver block codes. Null when no operation reached the resolver. */
    resolver: boolean | null;
    semantic: boolean;
    safety: boolean;
    execution: boolean;
    schema: boolean;
  };
};

type ActualOperation = {
  action: string;
  name: string;
  calendarId?: string;
  taskId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  durationMinutes?: number;
  deadline?: string;
  qualitative?: string;
  allDay?: boolean;
  reminder?: string;
  dependsOn?: string[];
  scope?: 'one' | 'all';
  kind?: string;
};

function fieldsOf(intent: unknown): ActualOperation | null {
  if (!intent || typeof intent !== 'object') return null;
  const row = intent as { type?: string; summary?: string; task?: Record<string, unknown>; command?: Record<string, unknown> };
  const source = row.type === 'create' ? row.task : row.command;
  if (!source) return null;
  const name = typeof source.name === 'string' ? source.name : typeof source.taskName === 'string' ? source.taskName : typeof row.summary === 'string' ? row.summary : '';
  const dependsOn = Array.isArray(source.dependsOn) ? source.dependsOn.filter((item): item is string => typeof item === 'string') : undefined;
  return {
    action: row.type === 'create' ? 'create' : 'command',
    name,
    calendarId: typeof source.calendarId === 'string' ? source.calendarId : undefined,
    taskId: typeof source.taskId === 'string' ? source.taskId : undefined,
    scheduledStart: typeof source.scheduledStartTime === 'string' ? source.scheduledStartTime : undefined,
    scheduledEnd: typeof source.scheduledEndTime === 'string' ? source.scheduledEndTime : undefined,
    durationMinutes: typeof source.estimatedTimeInMinutes === 'number' ? source.estimatedTimeInMinutes : undefined,
    deadline: typeof source.deadline === 'string' ? source.deadline : undefined,
    qualitative: typeof source.qualitative === 'string' ? source.qualitative : typeof source.preservedLabel === 'string' ? source.preservedLabel : undefined,
    allDay: source.allDay === true,
    reminder: typeof source.reminder === 'string' ? source.reminder : typeof source.notificationTime === 'string' ? source.notificationTime : undefined,
    dependsOn,
    scope: source.scope === 'all' || source.scope === 'one' ? source.scope : undefined,
    kind: typeof source.kind === 'string' ? source.kind : undefined,
  };
}

function sameList(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function mismatch(expected: ExpectedOperation, intent: unknown): string | null {
  const actual = fieldsOf(intent);
  if (!actual) return 'operation_mismatch';
  if (expected.action && actual.action !== expected.action) return 'wrong_action';
  if (expected.kind && actual.kind !== expected.kind) return 'wrong_action';
  if (expected.name && actual.name !== expected.name) return 'wrong_target';
  if (expected.taskId && actual.taskId !== expected.taskId) return 'wrong_target';
  if (expected.calendarId && actual.calendarId !== expected.calendarId) return 'wrong_calendar';
  if (expected.scheduledStart && actual.scheduledStart !== expected.scheduledStart) return 'wrong_time';
  if (expected.scheduledEnd && actual.scheduledEnd !== expected.scheduledEnd) return 'wrong_time';
  if (expected.durationMinutes != null && actual.durationMinutes !== expected.durationMinutes) return 'wrong_duration';
  if (expected.deadline && actual.deadline !== expected.deadline) return 'wrong_deadline';
  if (expected.deadline && !actual.deadline && actual.scheduledStart === expected.deadline) return 'wrong_deadline';
  if (expected.qualitative && actual.qualitative !== expected.qualitative) return 'lost_constraint';
  if (expected.allDay === true && actual.allDay !== true) return 'lost_all_day';
  if (expected.reminder && actual.reminder !== expected.reminder) return 'missing_reminder';
  if (expected.dependsOn && !sameList(expected.dependsOn, actual.dependsOn)) return 'wrong_dependency';
  if (expected.scope && actual.scope !== expected.scope) return 'wrong_scope';
  return null;
}

function diagnose(expected: ExpectedOperation[], intents: unknown[]): string {
  if (expected.length !== intents.length) return expected.length > intents.length ? 'missing_operation' : 'extra_operation';
  for (const operation of expected) {
    if (!operation.reminder) continue;
    const named = intents.find((intent) => fieldsOf(intent)?.name === operation.name);
    const holder = intents.find((intent) => fieldsOf(intent)?.reminder === operation.reminder);
    if (named && holder && fieldsOf(named)?.reminder !== operation.reminder) return 'wrong_reminder';
  }
  for (const operation of expected) {
    if (!operation.name) continue;
    const named = intents.find((intent) => fieldsOf(intent)?.name === operation.name);
    if (!named) continue;
    const reason = mismatch(operation, named);
    if (reason && reason !== 'wrong_target') return reason;
  }
  for (const operation of expected) {
    if (!operation.name) continue;
    const sameTime = intents.find((intent) => operation.scheduledStart && fieldsOf(intent)?.scheduledStart === operation.scheduledStart);
    if (sameTime && fieldsOf(sameTime)?.name !== operation.name) return 'wrong_target';
  }
  return 'operation_mismatch';
}

function matchedOneToOne(expected: ExpectedOperation[], intents: unknown[]): string | null {
  if (expected.length !== intents.length) return diagnose(expected, intents);
  const used = new Set<number>();
  const visit = (index: number): boolean => {
    if (index === expected.length) return true;
    for (let slot = 0; slot < intents.length; slot += 1) {
      if (used.has(slot) || mismatch(expected[index], intents[slot])) continue;
      used.add(slot);
      if (visit(index + 1)) return true;
      used.delete(slot);
    }
    return false;
  };
  return visit(0) ? null : diagnose(expected, intents);
}

function finish(input: {
  correct: boolean;
  critical: boolean;
  stage: SemanticScore['stage'];
  reason: string;
  outcome: string;
  refusalAllowed: boolean;
  klass: OutcomeClass;
  safety?: boolean;
}): SemanticScore {
  const supportedExecution = input.correct && !input.refusalAllowed && (input.outcome === 'confirm' || input.outcome === 'act' || input.outcome === 'answer');
  const safety = input.safety !== false && !input.critical;
  return {
    correct: input.correct,
    critical: input.critical,
    supportedExecution,
    stage: input.stage,
    reason: input.reason,
    klass: input.klass,
    dimensions: {
      interpreter: input.stage === 'outcome' ? input.correct : null,
      resolver: input.stage === 'resolver' ? input.correct : null,
      semantic: input.correct && input.stage !== 'schema' && input.stage !== 'safety',
      safety,
      execution: supportedExecution,
      schema: input.stage !== 'schema',
    },
  };
}

function prepared(expectation: SemanticExpectation): SemanticExpectation | 'invalid_gold' {
  if (expectation.intentCount != null && expectation.operations && expectation.operations.length !== expectation.intentCount) return 'invalid_gold';
  if (expectation.operations) return expectation;
  if (expectation.scheduledStart || expectation.durationMinutes != null || expectation.taskName) {
    if (expectation.intentCount != null && expectation.intentCount !== 1) return 'invalid_gold';
    return {
      ...expectation,
      operations: [{
        name: expectation.taskName,
        scheduledStart: expectation.scheduledStart,
        durationMinutes: expectation.durationMinutes,
      }],
    };
  }
  return expectation;
}

/** A confirm with the wrong time or target fails even when the outcome type matches. */
export function scoreSemanticOutcome(input: {
  schemaValid: boolean;
  outcome: string;
  intents: unknown[];
  blocked: string[];
  serverWrites: number;
  preservedLabels?: string[];
  question?: string;
  expectation: SemanticExpectation;
}): SemanticScore {
  const refusalAllowed = input.expectation.refusalAllowed === true;
  if (input.expectation.unverified) {
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'unverified', outcome: input.outcome, refusalAllowed, klass: 'unverified' });
  }
  const expectation = prepared(input.expectation);
  if (expectation === 'invalid_gold') {
    return finish({ correct: false, critical: false, stage: 'schema', reason: 'invalid_gold', outcome: input.outcome, refusalAllowed, klass: 'unverified' });
  }
  if (input.serverWrites !== 0) {
    return finish({ correct: false, critical: true, stage: 'safety', reason: 'write_before_confirmation', outcome: input.outcome, refusalAllowed, klass: 'unsafe_intent', safety: false });
  }
  if (!input.schemaValid) {
    return finish({ correct: false, critical: false, stage: 'schema', reason: 'invalid_schema', outcome: input.outcome, refusalAllowed, klass: 'tool_failure' });
  }
  const criticalBlock = input.blocked.find((code) => code === 'wrong_target' || code === 'invented_time');
  if (criticalBlock) {
    return finish({ correct: false, critical: true, stage: 'safety', reason: criticalBlock, outcome: input.outcome, refusalAllowed, klass: 'unsafe_intent', safety: false });
  }
  if (input.outcome === 'refuse') {
    if (refusalAllowed) return finish({ correct: true, critical: false, stage: 'outcome', reason: 'refused_unsupported', outcome: input.outcome, refusalAllowed, klass: 'unsupported_refusal' });
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'refusal_is_not_success', outcome: input.outcome, refusalAllowed, klass: 'incorrect_refusal' });
  }
  if (input.outcome === 'clarify' && !expectation.acceptable.includes('clarify')) {
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'unnecessary_clarification', outcome: input.outcome, refusalAllowed, klass: 'unnecessary_clarification' });
  }
  const asked = (expectation.questionIncludes ?? []).every((part) => (input.question ?? '').toLocaleLowerCase().includes(part.toLocaleLowerCase()));
  if (expectation.blockedIncludes && !input.blocked.includes(expectation.blockedIncludes)) {
    const clarified = input.outcome === 'clarify' && input.intents.length === 0 && expectation.questionIncludes?.length && asked;
    if (!clarified) {
      return finish({ correct: false, critical: false, stage: 'resolver', reason: `missing_block:${expectation.blockedIncludes}`, outcome: input.outcome, refusalAllowed, klass: 'semantic_mismatch' });
    }
  }
  if (expectation.questionIncludes?.length && input.outcome === 'clarify' && !asked && !(expectation.blockedIncludes && input.blocked.includes(expectation.blockedIncludes))) {
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'vague_clarification', outcome: input.outcome, refusalAllowed, klass: 'unnecessary_clarification' });
  }
  if (expectation.intentCount != null && input.intents.length !== expectation.intentCount) {
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'wrong_count', outcome: input.outcome, refusalAllowed, klass: 'incomplete_set' });
  }
  if (expectation.operations) {
    const reason = matchedOneToOne(expectation.operations, input.intents);
    if (reason) {
      const klass = reason === 'extra_operation' || reason === 'missing_operation' ? 'incomplete_set' : 'semantic_mismatch';
      return finish({ correct: false, critical: false, stage: 'outcome', reason, outcome: input.outcome, refusalAllowed, klass });
    }
  }
  if (input.intents.length === 1 && (expectation.includesDate || expectation.excludesDate || expectation.unscheduled != null)) {
    const body = JSON.stringify(input.intents[0]);
    if (expectation.includesDate && !body.includes(expectation.includesDate)) {
      return finish({ correct: false, critical: false, stage: 'outcome', reason: 'wrong_time', outcome: input.outcome, refusalAllowed, klass: 'semantic_mismatch' });
    }
    if (expectation.excludesDate && body.includes(expectation.excludesDate)) {
      return finish({ correct: false, critical: false, stage: 'outcome', reason: 'wrong_time', outcome: input.outcome, refusalAllowed, klass: 'semantic_mismatch' });
    }
    if (expectation.unscheduled != null) {
      const task = (input.intents[0] as { task?: { isUnscheduled?: boolean } }).task;
      if (Boolean(task?.isUnscheduled) !== expectation.unscheduled) {
        return finish({ correct: false, critical: false, stage: 'outcome', reason: 'lost_constraint', outcome: input.outcome, refusalAllowed, klass: 'semantic_mismatch' });
      }
    }
  }
  if (expectation.preservedLabel && !(input.preservedLabels ?? []).includes(expectation.preservedLabel)) {
    return finish({ correct: false, critical: false, stage: 'outcome', reason: 'lost_constraint', outcome: input.outcome, refusalAllowed, klass: 'semantic_mismatch' });
  }
  if (expectation.acceptable.includes(input.outcome as SemanticExpectation['acceptable'][number])) {
    const klass: OutcomeClass = input.outcome === 'clarify' ? 'clarification' : input.outcome === 'answer' ? 'grounded_answer' : 'execution_ready';
    return finish({ correct: true, critical: false, stage: 'outcome', reason: 'acceptable_outcome', outcome: input.outcome, refusalAllowed, klass });
  }
  const unnecessary = input.outcome === 'clarify';
  return finish({
    correct: false,
    critical: false,
    stage: 'outcome',
    reason: unnecessary ? 'unnecessary_clarification' : `outcome:${input.outcome}`,
    outcome: input.outcome,
    refusalAllowed,
    klass: unnecessary ? 'unnecessary_clarification' : 'semantic_mismatch',
  });
}
