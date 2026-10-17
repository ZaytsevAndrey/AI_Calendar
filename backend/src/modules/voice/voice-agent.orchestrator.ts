import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { VoiceTurnDto } from './dto/voice-turn.dto';
import { GroqClient } from './groq.client';
import { extractJsonObject } from './voice-parse.util';
import {
  buildVoiceAgentSystemPrompt,
  buildVoiceAgentUserPrompt,
} from './voice-agent.prompt';
import {
  VoiceAgentTools,
  type VoiceToolCall,
  type VoiceToolContext,
} from './voice-agent.tools';
import type {
  DayPlanProposal,
  VoiceAgentActionId,
  VoiceTurnOutcome,
  VoiceTurnResponse,
  VoiceWriteIntent,
} from './voice-agent.types';
import { VOICE_AGENT_ACTION_IDS } from './voice-agent.types';
import { VoiceSessionStore } from './voice-session.store';
import { scheduleTodayYmd } from './voice-local-date.util';
import type { VoiceParseResult } from './voice-parse.types';
import {
  commandNeedsConfirm,
  intentsFromParseResult,
} from './voice-agent.intents';
import {
  buildDayPlanProposal,
  dayPlanToIntents,
} from './voice-agent.day-plan';
import { isNoiseOrEmptyTranscript } from './voice-stt.util';
import { logVoiceLlm } from './voice-llm-log.util';

const MAX_TOOL_ROUNDS = 3;

type LlmDecision =
  | { type: 'tools'; calls: VoiceToolCall[] }
  | { type: 'mutate' }
  | { type: 'propose_plan'; day: string }
  | {
      type: 'final';
      outcome: VoiceTurnOutcome;
      assistantMessage: string;
      actions: VoiceAgentActionId[];
    };

@Injectable()
export class VoiceAgentOrchestrator {
  private readonly logger = new Logger(VoiceAgentOrchestrator.name);

  constructor(
    private readonly groq: GroqClient,
    private readonly userSettingsService: UserSettingsService,
    private readonly tools: VoiceAgentTools,
    private readonly sessions: VoiceSessionStore,
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
  ) {}

  async turn(
    userId: string,
    dto: VoiceTurnDto,
    parseFallback: (ctx: {
      transcript: string;
      previousTranscript?: string;
      clarificationAnswer?: string;
    }) => Promise<VoiceParseResult>,
  ): Promise<VoiceTurnResponse> {
    const session = this.sessions.getOrCreate(userId, dto.sessionId);
    const actionId = dto.actionId?.trim();
    const transcript = (dto.transcript || '').trim();

    if (actionId === 'cancel') {
      this.sessions.clearPending(userId, dto.sessionId);
      return this.finishFinal(userId, dto.sessionId, {
        outcome: 'answer',
        assistantMessage: 'Cancelled.',
        actions: [],
        intents: [],
        proposal: null,
      });
    }

    if (actionId === 'confirm' && session.pendingIntents?.length) {
      const intents = session.pendingIntents;
      const summary = session.pendingSummary || 'Confirmed.';
      this.sessions.clearPending(userId, dto.sessionId);
      return this.finishFinal(userId, dto.sessionId, {
        outcome: 'act',
        assistantMessage: summary,
        actions: [],
        intents,
        proposal: null,
      });
    }

    // Silence / Whisper hallucinations («дякую», «thank you») — ignore, no LLM.
    if (!actionId && isNoiseOrEmptyTranscript(transcript)) {
      return this.finishFinal(userId, dto.sessionId, {
        outcome: 'answer',
        assistantMessage: '',
        actions: [],
        intents: [],
        proposal: null,
      });
    }

    if (transcript) {
      this.sessions.appendTurn(userId, dto.sessionId, {
        role: 'user',
        text: transcript,
      });
    }

    const userTurns = this.sessions
      .get(userId, dto.sessionId)!
      .turns.filter((turn) => turn.role === 'user');
    const previousUser =
      userTurns.length >= 2 ? userTurns[userTurns.length - 2].text : undefined;
    // Only treat the prior user turn as clarification context while clarifying.
    // Otherwise a VAD-split second sentence re-parses+creates a second task.
    const clarifying = session.clarifyCount > 0;
    const runParse = () =>
      parseFallback({
        transcript: transcript || (clarifying ? previousUser : '') || '',
        previousTranscript: clarifying ? previousUser : undefined,
        clarificationAnswer:
          clarifying && previousUser && transcript ? transcript : undefined,
      });

    const [settings, phases, tasks, slots] = await Promise.all([
      this.userSettingsService.getSettings(userId),
      this.phasesRepository.find({
        where: { userId },
        order: { name: 'ASC' },
      }),
      this.tasksRepository.find({ where: { userId } }),
      this.scheduledRepository
        .createQueryBuilder('slot')
        .innerJoin('slot.task', 'task')
        .where('task.userId = :userId', { userId })
        .getMany(),
    ]);

    const timeZone = resolveIanaTimeZone(settings.timeZone || dto.timeZone);
    const nowIso = dto.clientNowIso?.trim() || new Date().toISOString();
    const todayYmd = scheduleTodayYmd(
      nowIso,
      timeZone,
      settings.wakeTime,
      settings.sleepTime,
    );
    const ctx: VoiceToolContext = {
      userId,
      timeZone,
      nowIso,
      settings,
      tasks,
      slots,
      phases,
    };
    const speechLanguage = settings.speechLanguage || settings.language || 'en';
    const parseSummaryCtx = {
      language: speechLanguage,
      timeZone,
      nowIso,
      wakeTime: settings.wakeTime,
      sleepTime: settings.sleepTime,
    };

    // Spoken yes while pending confirm
    if (
      session.pendingIntents?.length &&
      transcript &&
      /^(yes|yep|ok|okay|confirm|так|да|підтверд)/i.test(transcript)
    ) {
      const intents = session.pendingIntents;
      const summary = session.pendingSummary || 'Confirmed.';
      this.sessions.clearPending(userId, dto.sessionId);
      return this.finishFinal(userId, dto.sessionId, {
        outcome: 'act',
        assistantMessage: summary,
        actions: [],
        intents,
        proposal: null,
      });
    }

    const toolResults: Array<{ name: string; result: unknown }> = [];
    let decision: LlmDecision | null = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const raw = await this.groq.completeJson(
          buildVoiceAgentSystemPrompt(speechLanguage),
          buildVoiceAgentUserPrompt({
            transcript,
            timeZone,
            nowIso,
            todayYmd,
            clarifyCount: session.clarifyCount,
            history: session.turns,
            toolResults,
            actionId,
            hasPendingConfirm: Boolean(session.pendingIntents?.length),
          }),
        );
        logVoiceLlm(this.logger, `orchestrator.round${round}`, raw);
        decision = parseDecision(raw);
        if (decision.type === 'tools') {
          if (!decision.calls.length) break;
          for (const call of decision.calls.slice(0, 6)) {
            const result = await this.tools.execute(call, ctx);
            toolResults.push({ name: call.name, result });
            this.logger.log(
              `[llm:orchestrator.tool] ${call.name} → ${JSON.stringify(result).slice(0, 500)}`,
            );
          }
          continue;
        }
        break;
      }
    } catch (err) {
      if (isVoiceRateLimit(err) || isVoiceLlmTimeout(err)) throw err;
      this.logger.warn(
        `Orchestrator LLM failed; falling back to parse-task: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.fromParse(
        userId,
        dto.sessionId,
        await runParse(),
        Boolean(settings.confirmVoiceCommands),
        true,
        parseSummaryCtx,
      );
    }

    if (!decision || decision.type === 'tools') {
      return this.fromParse(
        userId,
        dto.sessionId,
        await runParse(),
        Boolean(settings.confirmVoiceCommands),
        true,
        parseSummaryCtx,
      );
    }

    if (decision.type === 'mutate') {
      try {
        return this.fromParse(
          userId,
          dto.sessionId,
          await runParse(),
          Boolean(settings.confirmVoiceCommands),
          false,
          parseSummaryCtx,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not understand the request';
        return this.finishFinal(userId, dto.sessionId, {
          outcome: 'refuse',
          assistantMessage: message,
          actions: ['retry'],
          intents: [],
          proposal: null,
        });
      }
    }

    // New errand speech misrouted as day-plan → create via parse, not free-gap packing.
    if (
      decision.type === 'propose_plan' &&
      looksLikeNewTaskSpeech(transcript) &&
      !looksLikeDayPlanRequest(transcript)
    ) {
      try {
        return this.fromParse(
          userId,
          dto.sessionId,
          await runParse(),
          Boolean(settings.confirmVoiceCommands),
          false,
          parseSummaryCtx,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not understand the request';
        return this.finishFinal(userId, dto.sessionId, {
          outcome: 'refuse',
          assistantMessage: message,
          actions: ['retry'],
          intents: [],
          proposal: null,
        });
      }
    }

    if (decision.type === 'propose_plan') {
      return this.proposePlan(userId, dto.sessionId, ctx, decision.day);
    }

    // Create speech (or a clarification answer after create) must go through
    // parse+normalize — not a vague LLM clarify/answer that skips the task.
    if (
      (looksLikeNewTaskSpeech(transcript) || clarifying) &&
      decision.type === 'final' &&
      (decision.outcome === 'clarify' ||
        decision.outcome === 'refuse' ||
        decision.outcome === 'answer')
    ) {
      try {
        return this.fromParse(
          userId,
          dto.sessionId,
          await runParse(),
          Boolean(settings.confirmVoiceCommands),
          false,
          parseSummaryCtx,
        );
      } catch {
        // fall through to the LLM clarify/refuse copy
      }
    }
    let outcome = decision.outcome;
    let message = decision.assistantMessage?.trim() || '';
    const actions = filterActions(decision.actions);

    if (outcome === 'clarify') {
      const nextCount = session.clarifyCount + 1;
      this.sessions.setClarifyCount(userId, dto.sessionId, nextCount);
      if (nextCount > 2) {
        outcome = 'refuse';
        message =
          message ||
          'I still do not understand. Please try a clearer request.';
      } else if (!message) {
        message = 'Could you clarify what you mean?';
      }
    } else if (outcome === 'answer' || outcome === 'refuse') {
      this.sessions.setClarifyCount(userId, dto.sessionId, 0);
    }

    if (!message) {
      message =
        outcome === 'refuse' ? 'I could not help with that.' : 'Done.';
    }

    if (outcome === 'confirm' || outcome === 'act') {
      outcome = 'answer';
    }

    return this.finishFinal(userId, dto.sessionId, {
      outcome,
      assistantMessage: message,
      actions,
      intents: [],
      proposal: null,
    });
  }

  endSession(userId: string, sessionId: string): void {
    this.sessions.clear(userId, sessionId);
  }

  private async proposePlan(
    userId: string,
    sessionId: string,
    ctx: VoiceToolContext,
    dayRaw: string,
  ): Promise<VoiceTurnResponse> {
    const gaps = (await this.tools.execute(
      { name: 'find_free_gaps', args: { day: dayRaw || 'today' } },
      ctx,
    )) as {
      day: string;
      gaps: Array<{ start: string; end: string; minutes: number }>;
    };
    const proposal = buildDayPlanProposal(ctx, dayRaw || 'today', gaps);
    if (!proposal.items.length) {
      return this.finishFinal(userId, sessionId, {
        outcome: 'answer',
        assistantMessage:
          'I could not fit any unscheduled tasks into free gaps for that day.',
        actions: [],
        intents: [],
        proposal: null,
      });
    }
    const intents = dayPlanToIntents(proposal);
    const summary = `Plan for ${proposal.day}: ${proposal.items.length} task(s). Confirm to apply.`;
    this.sessions.setPending(userId, sessionId, {
      intents,
      proposal,
      summary,
    });
    return this.finishFinal(userId, sessionId, {
      outcome: 'confirm',
      assistantMessage: summary,
      actions: ['confirm', 'cancel'],
      intents: [],
      proposal,
    });
  }

  private fromParse(
    userId: string,
    sessionId: string,
    parsed: VoiceParseResult,
    confirmVoiceCommands: boolean,
    asLegacy: boolean,
    ctx?: {
      language?: string | null;
      timeZone?: string;
      nowIso?: string;
      wakeTime?: string | null;
      sleepTime?: string | null;
    },
  ): VoiceTurnResponse {
    const mapped = intentsFromParseResult(parsed, ctx);
    if (mapped.refuseMessage) {
      return this.finishFinal(userId, sessionId, {
        outcome: 'refuse',
        assistantMessage: mapped.refuseMessage,
        actions: ['retry'],
        intents: [],
        proposal: null,
        legacyParse: asLegacy ? parsed : null,
      });
    }
    if (mapped.clarifyQuestion) {
      const next = (this.sessions.get(userId, sessionId)?.clarifyCount ?? 0) + 1;
      this.sessions.setClarifyCount(userId, sessionId, next);
      if (next > 2) {
        return this.finishFinal(userId, sessionId, {
          outcome: 'refuse',
          assistantMessage: mapped.clarifyQuestion,
          actions: ['retry'],
          intents: [],
          proposal: null,
          legacyParse: asLegacy ? parsed : null,
        });
      }
      return this.finishFinal(userId, sessionId, {
        outcome: 'clarify',
        assistantMessage: mapped.clarifyQuestion,
        actions: [],
        intents: [],
        proposal: null,
        legacyParse: asLegacy ? parsed : null,
      });
    }

    const intents = mapped.intents;
    const needsConfirm =
      mapped.needsConfirm ||
      intents.some((intent) => commandNeedsConfirm(intent, confirmVoiceCommands));
    const summary =
      intents.map((intent) => intent.summary).filter(Boolean).join('; ') ||
      'OK';

    if (needsConfirm) {
      this.sessions.setPending(userId, sessionId, {
        intents,
        proposal: null,
        summary,
      });
      return this.finishFinal(userId, sessionId, {
        outcome: 'confirm',
        assistantMessage: summary,
        actions: ['confirm', 'cancel'],
        intents: [],
        proposal: null,
        legacyParse: asLegacy ? parsed : null,
      });
    }

    this.sessions.setClarifyCount(userId, sessionId, 0);
    return this.finishFinal(userId, sessionId, {
      outcome: 'act',
      assistantMessage: summary,
      actions: [],
      intents,
      proposal: null,
      legacyParse: asLegacy ? parsed : null,
    });
  }

  private finishFinal(
    userId: string,
    sessionId: string,
    input: {
      outcome: VoiceTurnOutcome;
      assistantMessage: string;
      actions: VoiceAgentActionId[];
      intents: VoiceWriteIntent[];
      proposal: DayPlanProposal | null;
      legacyParse?: VoiceParseResult | null;
    },
  ): VoiceTurnResponse {
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
      intents: input.intents,
      actions: input.actions,
      proposal: input.proposal,
      clarifyCount: this.sessions.get(userId, sessionId)?.clarifyCount ?? 0,
      legacyParse: input.legacyParse ?? null,
    };
  }
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

function parseDecision(raw: string): LlmDecision {
  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const type = String(parsed.type || '').trim();
  if (type === 'mutate') return { type: 'mutate' };
  if (type === 'propose_plan') {
    return {
      type: 'propose_plan',
      day: String(parsed.day || 'today'),
    };
  }
  if (type === 'tools') {
    const callsRaw = Array.isArray(parsed.calls) ? parsed.calls : [];
    const calls: VoiceToolCall[] = callsRaw
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const name = String((row as { name?: string }).name || '').trim();
        if (!name) return null;
        const args = (row as { args?: Record<string, unknown> }).args;
        return {
          name,
          args: args && typeof args === 'object' ? args : {},
        };
      })
      .filter(Boolean) as VoiceToolCall[];
    return { type: 'tools', calls };
  }
  const outcome = normalizeOutcome(String(parsed.outcome || 'answer'));
  return {
    type: 'final',
    outcome,
    assistantMessage: String(parsed.assistantMessage || '').trim(),
    actions: filterActions(parsed.actions),
  };
}

function normalizeOutcome(value: string): VoiceTurnOutcome {
  if (
    value === 'answer' ||
    value === 'clarify' ||
    value === 'confirm' ||
    value === 'act' ||
    value === 'refuse'
  ) {
    return value;
  }
  return 'answer';
}

function filterActions(raw: unknown): VoiceAgentActionId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(VOICE_AGENT_ACTION_IDS);
  return raw
    .map((item) => String(item || '').trim())
    .filter((id): id is VoiceAgentActionId => allowed.has(id));
}

function looksLikeTaskCreate(transcript: string): boolean {
  return /^(?:please\s+|будь\s+ласка\s+)?(?:створи(?:ти)?|додай(?:ти)?|создай|добавь|create|add)(?=[^\p{L}]|$)/iu.test(
    transcript.replace(/\s+/g, ' ').trim(),
  );
}

/** Explicit "pack my unscheduled tasks" — not a new errand title. */
function looksLikeDayPlanRequest(transcript: string): boolean {
  const text = transcript.replace(/\s+/g, ' ').trim();
  return /(?:розплануй|розпиши|розклади|влаштуй)\s+(?:мені\s+)?(?:мій\s+)?день|(?:заплануй|розплануй)\s+(?:невідкладен|незапланован|unscheduled)|plan\s+(?:my\s+)?day|schedule\s+(?:my\s+)?(?:day|unscheduled|tasks)|arrange\s+(?:my\s+)?day|pack\s+(?:my\s+)?(?:day|unscheduled)/iu.test(
    text,
  );
}

/**
 * New task/errand speech, with or without "create"/"додай".
 * "Завтра о другій в магазин" must mutate, not propose_plan.
 */
function looksLikeNewTaskSpeech(transcript: string): boolean {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text || looksLikeDayPlanRequest(text)) return false;
  if (looksLikeTaskCreate(text)) return true;
  const hasDay =
    /(?:^|[^\p{L}])(?:на\s+)?(?:післязавтра|послезавтра|завтра|tomorrow|сьогодні|сегодня|today)(?=[^\p{L}]|$)/iu.test(
      text,
    ) ||
    /(?:^|[^\p{L}])(?:в|у|на)\s+(?:понеділок|вівторок|середу|четвер|п'?ятницю|суботу|неділю|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=[^\p{L}]|$)/iu.test(
      text,
    );
  const hasClock =
    /(?:^|[^\p{L}])(?:о|у|на|at|в)\s+(?:перш\p{L}*|друг\p{L}*|трет\p{L}*|четверт\p{L}*|п'?ят\p{L}*|шост\p{L}*|сьом\p{L}*|восьм\p{L}*|дев'?ят\p{L}*|десят\p{L}*|одинадцят\p{L}*|дванадцят\p{L}*|\d{1,2}(?::\d{2})?)(?:\s*(?:годині?|часа?|дня|ранку|вечора|am|pm))?(?=[^\p{L}]|$)/iu.test(
      text,
    ) || /\d{1,2}[:.]\d{2}/.test(text);
  // Day and/or clock plus some content beyond the time words → treat as create.
  if (!(hasDay || hasClock)) return false;
  const content = text
    .replace(
      /(?:^|[^\p{L}])(?:на\s+)?(?:післязавтра|послезавтра|завтра|tomorrow|сьогодні|сегодня|today)(?=[^\p{L}]|$)/giu,
      ' ',
    )
    .replace(
      /(?:^|[^\p{L}])(?:о|у|на|at|в)\s+(?:перш\p{L}*|друг\p{L}*|трет\p{L}*|четверт\p{L}*|п'?ят\p{L}*|шост\p{L}*|сьом\p{L}*|восьм\p{L}*|дев'?ят\p{L}*|десят\p{L}*|одинадцят\p{L}*|дванадцят\p{L}*|\d{1,2}(?::\d{2})?)(?:\s*(?:годині?|часа?|дня|ранку|вечора|am|pm))?(?=[^\p{L}]|$)/giu,
      ' ',
    )
    .replace(/\d{1,2}[:.]\d{2}/g, ' ')
    .replace(/[.!?,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return content.length >= 3;
}
