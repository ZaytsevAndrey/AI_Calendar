/**
 * Production `/voice/turn` on the structured vNext pipeline.
 * The server loads the user's catalog, the interpreter runs with authorized reads only, previews
 * need an explicit claim to confirm, confirm re-reads every target, and the client reports what
 * Apply did. No provider write happens here.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../../../common/iana-time-zone';
import { traceStep } from '../../../../common/voice-trace';
import { ExternalCalendarBusyService } from '../../../calendar-providers/external-calendar-busy.service';
import { overdueDays } from '../../../day-reminders/day-reminder.dates';
import { DayRemindersService } from '../../../day-reminders/day-reminders.service';
import { Phase } from '../../../phases/entities/phase.entity';
import { ScheduledTask } from '../../../schedule/schedule.entity';
import { Task, TaskStatus } from '../../../tasks/entities/task.entity';
import { UserSettingsService } from '../../../user-settings/user-settings.service';
import type { VoiceTurnDto } from '../../dto/voice-turn.dto';
import { GroqClient } from '../../groq.client';
import { VoiceDayPlanner } from '../../voice-agent.day-plan';
import { VoiceAgentTools, type VoiceToolContext } from '../../voice-agent.tools';
import type { PlanItem, VoiceExecutionClaim, VoiceTurnResponse } from '../../voice-agent.types';
import {
  addDaysToYmd,
  civilDayStartIso,
  localHm,
  localYmd,
  upcomingWeekdayYmd,
  scheduleTodayYmd,
} from '../../voice-local-date.util';
import { isNoiseOrEmptyTranscript, spokenControl } from '../../voice-stt.util';
import { canConfirm } from '../session/dialogue';
import { ReadBroker } from '../broker/read-broker';
import type { ProposalGroup } from '../contracts/proposal';
import type { SemanticEnvelopeV1 } from '../contracts/types';
import type { VNextLanguage } from '../copy';
import { buildTurnUser, INTERPRETER_A_SYSTEM, PROMPT_A_HASH } from '../interpreters/prompts';
import { runInterpreterA } from '../interpreters/run-interpreter';
import type { LlmComplete, RepairObserver } from '../repair/repair';
import { runVNextTurn, type InterpretOutput, type PipelineResult, type TurnInput, type VNextInterpreter } from '../pipeline';
import { domainReadExecutor } from '../read/domain-executor';
import type { EntityRecord } from '../reference/reference-resolver';
import { appendTurn, intentKey } from '../session/session';
import { buildCatalog, fingerprint, readResult, reminderRecord, taskRecord } from './catalog';
import { applyReport, expireUnreported, recordDispatch } from './outcomes';
import { StructuredVoiceSessions, type SessionEntry } from './session-registry';
import type { VNextSession } from '../session/session';
import { TurnLog } from './turn-log';
import { completionUsd } from '../llm/pricing';
import { FIND_TASKS_TOOL, findTasks } from '../search/find-tasks';
import { externalRecord, FIND_EVENTS_TOOL, parseFindEventsArgs } from '../search/find-events';
import type { ProviderEvent } from '../../../calendar-providers/calendar-provider.types';
import type { SearchReceipt } from '../search/receipt';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZERO = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

type Context = {
  userId: string;
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  language: VNextLanguage;
  defaultDurationMinutes: number;
  defaultReminderTime: string;
  tasks: Task[];
  slots: ScheduledTask[];
  tools: VoiceToolContext;
  catalog: EntityRecord[];
};

function hm(value: string | null | undefined, fallback: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? '');
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function voiceErrorCode(err: unknown): string | undefined {
  if (!(err instanceof ServiceUnavailableException)) return undefined;
  const response = err.getResponse();
  return typeof response === 'object' && response !== null && typeof (response as { code?: unknown }).code === 'string'
    ? (response as { code: string }).code
    : undefined;
}

/** One plan item for the prompt: its id, so an edit can name it, and the clocks it already has. */
export function planItemLine(item: PlanItem): string {
  return [
    `item ${item.id} ${item.name} ${item.durationMinutes}m`,
    item.preferredHm ? `at ${item.preferredHm}` : '',
    item.earliestHm ? `from ${item.earliestHm}` : '',
    item.deadlineHm ? `until ${item.deadlineHm}` : '',
  ].filter(Boolean).join(' ');
}

/** A UI action is not interpreted. It becomes the matching control, with no model call. */
function fixed(output: { group?: ProposalGroup; envelope?: SemanticEnvelopeV1 }): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return { ok: true, reads: [], usage: ZERO, specialist: null, promptHash: 'ui_action', ...output };
    },
  };
}

const CONTROL = (control: 'confirm' | 'cancel'): ProposalGroup => ({ version: '1', control, proposals: [], patches: [] });

/** Provider events the model sees without a read: today and the next 13 civil days, refreshed each minute. */
const EXTERNAL_PRELOAD_DAYS = 14;
const EXTERNAL_PRELOAD_TTL_MS = 60_000;

@Injectable()
export class StructuredVoiceService {
  private readonly logger = new Logger(StructuredVoiceService.name);
  private readonly sessions = new StructuredVoiceSessions();

  constructor(
    private readonly groq: GroqClient,
    private readonly userSettingsService: UserSettingsService,
    private readonly tools: VoiceAgentTools,
    private readonly dayPlanner: VoiceDayPlanner,
    private readonly externalBusy: ExternalCalendarBusyService,
    private readonly dayReminders: DayRemindersService,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
  ) {}

  turn(userId: string, dto: VoiceTurnDto): Promise<VoiceTurnResponse> {
    return this.sessions.run(userId, dto.sessionId, (entry) => this.turnLocked(userId, dto, entry));
  }

  endSession(userId: string, sessionId: string): void {
    this.sessions.end(userId, sessionId);
  }

  private async turnLocked(userId: string, dto: VoiceTurnDto, entry: SessionEntry): Promise<VoiceTurnResponse> {
    const log = new TurnLog(this.logger);
    const actionId = dto.actionId?.trim();
    const transcript = (dto.transcript ?? '').trim();
    const claim = dto.executionId && typeof dto.previewRevision === 'number'
      ? { executionId: dto.executionId, previewRevision: dto.previewRevision }
      : undefined;
    log.step('turn.start', {
      engine: 'structured',
      userId,
      sessionId: dto.sessionId,
      actionId: actionId ?? null,
      transcriptChars: transcript.length,
      claim: claim ?? null,
      clientNowIso: dto.clientNowIso ?? null,
      clientTimeZone: dto.timeZone,
      mode: dto.mode ?? null,
      previewBefore: this.openClaim(entry),
    }, transcript || undefined);
    if (actionId === 'report') {
      const applied = applyReport(entry, dto.executionReport);
      const fields = {
        ok: applied.ok,
        code: applied.code ?? null,
        executionId: dto.executionReport?.executionId ?? null,
        statuses: (dto.executionReport?.results ?? []).map((row) => `${row.status}${row.definite ? ':definite' : ''}`),
        ledger: entry.session.applyLedger.map((row) => row.status),
      };
      if (applied.ok) log.step('apply.report', fields, dto.executionReport);
      else log.warn('apply.report_ignored', fields, dto.executionReport);
      return this.finish(log, entry, this.response(entry, { outcome: 'answer', assistantMessage: '' }));
    }
    const expired = expireUnreported(entry);
    if (expired.length) log.warn('apply.unreported_marked_unknown', { executionIds: expired });
    const chosen = this.interpreterFor(actionId, transcript, entry.session);
    if (!chosen) {
      log.step('turn.ignored', { reason: actionId ? `client_action:${actionId}` : 'noise_or_empty' });
      return this.finish(log, entry, this.response(entry, { outcome: 'answer', assistantMessage: '' }));
    }
    const interpreter: VNextInterpreter | 'model' = typeof chosen === 'object' && 'control' in chosen ? fixed({ group: CONTROL(chosen.control) }) : chosen;
    if (typeof chosen === 'object' && 'control' in chosen) log.step('interpreter.spoken_control', { control: chosen.control, model: false });
    else if (interpreter !== 'model') log.step('interpreter.ui_action', { actionId, model: false });

    const ctx = await this.loadContext(userId, dto, log);
    // Provider events of the coming days are part of what the model can address, like owned tasks:
    // without them the model created tasks named like an event, or asked which item (V7). They enter
    // the same `external` map a find_events read fills, so confirm re-reads them the same way.
    if (interpreter === 'model') await this.preloadExternal(ctx, entry, log);
    log.step('context.ready', {
      timeZone: ctx.timeZone,
      nowIso: ctx.nowIso,
      language: ctx.language,
      wakeHm: ctx.wakeHm,
      sleepHm: ctx.sleepHm,
      defaultDurationMinutes: ctx.defaultDurationMinutes,
      defaultReminderTime: ctx.defaultReminderTime,
      catalog: ctx.catalog.length,
      catalogOpen: ctx.catalog.filter((row) => row.status === 'open').length,
      movable: ctx.catalog.filter((row) => row.googleEventId).length,
    }, ctx.catalog.map((row) => ({ id: row.id, type: row.type, name: row.name, status: row.status, revision: row.revision, start: row.scheduledStart ?? null, recurring: row.recurring ?? false })));
    const input: TurnInput = {
      transcript,
      userId,
      session: entry.session,
      nowIso: ctx.nowIso,
      timeZone: ctx.timeZone,
      wakeHm: ctx.wakeHm,
      sleepHm: ctx.sleepHm,
      defaultDurationMinutes: ctx.defaultDurationMinutes,
      defaultReminderTime: ctx.defaultReminderTime,
      language: ctx.language,
      // Provider events read earlier in this session stay addressable; confirm re-reads them.
      entities: [...ctx.catalog, ...entry.external.values()],
      planContext: {
        tasks: ctx.tasks,
        slots: ctx.slots,
        timeZone: ctx.timeZone,
        nowIso: ctx.nowIso,
        defaultDurationMinutes: ctx.defaultDurationMinutes,
      },
      proposeDay: (owner, draft, timeZone) => traceStep('other', 'day.propose', '', () => log.timed(
        'day.propose',
        () => this.dayPlanner.propose(owner, draft, timeZone),
        (proposal) => ({
          fields: { day: proposal.day, draftItems: draft.items.length, placed: proposal.items.length, unplaced: proposal.unplaced.map((row) => row.reason) },
          body: { draft: draft.items, proposal },
        }),
      )),
      readEntity: (id) => traceStep('other', 'confirm.reread', '', () => log.timed(
        'confirm.reread',
        () => this.readEntity(ctx, entry, id),
        (read) => ({ fields: { entityId: id, ...read } }),
      )),
      // No trusted complete search exists in production yet, so scope:all fails closed.
      arm: 'A',
      ...(claim ? { confirmation: claim } : {}),
    };
    // Not a voice.trace step: model calls, reads, and re-reads inside it are steps of their own,
    // and an enclosing step would count their time twice.
    const result = await log.timed(
      'pipeline',
      () => runVNextTurn(input, interpreter === 'model' ? this.modelInterpreter(ctx, entry, transcript, log, {
        // One search is one trusted set. Several searches in a turn are not one set, so scope:all fails closed.
        onReceipts: (receipts) => {
          input.searchReceipt = receipts.length === 1 ? receipts[0] : { complete: false, ids: [] };
        },
        // Provider events read by the interpreter join this turn's authorized catalog.
        onExternal: (records) => {
          for (const record of records) {
            if (!input.entities.some((row) => row.id === record.id)) input.entities.push(record);
          }
        },
      }) : interpreter),
    );
    for (const event of result.traces) log.step(`pipeline.${event.name}`, event.fields);
    if (result.response.outcome === 'act' && claim && result.response.intents.length) {
      recordDispatch(entry, claim.executionId, result.response.intents.map(intentKey));
      log.step('apply.dispatched', { executionId: claim.executionId, intents: result.response.intents.length }, result.response.intents);
    }
    if (result.response.assistantMessage) appendTurn(entry.session, 'assistant', result.response.assistantMessage);
    const response = this.respond(entry, result, claim);
    const state = entry.session.structured;
    log.step('turn.state', {
      blocked: result.blocked,
      preservedLabels: result.preservedLabels,
      serverWrites: result.serverWrites,
      sessionVersion: state?.sessionVersion ?? null,
      preview: state?.preview ? { executionId: state.preview.executionId, revision: state.preview.previewRevision, state: state.preview.executionState, items: state.preview.items.length } : null,
      operations: state?.operations.map((operation) => `${operation.pendingId}:${operation.action}:${operation.target.kind === 'entity' ? operation.target.entityId : 'new'}`) ?? [],
      fingerprints: Object.keys(state?.entityFingerprints ?? {}),
      // The open day-plan draft by item name, so a log reader sees what the next turn builds on.
      draft: entry.session.planDraft ? { day: entry.session.planDraft.day, items: entry.session.planDraft.items.map((item) => item.name) } : null,
    }, state ? { operations: state.operations, dependencies: state.dependencies, fingerprints: state.entityFingerprints } : undefined);
    return this.finish(log, entry, response);
  }

  /** Last line of a turn: what goes back to the client and how long the whole turn took. */
  private finish(log: TurnLog, entry: SessionEntry, response: VoiceTurnResponse): VoiceTurnResponse {
    log.step('turn.result', {
      ms: log.elapsed(),
      outcome: response.outcome,
      intents: response.intents.map((intent) => (intent.type === 'create' ? 'create' : String(intent.command.kind))),
      actions: response.actions,
      plan: response.plan ? { day: response.plan.day, items: response.plan.items.length, unplaced: response.plan.unplaced.length } : null,
      execution: response.execution ?? null,
      openQuestion: Boolean(entry.session.openQuestion),
      ledger: entry.session.applyLedger.map((row) => row.status),
      usage: log.usage,
    }, { assistantMessage: response.assistantMessage, intents: response.intents });
    return response;
  }

  /**
   * `model` for an utterance, a fixed control for a UI action, or null when there is nothing to do.
   * While a preview is open and no question is pending, a bare yes or no is the same control as the
   * Apply or Cancel button (D-10): no model call, nothing interpreted. Anything longer is speech.
   */
  private interpreterFor(actionId: string | undefined, transcript: string, session: VNextSession): VNextInterpreter | 'model' | null | { control: 'confirm' | 'cancel' } {
    if (actionId === 'confirm') return fixed({ group: CONTROL('confirm') });
    if (actionId === 'cancel') return fixed({ group: CONTROL('cancel') });
    if (actionId === 'build_plan') {
      return fixed({ envelope: { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } } });
    }
    // Before the noise filter: a two-letter "no" is an answer when a preview is waiting for one.
    const spoken = canConfirm(session) ? spokenControl(transcript) : null;
    if (spoken) return { control: spoken };
    if (isNoiseOrEmptyTranscript(transcript)) return null;
    return 'model';
  }

  private modelInterpreter(
    ctx: Context,
    entry: SessionEntry,
    transcript: string,
    log: TurnLog,
    hooks: { onReceipts: (receipts: SearchReceipt[]) => void; onExternal: (records: EntityRecord[]) => void },
  ): VNextInterpreter {
    const receipts: SearchReceipt[] = [];
    let call = 0;
    const llm: LlmComplete = {
      complete: async ({ system, user }) => {
        call += 1;
        const index = call;
        const kind = system === INTERPRETER_A_SYSTEM ? (user.includes('\nReads:') ? 'interpret_with_reads' : 'interpret') : 'repair';
        const started = Date.now();
        try {
          const text = await this.groq.completeJson(system, user, { role: 'planner', label: `vnext.${kind}` });
          // What the provider reported for this call: tokens, the model that answered, and its price (VR-24).
          const measured = this.groq.takeLastCompletion();
          const usd = measured ? completionUsd(measured.model, measured) : null;
          log.noteModelCall(measured ? { ...measured, usd } : null);
          log.step('model.call', {
            call: index,
            kind,
            ms: Date.now() - started,
            systemChars: system.length,
            userChars: user.length,
            outputChars: text.length,
            model: measured?.model ?? null,
            tokens: measured?.totalTokens ?? null,
            promptTokens: measured?.promptTokens ?? null,
            completionTokens: measured?.completionTokens ?? null,
            usd,
          }, index === 1 ? `output=${text}` : `user=${user} || output=${text}`);
          return {
            text,
            inputTokens: measured?.promptTokens ?? 0,
            outputTokens: measured?.completionTokens ?? 0,
            latencyMs: Date.now() - started,
          };
        } catch (err) {
          log.warn('model.call', {
            call: index,
            kind,
            ms: Date.now() - started,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            code: voiceErrorCode(err) ?? null,
          });
          throw err;
        }
      },
    };
    // One provider probe per turn. A failed probe stays failed for the turn, so a later read
    // is not reported as an empty day either.
    let probe: Promise<unknown> | null = null;
    const execute = domainReadExecutor(this.tools, ctx.tools, async () => {
      const day = localYmd(ctx.nowIso, ctx.timeZone);
      // Log only: the probe runs inside a tool step, which already counts its time.
      probe ??= log.timed(
        'provider.probe',
        () => this.tools.dayEvents(ctx.tools, day),
        (events) => ({ fields: { events: events.length } }),
      );
      await probe;
    });
    const broker = new ReadBroker((name, args) => traceStep('other', `tool.${name}`, '', () => log.timed(
      `tool.${name}`,
      () => (name === FIND_TASKS_TOOL
        ? Promise.resolve(this.findTasks(ctx, args, receipts, hooks.onReceipts))
        : name === FIND_EVENTS_TOOL
          ? this.findEvents(ctx, entry, args, hooks.onExternal)
          : execute(name, args)),
      (result) => {
        const error = result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
          ? (result as { error: string }).error
          : null;
        return { fields: { error, resultChars: JSON.stringify(result ?? null).length }, body: { args, result } };
      },
    ), undefined, { component: 'tool' }));
    const prompt = this.prompt(ctx, entry, transcript);
    log.step('interpreter.prompt', {
      system: 'interpreter_a',
      promptHash: PROMPT_A_HASH,
      systemChars: INTERPRETER_A_SYSTEM.length,
      userChars: prompt.length,
      owned: ctx.catalog.filter((row) => row.status === 'open').length,
      pending: entry.session.structured?.preview?.executionState === 'open',
      openQuestion: Boolean(entry.session.openQuestion),
      draft: Boolean(entry.session.planDraft),
      history: entry.session.turns.length,
    }, prompt);
    const observer: RepairObserver = {
      call: () => undefined,
      validation: (valid, errors) => {
        if (valid) log.step('model.validation', { valid });
        else log.warn('model.validation', { valid, errors: errors.map((row) => `${row.code}@${row.path}`) }, errors);
      },
    };
    return {
      arm: 'A',
      interpret: async (_structuredUser, utterance): Promise<InterpretOutput> => {
        const started = Date.now();
        try {
          const output = await runInterpreterA(llm, broker, prompt, utterance, observer);
          log.step('interpreter.result', {
            ms: Date.now() - started,
            ok: output.ok,
            code: output.code ?? null,
            modelCalls: call,
            reads: output.reads.map((read) => `${read.name}:${read.ok ? 'ok' : read.error ?? 'fail'}${read.withheld ? `:${read.withheld}` : ''}`),
            kind: output.envelope?.kind ?? null,
            operations: output.envelope?.operations.map((operation) => `${operation.action}:${operation.target.kind}`) ?? [],
            control: output.envelope?.control ?? null,
          }, output.envelope);
          return output;
        } catch (err) {
          const code = voiceErrorCode(err);
          log.warn('interpreter.failed', { ms: Date.now() - started, code: code ?? null, error: err instanceof Error ? err.message : String(err) });
          if (code === 'VOICE_RATE_LIMIT' || code === 'VOICE_LLM_TIMEOUT') throw err;
          return { ok: false, reads: broker.records, usage: ZERO, specialist: null, promptHash: PROMPT_A_HASH, code: 'provider_or_transport_error' };
        }
      },
    };
  }

  /**
   * The interpreter sees only this user's open records, by id. Pending operations are not offered
   * for cross-turn edits the bridge cannot carry; the pending summary is, and a new utterance
   * replaces the preview.
   */
  private prompt(ctx: Context, entry: SessionEntry, transcript: string): string {
    const session = entry.session;
    const today = scheduleTodayYmd(ctx.nowIso, ctx.timeZone, ctx.wakeHm, ctx.sleepHm);
    const open = session.structured?.preview?.executionState === 'open';
    return buildTurnUser({
      transcript,
      nowLocal: `${localYmd(ctx.nowIso, ctx.timeZone)} ${localHm(ctx.nowIso, ctx.timeZone)}`,
      timeZone: ctx.timeZone,
      wakeHm: ctx.wakeHm,
      sleepHm: ctx.sleepHm,
      scheduleToday: today,
      tomorrow: addDaysToYmd(today, 1),
      weekdays: WEEKDAYS.map((name, dow) => `${name} ${upcomingWeekdayYmd(today, dow)}`).join(', '),
      defaultDurationMinutes: ctx.defaultDurationMinutes,
      language: ctx.language,
      owned: [...ctx.catalog, ...entry.external.values()]
        .filter((row) => row.status === 'open')
        .map((row) => ({
          id: row.id,
          type: row.type,
          name: row.name,
          status: row.status,
          start: row.scheduledStart ? `${localYmd(row.scheduledStart, ctx.timeZone)} ${localHm(row.scheduledStart, ctx.timeZone)}` : null,
          // A series shows its coming days, so "Monday's gym" is a day the model can name (V7, en-d-03).
          ...(row.recurring && row.occurrences?.length
            ? { days: row.occurrences.slice(0, 6).map((occurrence) => `${localYmd(occurrence.start, ctx.timeZone)} ${localHm(occurrence.start, ctx.timeZone)}`) }
            : {}),
          ...(row.type === 'task' && row.unscheduled ? { later: true } : {}),
          ...(row.type === 'external_event' && !row.writable ? { access: 'read-only' } : {}),
        })),
      openQuestion: session.openQuestion,
      pending: open,
      pendingSummary: open ? session.pendingSummary : null,
      // The open preview's operations, by the id a correction must target (operation_result + opId).
      pendingOperations: open
        ? (session.structured?.operations ?? []).map((operation) => ({
          opId: operation.pendingId,
          action: operation.action,
          constraints: operation.constraints.map(({ constraintId: _id, ...rest }) => rest),
        }))
        : [],
      // Built before the turn appends this utterance, so every stored turn is history.
      history: session.turns,
      draft: session.planDraft
        ? {
            day: session.planDraft.day,
            revision: session.planDraft.revision,
            items: session.planDraft.items.map(planItemLine),
            later: ctx.tasks
              .filter((task) => task.isUnscheduled && !task.isRecurring && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELED)
              .filter((task) => !session.planDraft!.items.some((item) => item.taskId === task.id))
              .slice(0, 10)
              .map((task) => `${task.id} ${task.name}`),
          }
        : null,
      appliedCount: entry.dispatched.size,
    });
  }

  /** Trusted set search over the full server catalog. Its receipt, not the model, defines a bulk set. */
  private findTasks(ctx: Context, args: Record<string, unknown>, receipts: SearchReceipt[], onReceipts: (receipts: SearchReceipt[]) => void): unknown {
    const found = findTasks({ userId: ctx.userId, timeZone: ctx.timeZone, tasks: ctx.tasks, slots: ctx.slots }, args);
    if (!('error' in found.result)) {
      receipts.push(found.receipt);
      onReceipts([...receipts]);
    }
    return found.result;
  }

  /** Provider events for a day range. Each becomes an authorized row for this session; the reply lists them. */
  private async findEvents(ctx: Context, entry: SessionEntry, raw: Record<string, unknown>, onExternal: (records: EntityRecord[]) => void): Promise<unknown> {
    const parsed = parseFindEventsArgs(raw);
    if (!parsed.ok) return { error: parsed.error };
    // Civil days, half-open: [from 00:00, the day after `to` 00:00), each with its own midnight offset (VC-11 / AUD-014).
    const events = await this.externalBusy.listVisibleEvents(ctx.userId, civilDayStartIso(parsed.args.from, ctx.timeZone), civilDayStartIso(addDaysToYmd(parsed.args.to, 1), ctx.timeZone));
    const needle = parsed.args.nameContains?.toLocaleLowerCase();
    const records = this.externalRecords(ctx, events).filter((record) => !needle || record.name.toLocaleLowerCase().includes(needle));
    for (const record of records) entry.external.set(record.id, record);
    onExternal(records);
    return {
      complete: true,
      items: records.map((record) => ({
        id: record.id,
        name: record.name,
        start: record.scheduledStart ?? null,
        end: record.scheduledEnd ?? null,
        calendarId: record.calendarId ?? null,
        recurring: record.recurring ?? false,
        access: record.writable ? 'editable' : 'read-only',
      })),
    };
  }

  /** Upcoming provider events (today and the next 13 days), once per session per minute. */
  private async preloadExternal(ctx: Context, entry: SessionEntry, log: TurnLog): Promise<void> {
    const today = localYmd(ctx.nowIso, ctx.timeZone);
    const key = `${today}:${ctx.timeZone}`;
    const now = Date.now();
    if (entry.externalLoaded && entry.externalLoaded.key === key && now - entry.externalLoaded.at < EXTERNAL_PRELOAD_TTL_MS) return;
    try {
      const events = await log.timed(
        'provider.preload',
        () => this.externalBusy.listVisibleEvents(ctx.userId, civilDayStartIso(today, ctx.timeZone), civilDayStartIso(addDaysToYmd(today, EXTERNAL_PRELOAD_DAYS), ctx.timeZone)),
        (rows) => ({ fields: { events: rows.length, days: EXTERNAL_PRELOAD_DAYS } }),
      );
      for (const record of this.externalRecords(ctx, events)) entry.external.set(record.id, record);
      entry.externalLoaded = { key, at: now };
    } catch (err) {
      // A provider that cannot be reached leaves the list as it was; the turn goes on without it.
      log.warn('provider.preload', { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private externalRecords(ctx: Context, events: ProviderEvent[]): EntityRecord[] {
    // A Luefy task's own calendar event is reached through the task, not as a second object.
    const synced = new Set<string>();
    for (const task of ctx.tasks) if (task.googleEventId) synced.add(task.googleEventId);
    for (const slot of ctx.slots) if (slot.googleEventId) synced.add(slot.googleEventId);
    return events
      .map((event) => externalRecord(event, ctx.userId, synced, fingerprint))
      .filter((record): record is EntityRecord => record !== null);
  }

  /** Re-read one provider event on the day it was seen. Moved off that day reads as gone, which fails closed. */
  private async rereadEvent(ctx: Context, entry: SessionEntry, seen: EntityRecord) {
    const day = seen.scheduledStart ? localYmd(seen.scheduledStart, ctx.timeZone) : localYmd(ctx.nowIso, ctx.timeZone);
    const events = await this.externalBusy.listVisibleEvents(ctx.userId, civilDayStartIso(day, ctx.timeZone), civilDayStartIso(addDaysToYmd(day, 1), ctx.timeZone));
    const fresh = this.externalRecords(ctx, events).find((record) => record.id === seen.id);
    if (!fresh) return { exists: false };
    entry.external.set(fresh.id, fresh);
    return readResult(fresh);
  }

  /** Confirm-time re-read: by id and owner, through the same record builders as the catalog. */
  private async readEntity(ctx: Context, entry: SessionEntry, id: string) {
    const userId = ctx.userId;
    const seen = entry.external.get(id);
    if (seen) return this.rereadEvent(ctx, entry, seen);
    const task = await this.tasksRepository.findOne({ where: { id, userId } });
    if (task) {
      const slots = await this.scheduledRepository.find({ where: { taskId: task.id } });
      return readResult(taskRecord(task, slots));
    }
    const reminder = (await this.dayReminders.findAll(userId)).find((row) => row.id === id);
    if (reminder) return readResult(reminderRecord(reminder));
    return { exists: false };
  }

  private async loadContext(userId: string, dto: VoiceTurnDto, log: TurnLog): Promise<Context> {
    const [settings, phases, tasks, slots, reminders] = await traceStep('other', 'db.turn-context', '', () => log.timed(
      'context.load',
      () => Promise.all([
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
      ([, phaseRows, taskRows, slotRows, reminderRows]) => ({
        fields: { phases: phaseRows.length, tasks: taskRows.length, slots: slotRows.length, reminders: reminderRows.length },
      }),
    ));
    const timeZone = resolveIanaTimeZone(settings.timeZone || dto.timeZone);
    const nowIso = dto.clientNowIso?.trim() || new Date().toISOString();
    const speech = settings.speechLanguage || settings.language || 'en';
    const minutes = settings.defaultTaskDurationMinutes;
    return {
      userId,
      nowIso,
      timeZone,
      wakeHm: hm(settings.wakeTime, '08:00'),
      sleepHm: hm(settings.sleepTime, '23:00'),
      language: speech === 'uk' ? 'uk' : 'en',
      defaultDurationMinutes: typeof minutes === 'number' && minutes >= 5 ? minutes : 30,
      defaultReminderTime: hm(settings.defaultReminderTime, '09:00'),
      tasks,
      slots,
      tools: {
        userId,
        timeZone,
        nowIso,
        settings,
        tasks,
        slots,
        phases,
        reminders: reminders.map((row) => ({
          name: row.name,
          dueYmd: row.dueYmd,
          overdueDays: overdueDays(row.dueYmd, localYmd(nowIso, timeZone)),
          notificationTime: row.notificationTime,
          recurrencePattern: row.recurrencePattern,
        })),
      },
      catalog: buildCatalog(userId, tasks, slots, reminders),
    };
  }

  private respond(
    entry: SessionEntry,
    result: PipelineResult,
    claim: { executionId: string; previewRevision: number } | undefined,
  ): VoiceTurnResponse {
    const dispatched = result.response.outcome === 'act' && claim && entry.dispatched.has(claim.executionId);
    return {
      ...result.response,
      execution: dispatched ? { ...claim, state: 'dispatched' } : this.openClaim(entry),
    };
  }

  private response(entry: SessionEntry, partial: Pick<VoiceTurnResponse, 'outcome' | 'assistantMessage'>): VoiceTurnResponse {
    return {
      sessionId: entry.session.sessionId,
      ...partial,
      intents: [],
      actions: [],
      plan: null,
      segments: [],
      clarifyCount: 0,
      legacyParse: null,
      execution: this.openClaim(entry),
    };
  }

  private openClaim(entry: SessionEntry): VoiceExecutionClaim | null {
    const preview = entry.session.structured?.preview;
    if (!preview || preview.executionState !== 'open' || entry.session.protocol !== 'structured') return null;
    return { executionId: preview.executionId, previewRevision: preview.previewRevision, state: 'open' };
  }
}
