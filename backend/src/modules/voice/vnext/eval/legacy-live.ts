import type { LlmComplete, LlmUsage } from '../repair/repair';
import { voiceCopy } from '../copy';
import { clearPending, type VNextSession } from '../session/session';
import {
  PlannerInvalidDecisionError,
  PlannerInvalidJsonError,
  PlannerSegmentLimitError,
  parsePlannerDecision,
  type PlannerDecision,
} from '../../voice-agent.planner';
import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from '../../voice-agent.planner.prompt';
import { intentsFromParseResult } from '../../voice-agent.intents';
import type { VoiceTurnResponse, VoiceWriteIntent } from '../../voice-agent.types';
import { commandDraftFromRaw, readVoiceIntent, resolveVoiceCommand, sniffCommandIntent } from '../../voice-command.resolve';
import type { VoiceCommandTask } from '../../voice-command.types';
import { resolveDayReminderVoice, routeReminderIntent, type VoiceReminderRow } from '../../voice-day-reminder';
import { buildVoiceIntentPrompt } from '../../voice-parse.intent-prompts';
import { buildVoiceRouterSystemPrompt, buildVoiceRouterUserPrompt } from '../../voice-parse.router.prompt';
import { VOICE_PARSE_INTENTS, type VoiceParseIntentId } from '../../voice-parse.shared.prompt';
import type { VoiceParseResult } from '../../voice-parse.types';
import { extractJsonObject, normalizeVoiceParse } from '../../voice-parse.util';
import { addDaysToYmd, localHm, localYmd, scheduleTodayYmd } from '../../voice-local-date.util';
import type { EdgeCase } from './edge-cases';
import { edgeTool } from './edge-tools';
import type { RubricActual } from './rubric';

const USER = 'user-1';
const EMPTY: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

type Actual = { actual: RubricActual; usage: LlmUsage };

function plus(usage: LlmUsage, row: { inputTokens: number; outputTokens: number; latencyMs: number }): void {
  usage.calls += 1;
  usage.inputTokens += row.inputTokens;
  usage.outputTokens += row.outputTokens;
  usage.latencyMs += row.latencyMs;
}

function pack(
  session: VNextSession,
  outcome: VoiceTurnResponse['outcome'],
  message: string,
  intents: VoiceWriteIntent[],
  usage: LlmUsage,
  blocked: string[],
  extra: unknown = null,
): Actual {
  const response: VoiceTurnResponse = {
    sessionId: session.sessionId,
    outcome,
    assistantMessage: message,
    intents,
    actions: [],
    plan: null,
    segments: [],
    clarifyCount: outcome === 'clarify' ? 1 : 0,
    legacyParse: null,
  };
  const created = intents.find((intent) => intent.type === 'create');
  const minutes = created ? Number((created.task as { estimatedTimeInMinutes?: number }).estimatedTimeInMinutes) : undefined;
  return {
    usage,
    actual: {
      outcome,
      serverWrites: 0,
      body: JSON.stringify({ response, extra }),
      intentCount: intents.length,
      heldCount: session.heldIntents.length,
      ...(Number.isFinite(minutes) ? { durationMinutes: minutes } : {}),
      preservedLabels: Object.values(session.qualitativeByItemId),
      blocked,
    },
  };
}

function commandTasks(edge: EdgeCase): VoiceCommandTask[] {
  return edge.entities
    .filter((entity) => entity.userId === USER && entity.type !== 'reminder')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      status: entity.status === 'open' ? 'OPEN' : entity.status.toUpperCase(),
      isRecurring: false,
      isUnscheduled: true,
      isFixedExternal: entity.type === 'external_event',
      eventType: entity.type === 'external_event' ? 'fixed' : 'task',
      googleEventId: null,
      googleEventCalendarId: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
    }));
}

function parseIntent(intent: ReturnType<typeof readVoiceIntent>): VoiceParseIntentId {
  if (intent === 'reschedule' || intent === 'complete') return 'update';
  if ((VOICE_PARSE_INTENTS as readonly string[]).includes(intent)) return intent as VoiceParseIntentId;
  return 'create';
}

function routerLanguage(raw: unknown, fallback: 'uk' | 'en'): 'uk' | 'en' | 'ru' {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const lang = String((raw as { language?: unknown }).language || '').trim().toLowerCase().slice(0, 2);
  if (lang === 'uk' || lang === 'en' || lang === 'ru') return lang;
  return fallback;
}

async function parseSegment(
  llm: LlmComplete,
  edge: EdgeCase,
  segment: string,
  usage: LlmUsage,
): Promise<{ intents: VoiceWriteIntent[]; question: string | null; refuse: string | null }> {
  const tasks = commandTasks(edge);
  const names = tasks.map((task) => task.name);
  const reminders: VoiceReminderRow[] = [];
  const router = await llm.complete({
    system: buildVoiceRouterSystemPrompt(),
    user: buildVoiceRouterUserPrompt({ transcript: segment, openTaskNames: names, openReminders: [] }),
  });
  plus(usage, router);
  let routed: unknown;
  try {
    routed = extractJsonObject(router.text);
  } catch {
    return { intents: [], question: voiceCopy(edge.language, 'invalid'), refuse: null };
  }
  const sniffed = sniffCommandIntent(segment);
  let intent = readVoiceIntent(routed);
  const language = routerLanguage(routed, edge.language);
  const reminder = routeReminderIntent({ transcript: segment, reminders, taskNames: names });
  if (reminder.kind === 'clarify') return { intents: [], question: voiceCopy(edge.language, 'which_task'), refuse: null };
  if (reminder.kind === 'remind') intent = 'remind';
  else if (intent === 'remind') intent = 'create';
  else if (sniffed && intent === 'needs_clarification') intent = sniffed;
  const specialistIntent = parseIntent(intent);
  const specialist = buildVoiceIntentPrompt(specialistIntent, {
    transcript: segment,
    timeZone: edge.timeZone,
    nowIso: edge.nowIso,
    phases: [],
    settings: { wakeTime: edge.wakeHm, sleepTime: edge.sleepHm, weekendWorkEnabled: false },
    openTaskNames: names,
    openReminders: [],
    language,
    defaultTaskDurationMinutes: edge.defaultDurationMinutes,
    openTasks: tasks.map((task) => ({ name: task.name, recurring: false })),
    mode: 'assistant',
  });
  const content = await llm.complete({ system: specialist.system, user: specialist.user });
  plus(usage, content);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(content.text);
  } catch {
    return { intents: [], question: voiceCopy(edge.language, 'invalid'), refuse: null };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    (parsed as { intent?: string }).intent = intent;
  }
  let result: VoiceParseResult;
  if (intent === 'needs_clarification') {
    const question = parsed && typeof parsed === 'object' && typeof (parsed as { clarifyingQuestion?: unknown }).clarifyingQuestion === 'string'
      ? (parsed as { clarifyingQuestion: string }).clarifyingQuestion
      : voiceCopy(edge.language, 'which_task');
    result = { understanding: 'needs_clarification', clarifyingQuestion: question, task: null, command: null };
  } else if (intent === 'remind') {
    const resolved = resolveDayReminderVoice({ raw: parsed, reminders, taskNames: names, language });
    result = resolved.type === 'clarify'
      ? { understanding: 'needs_clarification', clarifyingQuestion: resolved.question, task: null, command: null }
      : { understanding: 'complete', clarifyingQuestion: null, task: null, command: resolved.command };
  } else if (intent === 'create') {
    result = {
      ...normalizeVoiceParse(parsed, {
        validPhaseIds: new Set(),
        phases: [],
        alreadyClarified: false,
        transcript: segment,
        timeZone: edge.timeZone,
        nowIso: edge.nowIso,
        wakeTime: edge.wakeHm,
        language,
        defaultTaskDurationMinutes: edge.defaultDurationMinutes,
      }),
      command: null,
    };
  } else if (
    parsed && typeof parsed === 'object'
    && (parsed as { understanding?: unknown }).understanding === 'needs_clarification'
    && typeof (parsed as { clarifyingQuestion?: unknown }).clarifyingQuestion === 'string'
  ) {
    result = {
      understanding: 'needs_clarification',
      clarifyingQuestion: (parsed as { clarifyingQuestion: string }).clarifyingQuestion,
      task: null,
      command: null,
    };
  } else {
    const resolved = resolveVoiceCommand({
      draft: commandDraftFromRaw(parsed, intent),
      transcript: segment,
      timeZone: edge.timeZone,
      nowIso: edge.nowIso,
      alreadyClarified: false,
      tasks,
      slots: [],
      language,
      wakeTime: edge.wakeHm,
    });
    result = resolved.type === 'clarify'
      ? { understanding: 'needs_clarification', clarifyingQuestion: resolved.question, task: null, command: null }
      : { understanding: 'complete', clarifyingQuestion: null, task: null, command: resolved.command };
  }
  const mapped = intentsFromParseResult(result, {
    language,
    timeZone: edge.timeZone,
    nowIso: edge.nowIso,
    wakeTime: edge.wakeHm,
    sleepTime: edge.sleepHm,
  });
  return { intents: mapped.intents, question: mapped.clarifyQuestion, refuse: mapped.refuseMessage };
}

/** Production planner, router, and specialist on the synthetic fixture. No server write. */
export async function runLegacyTurn(edge: EdgeCase, llm: LlmComplete, session: VNextSession): Promise<Actual> {
  const usage = { ...EMPTY };
  const today = scheduleTodayYmd(edge.nowIso, edge.timeZone, edge.wakeHm, edge.sleepHm);
  const execute = edgeTool(edge);
  const toolResults: Array<{ name: string; result: unknown }> = [];
  let decision: PlannerDecision | undefined;
  try {
    for (let round = 0; round <= 2; round += 1) {
      const raw = await llm.complete({
        system: buildPlannerSystemPrompt(edge.language, 'assistant'),
        user: buildPlannerUserPrompt({
          transcript: edge.transcript,
          timeZone: edge.timeZone,
          nowIso: edge.nowIso,
          todayYmd: today,
          wakeTime: edge.wakeHm,
          sleepTime: edge.sleepHm,
          history: session.turns.length ? session.turns : edge.history,
          toolResults,
          pendingConfirmSummary: session.pendingIntents?.length ? session.pendingSummary : null,
          pendingClarification: session.openQuestion ? { segment: '', question: session.openQuestion } : null,
          planDraft: session.planDraft,
        }),
      });
      plus(usage, raw);
      decision = parsePlannerDecision(raw.text);
      if (decision.type !== 'tools') break;
      if (!decision.calls.length || decision.calls.length > 6 || round === 2) {
        return pack(session, 'refuse', voiceCopy(edge.language, 'tool_error'), [], usage, ['tool_limit'], decision);
      }
      for (const call of decision.calls) {
        try {
          toolResults.push({ name: call.name, result: await execute(call.name, call.args ?? {}) });
        } catch (err) {
          const message = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'tool_error';
          toolResults.push({ name: call.name, result: { error: message } });
        }
      }
    }
  } catch (err) {
    if (err instanceof PlannerSegmentLimitError) {
      return pack(session, 'refuse', voiceCopy(edge.language, 'segment_limit'), [], usage, ['segment_limit']);
    }
    if (err instanceof PlannerInvalidJsonError || err instanceof PlannerInvalidDecisionError) {
      return pack(session, 'refuse', voiceCopy(edge.language, 'invalid'), [], usage, ['invalid_model_output']);
    }
    throw err;
  }
  if (!decision) return pack(session, 'refuse', voiceCopy(edge.language, 'invalid'), [], usage, ['invalid_model_output']);
  const chosen = decision;
  if (session.openQuestion && chosen.type !== 'answer_pending' && chosen.type !== 'cancel_pending') {
    return pack(session, 'clarify', session.openQuestion, [], usage, ['open_question']);
  }
  if (chosen.type === 'cancel_pending') {
    clearPending(session);
    session.planDraft = null;
    return pack(session, 'answer', voiceCopy(edge.language, 'canceled'), [], usage, []);
  }
  if (chosen.type === 'confirm_pending') {
    const intents = session.pendingIntents ?? [];
    if (!intents.length) return pack(session, 'answer', voiceCopy(edge.language, 'no_pending'), [], usage, []);
    const summary = session.pendingSummary ?? '';
    clearPending(session);
    return pack(session, 'act', summary, intents, usage, []);
  }
  if (chosen.type === 'answer_pending') {
    const intents = session.heldIntents;
    session.openQuestion = null;
    session.heldIntents = [];
    session.pendingIntents = intents;
    session.pendingSummary = intents.map((intent) => intent.summary).join(' ');
    return pack(session, intents.length ? 'confirm' : 'refuse', session.pendingSummary || voiceCopy(edge.language, 'invalid'), intents, usage, intents.length ? [] : ['no_pending_question']);
  }
  if (chosen.type === 'final') {
    return pack(session, chosen.outcome, chosen.assistantMessage, [], usage, [], { tomorrow: addDaysToYmd(today, 1), local: `${localYmd(edge.nowIso, edge.timeZone)} ${localHm(edge.nowIso, edge.timeZone)}` });
  }
  if (chosen.type === 'plan_start' || chosen.type === 'plan_edits' || chosen.type === 'plan_question') {
    const question = chosen.type === 'plan_edits' ? chosen.answer : chosen.question;
    return pack(session, chosen.type === 'plan_question' ? 'clarify' : 'confirm', question, [], usage, [], chosen);
  }
  if (chosen.type !== 'steps') {
    return pack(session, 'refuse', voiceCopy(edge.language, 'unsupported'), [], usage, ['unsupported'], chosen);
  }
  const ready: VoiceWriteIntent[] = [];
  let question: string | null = null;
  let refuse: string | null = null;
  for (const segment of chosen.segments) {
    const parsed = await parseSegment(llm, edge, segment, usage);
    if (parsed.question && !question) question = parsed.question;
    if (parsed.refuse && !refuse) refuse = parsed.refuse;
    if (!parsed.question && !parsed.refuse) ready.push(...parsed.intents);
  }
  if (question) {
    session.heldIntents = ready;
    session.openQuestion = question;
    return pack(session, 'clarify', question, [], usage, []);
  }
  if (!ready.length) return pack(session, 'refuse', refuse || voiceCopy(edge.language, 'invalid'), [], usage, []);
  session.pendingIntents = ready;
  session.pendingSummary = ready.map((intent) => intent.summary).join(' ');
  session.heldIntents = [];
  session.openQuestion = null;
  return pack(session, 'confirm', session.pendingSummary, ready, usage, [], chosen);
}
