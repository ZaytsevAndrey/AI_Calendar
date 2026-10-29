/**
 * Structured day-plan handler. Reuses plan-draft tools and proposeDay.
 * Apply opens a structured preview; it does not write providers.
 */
import type { DayPlanProposal, DayPlanProposalItem, PlanDraft, VoiceWriteIntent } from '../../voice-agent.types';
import {
  applyPlanEdits,
  daySlotFor,
  initialPlanDraft,
  planToIntents,
  type PlanDraftContext,
  type PlanEdit,
} from '../../voice-agent.plan-draft';
import { TIME_OF_DAY_LABELS, type DayPlanEditV1, type SemanticEnvelopeV1, type TimeOfDayLabelV1 } from '../contracts/types';
import { voiceCopy } from '../copy';
import { mapQualitative } from '../qualitative/policy';
import { clearDialogue } from '../session/dialogue';
import { clearPending, type VNextSession } from '../session/session';
import { localHm, localYmd } from '../../voice-local-date.util';
import {
  createStructuredState,
  sequenceAllocator,
  type EntityFingerprint,
  type StructuredState,
} from '../state/structured-state';
import { withFingerprints } from '../state/revalidate-preview';
import type { PipelineResult, TraceEvent, TurnInput, InterpretOutput } from '../pipeline';

function reply(sessionId: string, partial: Partial<import('../../voice-agent.types').VoiceTurnResponse> & Pick<import('../../voice-agent.types').VoiceTurnResponse, 'outcome' | 'assistantMessage'>): import('../../voice-agent.types').VoiceTurnResponse {
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

function done(input: TurnInput, response: import('../../voice-agent.types').VoiceTurnResponse, extra: Partial<PipelineResult>): PipelineResult {
  return {
    response,
    traces: extra.traces ?? [],
    serverWrites: 0,
    usage: extra.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    specialist: extra.specialist ?? null,
    blocked: extra.blocked ?? [],
    preservedLabels: extra.preservedLabels ?? [],
  };
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

/**
 * Check the planner's placements against the draft and the agenda that was read.
 * The planner is trusted to search; it is not trusted to have found a real gap.
 */
function placementProblems(draft: PlanDraft, proposal: DayPlanProposal, context: PlanDraftContext): string[] {
  const problems: string[] = [];
  const byId = new Map(draft.items.map((item) => [item.id, item]));
  const reseated = new Set(proposal.items.flatMap((item) => (item.taskId ? [item.taskId] : [])));
  const spans: Array<{ start: number; end: number }> = [];
  for (const item of proposal.items) {
    const start = Date.parse(item.start);
    const end = Date.parse(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      problems.push('proposal_invalid_span');
      continue;
    }
    if (localYmd(item.start, context.timeZone) !== proposal.day) problems.push('proposal_day');
    const planned = byId.get(item.itemId);
    if (planned && planned.durationMinutes > 0 && Math.round((end - start) / 60_000) !== planned.durationMinutes) {
      problems.push('proposal_duration');
    }
    if (planned?.earliestHm && localHm(item.start, context.timeZone) < planned.earliestHm) problems.push('proposal_window');
    if (planned?.deadlineHm && localHm(item.end, context.timeZone) > planned.deadlineHm) problems.push('proposal_window');
    if (spans.some((span) => start < span.end && span.start < end)) problems.push('proposal_overlap');
    spans.push({ start, end });
  }
  // A slot of a task the plan does not re-seat is a fixed event on the agenda.
  for (const slot of context.slots) {
    if (reseated.has(slot.taskId)) continue;
    const start = new Date(slot.scheduledStartTime).getTime();
    const end = new Date(slot.scheduledEndTime).getTime();
    if (spans.some((span) => start < span.end && span.start < end)) problems.push('proposal_overlap');
  }
  return [...new Set(problems)];
}

/**
 * Freshness baseline for every stored task the plan writes. Only the authorized catalog vouches for
 * a revision; a row it does not carry is not given a made-up one.
 */
function planFingerprints(
  intents: VoiceWriteIntent[],
  input: TurnInput,
): { ok: true; fingerprints: Record<string, EntityFingerprint>; entityIds: string[] } | { ok: false; code: string } {
  const fingerprints: Record<string, EntityFingerprint> = {};
  const entityIds: string[] = [];
  for (const intent of intents) {
    if (intent.type !== 'command' || typeof intent.command.taskId !== 'string' || !intent.command.taskId) continue;
    const entityId = intent.command.taskId;
    const row = input.entities.find((entity) => entity.id === entityId);
    const task = input.planContext?.tasks.find((item) => item.id === entityId);
    if (!row || row.userId !== input.userId || row.type !== 'task' || (task?.userId != null && task.userId !== input.userId)) {
      return { ok: false, code: 'unauthorized_entity' };
    }
    if (row.writable === false) return { ok: false, code: 'unauthorized_entity' };
    if (row.status !== 'open') return { ok: false, code: 'ineligible' };
    if (row.revision == null) return { ok: false, code: 'revalidation_incomplete' };
    if (!entityIds.includes(entityId)) entityIds.push(entityId);
    fingerprints[entityId] = {
      entityId,
      revision: row.revision,
      calendarId: row.calendarId ?? null,
      writable: true,
      googleEventId: row.googleEventId ?? null,
      status: 'open',
      userId: input.userId,
      requiresMoveIdentity: false,
    };
  }
  return { ok: true, fingerprints, entityIds };
}

function intentCovers(
  item: DayPlanProposalItem,
  intents: VoiceWriteIntent[],
  proposal: DayPlanProposal,
  context: PlanDraftContext,
  used: Set<number>,
): boolean {
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

function publishPlanPreview(
  session: VNextSession,
  intents: VoiceWriteIntent[],
  entityIds: string[],
  fingerprints: Record<string, EntityFingerprint>,
): StructuredState {
  const previous = session.structured ?? createStructuredState(session.sessionId);
  const ids = sequenceAllocator(previous.sessionVersion * 100 + 1);
  const executionId = ids.executionId();
  const items = entityIds.map((entityId) => ({ pendingId: `plan_${entityId}`, revision: 1 }));
  const previewRevision = (previous.preview?.previewRevision ?? 0) + 1;
  const state = withFingerprints({
    ...previous,
    sessionVersion: previous.sessionVersion + 1,
    operations: previous.operations,
    preview: {
      protocol: 'structured' as const,
      previewRevision,
      executionId,
      executionState: 'open' as const,
      items,
    },
    executions: [
      ...previous.executions,
      {
        executionId,
        sessionId: session.sessionId,
        previewRevision,
        state: 'open' as const,
        itemKeys: entityIds,
        itemState: Object.fromEntries(entityIds.map((id) => [id, 'not_sent' as const])),
        sessionVersion: previous.sessionVersion + 1,
      },
    ],
  }, fingerprints);
  session.protocol = 'structured';
  session.structured = state;
  session.structuredIntents = intents;
  session.pendingIntents = intents;
  session.pendingSummary = intents.map((intent) => intent.summary).join(' ');
  session.previewTargetIds = entityIds;
  session.previewSuspended = false;
  session.openQuestion = null;
  session.pendingClarification = null;
  return state;
}

export async function handleStructuredDayPlan(
  input: TurnInput,
  envelope: SemanticEnvelopeV1,
  interpreted: InterpretOutput,
  traces: TraceEvent[],
): Promise<PipelineResult> {
  const command = envelope.dayPlan;
  if (!command) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), {
      traces,
      usage: interpreted.usage,
    });
  }
  if (command.phase === 'cancel') {
    input.session.planDraft = null;
    input.session.qualitativeByItemId = {};
    clearPending(input.session);
    return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, 'canceled') }), {
      traces,
      usage: interpreted.usage,
    });
  }
  const day = command.day || input.session.planDraft?.day;
  if (command.phase === 'start') {
    if (!day) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), {
        traces,
        usage: interpreted.usage,
        blocked: ['invalid_date'],
      });
    }
    if (!input.planContext) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        usage: interpreted.usage,
        blocked: ['day_context_missing'],
      });
    }
    input.session.planDraft = { ...initialPlanDraft(day, input.planContext), stage: 'interview' };
  }
  if (!input.session.planDraft) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid') }), {
      traces,
      usage: interpreted.usage,
      blocked: ['no_open_plan'],
    });
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
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
      blocked: ['day_context_missing'],
      preservedLabels: qualitative,
    });
  }
  const unknown = input.planContext
    ? edits.flatMap((edit) => (edit.op === 'include_task' && !input.planContext?.tasks.some((task) => task.id === edit.taskId) ? [edit.taskId] : []))
    : [];
  if (unknown.length) {
    return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
      traces,
      usage: interpreted.usage,
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
      usage: interpreted.usage,
      blocked: ['unmapped_time'],
      preservedLabels: unresolvedLabels,
    });
  }
  if (command.phase === 'apply') {
    if (!input.proposeDay || !input.planContext) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        usage: interpreted.usage,
        blocked: [...blocked, input.planContext ? 'day_planner_unavailable' : 'day_context_missing'],
        preservedLabels: qualitative,
      });
    }
    let proposal: DayPlanProposal;
    try {
      proposal = await input.proposeDay(input.userId, draft, input.timeZone);
    } catch {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        usage: interpreted.usage,
        blocked: ['day_planner_failed'],
        preservedLabels: qualitative,
      });
    }
    const problems = [...proposalProblems(draft, proposal), ...placementProblems(draft, proposal, input.planContext)];
    if (problems.length) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'invalid'), actions: ['retry'] }), {
        traces,
        usage: interpreted.usage,
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
    if (!intents.length) {
      // Nothing to write: either nothing fit or every item already sits where the plan puts it. No preview opens.
      const code = proposal.unplaced.length ? 'no_room' : 'no_pending';
      return done(input, reply(input.session.sessionId, { outcome: 'answer', assistantMessage: voiceCopy(input.language, code), plan: proposal }), {
        traces,
        usage: interpreted.usage,
        blocked: [...blocked, proposal.unplaced.length ? 'no_room' : 'no_change'],
        preservedLabels: qualitative,
      });
    }
    const baseline = planFingerprints(intents, input);
    if (!baseline.ok) {
      return done(input, reply(input.session.sessionId, { outcome: 'refuse', assistantMessage: voiceCopy(input.language, 'cannot_change') }), {
        traces,
        usage: interpreted.usage,
        blocked: [...blocked, baseline.code],
        preservedLabels: qualitative,
      });
    }
    clearDialogue(input.session);
    input.session.pendingClarification = null;
    input.session.heldIntents = [];
    input.session.adaptedOpIds = [];
    input.session.canceledOpIds = [];
    publishPlanPreview(input.session, intents, baseline.entityIds, baseline.fingerprints);
    return done(
      input,
      reply(input.session.sessionId, {
        outcome: 'confirm',
        assistantMessage: input.session.pendingSummary || voiceCopy(input.language, 'held'),
        intents,
        actions: ['confirm', 'cancel'],
        plan: proposal,
      }),
      { traces, usage: interpreted.usage, blocked, preservedLabels: qualitative },
    );
  }
  // Read-only / interview / edit: never open a pending execution.
  return done(
    input,
    reply(input.session.sessionId, {
      outcome: draft.stage === 'review' ? 'confirm' : 'clarify',
      assistantMessage: command.question || voiceCopy(input.language, 'held'),
      actions: draft.stage === 'review' ? ['confirm', 'cancel'] : ['build_plan', 'cancel'],
      plan: draftView(draft),
    }),
    { traces, usage: interpreted.usage, blocked, preservedLabels: qualitative },
  );
}
