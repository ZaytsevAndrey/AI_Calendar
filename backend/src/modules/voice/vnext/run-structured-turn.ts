/**
 * Structured vNext turn. No linguistic recovery.
 * Not connected to VoiceController or VoiceService.
 */
import type { VoiceTurnResponse, VoiceWriteIntent } from '../voice-agent.types';
import { expandStructuredScope } from './adapter/structured-scope';
import { envelopeToProposalGroup } from './contracts/envelope-to-proposal';
import type { ProposalGroup } from './contracts/proposal';
import type { SemanticEnvelopeV1 } from './contracts/types';
import { voiceCopy } from './copy';
import { handleStructuredDayPlan } from './day-plan/structured-day-plan';
import { evidenceCovers } from './evidence/evidence';
import { ask as askDialogue, clearDialogue } from './session/dialogue';
import { appendTurn, clearPending, intentKey, invalidateLegacyPreview, pinArm, type VNextSession } from './session/session';
import { prepareStructuredPreview } from './state/prepare-preview';
import { readPreviewEntities, revalidateFingerprints } from './state/revalidate-preview';
import {
  cancelPreview,
  confirmPreview,
  createStructuredState,
  sequenceAllocator,
  setConfirmationBlock,
  type KnownEntity,
  type StructuredState,
} from './state/structured-state';
import type { EntityRecord } from './reference/reference-resolver';
import type { InterpretOutput, PipelineResult, TraceEvent, TurnInput, VNextInterpreter } from './pipeline';
// Types only — avoid a runtime cycle with pipeline.ts.

const ZERO = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

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
  return {
    response,
    traces: extra.traces ?? [],
    serverWrites: 0,
    usage: extra.usage ?? ZERO,
    specialist: extra.specialist ?? null,
    blocked: extra.blocked ?? [],
    preservedLabels: extra.preservedLabels ?? [],
  };
}

export function entitiesToKnown(entities: EntityRecord[], userId: string): KnownEntity[] {
  return entities
    .filter((entity) => entity.userId === userId)
    .map((entity) => ({
      entityId: entity.id,
      entityType: entity.type === 'external_event' ? 'external_event' : entity.type === 'reminder' ? 'reminder' : 'task',
      revision: entity.revision ?? 1,
      calendarId: entity.calendarId ?? null,
      writable: entity.type === 'external_event' ? entity.writable === true : entity.writable !== false,
      ...(entity.googleEventId != null ? { googleEventId: entity.googleEventId } : {}),
      ...(entity.scheduledStart != null ? { scheduledStart: entity.scheduledStart } : {}),
      ...(entity.scheduledEnd != null ? { scheduledEnd: entity.scheduledEnd } : {}),
      ...(entity.status ? { status: entity.status } : {}),
      ...(entity.recurring ? { recurring: true } : {}),
      ...(entity.provider ? { provider: entity.provider } : {}),
      ...(entity.occurrences ? { occurrences: entity.occurrences } : {}),
      ...(entity.seriesEventId != null ? { seriesEventId: entity.seriesEventId } : {}),
      ...(entity.name ? { name: entity.name } : {}),
      ...(entity.fixed ? { fixed: true } : {}),
    }));
}

/** Copy for a preview that could not be prepared. The code stays in `blocked`; this only picks the question. */
function blockedCopy(code: string): Parameters<typeof voiceCopy>[1] {
  if (code === 'ineligible') return 'cannot_change';
  if (code === 'wrong_calendar') return 'calendar';
  if (code === 'missing_series_scope') return 'which_series';
  if (code === 'missing_day') return 'which_day';
  if (code === 'missing_title') return 'need_title';
  if (code === 'gap') return 'dst_gap';
  if (code === 'fold') return 'dst_fold';
  if (code === 'event_no_done') return 'event_no_done';
  if (code === 'missing_predecessor_time') return 'predecessor';
  if (code === 'unsupported_dependency_execution') return 'dependency';
  if (code === 'missing_clock') return 'which_clock';
  if (code === 'unsupported_action') return 'unsupported';
  if (code === 'contradictory_constraints') return 'contradictory';
  if (code === 'unrepresentable_schedule') return 'which_day';
  if (code === 'unmapped_time') return 'need_clock';
  if (code === 'missing_occurrence' || code === 'occurrence_not_found' || code === 'ambiguous_occurrence') return 'which_occurrence';
  if (code === 'empty_patch') return 'what_change';
  if (code === 'unrepresented_constraint' || code === 'unsupported_series_scope' || code === 'unrepresentable_move' || code === 'unrepresentable_delete' || code === 'unrepresentable_update') {
    return 'unrepresented';
  }
  return 'which_task';
}

function ensureStructured(session: VNextSession): StructuredState {
  if (!session.structured) session.structured = createStructuredState(session.sessionId);
  return session.structured;
}

function publishPreview(session: VNextSession, state: StructuredState, intents: VoiceWriteIntent[], summary: string): void {
  session.protocol = 'structured';
  session.structured = state;
  session.structuredIntents = intents;
  session.pendingIntents = intents;
  session.pendingSummary = summary;
  session.previewSuspended = false;
  session.openQuestion = null;
  session.pendingClarification = null;
}

function summarize(intents: VoiceWriteIntent[]): string {
  return intents.map((intent) => intent.summary).filter(Boolean).join(' ') || 'preview';
}

export async function runStructuredTurn(input: TurnInput, interpreter: VNextInterpreter): Promise<PipelineResult> {
  const traces: TraceEvent[] = [{ name: 'turn', fields: { arm: input.arm, chars: input.transcript.length, protocol: 'structured' } }];
  if (input.session.userId !== input.userId) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'cannot_change') }), { traces, blocked: ['cross_user'] });
  }
  if (!pinArm(input.session, input.arm)) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'unsupported') }), { traces, blocked: ['arm_pinned'] });
  }
  if (input.transcript) appendTurn(input.session, 'user', input.transcript);
  invalidateLegacyPreview(input.session);

  const interpreted = await interpreter.interpret(turnUser(input), input.transcript);
  traces.push({
    name: 'interpret',
    fields: { ok: interpreted.ok, specialist: interpreted.specialist, promptHash: interpreted.promptHash, calls: interpreted.usage.calls },
  });
  const transport = transportCopy(interpreted.code);
  if (!interpreted.ok && transport) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, transport), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
      blocked: [interpreted.code ?? 'provider_or_transport_error'],
    });
  }
  if (!interpreted.ok) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
      blocked: [interpreted.code ?? 'invalid_model_output'],
    });
  }

  const group = resolveGroup(interpreted, input);
  if (group) return await handleGroup(input, group, interpreted, traces);

  const envelope = interpreted.envelope;
  if (!envelope) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
      blocked: ['invalid_model_output'],
    });
  }
  if (envelope.kind === 'answer') return handleAnswer(input, envelope, interpreted, traces);
  if (envelope.kind === 'clarification') return handleClarification(input, envelope, interpreted, traces);
  if (envelope.kind === 'day_plan') {
    return handleStructuredDayPlan(input, envelope, interpreted, traces);
  }
  return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'unsupported') }), {
    traces,
    usage: interpreted.usage,
    blocked: ['unsupported'],
  });
}

function resolveGroup(interpreted: InterpretOutput, input: TurnInput): ProposalGroup | null {
  if (interpreted.group) return interpreted.group;
  if (interpreted.envelope) {
    return envelopeToProposalGroup(interpreted.envelope, { nowIso: input.nowIso, timeZone: input.timeZone });
  }
  return null;
}

async function handleGroup(input: TurnInput, group: ProposalGroup, interpreted: InterpretOutput, traces: TraceEvent[]): Promise<PipelineResult> {
  if (group.control === 'confirm') return handleConfirm(input, group, interpreted, traces);
  if (group.control === 'cancel') return handleCancel(input, interpreted, traces);
  if (group.control === 'pause') {
    const state = ensureStructured(input.session);
    const blocked = setConfirmationBlock({ state, expectedSessionVersion: state.sessionVersion, blocked: true });
    if (blocked.ok) input.session.structured = blocked.state;
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'which_task'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: ['clarification_open'],
    });
  }

  // Nothing left to change (for example a create that the same utterance deleted). An open preview stays as it was.
  if (!group.proposals.length && !group.patches.length) {
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'no_pending') }), {
      traces,
      usage: interpreted.usage,
    });
  }

  const expanded = expandStructuredScope(
    group.proposals,
    input.userId,
    input.entities,
    input.searchReceipt,
    input.catalogSearch,
  );
  if (!expanded.ok) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'scope'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [expanded.code],
    });
  }
  // The V1 bridge cannot tell a task from a provider event. The authorized catalog row decides.
  const working: ProposalGroup = {
    ...group,
    proposals: expanded.proposals.map((proposal) => {
      if (proposal.target.kind !== 'entity' || proposal.entityType !== 'task') return proposal;
      const entityId = proposal.target.entityId;
      const row = input.entities.find((entity) => entity.id === entityId && entity.userId === input.userId);
      return row?.type === 'external_event' ? { ...proposal, entityType: 'external_event' as const } : proposal;
    }),
  };

  if (working.proposals.some((proposal) => proposal.target.kind === 'unresolved')) {
    const reason = working.proposals.find((proposal) => proposal.target.kind === 'unresolved')?.target;
    const code = reason && reason.kind === 'unresolved' && reason.reason === 'ambiguous' ? 'ambiguous' : 'unresolved_target';
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'which_task'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [code],
    });
  }
  const known = entitiesToKnown(input.entities, input.userId);
  const catalogIds = known.map((entity) => entity.entityId);
  const unauthorized = working.proposals.some((proposal) =>
    proposal.target.kind === 'entity' && !catalogIds.includes(proposal.target.entityId));
  if (unauthorized) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'cannot_change') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['unauthorized_entity'],
    });
  }
  // A calendar the model named must be the calendar the authorized row is on. The id is not re-resolved.
  const wrongCalendar = working.proposals.some((proposal) => {
    if (proposal.target.kind !== 'entity' || !proposal.calendarId) return false;
    const entityId = proposal.target.entityId;
    return known.find((entity) => entity.entityId === entityId)?.calendarId !== proposal.calendarId;
  });
  if (wrongCalendar) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'calendar'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: ['wrong_calendar'],
    });
  }
  const previous = ensureStructured(input.session);
  const prepared = prepareStructuredPreview({
    state: previous,
    group: {
      ...working,
      ...(previous.operations.length && working.proposals.length && !working.previewBoundary
        ? { previewBoundary: 'extend' as const }
        : {}),
    },
    entities: known,
    ids: sequenceAllocator(previous.sessionVersion * 100),
    timeZone: input.timeZone,
    catalogEntityIds: catalogIds,
    userId: input.userId,
    defaultDurationMinutes: input.defaultDurationMinutes,
    defaultReminderTime: input.defaultReminderTime,
    nowIso: input.nowIso,
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
    language: input.language,
  });
  if (!prepared.ok) {
    traces.push({ name: 'prepare', fields: { ok: false, code: prepared.code } });
    if (prepared.code === 'unauthorized_entity' || prepared.code === 'forged') {
      const external = working.proposals.some((proposal) => {
        if (proposal.target.kind !== 'entity') return false;
        const row = input.entities.find((entity) => entity.id === (proposal.target as { entityId: string }).entityId);
        return row?.type === 'external_event';
      });
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'cannot_change') }), {
        traces,
        usage: interpreted.usage,
        blocked: prepared.code === 'unauthorized_entity' && external
          ? ['unauthorized_entity', 'external_readonly']
          : [prepared.code],
      });
    }
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, blockedCopy(prepared.code)), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [prepared.code],
      preservedLabels: prepared.code === 'unmapped_time' ? prepared.detail.split(',').filter(Boolean) : [],
    });
  }
  const summary = summarize(prepared.intents);
  publishPreview(input.session, prepared.state, prepared.intents, summary);
  input.session.previewTargetIds = expanded.targetIds;
  traces.push({
    name: 'preview',
    fields: {
      ok: true,
      executionId: prepared.state.preview?.executionId ?? '',
      previewRevision: prepared.state.preview?.previewRevision ?? 0,
      intents: prepared.intents.length,
    },
  });
  return done(input, reply(input.session.sessionId, {
    outcome: 'confirm',
    assistantMessage: summary,
    intents: prepared.intents,
    actions: ['confirm', 'cancel'],
  }), { traces, usage: interpreted.usage, specialist: interpreted.specialist, preservedLabels: prepared.preservedLabels });
}

async function handleConfirm(input: TurnInput, group: ProposalGroup, interpreted: InterpretOutput, traces: TraceEvent[]): Promise<PipelineResult> {
  if (group.proposals.length || group.patches.length) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['confirm_with_mutation'],
    });
  }
  // An open question outranks a yes: the yes is not an answer to it.
  if (input.session.openQuestion || input.session.pendingClarification || input.session.structured?.blocksConfirmation) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: input.session.openQuestion || voiceCopy(input.language, 'which_task'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: ['clarification_open'],
    });
  }
  const claim = input.confirmation;
  if (!claim?.executionId || claim.previewRevision == null) {
    const open = input.session.protocol === 'structured' && input.session.structured?.preview?.executionState === 'open';
    if (!open) {
      return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'no_pending') }), {
        traces,
        usage: interpreted.usage,
        blocked: ['no_pending'],
      });
    }
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'confirm_not_explicit') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['missing_confirmation_claim'],
    });
  }
  if (input.session.protocol !== 'structured' || !input.session.structured) {
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'no_pending') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['legacy_or_missing_preview'],
    });
  }
  const stateAtStart = input.session.structured;
  const expectedSessionVersion = stateAtStart.sessionVersion;
  if (
    !stateAtStart.preview
    || stateAtStart.preview.executionId !== claim.executionId
    || stateAtStart.preview.previewRevision !== claim.previewRevision
    || stateAtStart.preview.executionState !== 'open'
  ) {
    const duplicate = stateAtStart.executions.some((record) =>
      record.state === 'dispatched'
      && record.executionId === claim.executionId
      && record.previewRevision === claim.previewRevision);
    return done(input, reply(input.session.sessionId, {
      outcome: duplicate ? 'answer' : 'clarify',
      assistantMessage: voiceCopy(input.language, duplicate ? 'already_applied' : 'stale'),
      clarifyCount: duplicate ? 0 : 1,
    }), {
      traces,
      usage: interpreted.usage,
      blocked: duplicate ? ['duplicate_confirm', 'already_applied'] : ['stale_execution'],
    });
  }

  if (input.session.previewTargetIds.length) {
    const receiptIds = input.searchReceipt?.ids;
    if (receiptIds) {
      const previous = [...input.session.previewTargetIds].sort();
      const next = [...receiptIds].sort();
      if (previous.length !== next.length || previous.some((id, index) => id !== next[index])) {
        return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
          traces,
          usage: interpreted.usage,
          blocked: ['stale_scope'],
        });
      }
    }
  }

  // A write whose earlier outcome is unknown may already be stored. It is not sent again until that is known.
  const previewKeys = new Set((input.session.structuredIntents ?? input.session.pendingIntents ?? []).map(intentKey));
  if (input.session.applyLedger.some((row) => row.status === 'unknown' && previewKeys.has(row.key))) {
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'unknown') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['unknown_apply'],
    });
  }

  const fingerprints = stateAtStart.entityFingerprints ?? {};
  const reads = await readPreviewEntities(
    fingerprints,
    input.readEntity,
    input.entities.map((entity) => ({
      entityId: entity.id,
      exists: true,
      revision: entity.revision,
      calendarId: entity.calendarId ?? null,
      writable: entity.type === 'external_event' ? entity.writable === true : entity.writable !== false,
      googleEventId: entity.googleEventId ?? null,
      status: entity.status,
      userId: entity.userId,
    })),
  );
  if (!reads.ok) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [reads.code],
    });
  }
  const revalidated = revalidateFingerprints(fingerprints, reads.reads, input.userId);
  if (!revalidated.ok) {
    // Retire only the preview this claim named. A correction that landed during the reads owns the session now.
    const current = input.session.structured;
    const unchanged = current?.sessionVersion === expectedSessionVersion
      && current.preview?.executionId === claim.executionId
      && current.preview.previewRevision === claim.previewRevision;
    if (!unchanged) {
      return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
        traces,
        usage: interpreted.usage,
        blocked: [revalidated.code, 'version_conflict'],
      });
    }
    clearPending(input.session);
    if (input.session.structured?.preview?.executionState === 'open') {
      const preview = input.session.structured.preview;
      input.session.structured = {
        ...input.session.structured,
        preview: { ...preview, executionState: 'superseded' },
        executions: input.session.structured.executions.map((record) =>
          record.executionId === preview.executionId && record.state === 'open'
            ? { ...record, state: 'superseded' as const }
            : record,
        ),
      };
    }
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [revalidated.code],
    });
  }

  const stateAfterReads = input.session.structured;
  if (!stateAfterReads || stateAfterReads.sessionVersion !== expectedSessionVersion) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: ['version_conflict'],
    });
  }
  if (
    !stateAfterReads.preview
    || stateAfterReads.preview.executionId !== claim.executionId
    || stateAfterReads.preview.previewRevision !== claim.previewRevision
    || stateAfterReads.preview.executionState !== 'open'
  ) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: ['version_conflict'],
    });
  }

  const confirmed = confirmPreview({
    state: stateAfterReads,
    expectedSessionVersion,
    executionId: claim.executionId,
    previewRevision: claim.previewRevision,
  });
  if (!confirmed.ok) {
    return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
      traces,
      usage: interpreted.usage,
      blocked: [confirmed.code],
    });
  }
  if (confirmed.duplicate) {
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'already_applied') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['duplicate_confirm', 'already_applied'],
    });
  }
  const intents = input.session.structuredIntents ?? input.session.pendingIntents ?? [];
  const summary = input.session.pendingSummary ?? summarize(intents);
  clearPending(input.session);
  input.session.protocol = 'structured';
  input.session.structured = confirmed.state;
  for (const intent of intents) {
    const key = intentKey(intent);
    if (!input.session.appliedKeys.includes(key)) input.session.appliedKeys.push(key);
    if (!input.session.applyLedger.some((row) => row.key === key)) input.session.applyLedger.push({ key, status: 'pending' });
  }
  return done(input, reply(input.session.sessionId, {
    outcome: 'act',
    assistantMessage: `${voiceCopy(input.language, 'applied_local')} ${summary}`,
    intents,
  }), { traces, usage: interpreted.usage, specialist: interpreted.specialist });
}

/**
 * Cancel never dispatches, so it does not need a claim. A claim names the preview to cancel; without one
 * the open preview is cancelled. Either way the structured preview is retired, so a later yes or a later
 * preview cannot bring its operations back.
 */
function handleCancel(input: TurnInput, interpreted: InterpretOutput, traces: TraceEvent[]): PipelineResult {
  const claim = input.confirmation;
  const state = input.session.structured;
  if (state?.preview?.executionState === 'open') {
    const named = claim?.executionId && claim.previewRevision != null;
    const cancelled = cancelPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: named ? claim.executionId : state.preview.executionId,
      previewRevision: named ? claim.previewRevision : state.preview.previewRevision,
    });
    if (!cancelled.ok) {
      // The claim names a preview that is no longer the open one. The newer preview stays.
      return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: voiceCopy(input.language, 'stale'), clarifyCount: 1 }), {
        traces,
        usage: interpreted.usage,
        blocked: [cancelled.code],
      });
    }
    input.session.structured = cancelled.state;
  }
  clearPending(input.session);
  clearDialogue(input.session);
  // An open day-plan draft is independent of the preview; the day plan has its own cancel phase.
  return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'canceled') }), {
    traces,
    usage: interpreted.usage,
  });
}

function handleAnswer(input: TurnInput, envelope: SemanticEnvelopeV1, interpreted: InterpretOutput, traces: TraceEvent[]): PipelineResult {
  if (interpreted.reads.some((read) => !read.ok)) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'tool_error') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['tool_error'],
    });
  }
  const withheld = interpreted.reads.find((read) => read.withheld);
  if (withheld?.withheld) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'tool_error') }), {
      traces,
      usage: interpreted.usage,
      blocked: [withheld.withheld],
    });
  }
  if (input.evidenceNeed) {
    const covered = evidenceCovers(input.evidenceNeed, interpreted.reads);
    if (!covered.ok) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'evidence') }), {
        traces,
        usage: interpreted.usage,
        blocked: [covered.reason ?? 'evidence'],
      });
    }
  }
  const refs = envelope.answer?.evidenceRefs ?? [];
  if (refs.length && refs.some((ref) => !interpreted.reads.some((read) => read.requestId === ref && read.ok))) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'evidence') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['evidence'],
    });
  }
  return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: envelope.answer?.text ?? '' }), {
    traces,
    usage: interpreted.usage,
  });
}

function handleClarification(input: TurnInput, envelope: SemanticEnvelopeV1, interpreted: InterpretOutput, traces: TraceEvent[]): PipelineResult {
  const question = envelope.clarification?.question?.trim() ?? '';
  if (!question) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
      blocked: ['clarification_without_operation'],
    });
  }
  askDialogue(input.session, { id: 'clarification', question, missing: (envelope.clarification?.missing ?? []).join(','), operationId: null });
  input.session.pendingClarification = {
    question,
    blocked: [],
    history: [],
    utterance: input.transcript,
  };
  const state = ensureStructured(input.session);
  const blocked = setConfirmationBlock({ state, expectedSessionVersion: state.sessionVersion, blocked: true });
  if (blocked.ok) input.session.structured = blocked.state;
  return done(input, reply(input.session.sessionId, { outcome: 'clarify', assistantMessage: question, clarifyCount: 1 }), {
    traces,
    usage: interpreted.usage,
  });
}

function turnUser(input: TurnInput): string {
  return JSON.stringify({
    transcript: input.transcript,
    nowIso: input.nowIso,
    timeZone: input.timeZone,
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
    language: input.language,
    pending: Boolean(input.session.pendingIntents?.length || input.session.structured?.preview?.executionState === 'open'),
    protocol: input.session.protocol ?? 'structured',
    preview: input.session.structured?.preview
      ? { executionId: input.session.structured.preview.executionId, previewRevision: input.session.structured.preview.previewRevision }
      : null,
  });
}
