import { applyPlanEdits, daySlotFor, initialPlanDraft, planToIntents, type PlanDraftContext, type PlanEdit } from '../voice-agent.plan-draft';
import type { DayPlanProposal, DayPlanProposalItem, PlanDraft, VoiceTurnResponse, VoiceWriteIntent } from '../voice-agent.types';
import {
  addDaysToYmd,
  localHm,
  localYmd,
  nextWeekdayYmd,
  scheduleTodayYmd,
} from '../voice-local-date.util';
import { adaptOperation, withinWriteCap } from './adapter/adapter';
import { expandScope } from './adapter/scope';
import type { SearchReceipt } from './search/receipt';
import { bulkBlock } from './search/receipt';
import { integrityFailure } from './integrity/check';
import { ask as askDialogue, clearDialogue } from './session/dialogue';
import { voiceCopy, type VNextLanguage } from './copy';
import type { ProposalGroup } from './contracts/proposal';
import { TIME_OF_DAY_LABELS, type DayPlanEditV1, type SemanticEnvelopeV1, type SemanticOperationV1, type TimeOfDayLabelV1 } from './contracts/types';
import { evidenceCovers, type EvidenceNeed, type ReadRecord } from './evidence/evidence';
import { normalizeOperations } from './graph/normalize';
import { buildTurnUser } from './interpreters/prompts';
import type { BenchmarkTrace } from './diagnostics/trace';
import { mapQualitative } from './qualitative/policy';
import { resolveTarget, type EntityRecord } from './reference/reference-resolver';
import type { LlmUsage } from './repair/repair';
import { mergeAnswer, type BlockedOperation } from './session/clarification';
import { appendTurn, clearPending, intentKey, pinArm, type VNextArm, type VNextSession } from './session/session';
import { resolveConstraints, type TurnClock } from './temporal/temporal-resolver';
import { runStructuredTurn } from './run-structured-turn';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type TraceEvent = { name: string; fields: Record<string, string | number | boolean | null> };

export type PipelineResult = {
  response: VoiceTurnResponse;
  traces: TraceEvent[];
  serverWrites: 0;
  usage: LlmUsage;
  specialist: string | null;
  blocked: string[];
  preservedLabels: string[];
};

export type InterpretOutput = {
  ok: boolean;
  envelope?: SemanticEnvelopeV1;
  /** Preferred Stage 4 output. When present, the envelope is ignored for writes. */
  group?: ProposalGroup;
  reads: ReadRecord[];
  usage: LlmUsage;
  specialist: string | null;
  promptHash: string;
  code?: string;
};

export type VNextInterpreter = {
  arm: VNextArm;
  interpret(user: string, transcript: string): Promise<InterpretOutput>;
};

export type TurnInput = {
  transcript: string;
  userId: string;
  session: VNextSession;
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  defaultDurationMinutes: number;
  /** User setting. Omitted callers use the application fallback of 09:00. */
  defaultReminderTime?: string;
  language: VNextLanguage;
  entities: EntityRecord[];
  /** Real tasks and slots. Absent context is a refusal, not an empty day. */
  planContext?: PlanDraftContext;
  /** Production `VoiceDayPlanner.propose`. The pipeline does not construct it. */
  proposeDay?: (userId: string, draft: PlanDraft, timeZone: string) => Promise<DayPlanProposal>;
  evidenceNeed?: EvidenceNeed;
  arm: VNextArm;
  /** Trusted search receipt. The interpreter cannot set this. Missing means the set is not complete. */
  searchReceipt?: SearchReceipt;
  /** Trusted search over a catalog the runner already holds. The interpreter cannot set this. */
  catalogSearch?: (query: { name: string; calendarId?: string }) => SearchReceipt;
  /** Re-read a provider row before Apply. A missing row is not an empty calendar. */
  readEntity?: (id: string) => Promise<{
    exists: boolean;
    revision?: number;
    calendarId?: string | null;
    writable?: boolean;
    googleEventId?: string | null;
    status?: 'open' | 'completed' | 'canceled';
    userId?: string;
  }>;
  /**
   * Trusted confirmation claim from the client transport.
   * Spoken words and model-copied ids cannot authorize a structured preview.
   */
  confirmation?: { executionId: string; previewRevision: number };
  trace?: BenchmarkTrace;
};

const ZERO: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

function reply(sessionId: string, partial: Partial<VoiceTurnResponse> & Pick<VoiceTurnResponse, 'outcome' | 'assistantMessage'>): VoiceTurnResponse {
  return {
    sessionId,
    outcome: partial.outcome,
    assistantMessage: partial.assistantMessage,
    intents: partial.intents ?? [],
    actions: partial.actions ?? [],
    plan: partial.plan ?? null,
    segments: [],
    clarifyCount: partial.clarifyCount ?? 0,
    legacyParse: null,
  };
}

function transportCopy(code: string | undefined): 'transport' | 'timeout' | 'provider_unavailable' | null {
  if (code === 'timeout' || code === 'provider_timeout') return 'timeout';
  if (code === 'provider_unavailable') return 'provider_unavailable';
  if (code === 'provider_or_transport_error') return 'transport';
  return null;
}

function done(input: TurnInput, response: VoiceTurnResponse, extra: Partial<PipelineResult>): PipelineResult {
  const result: PipelineResult = {
    response,
    traces: extra.traces ?? [],
    serverWrites: 0,
    usage: extra.usage ?? ZERO,
    specialist: extra.specialist ?? null,
    blocked: extra.blocked ?? [],
    preservedLabels: extra.preservedLabels ?? [],
  };
  if (input.trace) {
    input.trace.previewPayload = result.response.intents;
    input.trace.finalResponse = result.response;
    input.trace.blocked = result.blocked;
  }
  if (response.assistantMessage) appendTurn(input.session, 'assistant', response.assistantMessage);
  return result;
}

function priorDialogue(session: VNextSession, transcript: string): Array<{ role: 'user' | 'assistant'; text: string }> {
  const turns = session.turns.slice(0, -1);
  const last = session.turns[session.turns.length - 1];
  const prior = last?.role === 'user' && last.text === transcript ? turns : session.turns;
  return prior.slice(-6);
}

function accessFor(intents: VoiceWriteIntent[], entities: EntityRecord[]): VNextSession['previewAccess'] {
  const access: VNextSession['previewAccess'] = {};
  for (const intent of intents) {
    if (intent.type !== 'command') continue;
    const id = typeof intent.command.taskId === 'string' ? intent.command.taskId : '';
    const entity = id ? entities.find((row) => row.id === id) : undefined;
    if (!entity) continue;
    access[id] = {
      userId: entity.userId,
      calendarId: entity.calendarId ?? null,
      external: entity.type === 'external_event',
      writable: entity.writable === true,
    };
  }
  return access;
}

function accessBlock(intents: VoiceWriteIntent[], entities: EntityRecord[], userId: string, seen: VNextSession['previewAccess']): string | null {
  for (const intent of intents) {
    if (intent.type !== 'command') continue;
    const id = typeof intent.command.taskId === 'string' ? intent.command.taskId : '';
    if (!id || !seen[id]) continue;
    const entity = entities.find((row) => row.id === id);
    if (!entity) return 'stale_deleted';
    if (entity.userId !== userId) return 'cross_user';
    if (entity.status !== 'open') return 'ineligible';
    if (entity.type === 'external_event' && entity.writable !== true) return 'external_readonly';
    if ((seen[id].calendarId ?? null) !== (entity.calendarId ?? null)) return 'wrong_calendar';
  }
  return null;
}

function describePreview(intent: VoiceWriteIntent, timeZone: string): string {
  const bits = [intent.summary];
  if (intent.type === 'create') {
    const start = intent.task.scheduledStartTime;
    if (typeof start === 'string') bits.push(localHm(start, timeZone));
    return bits.join(' ');
  }
  const command = intent.command;
  const patch = command.patch && typeof command.patch === 'object' ? command.patch as Record<string, unknown> : undefined;
  const start = typeof command.scheduledStartTime === 'string'
    ? command.scheduledStartTime
    : typeof patch?.scheduledStartTime === 'string' ? patch.scheduledStartTime : undefined;
  if (start) bits.push(localHm(start, timeZone));
  if (typeof command.notificationTime === 'string' && command.notificationTime) bits.push(command.notificationTime);
  if (typeof command.dueYmd === 'string') bits.push(command.dueYmd);
  return bits.join(' ');
}

function revisionsFor(intents: VoiceWriteIntent[], entities: EntityRecord[]): Record<string, number> {
  const revisions: Record<string, number> = {};
  for (const intent of intents) {
    const command = intent.type === 'command' ? intent.command as { taskId?: string } : null;
    const id = command?.taskId;
    const revision = id ? entities.find((entity) => entity.id === id)?.revision : undefined;
    if (id && revision != null) revisions[id] = revision;
  }
  return revisions;
}

function clockOf(input: TurnInput): TurnClock {
  return { nowIso: input.nowIso, timeZone: input.timeZone, wakeHm: input.wakeHm, sleepHm: input.sleepHm };
}

function turnUser(input: TurnInput): string {
  const today = scheduleTodayYmd(input.nowIso, input.timeZone, input.wakeHm, input.sleepHm);
  return buildTurnUser({
    transcript: input.transcript,
    nowLocal: `${localYmd(input.nowIso, input.timeZone)} ${localHm(input.nowIso, input.timeZone)}`,
    timeZone: input.timeZone,
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
    scheduleToday: today,
    tomorrow: addDaysToYmd(today, 1),
    weekdays: WEEKDAYS.map((name, dow) => `${name} ${nextWeekdayYmd(today, dow)}`).join(', '),
    defaultDurationMinutes: input.defaultDurationMinutes,
    language: input.language,
    owned: input.entities
      .filter((entity) => entity.userId === input.userId && entity.status === 'open')
      .map((entity) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        status: entity.status,
        start: entity.scheduledStart,
        access: entity.type === 'external_event' ? (entity.writable === true ? 'writable' : 'read-only') : undefined,
      })),
    openQuestion: input.session.openQuestion,
    pending: Boolean(input.session.pendingIntents?.length),
    history: priorDialogue(input.session, input.transcript),
    pendingSummary: input.session.pendingSummary,
    referents: Object.values(input.session.referents).map((row) => ({ phrase: row.phrase, id: row.entityId ?? row.localId ?? '' })),
    draft: input.session.planDraft
      ? { day: input.session.planDraft.day, revision: input.session.planDraft.revision, items: input.session.planDraft.items.map((item) => `${item.id} ${item.name}`) }
      : null,
    canceledOpIds: input.session.canceledOpIds,
    appliedCount: input.session.appliedKeys.length,
    pendingOperations: input.session.pendingOperations.map((operation) => ({
      opId: operation.opId,
      action: operation.action,
      constraints: operation.constraints,
    })),
  });
}

function toPlanEdit(edit: DayPlanEditV1, input: TurnInput): { edit: PlanEdit; qualitative?: string } {
  if (edit.op !== 'add_task' && edit.op !== 'set_preferred_start') return { edit: edit as PlanEdit };
  if (!edit.qualitative) return { edit: edit as PlanEdit };
  const mapped = mapQualitative({
    label: edit.qualitative,
    bound: 'at',
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
  });
  if (edit.op === 'add_task') {
    if (mapped.status === 'window') {
      return {
        qualitative: edit.qualitative,
        edit: {
          op: 'add_task',
          name: edit.name,
          durationMinutes: edit.durationMinutes,
          preferredHm: null,
          earliestHm: mapped.earliestHm,
          deadlineHm: mapped.deadlineHm,
        },
      };
    }
    return {
      qualitative: edit.qualitative,
      edit: {
        op: 'add_task',
        name: edit.name,
        durationMinutes: edit.durationMinutes,
        preferredHm: null,
        earliestHm: null,
        deadlineHm: null,
      },
    };
  }
  return {
    qualitative: edit.qualitative,
    edit: mapped.status === 'window'
      ? { op: 'set_window', itemId: edit.itemId, earliestHm: mapped.earliestHm, deadlineHm: mapped.deadlineHm }
      : mapped.status === 'deadline'
        ? { op: 'set_window', itemId: edit.itemId, deadlineHm: mapped.hm }
        : mapped.status === 'earliest'
          ? { op: 'set_window', itemId: edit.itemId, earliestHm: mapped.hm }
          : { op: 'set_preferred_start', itemId: edit.itemId, hm: null },
  };
}

function storedQualitative(value: string | undefined): TimeOfDayLabelV1 | null {
  if (!value) return null;
  return (TIME_OF_DAY_LABELS as readonly string[]).includes(value) ? (value as TimeOfDayLabelV1) : null;
}

function semanticOf(operation: SemanticOperationV1): SemanticOperationV1 {
  return {
    opId: operation.opId,
    action: operation.action,
    target: operation.target,
    changes: operation.changes,
    constraints: operation.constraints,
    dependsOn: operation.dependsOn,
    source: operation.source,
  };
}

function questionCode(blocked: string[]): string {
  if (blocked.includes('unresolved_scope') || blocked.includes('completeness_unknown') || blocked.includes('search_incomplete') || blocked.includes('search_truncated') || blocked.includes('search_failed') || blocked.includes('duplicate_targets') || blocked.includes('empty_scope') || blocked.includes('bulk_limit') || blocked.includes('scope_mismatch')) return 'scope';
  if (blocked.includes('stale_scope')) return 'stale';
  if (blocked.includes('unsupported_bulk')) return 'bulk';
  if (blocked.includes('unsupported_all_day')) return 'all_day';
  if (blocked.includes('wrong_calendar') || blocked.includes('external_readonly')) return 'calendar';
  if (blocked.includes('cross_user') || blocked.includes('forged') || blocked.includes('ineligible')) return 'cannot_change';
  if (blocked.includes('ambiguous_correction')) return 'which_task';
  if (blocked.includes('stale_provider') || blocked.includes('stale_deleted')) return 'stale';
  if (blocked.includes('gap')) return 'dst_gap';
  if (blocked.includes('fold')) return 'dst_fold';
  if (blocked.includes('past')) return 'past_clock';
  if (blocked.includes('missing_day') || blocked.includes('needs_day') || blocked.includes('conflicting_day')) return 'which_day';
  if (blocked.includes('missing_series_scope')) return 'which_series';
  if (blocked.includes('missing_predecessor')) return 'predecessor';
  if (blocked.includes('unresolved') || blocked.includes('ambiguous')) return 'which_task';
  if (blocked.includes('invented_time')) return 'invented_time';
  if (blocked.includes('lost_clock')) return 'lost_clock';
  if (blocked.includes('lost_duration')) return 'lost_duration';
  if (blocked.includes('lost_reminder')) return 'lost_reminder';
  if (blocked.includes('lost_recurrence') || blocked.includes('lost_all_day')) return blocked.includes('lost_all_day') ? 'all_day' : 'lost_recurrence';
  return 'held';
}

function answerClarification(input: TurnInput, envelope: SemanticEnvelopeV1, traces: TraceEvent[]): PipelineResult {
  const pending = input.session.pendingClarification;
  const question = input.session.openQuestion ?? pending?.question ?? voiceCopy(input.language, 'held');
  if (!pending?.blocked.length) {
    if (envelope.kind === 'operations' && envelope.operations.length) {
      clearDialogue(input.session);
      input.session.pendingClarification = null;
      input.session.heldIntents = [];
      input.session.adaptedOpIds = [];
      return operationsTurn(input, envelope, traces);
    }
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: question, clarifyCount: 1 }), { traces, blocked: ['answer_not_applied'] });
  }
  pending.history = [...pending.history, input.transcript];
  const merged = mergeAnswer(pending.blocked, envelope.operations);
  if (!merged.ok) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: question, clarifyCount: 1 }), { traces, blocked: [merged.code] });
  }
  input.session.pendingClarification = {
    ...pending,
    blocked: merged.operations.map((operation) => ({
      operation,
      code: pending.blocked.find((row) => row.operation.opId === operation.opId)?.code ?? 'reprocess',
    })),
  };
  const prior = input.session.heldIntents;
  return operationsTurn(input, { version: '1', kind: 'operations', operations: merged.operations }, traces, prior, { allowIdDisambiguation: true });
}

function draftView(draft: PlanDraft): DayPlanProposal {
  return {
    day: draft.day,
    stage: draft.stage,
    revision: draft.revision,
    items: draft.items.map((item) => ({
      itemId: item.id,
      taskId: item.taskId,
      source: item.source,
      name: item.name,
      start: '',
      end: '',
      durationMinutes: item.durationMinutes,
    })),
    unplaced: [],
    changedItemIds: [],
  };
}

function proposalProblems(draft: PlanDraft, proposal: DayPlanProposal): string[] {
  const problems: string[] = [];
  if (proposal.day !== draft.day) problems.push('proposal_day');
  const draftIds = new Set(draft.items.map((item) => item.id));
  const seen = new Set<string>();
  for (const item of proposal.items) {
    if (!draftIds.has(item.itemId)) problems.push('proposal_unknown_item');
    if (seen.has(item.itemId)) problems.push('proposal_duplicate_item');
    seen.add(item.itemId);
  }
  for (const row of proposal.unplaced) {
    if (!draftIds.has(row.itemId)) problems.push('proposal_unknown_item');
    if (seen.has(row.itemId)) problems.push('proposal_duplicate_item');
    seen.add(row.itemId);
  }
  return [...new Set(problems)];
}

function intentCovers(item: DayPlanProposalItem, intents: VoiceWriteIntent[], proposal: DayPlanProposal, context: PlanDraftContext, used: Set<number>): boolean {
  if (item.source === 'flexible' && item.taskId) {
    const slot = daySlotFor(item.taskId, proposal.day, context);
    if (slot && new Date(slot.scheduledStartTime).getTime() === new Date(item.start).getTime()) return true;
  }
  const index = intents.findIndex((intent, position) => {
    if (used.has(position)) return false;
    if (item.source === 'new' && intent.type === 'create') return intent.task.name === item.name;
    return intent.type === 'command' && intent.command.taskId === item.taskId;
  });
  if (index < 0) return false;
  used.add(index);
  return true;
}

/** Prerequisites run before dependents, so a failed prerequisite cannot leave an executable dependent. */
function dependencyOrder<T extends { opId: string; dependsOn: string[]; canceled: boolean }>(operations: T[]): T[] {
  const pending = operations.filter((operation) => !operation.canceled);
  const ids = new Set(pending.map((operation) => operation.opId));
  const ordered: T[] = [];
  const done = new Set<string>();
  while (pending.length) {
    const ready = pending.findIndex((operation) => operation.dependsOn.every((dep) => !ids.has(dep) || done.has(dep)));
    if (ready < 0) {
      ordered.push(...pending);
      break;
    }
    const [next] = pending.splice(ready, 1);
    if (!next) break;
    ordered.push(next);
    done.add(next.opId);
  }
  return ordered;
}

function openClarification(input: TurnInput, traces: TraceEvent[], code: string): PipelineResult | null {
  if (!input.session.pendingClarification || !input.session.openQuestion) return null;
  return done(
    input,
    reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: input.session.openQuestion, clarifyCount: 1 }),
    { traces, blocked: [code] },
  );
}

function operationsTurn(
  input: TurnInput,
  envelope: SemanticEnvelopeV1,
  traces: TraceEvent[],
  priorIntents: VoiceWriteIntent[] = [],
  options?: { allowIdDisambiguation?: boolean },
): PipelineResult {
  const priorUserTurns = input.session.turns.filter((turn) => turn.role === 'user').slice(0, -1).map((turn) => turn.text);
  envelope = { ...envelope, operations: [...envelope.operations] };
  const expanded = expandScope(envelope.operations, input.userId, input.entities, input.searchReceipt, input.catalogSearch);
  if (expanded.unresolved) {
    const code = expanded.code ?? 'unresolved_scope';
    const asking = openClarification(input, traces, code);
    if (asking) return asking;
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'scope'), clarifyCount: 1 }), { traces, blocked: [code] });
  }
  const present = new Set(expanded.operations.map((operation) => operation.opId));
  const adapted = new Set(input.session.adaptedOpIds);
  const operations = expanded.operations.map((operation) => ({
    ...operation,
    dependsOn: operation.dependsOn.filter((dep) => present.has(dep) || !adapted.has(dep)),
  }));
  const graph = normalizeOperations(operations);
  traces.push({ name: 'graph', fields: { issues: graph.issues.map((issue) => issue.code).join(',') || 'none' } });
  if (input.trace) {
    input.trace.semanticOperations = envelope.operations;
    input.trace.dependencyResolution = graph.operations.map((operation) => ({
      opId: operation.opId,
      action: operation.action,
      dependsOn: operation.dependsOn,
      canceled: operation.canceled,
      blockedBy: operation.blockedBy ?? null,
    }));
  }
  if (graph.issues.some((issue) => issue.code === 'cycle')) {
    const asking = openClarification(input, traces, 'cycle');
    if (asking) return asking;
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), { traces, blocked: ['cycle'] });
  }
  const active = graph.operations.filter((operation) => !operation.canceled && !operation.blockedBy);
  if (!withinWriteCap(active.length)) {
    const asking = openClarification(input, traces, 'segment_limit');
    if (asking) return asking;
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'segment_limit'), actions: ['retry'] }), { traces, blocked: ['segment_limit'] });
  }
  if (!graph.operations.some((operation) => !operation.canceled)) {
    if (input.session.pendingClarification) {
      const held = priorIntents;
      clearDialogue(input.session);
      input.session.pendingClarification = null;
      input.session.heldIntents = [];
      input.session.adaptedOpIds = [];
      input.session.canceledOpIds = [];
      if (held.length) {
        input.session.pendingIntents = held;
        input.session.pendingSummary = held.map((intent) => intent.summary).join(' ');
        return done(input, reply(input.session.sessionId, { outcome: 'confirm', assistantMessage: input.session.pendingSummary, intents: held, actions: ['confirm', 'cancel'] }), { traces });
      }
    }
    input.session.pendingIntents = null;
    input.session.pendingSummary = null;
    input.session.pendingOperations = [];
    input.session.previewRevisions = {};
    input.session.previewAccess = {};
    input.session.previewTargetIds = [];
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'canceled') }), { traces });
  }
  const intents: VoiceWriteIntent[] = [];
  const blocked: string[] = [];
  const blockedOps: BlockedOperation[] = [];
  const preservedLabels: string[] = [];
  const failed = new Set<string>();
  const adaptedThisTurn: string[] = [];
  let question = false;
  const canceledIds = new Set<string>([...input.session.canceledOpIds, ...graph.operations.filter((operation) => operation.canceled).map((operation) => operation.opId)]);
  const ordered = dependencyOrder(graph.operations);
  const duplicated = new Set(graph.issues.filter((issue) => issue.code === 'duplicate_op' && issue.opId).map((issue) => issue.opId as string));
  const missing = new Set(graph.issues.filter((issue) => issue.code === 'missing_dependency' && issue.opId).map((issue) => issue.opId as string));
  const remember = (operation: SemanticOperationV1, code: string) => {
    blocked.push(code);
    failed.add(operation.opId);
    blockedOps.push({ operation: semanticOf(operation), code });
    question = true;
  };
  for (const operation of ordered) {
    if (operation.canceled) continue;
    if (operation.dependsOn.some((dep) => canceledIds.has(dep))) {
      input.trace?.adapterResults.push({ opId: operation.opId, intent: null, blocked: 'prerequisite_canceled' });
      remember(operation, 'prerequisite_canceled');
      continue;
    }
    const dependencyFailed = operation.blockedBy === 'prerequisite_canceled' || operation.dependsOn.some((dep) => failed.has(dep));
    if (operation.blockedBy || dependencyFailed || duplicated.has(operation.opId) || missing.has(operation.opId)) {
      const code = duplicated.has(operation.opId)
        ? 'duplicate_op'
        : missing.has(operation.opId)
          ? 'missing_dependency'
          : operation.blockedBy ?? 'prerequisite_failed';
      input.trace?.adapterResults.push({ opId: operation.opId, intent: null, blocked: code });
      remember(operation, code);
      continue;
    }
    const resolution = resolveTarget({
      target: operation.target,
      userId: input.userId,
      entities: input.entities,
      referents: input.session.referents,
      write: true,
      action: operation.action,
      allowIdDisambiguation: options?.allowIdDisambiguation === true,
      trustedSetMember: operation.trustedSetMember === true,
    });
    const when = resolveConstraints(operation.constraints, clockOf(input));
    traces.push({
      name: 'resolve',
      fields: { opId: operation.opId, target: resolution.status, when: when.map((row) => row.status).join(',') || 'none' },
    });
    input.trace?.referenceResolution.push({ opId: operation.opId, resolution });
    input.trace?.policyDecisions.push({ opId: operation.opId, previewRequired: true });
    const adapted = adaptOperation({
      operation,
      resolution,
      when,
      entities: input.entities,
      language: input.language,
      timeZone: input.timeZone,
      wakeHm: input.wakeHm,
      sleepHm: input.sleepHm,
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultReminderTime: input.defaultReminderTime || '09:00',
      userId: input.userId,
    });
    input.trace?.adapterResults.push({ opId: adapted.opId, blocked: adapted.blocked ?? null, preservedLabel: adapted.preservedLabel ?? null, intent: adapted.intent });
    if (adapted.preservedLabel) preservedLabels.push(adapted.preservedLabel);
    if (!adapted.intent) {
      remember(operation, adapted.blocked ?? 'blocked');
      continue;
    }
    const broken = integrityFailure(operation, adapted.intent, when, resolution);
    if (broken) {
      input.trace?.adapterResults.push({ opId: operation.opId, intent: null, blocked: broken });
      remember(operation, broken);
      continue;
    }
    intents.push(adapted.intent);
    adaptedThisTurn.push(operation.opId);
    if (operation.target.kind === 'new') {
      input.session.referents[operation.target.localId] = { localId: operation.target.localId, phrase: operation.changes.title ?? operation.target.localId };
    }
  }
  if (question) {
    const permissionOnly = intents.length === 0 && blocked.length > 0 && blocked.every((code) => code === 'external_readonly' || code === 'wrong_calendar' || code === 'ineligible');
    if (permissionOnly) {
      return done(
        input,
        reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'calendar'), clarifyCount: 1 }),
        { traces, blocked, preservedLabels },
      );
    }
    input.session.heldIntents = [...priorIntents, ...intents];
    input.session.adaptedOpIds = [...new Set([...input.session.adaptedOpIds, ...adaptedThisTurn])];
    input.session.canceledOpIds = [...canceledIds];
    input.session.pendingIntents = null;
    input.session.pendingSummary = null;
    const ask = questionCode(blocked);
    const text = voiceCopy(input.language, ask);
    askDialogue(input.session, { id: blockedOps[0]?.operation.opId ?? 'question', question: text, missing: ask, operationId: blockedOps[0]?.operation.opId ?? null });
    input.session.pendingClarification = {
      question: text,
      blocked: blockedOps,
      history: input.session.pendingClarification?.history ?? [],
      utterance: input.session.pendingClarification?.utterance || input.transcript,
    };
    return done(
      input,
      reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: text, clarifyCount: 1 }),
      { traces, blocked, preservedLabels },
    );
  }
  const preview = [...priorIntents, ...intents];
  input.session.pendingIntents = preview;
  input.session.pendingSummary = preview.map((intent) => describePreview(intent, input.timeZone)).join(' ');
  input.session.pendingOperations = ordered
    .filter((operation) => !operation.canceled && adaptedThisTurn.includes(operation.opId))
    .map((operation) => semanticOf(operation));
  input.session.previewRevisions = revisionsFor(preview, input.entities);
  input.session.previewAccess = accessFor(preview, input.entities);
  input.session.previewTargetIds = expanded.targetIds;
  input.session.previewSuspended = false;
  input.session.heldIntents = [];
  input.session.adaptedOpIds = [];
  input.session.canceledOpIds = [];
  input.session.pendingClarification = null;
  clearDialogue(input.session);
  return done(
    input,
    reply(input.session.sessionId, {
      outcome: 'confirm',
      assistantMessage: `${voiceCopy(input.language, 'preview')} ${input.session.pendingSummary}`,
      intents: preview,
      actions: ['confirm', 'cancel'],
    }),
    { traces, preservedLabels },
  );
}

async function dayPlanTurn(input: TurnInput, envelope: SemanticEnvelopeV1, traces: TraceEvent[]): Promise<PipelineResult> {
  const command = envelope.dayPlan;
  if (!command) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), { traces });
  }
  if (command.phase === 'cancel') {
    input.session.planDraft = null;
    input.session.qualitativeByItemId = {};
    clearPending(input.session);
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'canceled') }), { traces });
  }
  const day = command.day || input.session.planDraft?.day;
  if (command.phase === 'start') {
    if (!day) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), { traces, blocked: ['invalid_date'] });
    }
    if (!input.planContext) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), { traces, blocked: ['day_context_missing'] });
    }
    input.session.planDraft = { ...initialPlanDraft(day, input.planContext), stage: 'interview' };
  }
  if (!input.session.planDraft) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), { traces, blocked: ['no_open_plan'] });
  }
  const qualitative: string[] = [];
  const edits: PlanEdit[] = [];
  for (const edit of command.edits ?? []) {
    const mapped = toPlanEdit(edit, input);
    edits.push(mapped.edit);
    if (mapped.qualitative) qualitative.push(mapped.qualitative);
    if (edit.op === 'set_preferred_start' && edit.qualitative) {
      input.session.qualitativeByItemId[edit.itemId] = edit.qualitative;
    }
  }
  const needsTasks = edits.some((edit) => edit.op === 'include_task');
  if (needsTasks && !input.planContext) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), { traces, blocked: ['day_context_missing'], preservedLabels: qualitative });
  }
  const unknown = input.planContext
    ? edits.flatMap((edit) => (edit.op === 'include_task' && !input.planContext?.tasks.some((task) => task.id === edit.taskId) ? [edit.taskId] : []))
    : [];
  if (unknown.length) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      blocked: unknown.map(() => 'unknown_task'),
      preservedLabels: qualitative,
    });
  }
  const blocked: string[] = [];
  if (edits.length) {
    const beforeIds = new Set(input.session.planDraft.items.map((item) => item.id));
    const applied = applyPlanEdits(input.session.planDraft, edits, input.planContext ?? {
      tasks: [],
      slots: [],
      timeZone: input.timeZone,
      nowIso: input.nowIso,
      defaultDurationMinutes: input.defaultDurationMinutes,
    });
    const created = applied.draft.items.filter((item) => item.source === 'new' && !beforeIds.has(item.id));
    const adds = (command.edits ?? []).filter((edit) => edit.op === 'add_task');
    adds.forEach((edit, index) => {
      const item = created[index];
      if (item && edit.qualitative) input.session.qualitativeByItemId[item.id] = edit.qualitative;
    });
    input.session.planDraft = { ...applied.draft, stage: input.session.planDraft.stage };
    for (const skip of applied.skipped) blocked.push(skip.reason);
  }
  const draft = input.session.planDraft;
  const unresolvedLabels = draft.items.flatMap((item) => {
    const label = storedQualitative(input.session.qualitativeByItemId[item.id]);
    if (!label) return [];
    const mapped = mapQualitative({ label, bound: 'at', wakeHm: input.wakeHm, sleepHm: input.sleepHm });
    return mapped.status === 'unmapped' ? [label] : [];
  });
  if (command.phase === 'apply' && unresolvedLabels.length) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      blocked: ['unmapped_time'],
      preservedLabels: unresolvedLabels,
    });
  }
  if (command.phase === 'apply') {
    if (!input.proposeDay || !input.planContext) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        blocked: [...blocked, input.planContext ? 'day_planner_unavailable' : 'day_context_missing'],
        preservedLabels: qualitative,
      });
    }
    let proposal: DayPlanProposal;
    try {
      proposal = await input.proposeDay(input.userId, draft, input.timeZone);
    } catch {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), { traces, blocked: ['day_planner_failed'], preservedLabels: qualitative });
    }
    const problems = proposalProblems(draft, proposal);
    if (problems.length) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        blocked: [...blocked, ...problems],
        preservedLabels: qualitative,
      });
    }
    const accounted = new Set([...proposal.items.map((item) => item.itemId), ...proposal.unplaced.map((row) => row.itemId)]);
    const omitted = draft.items.filter((item) => !accounted.has(item.id));
    if (omitted.length) {
      proposal = {
        ...proposal,
        unplaced: [...proposal.unplaced, ...omitted.map((item) => ({ itemId: item.id, name: item.name, reason: 'no_room' as const }))],
      };
      blocked.push('proposal_omitted_item');
    }
    let intents = planToIntents(proposal, { ...input.planContext, language: input.language });
    const usedIntents = new Set<number>();
    const uncovered = proposal.items.filter((item) => !intentCovers(item, intents, proposal, input.planContext!, usedIntents));
    if (uncovered.length) {
      const uncoveredIds = new Set(uncovered.map((item) => item.itemId));
      proposal = {
        ...proposal,
        items: proposal.items.filter((item) => !uncoveredIds.has(item.itemId)),
        unplaced: [...proposal.unplaced, ...uncovered.map((item) => ({ itemId: item.itemId, name: item.name, reason: 'no_room' as const }))],
      };
      intents = planToIntents(proposal, { ...input.planContext, language: input.language });
      blocked.push('proposal_unplaced');
    }
    input.session.pendingIntents = intents;
    input.session.pendingSummary = intents.map((intent) => intent.summary).join(' ');
    input.session.heldIntents = [];
    input.session.adaptedOpIds = [];
    input.session.canceledOpIds = [];
    clearDialogue(input.session);
    input.session.pendingClarification = null;
    return done(
      input,
      reply(input.session.sessionId, {
        outcome: 'confirm',
        assistantMessage: input.session.pendingSummary || voiceCopy(input.language, 'held'),
        intents,
        actions: ['confirm', 'cancel'],
        plan: proposal,
      }),
      { traces, blocked, preservedLabels: qualitative },
    );
  }
  return done(
    input,
    reply(input.session.sessionId, {
      outcome: draft.stage === 'review' ? 'confirm' : 'clarify',
      assistantMessage: command.question || voiceCopy(input.language, 'held'),
      actions: draft.stage === 'review' ? ['confirm', 'cancel'] : ['build_plan', 'cancel'],
      plan: draftView(draft),
    }),
    { traces, blocked, preservedLabels: qualitative },
  );
}

/** Experimental turn. Does not write tasks, reminders, or calendars. Structured path only. */
export async function runVNextTurn(input: TurnInput, interpreter: VNextInterpreter): Promise<PipelineResult> {
  return runStructuredTurn(input, interpreter);
}
