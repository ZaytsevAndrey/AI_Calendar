import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import {
  annotateLatestStep,
  clipVoiceBody,
  currentVoiceTrace,
  recordVoiceStep,
  traceStep,
  voiceTraceBodiesEnabled,
  withTurnTrace,
  withVoiceSegment,
  type VoiceStep,
} from '../../common/voice-trace';
import { t, type MessageKey } from '../../i18n/t';
import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import { overdueDays } from '../day-reminders/day-reminder.dates';
import { DayRemindersService } from '../day-reminders/day-reminders.service';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { VoiceTurnDto } from './dto/voice-turn.dto';
import { voiceCompanionMode, type VoiceCompanionMode } from './voice-companion-mode';
import { GroqClient } from './groq.client';
import {
  collectSegments,
  continuePendingBatch,
  joinSpoken,
  skipOpenQuestions,
  type SegmentParse,
  type SummaryContext,
} from './voice-agent.batch';
import { VoiceDayPlanner } from './voice-agent.day-plan';
import {
  applyPlanEdits,
  initialPlanDraft,
  planToIntents,
  type PlanDraftContext,
  type PlanEdit,
  type SkippedPlanEdit,
} from './voice-agent.plan-draft';
import {
  parsePlannerDecision,
  PlannerInvalidDecisionError,
  PlannerInvalidJsonError,
  PlannerSegmentLimitError,
  type PlannerDecision,
} from './voice-agent.planner';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from './voice-agent.planner.prompt';
import { VoiceAgentTools, type VoiceToolContext } from './voice-agent.tools';
import type {
  DayPlanProposal,
  PendingBatch,
  PlanDraft,
  VoiceAgentActionId,
  VoiceAgentSession,
  VoiceExecutionReport,
  VoiceSegmentSummary,
  VoiceTurnOutcome,
  VoiceTurnResponse,
  VoiceWriteIntent,
} from './voice-agent.types';
import {
  logPlannerEvent,
  logVoiceLlm,
  type PlannerFaultCode,
} from './voice-llm-log.util';
import {
  addDaysToYmd,
  localYmd,
  resolveScheduleDayYmd,
  scheduleTodayYmd,
} from './voice-local-date.util';
import type { VoiceParseResult } from './voice-parse.types';
import { VoiceSessionStore } from './voice-session.store';
import { unappliedIntentLine } from './voice-unapplied';
import { isNoiseOrEmptyTranscript } from './voice-stt.util';

/** Tool rounds before the planner must decide. Rounds 0 and 1 may run tools. Round 2 must decide. */
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS_PER_ROUND = 6;

type ToolLimitReason = 'empty_calls' | 'too_many_calls' | 'max_rounds';

class PlannerToolLimitError extends Error {
  readonly code = 'tool_limit_exceeded' as const;

  constructor(
    readonly reason: ToolLimitReason,
    readonly round: number,
  ) {
    super(`Planner tool limit: ${reason} at round ${round}`);
    this.name = 'PlannerToolLimitError';
  }
}

type PlannerFault = {
  code: PlannerFaultCode;
  typeName?: string;
  reason?: string;
  round?: number;
  message?: string;
};

export type VoiceParseFallback = (ctx: {
  transcript: string;
  previousTranscript?: string;
  clarificationAnswer?: string;
  /** Index in this turn's segment list. Blank planner rows never receive one. */
  segment?: number;
}) => Promise<VoiceParseResult>;

type TurnContext = VoiceToolContext & {
  sessionId: string;
  todayYmd: string;
  language: AppLanguage;
  defaultDurationMinutes: number;
  mode: VoiceCompanionMode;
  summary: SummaryContext;
};

type FinalInput = {
  outcome: VoiceTurnOutcome;
  assistantMessage: string;
  actions?: VoiceAgentActionId[];
  intents?: VoiceWriteIntent[];
  plan?: DayPlanProposal | null;
  segments?: VoiceSegmentSummary[];
  legacyParse?: VoiceParseResult | null;
};

@Injectable()
export class VoiceAgentOrchestrator {
  private readonly logger = new Logger(VoiceAgentOrchestrator.name);

  constructor(
    private readonly groq: GroqClient,
    private readonly userSettingsService: UserSettingsService,
    private readonly tools: VoiceAgentTools,
    private readonly sessions: VoiceSessionStore,
    private readonly dayPlanner: VoiceDayPlanner,
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
    private readonly dayReminders: DayRemindersService,
  ) {}

  async turn(
    userId: string,
    dto: VoiceTurnDto,
    parseFallback: VoiceParseFallback,
  ): Promise<VoiceTurnResponse> {
    if (!currentVoiceTrace()) {
      return withTurnTrace(() => this.turn(userId, dto, parseFallback));
    }
    const sessionId = dto.sessionId;
    const session = this.sessions.getOrCreate(userId, sessionId);
    const actionId = dto.actionId?.trim();
    const transcript = (dto.transcript || '').trim();

    if (this.hasOpenQuestion(session)) {
      if (actionId === 'cancel') return this.cancelOpenBatch(userId, dto, session);
      if (actionId || isNoiseOrEmptyTranscript(transcript)) {
        return this.repeatOpenQuestion(userId, sessionId, session);
      }
    }
    if (actionId === 'report') {
      return this.report(userId, dto, session);
    }
    if (actionId === 'cancel') {
      return this.cancel(userId, dto, session);
    }
    if (actionId === 'confirm' && session.pendingIntents) {
      return this.confirm(userId, sessionId, session);
    }

    // Silence / Whisper hallucinations («дякую», «thank you») — ignore, no LLM.
    if (!actionId && isNoiseOrEmptyTranscript(transcript)) {
      return this.finish(userId, sessionId, { outcome: 'answer', assistantMessage: '' });
    }

    if (transcript) {
      this.sessions.appendTurn(userId, sessionId, { role: 'user', text: transcript });
    }

    const ctx = await this.loadContext(userId, dto);

    if (
      session.planDraft &&
      (actionId === 'build_plan' || actionId === 'confirm')
    ) {
      return this.proposeAndHold(ctx, { ...session.planDraft, stage: 'review' });
    }

    let decision: Exclude<PlannerDecision, { type: 'tools' }>;
    try {
      decision = await this.decide(ctx, session, transcript);
    } catch (err) {
      if (isVoiceRateLimit(err) || isVoiceLlmTimeout(err)) throw err;
      if (this.hasOpenQuestion(session)) {
        this.noteCaughtPlannerFault(err);
        return this.repeatOpenQuestion(userId, sessionId, session);
      }
      if (err instanceof PlannerInvalidJsonError) {
        return this.plannerFault(ctx, session, { code: 'invalid_json' });
      }
      if (err instanceof PlannerInvalidDecisionError) {
        return this.plannerFault(ctx, session, {
          code: 'invalid_decision',
          typeName: err.typeName,
          ...(err.reason ? { reason: err.reason } : {}),
        });
      }
      if (err instanceof PlannerSegmentLimitError) {
        return this.segmentLimit(ctx, session, err);
      }
      if (err instanceof PlannerToolLimitError) {
        return this.plannerFault(ctx, session, {
          code: 'tool_limit_exceeded',
          reason: err.reason,
          round: err.round,
        });
      }
      return this.plannerFault(ctx, session, {
        code: 'planner_execution_error',
        message: errorMessage(err),
      });
    }

    if (
      this.hasOpenQuestion(session) &&
      decision.type !== 'answer_pending' &&
      decision.type !== 'cancel_pending'
    ) {
      return this.repeatOpenQuestion(userId, sessionId, session);
    }

    switch (decision.type) {
      case 'steps':
        return this.steps(ctx, session, decision, parseFallback);
      case 'plan_start':
        return this.planStart(ctx, session, decision);
      case 'plan_edits':
        if (!session.planDraft) {
          return this.plannerFault(ctx, session, {
            code: 'invalid_decision',
            typeName: 'plan_edits',
            reason: 'no_open_plan',
          });
        }
        return this.planEdits(ctx, session.planDraft, decision);
      case 'plan_question':
        if (!session.planDraft) {
          return this.finish(userId, sessionId, {
            outcome: 'clarify',
            assistantMessage: this.spokenWithSkips(ctx, decision.question, decision.skipped),
          });
        }
        return this.planQuestion(ctx, session.planDraft, decision);
      case 'answer_pending':
        if (!session.pendingBatch) {
          return this.plannerFault(ctx, session, {
            code: 'invalid_decision',
            typeName: 'answer_pending',
            reason: 'no_pending_batch',
          });
        }
        return this.answerPending(ctx, session.pendingBatch, transcript, parseFallback);
      case 'confirm_pending':
        if (session.pendingIntents) return this.confirm(userId, sessionId, session);
        return this.reShowOr(ctx, session, this.vt(ctx, 'voice.confirmed'));
      case 'cancel_pending':
        return this.cancel(userId, dto, session);
      case 'final':
        return this.final(ctx, session, decision);
    }
  }

  endSession(userId: string, sessionId: string): void {
    this.sessions.clear(userId, sessionId);
  }

  private async loadContext(userId: string, dto: VoiceTurnDto): Promise<TurnContext> {
    const [settings, phases, tasks, slots, reminderRows] = await traceStep(
      'other',
      'db.turn-context',
      '',
      () =>
        Promise.all([
          this.userSettingsService.getSettings(userId),
          this.phasesRepository.find({ where: { userId }, order: { name: 'ASC' } }),
          this.tasksRepository.find({ where: { userId } }),
          this.scheduledRepository
            .createQueryBuilder('slot')
            .innerJoin('slot.task', 'task')
            .where('task.userId = :userId', { userId })
            .getMany(),
          this.dayReminders.findAll(userId),
        ]),
    );
    const timeZone = resolveIanaTimeZone(settings.timeZone || dto.timeZone);
    const nowIso = dto.clientNowIso?.trim() || new Date().toISOString();
    const speech = settings.speechLanguage || settings.language || 'en';
    const language: AppLanguage = isAppLanguage(speech) ? speech : 'en';
    const minutes = settings.defaultTaskDurationMinutes;
    return {
      userId,
      sessionId: dto.sessionId,
      timeZone,
      nowIso,
      settings,
      tasks,
      slots,
      phases,
      reminders: reminderRows.map((row) => ({
        name: row.name,
        dueYmd: row.dueYmd,
        overdueDays: overdueDays(row.dueYmd, localYmd(nowIso, timeZone)),
        notificationTime: row.notificationTime,
        recurrencePattern: row.recurrencePattern,
      })),
      todayYmd: scheduleTodayYmd(nowIso, timeZone, settings.wakeTime, settings.sleepTime),
      language,
      defaultDurationMinutes: typeof minutes === 'number' && minutes >= 5 ? minutes : 30,
      mode: voiceCompanionMode(dto.mode),
      summary: {
        language,
        timeZone,
        nowIso,
        wakeTime: settings.wakeTime,
        sleepTime: settings.sleepTime,
      },
    };
  }

  private async decide(
    ctx: TurnContext,
    session: VoiceAgentSession,
    transcript: string,
  ): Promise<Exclude<PlannerDecision, { type: 'tools' }>> {
    const toolResults: Array<{ name: string; result: unknown }> = [];
    const pendingQuestion = session.pendingBatch?.unresolved[0] ?? null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const raw = await this.groq.completeJson(
        buildPlannerSystemPrompt(ctx.language, ctx.mode),
        buildPlannerUserPrompt({
          transcript,
          timeZone: ctx.timeZone,
          nowIso: ctx.nowIso,
          todayYmd: ctx.todayYmd,
          wakeTime: ctx.settings.wakeTime,
          sleepTime: ctx.settings.sleepTime,
          history: session.turns,
          toolResults,
          pendingConfirmSummary: session.pendingIntents ? session.pendingSummary : null,
          pendingClarification: pendingQuestion,
          planDraft: session.planDraft,
        }),
        { role: 'planner', label: `planner.r${round}` },
      );
      logVoiceLlm(this.logger, `planner.round${round}`, raw);
      const decision = parsePlannerDecision(raw);
      logPlannerEvent(this.logger, 'planner.decision', decisionFields(decision, round));
      this.markPlannerAccepted(decision);
      if (decision.type !== 'tools') return decision;
      if (!decision.calls.length) throw new PlannerToolLimitError('empty_calls', round);
      if (decision.calls.length > MAX_TOOL_CALLS_PER_ROUND) {
        throw new PlannerToolLimitError('too_many_calls', round);
      }
      if (round === MAX_TOOL_ROUNDS) throw new PlannerToolLimitError('max_rounds', round);
      for (const call of decision.calls) {
        const result = await traceStep(
          'other',
          `tool.${call.name}`,
          '',
          () => this.tools.execute(call, ctx),
          undefined,
          {
            component: 'tool',
            describe: (value) => {
              const errorCode = toolErrorCode(value);
              return errorCode ? { valid: false, errorCode } : {};
            },
          },
        );
        toolResults.push({ name: call.name, result });
        this.logToolResult(call.name, result);
      }
    }
    throw new PlannerToolLimitError('max_rounds', MAX_TOOL_ROUNDS);
  }

  /** Record a planner failure without replacing the open question. */
  private noteCaughtPlannerFault(err: unknown): void {
    if (err instanceof PlannerInvalidJsonError) {
      logPlannerEvent(this.logger, 'planner.fault', { code: 'invalid_json' });
      this.markPlannerRejected('invalid_json');
      return;
    }
    if (err instanceof PlannerInvalidDecisionError) {
      logPlannerEvent(this.logger, 'planner.fault', {
        code: 'invalid_decision',
        typeName: err.typeName,
        ...(err.reason ? { reason: err.reason } : {}),
      });
      this.markPlannerRejected('invalid_decision', err.reason, err.typeName);
      return;
    }
    if (err instanceof PlannerSegmentLimitError) {
      logPlannerEvent(this.logger, 'planner.fault', {
        code: 'segment_limit_exceeded',
        count: err.count,
        limit: err.limit,
      });
      this.markPlannerRejected('segment_limit_exceeded', `count:${err.count}`);
      return;
    }
    if (err instanceof PlannerToolLimitError) {
      logPlannerEvent(this.logger, 'planner.fault', {
        code: 'tool_limit_exceeded',
        reason: err.reason,
        round: err.round,
      });
      this.markPlannerRejected('tool_limit_exceeded', err.reason);
      return;
    }
    logPlannerEvent(this.logger, 'planner.fault', {
      code: 'planner_execution_error',
      message: errorMessage(err).slice(0, 300),
    });
    this.markPlannerRejected('planner_execution_error', errorMessage(err).slice(0, 300));
  }

  /** A planner fault is a refusal. It is not a task parse and it does not drop the session. */
  private plannerFault(
    ctx: TurnContext,
    session: VoiceAgentSession,
    fault: PlannerFault,
  ): VoiceTurnResponse {
    const fields: Record<string, string | number | boolean> = { code: fault.code };
    if (fault.typeName) fields.typeName = fault.typeName;
    if (fault.reason) fields.reason = fault.reason;
    if (typeof fault.round === 'number') fields.round = fault.round;
    if (fault.message) fields.message = fault.message.slice(0, 300);
    logPlannerEvent(this.logger, 'planner.fault', fields);
    this.markPlannerRejected(fault.code, fault.reason, fault.typeName);

    const plan = openPlanPayload(session);
    return this.finish(ctx.userId, ctx.sessionId, {
      outcome: 'refuse',
      assistantMessage: this.vt(ctx, 'voice.couldNotHelp'),
      actions: plan ? planActions(session) : ['retry'],
      ...(plan ? { plan } : {}),
    });
  }

  /** Ask to split the utterance. No segment is parsed or applied. */
  private segmentLimit(
    ctx: TurnContext,
    session: VoiceAgentSession,
    err: PlannerSegmentLimitError,
  ): VoiceTurnResponse {
    logPlannerEvent(this.logger, 'planner.fault', {
      code: 'segment_limit_exceeded',
      count: err.count,
      limit: err.limit,
    });
    this.markPlannerRejected('segment_limit_exceeded', `count:${err.count}`);
    const plan = openPlanPayload(session);
    return this.finish(ctx.userId, ctx.sessionId, {
      outcome: 'clarify',
      assistantMessage: this.vt(ctx, 'voice.segmentLimit'),
      actions: plan ? planActions(session) : ['retry'],
      ...(plan ? { plan } : {}),
    });
  }

  /** Multi-intent: each write segment goes through the existing router + specialist. */
  private async steps(
    ctx: TurnContext,
    session: VoiceAgentSession,
    decision: { answer: string; segments: string[] },
    parseFallback: VoiceParseFallback,
  ): Promise<VoiceTurnResponse> {
    const held = session.pendingBatch
      ? skipOpenQuestions(session.pendingBatch, ctx.summary)
      : null;
    this.sessions.setPendingBatch(ctx.userId, ctx.sessionId, null);
    if (!decision.segments.length) {
      if (held?.intents.length) {
        return this.settleBatch(ctx, {
          ...held,
          answer: joinSpoken([decision.answer, held.answer]),
        });
      }
      if (!decision.answer) {
        if (held?.notes.length) return this.settleBatch(ctx, held);
        return this.plannerFault(ctx, session, {
          code: 'invalid_decision',
          typeName: 'steps',
          reason: 'empty',
        });
      }
      this.sessions.setClarifyCount(ctx.userId, ctx.sessionId, 0);
      return this.reShowOr(
        ctx,
        session,
        joinSpoken([decision.answer, ...(held?.notes ?? [])]),
      );
    }
    // Writes already resolved in that batch stay. Ignored questions are skipped.
    // Writes beside an open plan release its held Apply; the report re-seats the draft.
    if (session.pendingKind === 'plan') this.sessions.clearPending(ctx.userId, ctx.sessionId);
    const parses: SegmentParse[] = [];
    for (let index = 0; index < decision.segments.length; index += 1) {
      const parsed = await this.parseSegment(decision.segments[index], parseFallback, index);
      parses.push(parsed);
      this.noteSegment(index, parsed);
    }
    const collected = collectSegments(parses, {
      ...ctx.summary,
    });
    return this.settleBatch(ctx, {
      intents: [...(held?.intents ?? []), ...collected.intents],
      segments: [...(held?.segments ?? []), ...collected.segments],
      unresolved: collected.unresolved,
      clarifyCount: 1,
      answer: decision.answer,
      notes: [...(held?.notes ?? []), ...collected.notes],
      needsConfirm: Boolean(held?.needsConfirm) || collected.needsConfirm,
    });
  }

  private async answerPending(
    ctx: TurnContext,
    batch: PendingBatch,
    transcript: string,
    parseFallback: VoiceParseFallback,
  ): Promise<VoiceTurnResponse> {
    const current = batch.unresolved[0];
    const segment = segmentIndex(batch, current.segment);
    let parse: SegmentParse;
    try {
      parse = {
        segment: current.segment,
        result: await this.parseIndexed(segment, () =>
          parseFallback({
            transcript,
            previousTranscript: current.segment,
            clarificationAnswer: transcript,
            ...(segment != null ? { segment } : {}),
          }),
        ),
      };
    } catch (err) {
      if (isVoiceRateLimit(err) || isVoiceLlmTimeout(err)) throw err;
      parse = { segment: current.segment, error: errorMessage(err) };
    }
    this.noteSegment(segment, parse);
    const next = continuePendingBatch(batch, parse, {
      ...ctx.summary,
    });
    return this.settleBatch(ctx, next);
  }

  /** Ask about the next unclear segment, or hand the resolved batch to the client. */
  private settleBatch(ctx: TurnContext, batch: PendingBatch): VoiceTurnResponse {
    const { userId, sessionId } = ctx;
    if (batch.unresolved.length) {
      this.sessions.setPendingBatch(userId, sessionId, batch);
      return this.finish(userId, sessionId, {
        outcome: 'clarify',
        assistantMessage: batch.unresolved[0].question,
        segments: batch.segments,
      });
    }
    this.sessions.setPendingBatch(userId, sessionId, null);
    const spoken = batch.intents.map((intent) =>
      batch.needsConfirm ? intent.summary : statedSummary(intent, ctx.language),
    );
    const message = joinSpoken([batch.answer, ...spoken, ...batch.notes]);
    if (!batch.intents.length) {
      return this.finish(userId, sessionId, {
        outcome: 'refuse',
        assistantMessage: message || this.vt(ctx, 'voice.couldNotHelp'),
        actions: ['retry'],
        segments: batch.segments,
      });
    }
    this.sessions.setClarifyCount(userId, sessionId, 0);
    if (batch.needsConfirm) {
      this.sessions.setPending(userId, sessionId, {
        intents: batch.intents,
        summary: message,
        kind: 'writes',
      });
      return this.finish(userId, sessionId, {
        outcome: 'confirm',
        assistantMessage: message,
        actions: ['confirm', 'cancel'],
        intents: batch.intents,
        segments: batch.segments,
      });
    }
    return this.finish(userId, sessionId, {
      outcome: 'act',
      assistantMessage: message,
      intents: batch.intents,
      segments: batch.segments,
    });
  }

  /** One disposition per planner segment. The text of the segment is not stored. */
  private noteSegment(index: number | undefined, parse: SegmentParse): void {
    recordVoiceStep({
      component: 'orchestrator',
      name: 'segment',
      ...(index != null ? { segment: index } : {}),
      ...segmentDisposition(parse, index),
    });
  }

  private async parseSegment(
    segment: string,
    parseFallback: VoiceParseFallback,
    index: number,
  ): Promise<SegmentParse> {
    try {
      return {
        segment,
        result: await this.parseIndexed(index, () =>
          parseFallback({ transcript: segment, segment: index }),
        ),
      };
    } catch (err) {
      if (isVoiceRateLimit(err) || isVoiceLlmTimeout(err)) throw err;
      return { segment, error: errorMessage(err) };
    }
  }

  /** Keep the segment index for router, specialist, and normalizer inside this parse. */
  private parseIndexed<T>(segment: number | undefined, fn: () => Promise<T>): Promise<T> {
    if (segment == null) return fn();
    return withVoiceSegment(segment, fn);
  }

  /** The model call succeeded. Validation is recorded separately from that technical result. */
  private markPlannerAccepted(decision: PlannerDecision): void {
    const counts = formatSkipCounts(decisionSkips(decision));
    annotateLatestStep(isPlannerStep, {
      component: 'planner',
      valid: true,
      decision: decision.type,
      ...(counts ? { reason: counts } : {}),
    });
  }

  private markPlannerRejected(errorCode: string, reason?: string, decision?: string): void {
    annotateLatestStep(isPlannerStep, {
      component: 'planner',
      valid: false,
      errorCode,
      ...(decision ? { decision } : {}),
      ...(reason ? { reason } : {}),
    });
  }

  /** Cap and other apply-time rejects. Counts only — no task text. */
  private noteAppliedSkips(type: string, skipped: SkippedPlanEdit[]): void {
    const counts = formatSkipCounts(skipped);
    if (!counts) return;
    logPlannerEvent(this.logger, 'planner.decision', { type, stage: 'apply', skipped: counts });
    annotateLatestStep(isPlannerStep, (step) => ({
      reason: step.reason ? `${step.reason},apply:${counts}` : `apply:${counts}`,
    }));
  }

  private logToolResult(name: string, result: unknown): void {
    const traceId = currentVoiceTrace()?.traceId;
    const code = toolErrorCode(result);
    const head = `[llm:planner.tool]${traceId ? ` traceId=${traceId}` : ''} name=${name}${
      code ? ` error=${code}` : ''
    }`;
    if (!voiceTraceBodiesEnabled()) {
      this.logger.log(head);
      return;
    }
    this.logger.log(`${head} ${clipVoiceBody(JSON.stringify(result), 500)}`);
  }

  private async planStart(
    ctx: TurnContext,
    session: VoiceAgentSession,
    decision: {
      day: string;
      interview: boolean;
      question: string;
      edits: PlanEdit[];
      skipped: SkippedPlanEdit[];
    },
  ): Promise<VoiceTurnResponse> {
    const resolved = resolveScheduleDayYmd(decision.day, ctx.todayYmd);
    if ('error' in resolved) return this.invalidPlanDay(ctx, session);
    this.sessions.setPendingBatch(ctx.userId, ctx.sessionId, null);
    this.sessions.clearPending(ctx.userId, ctx.sessionId);
    const draftCtx = this.draftContext(ctx);
    const applied = applyPlanEdits(initialPlanDraft(resolved.day, draftCtx), decision.edits, draftCtx);
    this.noteAppliedSkips('plan_start', applied.skipped);
    return this.holdInterview(
      ctx,
      {
        ...applied.draft,
        stage: 'interview',
        interviewAsked: decision.question ? 1 : 0,
      },
      this.spokenWithSkips(ctx, decision.question, [...decision.skipped, ...applied.skipped]),
    );
  }

  /** A present day that is not a real date does not open or replace a plan. */
  private invalidPlanDay(ctx: TurnContext, session: VoiceAgentSession): VoiceTurnResponse {
    logPlannerEvent(this.logger, 'planner.fault', {
      code: 'invalid_decision',
      typeName: 'plan_start',
      reason: 'invalid_day',
    });
    this.markPlannerRejected('invalid_decision', 'invalid_day', 'plan_start');
    const plan = openPlanPayload(session);
    return this.finish(ctx.userId, ctx.sessionId, {
      outcome: 'clarify',
      assistantMessage: this.vt(ctx, 'voice.planDayInvalid'),
      actions: plan ? planActions(session) : ['retry'],
      ...(plan ? { plan } : {}),
    });
  }

  private spokenWithSkips(ctx: TurnContext, text: string, skipped: SkippedPlanEdit[]): string {
    const parts = [text];
    const time = skipped.filter(
      (row) => row.reason === 'invalid_time' || row.reason === 'invalid_duration',
    ).length;
    const rejected = skipped.filter((row) => row.reason === 'invalid_edit').length;
    const full = skipped.filter((row) => row.reason === 'plan_full').length;
    if (time) parts.push(this.vt(ctx, 'voice.planEditSkipped', { count: time }));
    if (rejected) parts.push(this.vt(ctx, 'voice.planEditRejected', { count: rejected }));
    if (full) parts.push(this.vt(ctx, 'voice.planFull', { count: full }));
    if (parts.length === 1) return text;
    return joinSpoken(parts);
  }

  private async planEdits(
    ctx: TurnContext,
    draft: PlanDraft,
    decision: { edits: PlanEdit[]; answer: string; skipped: SkippedPlanEdit[] },
  ): Promise<VoiceTurnResponse> {
    const applied = applyPlanEdits(draft, decision.edits, this.draftContext(ctx));
    this.noteAppliedSkips('plan_edits', applied.skipped);
    return this.holdInterview(
      ctx,
      { ...applied.draft, stage: 'interview' },
      this.spokenWithSkips(ctx, decision.answer, [...decision.skipped, ...applied.skipped]),
    );
  }

  private async planQuestion(
    ctx: TurnContext,
    draft: PlanDraft,
    decision: { question: string; edits: PlanEdit[]; skipped: SkippedPlanEdit[] },
  ): Promise<VoiceTurnResponse> {
    const applied = applyPlanEdits(draft, decision.edits, this.draftContext(ctx));
    this.noteAppliedSkips('plan_question', applied.skipped);
    return this.holdInterview(
      ctx,
      { ...applied.draft, stage: 'interview', interviewAsked: applied.draft.interviewAsked + 1 },
      this.spokenWithSkips(ctx, decision.question, [...decision.skipped, ...applied.skipped]),
    );
  }

  private holdInterview(
    ctx: TurnContext,
    draft: PlanDraft,
    question: string,
  ): VoiceTurnResponse {
    this.sessions.setPlanDraft(ctx.userId, ctx.sessionId, draft);
    this.sessions.clearPending(ctx.userId, ctx.sessionId);
    return this.finish(ctx.userId, ctx.sessionId, {
      outcome: 'clarify',
      assistantMessage: question,
      actions: ['build_plan', 'cancel'],
      plan: interviewPayload(draft),
    });
  }

  /** Seat the draft with the engine, keep Apply intents server-side, show the cards. */
  private async proposeAndHold(
    ctx: TurnContext,
    draft: PlanDraft,
    prefix?: string,
  ): Promise<VoiceTurnResponse> {
    const proposal = await traceStep('other', 'day-plan', '', () =>
      this.dayPlanner.propose(ctx.userId, draft, ctx.timeZone),
    );
    const dayLabel = this.dayLabel(ctx, draft.day);
    if (!proposal.items.length && !proposal.unplaced.length) {
      const empty: PlanDraft = { ...draft, stage: 'interview', lastProposal: null };
      return this.holdInterview(
        ctx,
        empty,
        joinSpoken([prefix, this.vt(ctx, 'voice.planEmpty', { day: dayLabel })]),
      );
    }
    const held: PlanDraft = {
      ...draft,
      stage: 'review',
      revision: proposal.revision,
      lastProposal: proposal,
    };
    this.sessions.setPlanDraft(ctx.userId, ctx.sessionId, held);
    const intents = planToIntents(proposal, {
      slots: ctx.slots,
      timeZone: ctx.timeZone,
      nowIso: ctx.nowIso,
      language: ctx.language,
    });
    this.sessions.setPending(ctx.userId, ctx.sessionId, {
      intents,
      summary: this.vt(ctx, 'voice.planApplying', { day: dayLabel }),
      kind: 'plan',
    });
    const message = joinSpoken([
      prefix,
      proposal.items.length
        ? this.vt(ctx, 'voice.planProposed', { day: dayLabel, count: proposal.items.length })
        : null,
      proposal.unplaced.length
        ? this.vt(ctx, 'voice.planUnplaced', {
            names: proposal.unplaced.map((row) => row.name).join(', '),
          })
        : null,
      proposal.items.length && !intents.length ? this.vt(ctx, 'voice.planNoChanges') : null,
    ]);
    return this.finish(ctx.userId, ctx.sessionId, {
      outcome: 'confirm',
      assistantMessage: message,
      actions: ['confirm', 'cancel'],
      plan: proposal,
    });
  }

  /** Answer while keeping an open plan on screen (Apply / interview chrome stays). */
  private reShowOr(
    ctx: TurnContext,
    session: VoiceAgentSession,
    message: string,
  ): VoiceTurnResponse {
    const draft = session.planDraft;
    if (draft?.stage === 'review' && draft.lastProposal && session.pendingKind === 'plan') {
      return this.finish(ctx.userId, ctx.sessionId, {
        outcome: 'confirm',
        assistantMessage: message,
        actions: ['confirm', 'cancel'],
        plan: draft.lastProposal,
      });
    }
    if (draft?.stage === 'interview') {
      return this.finish(ctx.userId, ctx.sessionId, {
        outcome: 'clarify',
        assistantMessage: message,
        actions: ['build_plan', 'cancel'],
        plan: interviewPayload(draft),
      });
    }
    return this.finish(ctx.userId, ctx.sessionId, { outcome: 'answer', assistantMessage: message });
  }

  private final(
    ctx: TurnContext,
    session: VoiceAgentSession,
    decision: { outcome: 'answer' | 'clarify' | 'refuse'; assistantMessage: string },
  ): VoiceTurnResponse {
    const { userId, sessionId } = ctx;
    const ignored = session.pendingBatch
      ? skipOpenQuestions(session.pendingBatch, ctx.summary)
      : null;
    if (ignored) this.sessions.setPendingBatch(userId, sessionId, null);
    let message = joinSpoken([decision.assistantMessage, ...(ignored?.notes ?? [])]);
    if (decision.outcome === 'clarify') {
      return this.finish(userId, sessionId, {
        outcome: 'clarify',
        assistantMessage: message || this.vt(ctx, 'voice.clarifyGeneric'),
      });
    }
    this.sessions.setClarifyCount(userId, sessionId, 0);
    if (decision.outcome === 'refuse') {
      return this.finish(userId, sessionId, {
        outcome: 'refuse',
        assistantMessage: message || this.vt(ctx, 'voice.couldNotHelp'),
        actions: ['retry'],
      });
    }
    message = message || this.vt(ctx, 'voice.couldNotHelp');
    return this.reShowOr(ctx, session, message);
  }

  private confirm(
    userId: string,
    sessionId: string,
    session: VoiceAgentSession,
  ): VoiceTurnResponse {
    const intents = session.pendingIntents ?? [];
    const summary = session.pendingSummary || '';
    if (session.pendingKind === 'plan') {
      this.sessions.setPlanDraft(userId, sessionId, null);
    }
    this.sessions.clearPending(userId, sessionId);
    this.sessions.setPendingBatch(userId, sessionId, null);
    return this.finish(userId, sessionId, {
      outcome: 'act',
      assistantMessage: summary,
      intents,
    });
  }

  /** True while a specialist question is still stored on the batch. */
  private hasOpenQuestion(session: VoiceAgentSession): boolean {
    return Boolean(session.pendingBatch?.unresolved.length);
  }

  /** The open question again. The batch and the day draft stay as they are. */
  private repeatOpenQuestion(
    userId: string,
    sessionId: string,
    session: VoiceAgentSession,
  ): VoiceTurnResponse {
    const batch = session.pendingBatch;
    return this.finish(userId, sessionId, {
      outcome: 'clarify',
      assistantMessage: batch?.unresolved[0]?.question ?? '',
      segments: batch?.segments ?? [],
    });
  }

  /** Drop the open batch only. A day-plan draft is a different confirm. */
  private async cancelOpenBatch(
    userId: string,
    dto: VoiceTurnDto,
    session: VoiceAgentSession,
  ): Promise<VoiceTurnResponse> {
    const batch = session.pendingBatch;
    const settings = await this.userSettingsService.getSettings(userId);
    const speech = settings.speechLanguage || settings.language;
    const lang = isAppLanguage(speech) ? speech : 'en';
    const withheld = (batch?.intents ?? [])
      .map((intent) => unappliedIntentLine(intent, lang))
      .map((line) => line.trim())
      .filter(Boolean);
    this.sessions.setPendingBatch(userId, dto.sessionId, null);
    return this.finish(userId, dto.sessionId, {
      outcome: 'answer',
      assistantMessage: joinSpoken([t(lang, 'voice.cancelled'), ...withheld]),
      segments: batch?.segments ?? [],
    });
  }

  /** Cancel a write confirm first (the plan stays); a second cancel drops the plan. */
  private async cancel(
    userId: string,
    dto: VoiceTurnDto,
    session: VoiceAgentSession,
  ): Promise<VoiceTurnResponse> {
    const sessionId = dto.sessionId;
    if (this.hasOpenQuestion(session)) return this.cancelOpenBatch(userId, dto, session);
    const keepPlan = session.pendingKind === 'writes' && session.planDraft != null;
    this.sessions.clearPending(userId, sessionId);
    this.sessions.setPendingBatch(userId, sessionId, null);
    if (keepPlan && session.planDraft) {
      const ctx = await this.loadContext(userId, dto);
      if (session.planDraft.stage === 'interview') {
        return this.holdInterview(ctx, session.planDraft, '');
      }
      return this.proposeAndHold(ctx, session.planDraft);
    }
    this.sessions.setPlanDraft(userId, sessionId, null);
    const settings = await this.userSettingsService.getSettings(userId);
    const speech = settings.speechLanguage || settings.language;
    return this.finish(userId, sessionId, {
      outcome: 'answer',
      assistantMessage: t(isAppLanguage(speech) ? speech : 'en', 'voice.cancelled'),
    });
  }

  /** Client tells what it applied. No LLM call; an open plan is re-seated against the new calendar. */
  private async report(
    userId: string,
    dto: VoiceTurnDto,
    session: VoiceAgentSession,
  ): Promise<VoiceTurnResponse> {
    const sessionId = dto.sessionId;
    const line = describeReport(dto.executionReport);
    if (line) this.sessions.appendTurn(userId, sessionId, { role: 'system', text: line });
    if (session.planDraft && !session.pendingIntents) {
      const ctx = await this.loadContext(userId, dto);
      if (session.planDraft.stage === 'review') {
        return this.proposeAndHold(ctx, session.planDraft);
      }
      return this.holdInterview(ctx, session.planDraft, '');
    }
    return this.finish(userId, sessionId, { outcome: 'answer', assistantMessage: '' });
  }

  private draftContext(ctx: TurnContext): PlanDraftContext {
    return {
      tasks: ctx.tasks,
      slots: ctx.slots,
      timeZone: ctx.timeZone,
      nowIso: ctx.nowIso,
      defaultDurationMinutes: ctx.defaultDurationMinutes,
    };
  }

  private dayLabel(ctx: TurnContext, day: string): string {
    if (day === ctx.todayYmd) return this.vt(ctx, 'voice.whenToday');
    if (day === addDaysToYmd(ctx.todayYmd, 1)) return this.vt(ctx, 'voice.whenTomorrow');
    return day;
  }

  private vt(
    ctx: TurnContext,
    key: MessageKey,
    params?: Record<string, string | number>,
  ): string {
    return t(ctx.language, key, params);
  }

  private finish(userId: string, sessionId: string, input: FinalInput): VoiceTurnResponse {
    if (input.assistantMessage) {
      this.sessions.appendTurn(userId, sessionId, {
        role: 'assistant',
        text: input.assistantMessage,
      });
    }
    return {
      sessionId,
      outcome: input.outcome,
      assistantMessage: input.assistantMessage,
      intents: input.intents ?? [],
      actions: input.actions ?? [],
      plan: input.plan ?? null,
      segments: input.segments ?? [],
      clarifyCount: this.sessions.get(userId, sessionId)?.clarifyCount ?? 0,
      legacyParse: input.legacyParse ?? null,
    };
  }
}

function statedSummary(intent: VoiceWriteIntent, lang: AppLanguage): string {
  const summary = intent.summary.trim();
  if (!summary.endsWith('?')) return intent.summary;
  if (summary.includes(':')) return summary.replace(/\?+$/, '.');
  const name =
    intent.type === 'create'
      ? String(intent.task.name ?? '')
      : String(intent.command.taskName ?? intent.command.name ?? '');
  return name ? t(lang, 'voice.appliedChange', { name }) : summary.replace(/\?+$/, '.');
}

const SKIP_COUNT_KEYS = [
  'invalid_time',
  'invalid_duration',
  'invalid_edit.unknown_op',
  'invalid_edit.not_an_object',
  'invalid_edit.not_an_array',
  'invalid_edit.missing_name',
  'invalid_edit.missing_task_id',
  'invalid_edit.missing_item_id',
  'invalid_edit.missing_item_ids',
  'plan_full',
] as const;

/** Reason counts only. Task names and clock text stay out of the trace. */
function formatSkipCounts(skipped: SkippedPlanEdit[]): string {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const key = row.reason === 'invalid_edit' ? `invalid_edit.${row.cause}` : row.reason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return SKIP_COUNT_KEYS.filter((key) => counts.has(key))
    .map((key) => `${key}:${counts.get(key)}`)
    .join(',');
}

function decisionSkips(decision: PlannerDecision): SkippedPlanEdit[] {
  if (
    decision.type === 'plan_start' ||
    decision.type === 'plan_edits' ||
    decision.type === 'plan_question'
  ) {
    return decision.skipped;
  }
  return [];
}

function isPlannerStep(step: VoiceStep): boolean {
  return step.component === 'planner' || step.name.startsWith('planner');
}

function toolErrorCode(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('error' in result)) return undefined;
  const error = (result as { error?: unknown }).error;
  if (typeof error !== 'string' || !error.trim()) return undefined;
  if (/^[a-z0-9_]+$/i.test(error)) return error;
  if (error.startsWith('Unknown tool:')) return 'unknown_tool';
  return 'tool_error';
}

/** Index of a still-open segment. Dropped neighbors keep their own earlier indexes. */
function segmentIndex(batch: PendingBatch, text: string): number | undefined {
  const index = batch.segments.findIndex(
    (row) => row.status === 'clarify' && row.summary === text,
  );
  return index >= 0 ? index : undefined;
}

function decisionFields(
  decision: PlannerDecision,
  round: number,
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = { type: decision.type, round };
  if (decision.type === 'tools') {
    fields.calls = decision.calls.length;
    fields.tools = decision.calls.map((call) => call.name).join(',');
  } else if (decision.type === 'steps') {
    fields.segments = decision.segments.length;
  } else if (
    decision.type === 'plan_start' ||
    decision.type === 'plan_edits' ||
    decision.type === 'plan_question'
  ) {
    fields.edits = decision.edits.length;
    const counts = formatSkipCounts(decision.skipped);
    if (counts) fields.skipped = counts;
  } else if (decision.type === 'final') {
    fields.outcome = decision.outcome;
  }
  return fields;
}

function openPlanPayload(session: VoiceAgentSession): DayPlanProposal | null {
  const draft = session.planDraft;
  if (draft?.stage === 'review' && draft.lastProposal && session.pendingKind === 'plan') {
    return draft.lastProposal;
  }
  if (draft?.stage === 'interview') return interviewPayload(draft);
  return null;
}

function planActions(session: VoiceAgentSession): VoiceAgentActionId[] {
  if (session.planDraft?.stage === 'review' && session.pendingKind === 'plan') {
    return ['confirm', 'cancel'];
  }
  return ['build_plan', 'cancel'];
}

function interviewPayload(draft: PlanDraft): DayPlanProposal {
  return {
    day: draft.day,
    stage: 'interview',
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

export function describeReport(report: VoiceExecutionReport | undefined): string {
  const results = report?.results ?? [];
  if (!results.length) return '';
  const applied = results.filter((row) => row.status === 'applied').map((row) => row.summary);
  const missed = results
    .filter((row) => row.status !== 'applied')
    .map((row) => `${row.summary} (${row.status})`);
  const parts: string[] = [];
  if (applied.length) parts.push(`App applied: ${applied.join('; ')}`);
  if (missed.length) parts.push(`Not applied: ${missed.join('; ')}`);
  return parts.join('. ');
}

/**
 * Same order as collectSegments: a thrown parse, then a refuse command, then a
 * question, then an accepted write. The question and the refuse message stay
 * out of the trace.
 */
function segmentDisposition(
  parse: SegmentParse,
  index: number | undefined,
): Pick<VoiceStep, 'outcome' | 'valid' | 'errorCode' | 'reason'> {
  if ('error' in parse) {
    const located = locateDroppedSegment(index);
    return {
      outcome: 'dropped',
      valid: false,
      errorCode: located.errorCode,
      ...(located.reason ? { reason: located.reason } : {}),
    };
  }
  const result = parse.result;
  const command = result.command;
  if (command?.kind === 'refuse') return { outcome: 'refused', reason: 'command_refuse' };
  if (command) return { outcome: 'accepted' };
  if (result.understanding === 'needs_clarification' || !result.task?.name) {
    return { outcome: 'clarify', reason: 'needs_clarification' };
  }
  return { outcome: 'accepted' };
}

/** Point a dropped segment at the step that already failed. Never copy its text. */
function locateDroppedSegment(index: number | undefined): { errorCode: string; reason?: string } {
  if (index == null) return { errorCode: 'parse_error' };
  const steps = currentVoiceTrace()?.steps ?? [];
  const mine = steps.filter((step) => step.name !== 'segment' && step.segment === index);
  const invalid = [...mine].reverse().find((step) => step.valid === false && step.errorCode);
  if (invalid?.errorCode) {
    return {
      errorCode: invalid.errorCode,
      ...(invalid.component ? { reason: invalid.component } : {}),
    };
  }
  const failed = [...mine].reverse().find((step) => !step.ok);
  if (failed?.component) return { errorCode: 'call_failed', reason: failed.component };
  return { errorCode: 'parse_error' };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function voiceErrorCode(err: unknown): string | undefined {
  if (!(err instanceof ServiceUnavailableException)) return undefined;
  const response = err.getResponse();
  if (typeof response !== 'object' || response === null) return undefined;
  const code = (response as { code?: string }).code;
  return typeof code === 'string' ? code : undefined;
}

function isVoiceRateLimit(err: unknown): boolean {
  return voiceErrorCode(err) === 'VOICE_RATE_LIMIT';
}

function isVoiceLlmTimeout(err: unknown): boolean {
  return voiceErrorCode(err) === 'VOICE_LLM_TIMEOUT';
}
