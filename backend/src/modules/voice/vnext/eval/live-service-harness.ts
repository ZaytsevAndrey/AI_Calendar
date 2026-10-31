/**
 * Production-faithful live harness (V7).
 *
 * Drives the real `StructuredVoiceService.turn()` — the class behind POST /voice/turn — with
 * in-memory repositories built from an evaluation world, a real `GroqClient` (production routing:
 * DeepSeek when `VOICE_LLM_PROVIDER=deepseek`), the production prompt, validation, projection,
 * claims and dialogue. A client simulator sends the claim of the preview it shows on every turn,
 * as the panel does, and reports a dispatched execution as applied (the server never writes; the
 * client-side Scheduling calls are not executed here — "preview-only" verification).
 *
 * Evaluation only. Nothing here is on the production path.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runWithVoiceTrace, VoiceTrace } from '../../../../common/voice-trace';
import type { ProviderEvent } from '../../../calendar-providers/calendar-provider.types';
import type { DayReminder } from '../../../day-reminders/entities/day-reminder.entity';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import { TaskEventType } from '../../../scheduling/event-type.enum';
import { TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import type { VoiceTurnDto } from '../../dto/voice-turn.dto';
import { GroqClient } from '../../groq.client';
import type { DayPlanProposal, PlanDraft, VoiceTurnResponse, VoiceWriteIntent } from '../../voice-agent.types';
import type { VNextLanguage } from '../copy';
import { externalEntityId } from '../search/find-events';
import type { EntityRecord } from '../reference/reference-resolver';
import { StructuredVoiceService } from '../production/structured-voice.service';
import { fixtureEchoProposal } from './phase477-run';
import type { ObservedTurn } from './phase477-score';

export const LIVE_USER = 'user-1';
export const LIVE_NOW = '2026-10-18T06:00:00.000Z'; // Sunday 09:00 Kyiv
export const LIVE_ZONE = 'Europe/Kyiv';

/** One parsed `voice.structured` log line of the service. */
export type TurnStep = { name: string; fields: Record<string, unknown>; body: string | null; warn: boolean };

export type LiveStore = { tasks: Task[]; slots: ScheduledTask[]; reminders: DayReminder[]; events: ProviderEvent[]; externalIds: Map<string, string> };

/**
 * An evaluation world (catalog-level records) as the rows the production service reads.
 * A task with a start gets one slot of an hour (end when given); a task without one is a Later task;
 * a recurring record gets one slot per occurrence; an external event becomes a provider event the
 * model must find through `find_events`, as in production (it is not in the owned list).
 */
export function storeFromWorld(entities: readonly EntityRecord[]): LiveStore {
  const store: LiveStore = { tasks: [], slots: [], reminders: [], events: [], externalIds: new Map() };
  const at = (iso: string) => new Date(iso);
  const updated = at('2026-10-10T00:00:00.000Z');
  for (const row of entities) {
    if (row.type === 'external_event') {
      const start = row.scheduledStart ?? '2026-10-19T07:00:00.000Z';
      const end = row.scheduledEnd ?? new Date(Date.parse(start) + 3_600_000).toISOString();
      const event: ProviderEvent = {
        id: row.id,
        calendarId: row.calendarId ?? 'primary',
        summary: row.name,
        provider: row.provider ?? 'google',
        start: { dateTime: start },
        end: { dateTime: end },
        organizer: { self: row.writable === true },
        updated: updated.toISOString(),
        status: 'confirmed',
      } as ProviderEvent;
      store.events.push(event);
      store.externalIds.set(externalEntityId(event), row.id);
      continue;
    }
    if (row.type === 'reminder') {
      store.reminders.push({
        id: row.id,
        userId: row.userId,
        name: row.name,
        status: row.status === 'open' ? 'open' : 'resolved',
        dueYmd: row.reminder?.dueYmd ?? '2026-10-19',
        notificationTime: row.reminder?.notificationTime ?? null,
        description: row.reminder?.description ?? null,
        recurrencePattern: row.reminder?.recurrencePattern ?? null,
        recurrenceWeekDays: row.reminder?.recurrenceWeekDays ?? null,
        updatedAt: updated,
      } as unknown as DayReminder);
      continue;
    }
    const status = row.status === 'completed' ? TaskStatus.COMPLETED : row.status === 'canceled' ? TaskStatus.CANCELED : TaskStatus.TODO;
    const occurrences = row.recurring
      ? (row.occurrences ?? [])
      : row.scheduledStart
        ? [{ start: row.scheduledStart, end: row.scheduledEnd ?? new Date(Date.parse(row.scheduledStart) + 3_600_000).toISOString(), googleEventId: row.googleEventId ?? null }]
        : [];
    store.tasks.push({
      id: row.id,
      userId: row.userId,
      name: row.name,
      status,
      isRecurring: Boolean(row.recurring),
      isUnscheduled: !row.recurring && !row.scheduledStart,
      eventType: row.fixed ? TaskEventType.FIXED : TaskEventType.ADMIN,
      googleEventId: row.recurring ? row.seriesEventId ?? null : null,
      googleEventCalendarId: row.calendarId ?? null,
      estimatedTimeInMinutes: occurrences[0] ? Math.max(1, Math.round((Date.parse(occurrences[0].end) - Date.parse(occurrences[0].start)) / 60_000)) : 30,
      createdAt: at('2026-10-01T00:00:00.000Z'),
      updatedAt: updated,
      parentSeriesId: null,
      seriesGroupId: null,
      problematicOccurrenceYmds: null,
    } as unknown as Task);
    occurrences.forEach((occurrence, index) => {
      store.slots.push({
        id: `${row.id}-slot-${index + 1}`,
        taskId: row.id,
        scheduledStartTime: at(occurrence.start),
        scheduledEndTime: at(occurrence.end),
        googleEventId: occurrence.googleEventId ?? null,
        googleEventCalendarId: row.calendarId ?? null,
        updatedAt: updated,
      } as unknown as ScheduledTask);
    });
  }
  return store;
}

export type LiveSettings = { timeZone: string; language: VNextLanguage; wakeHm: string; sleepHm: string; defaultDurationMinutes: number; defaultReminderTime: string };

export const DEFAULT_SETTINGS: LiveSettings = { timeZone: LIVE_ZONE, language: 'uk', wakeHm: '08:00', sleepHm: '23:00', defaultDurationMinutes: 30, defaultReminderTime: '09:00' };

/** The production `GroqClient` over the process environment: the same routing POST /voice/turn uses. */
export function productionGroq(env: NodeJS.ProcessEnv = process.env): GroqClient {
  return new GroqClient(new ConfigService({ ...env }));
}

/** The real service over in-memory rows. `groq` may be the production client or a scripted stand-in. */
export function buildLiveService(store: LiveStore, settings: LiveSettings, groq: Pick<GroqClient, 'completeJson' | 'takeLastCompletion'>): StructuredVoiceService {
  const tasksRepository = {
    find: async ({ where }: { where: { userId: string } }) => store.tasks.filter((row) => row.userId === where.userId),
    findOne: async ({ where }: { where: { id: string; userId: string } }) => store.tasks.find((row) => row.id === where.id && row.userId === where.userId) ?? null,
  };
  const scheduledRepository = {
    find: async ({ where }: { where: { taskId: string } }) => store.slots.filter((row) => row.taskId === where.taskId),
    createQueryBuilder: () => {
      let owner = '';
      const chain = {
        innerJoin: () => chain,
        where: (_sql: string, params: { userId: string }) => {
          owner = params.userId;
          return chain;
        },
        getMany: async () => store.slots.filter((row) => store.tasks.some((item) => item.id === row.taskId && item.userId === owner)),
      };
      return chain;
    },
  };
  return new StructuredVoiceService(
    groq as GroqClient,
    {
      getSettings: async () => ({
        timeZone: settings.timeZone,
        wakeTime: `${settings.wakeHm}:00`,
        sleepTime: `${settings.sleepHm}:00`,
        speechLanguage: settings.language,
        language: settings.language,
        defaultTaskDurationMinutes: settings.defaultDurationMinutes,
        defaultReminderTime: settings.defaultReminderTime,
      }),
    } as never,
    { execute: async () => ({}) } as never,
    { propose: async (_userId: string, draft: PlanDraft): Promise<DayPlanProposal> => fixtureEchoProposal(draft) } as never,
    { listVisibleEvents: async () => store.events } as never,
    { findAll: async (userId: string) => store.reminders.filter((row) => row.userId === userId && (row as { status: string }).status === 'open') } as never,
    tasksRepository as never,
    scheduledRepository as never,
    { find: async () => [] } as never,
  );
}

/** Collects the service's `voice.structured` lines while a turn runs. Bodies need VOICE_TRACE_BODY=1. */
export class StepCapture {
  private lines: TurnStep[] = [];

  start(): void {
    const push = (warn: boolean) => (message: unknown) => {
      const text = typeof message === 'string' ? message : String(message);
      const step = parseStepLine(text, warn);
      if (step) this.lines.push(step);
    };
    const sink = { log: push(false), warn: push(true), error: push(true), debug: () => undefined, verbose: () => undefined, fatal: push(true) };
    Logger.overrideLogger(sink as never);
  }

  take(): TurnStep[] {
    const taken = this.lines;
    this.lines = [];
    return taken;
  }

  /** Back to Nest's default console logger (there is no getter for the previous one). */
  stop(): void {
    Logger.overrideLogger(true);
  }
}

export function parseStepLine(text: string, warn = false): TurnStep | null {
  const match = /^voice\.structured (\S+) (\S+) (.*)$/s.exec(text);
  if (!match) return null;
  const rest = match[3];
  const bodyAt = rest.indexOf(' body=');
  const fieldsText = bodyAt >= 0 ? rest.slice(0, bodyAt) : rest;
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(fieldsText) as Record<string, unknown>;
  } catch {
    fields = { raw: fieldsText };
  }
  return { name: match[2], fields, body: bodyAt >= 0 ? rest.slice(bodyAt + 6) : null, warn };
}

export type LiveTurn = {
  turn: number;
  utterance: string;
  dto: Record<string, unknown>;
  response: VoiceTurnResponse;
  observed: ObservedTurn;
  steps: TurnStep[];
  /** Prompt, model outputs and reads of this turn, pulled from the steps for the report. */
  prompt: string | null;
  modelOutputs: string[];
  reads: Array<{ tool: string; args: unknown; result: unknown; error: string | null; ms: number | null }>;
  validationErrors: string[];
  usage: { calls: number; tokens: number; promptTokens: number; completionTokens: number; usd: number } | null;
  latencyMs: number;
  /** The client's simulated execution report, when this turn dispatched writes. */
  simulatedReport: { executionId: string; results: Array<{ summary: string; status: 'applied' }> } | null;
};

export type LiveClient = {
  turn(utterance: string): Promise<LiveTurn>;
  turns(): LiveTurn[];
};

function jsonBody(body: string | null): unknown {
  if (body == null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** World ids for production external ids (`ext:google:<id>` → `<id>`), so the scorer sees the world's names. */
function normalizeIntents(intents: VoiceWriteIntent[], externalIds: Map<string, string>): VoiceWriteIntent[] {
  if (!externalIds.size) return intents;
  const text = JSON.stringify(intents);
  let out = text;
  for (const [production, world] of externalIds) out = out.split(`"${production}"`).join(`"${world}"`);
  return JSON.parse(out) as VoiceWriteIntent[];
}

/**
 * The client side of /voice/turn: one session, the shown claim on every turn, a report of every
 * dispatched execution as applied (simulated — nothing is written anywhere), and the per-turn capture.
 */
export function liveClient(input: {
  service: StructuredVoiceService;
  groq: Pick<GroqClient, 'runWithPin'> | null;
  capture: StepCapture;
  sessionId: string;
  store: LiveStore;
  timeZone?: string;
  nowIso?: string;
}): LiveClient {
  const history: LiveTurn[] = [];
  let shown: { executionId: string; previewRevision: number } | null = null;
  const run = <T>(fn: () => Promise<T>): Promise<T> => runWithVoiceTrace(new VoiceTrace(), () => (input.groq ? input.groq.runWithPin(0, fn).then((row) => row.value) : fn()));
  const call = async (dto: Record<string, unknown>): Promise<{ response: VoiceTurnResponse; steps: TurnStep[]; ms: number }> => {
    input.capture.take();
    const started = Date.now();
    const response = await run(() => input.service.turn(LIVE_USER, dto as unknown as VoiceTurnDto));
    return { response, steps: input.capture.take(), ms: Date.now() - started };
  };
  return {
    turns: () => history,
    async turn(utterance: string): Promise<LiveTurn> {
      const dto: Record<string, unknown> = {
        sessionId: input.sessionId,
        timeZone: input.timeZone ?? LIVE_ZONE,
        clientNowIso: input.nowIso ?? LIVE_NOW,
        transcript: utterance,
        ...(shown ?? {}),
      };
      const { response, steps, ms } = await call(dto);
      const state = steps.find((step) => step.name === 'turn.state');
      const result = steps.find((step) => step.name === 'turn.result');
      const preview = state?.fields.preview as { state?: string; items?: number } | null | undefined;
      const intents = normalizeIntents(response.intents ?? [], input.store.externalIds);
      const observed: ObservedTurn = {
        outcome: response.outcome,
        blocked: Array.isArray(state?.fields.blocked) ? (state!.fields.blocked as string[]) : [],
        intents,
        serverWrites: typeof state?.fields.serverWrites === 'number' ? (state!.fields.serverWrites as number) : 0,
        assistantMessage: response.assistantMessage ?? '',
        draftNames: response.plan?.items?.map((item) => item.name) ?? draftNamesFrom(steps),
        pendingCount: preview?.state === 'open' ? preview.items ?? 0 : 0,
        timeZone: input.timeZone ?? LIVE_ZONE,
      };
      const usage = result?.fields.usage as LiveTurn['usage'] | undefined;
      const row: LiveTurn = {
        turn: history.length,
        utterance,
        dto,
        response: { ...response, intents },
        observed,
        steps,
        prompt: steps.find((step) => step.name === 'interpreter.prompt')?.body ?? null,
        modelOutputs: steps.filter((step) => step.name === 'model.call' && step.body).map((step) => step.body!),
        reads: steps.filter((step) => step.name.startsWith('tool.')).map((step) => {
          const body = jsonBody(step.body) as { args?: unknown; result?: unknown } | null;
          return { tool: step.name.slice(5), args: body?.args ?? null, result: body?.result ?? null, error: (step.fields.error as string | null) ?? null, ms: (step.fields.ms as number | null) ?? null };
        }),
        validationErrors: steps.filter((step) => step.name === 'model.validation' && step.fields.valid === false).flatMap((step) => (step.fields.errors as string[]) ?? []),
        usage: usage ?? null,
        latencyMs: ms,
        simulatedReport: null,
      };
      // The panel keeps sending the claim of the preview it shows; a dispatched one is reported and gone.
      shown = response.execution?.state === 'open' ? { executionId: response.execution.executionId, previewRevision: response.execution.previewRevision } : null;
      if (response.outcome === 'act' && response.execution?.executionId && intents.length) {
        const report = { executionId: response.execution.executionId, results: intents.map((intent) => ({ summary: intent.summary, status: 'applied' as const })) };
        await call({ sessionId: input.sessionId, timeZone: input.timeZone ?? LIVE_ZONE, clientNowIso: input.nowIso ?? LIVE_NOW, actionId: 'report', executionReport: report });
        row.simulatedReport = report;
      }
      history.push(row);
      return row;
    },
  };
}

function draftNamesFrom(steps: TurnStep[]): string[] {
  const state = steps.find((step) => step.name === 'turn.state');
  const draft = state?.fields.draft as { items?: string[] } | undefined;
  return draft?.items ?? [];
}
