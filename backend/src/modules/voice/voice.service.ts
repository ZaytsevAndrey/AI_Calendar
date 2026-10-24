import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { t } from '../../i18n/t';
import { isAppLanguage } from '../../i18n/types';
import { DayRemindersService } from '../day-reminders/day-reminders.service';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { transcodeToPcmWav } from './audio-to-wav';
import { AzureSttClient } from './azure-stt';
import { GroqClient } from './groq.client';
import { ParseVoiceTaskDto } from './dto/parse-voice-task.dto';
import { TranscribeVoiceDto } from './dto/transcribe-voice.dto';
import { VoiceTurnDto } from './dto/voice-turn.dto';
import { voiceCompanionMode } from './voice-companion-mode';
import {
  commandDraftFromRaw,
  readVoiceIntent,
  resolveVoiceCommand,
  sniffCommandIntent,
} from './voice-command.resolve';
import {
  resolveDayReminderVoice,
  routeReminderIntent,
  type VoiceReminderRow,
} from './voice-day-reminder';
import type { VoiceCommandSlot, VoiceCommandTask } from './voice-command.types';
import { buildVoiceIntentPrompt } from './voice-parse.intent-prompts';
import {
  buildVoiceRouterSystemPrompt,
  buildVoiceRouterUserPrompt,
} from './voice-parse.router.prompt';
import {
  VOICE_PARSE_INTENTS,
  type VoiceParseIntentId,
} from './voice-parse.shared.prompt';
import {
  clarificationOnlyResult,
  extractJsonObject,
  normalizeVoiceParse,
} from './voice-parse.util';
import {
  buildWhisperPrompt,
  cleanupVoiceTranscript,
  isNoiseOrEmptyTranscript,
} from './voice-stt.util';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { traceStep } from '../../common/voice-trace';
import { localHm, localYmd } from './voice-local-date.util';
import type { VoiceParseResult } from './voice-parse.types';
import { VoiceAgentOrchestrator } from './voice-agent.orchestrator';
import type { VoiceTurnResponse } from './voice-agent.types';
import { logVoiceLlm } from './voice-llm-log.util';
import {
  buildVoiceParseResultLog,
  formatVoiceParseResultLog,
} from './voice-parse-result-log.util';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceSessionStore } from './voice-session.store';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/m4a': 'm4a',
};

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly groq: GroqClient,
    private readonly userSettingsService: UserSettingsService,
    private readonly agentOrchestrator: VoiceAgentOrchestrator,
    private readonly sessions: VoiceSessionStore,
    private readonly quota: VoiceQuotaService,
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
    private readonly azureStt: AzureSttClient,
    private readonly dayReminders: DayRemindersService,
  ) {}

  async turn(userId: string, dto: VoiceTurnDto): Promise<VoiceTurnResponse> {
    await this.quota.assertUnderLimit(userId);
    return this.withSessionGroq(userId, dto.sessionId, () =>
      this.agentOrchestrator.turn(userId, dto, (ctx) => {
        const transcript = (ctx.transcript || '').trim();
        if (!transcript) {
          throw new BadRequestException('transcript is required');
        }
        return this.parseTask(userId, {
          transcript,
          timeZone: dto.timeZone,
          clientNowIso: dto.clientNowIso,
          previousTranscript: ctx.previousTranscript,
          clarificationAnswer: ctx.clarificationAnswer,
          mode: dto.mode,
        });
      }),
    );
  }

  endVoiceSession(userId: string, sessionId: string): { ok: true } {
    this.agentOrchestrator.endSession(userId, sessionId);
    return { ok: true };
  }

  async transcribe(
    userId: string,
    dto: TranscribeVoiceDto,
  ): Promise<{ transcript: string; language?: string }> {
    await this.quota.assertUnderLimit(userId);
    const base64 = stripDataUrl(dto.audioBase64 || '');
    if (!base64) {
      throw new BadRequestException('audioBase64 is required');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('audioBase64 is invalid');
    }
    if (!buffer.length) {
      throw new BadRequestException('Audio is empty');
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new BadRequestException('Audio is too large (max 8 MB)');
    }

    const mimeType = (dto.mimeType || 'audio/webm').split(';')[0].trim();
    const ext = MIME_EXTENSION[mimeType] || 'webm';
    const settings = await traceStep('other', 'db.settings', '', () =>
      this.userSettingsService.getSettings(userId),
    );
    // Prefer speech language (not UI language) so Whisper does not guess.
    const sttLanguage = whisperLanguageFromSettings(
      dto.language || settings.speechLanguage || settings.language,
    );
    const run = async () => {
      if (this.azureStt.enabled()) {
        return this.transcribeWithAzure(buffer, sttLanguage);
      }
      const result = await this.groq.transcribe(
        buffer,
        `voice.${ext}`,
        mimeType,
        sttLanguage,
        buildWhisperPrompt(sttLanguage),
      );
      const cleaned = cleanupVoiceTranscript(
        result.text,
        result.language || sttLanguage,
      );
      // Whisper often invents «дякую» / «thank you» on silence — drop it.
      const transcript = isNoiseOrEmptyTranscript(cleaned) ? '' : cleaned;
      this.logger.log(
        `voice.stt provider=groq raw=${JSON.stringify(result.text)} cleaned=${JSON.stringify(cleaned)} kept=${JSON.stringify(transcript)}`,
      );
      return { transcript, language: result.language || sttLanguage };
    };
    const sessionId = dto.sessionId?.trim();
    if (sessionId) {
      return this.withSessionGroq(userId, sessionId, run);
    }
    return run();
  }

  /**
   * Azure test path. The whole recording is converted to PCM WAV.
   * Silence is left in. Whisper cleanup is not applied, so the log shows
   * the words Azure actually returned.
   */
  private async transcribeWithAzure(
    buffer: Buffer,
    sttLanguage?: string,
  ): Promise<{ transcript: string; language?: string }> {
    let wav: Buffer;
    try {
      wav = await traceStep('other', 'audio.wav', 'ffmpeg', () =>
        transcodeToPcmWav(buffer),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Azure STT convert failed: ${message}`);
      throw new ServiceUnavailableException(
        'Could not prepare audio for speech recognition',
      );
    }
    const result = await this.azureStt.transcribe(wav, sttLanguage);
    const transcript = result.text.trim();
    this.logger.log(
      `voice.stt provider=azure raw=${JSON.stringify(result.text)} kept=${JSON.stringify(transcript)}`,
    );
    return { transcript, language: result.language || sttLanguage };
  }

  async parseTask(
    userId: string,
    dto: ParseVoiceTaskDto,
  ): Promise<VoiceParseResult> {
    await this.quota.assertUnderLimit(userId);
    if (this.groq.isInPinContext()) {
      return this.parseTaskBody(userId, dto);
    }
    return this.withEphemeralGroq(userId, () => this.parseTaskBody(userId, dto));
  }

  /**
   * Pin one Groq key for the voice session (STT + turn) and count chat tokens.
   */
  private async withSessionGroq<T>(
    userId: string,
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const session = this.sessions.getOrCreate(userId, sessionId);
    if (session.groqKeyIndex == null) {
      session.groqKeyIndex = this.groq.pinNextKey().index;
    }
    const { value, keyIndex, tokensUsed } = await this.groq.runWithPin(
      session.groqKeyIndex,
      fn,
    );
    session.groqKeyIndex = keyIndex;
    if (tokensUsed > 0) {
      await this.quota.addTokens(userId, tokensUsed);
    }
    return value;
  }

  private async withEphemeralGroq<T>(
    userId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const pin = this.groq.pinNextKey();
    const { value, tokensUsed } = await this.groq.runWithPin(pin.index, fn);
    if (tokensUsed > 0) {
      await this.quota.addTokens(userId, tokensUsed);
    }
    return value;
  }

  private async parseTaskBody(
    userId: string,
    dto: ParseVoiceTaskDto,
  ): Promise<VoiceParseResult> {
    const transcript = (dto.transcript || '').trim();
    if (!transcript) {
      throw new BadRequestException('transcript is required');
    }

    const [settings, phases, tasks, slots, reminderRows] = await traceStep(
      'other',
      'db.parse-context',
      '',
      () =>
        Promise.all([
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
          this.dayReminders.findAll(userId),
        ]),
    );
    const openReminderRows: VoiceReminderRow[] = reminderRows.map((row) => ({
      id: row.id,
      name: row.name,
      dueYmd: row.dueYmd,
      notificationTime: row.notificationTime,
      description: row.description,
      recurrencePattern: row.recurrencePattern,
      recurrenceWeekDays: row.recurrenceWeekDays,
    }));

    // Settings IANA first so "tomorrow" matches the calendar, not the browser.
    const timeZone = resolveIanaTimeZone(settings.timeZone || dto.timeZone);
    const nowIso = dto.clientNowIso?.trim() || new Date().toISOString();
    const alreadyClarified = Boolean(dto.clarificationAnswer?.trim());
    const openTasks = tasks
      .filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELED,
      )
      .slice(0, 40)
      .map((task) => ({
        name: task.name,
        recurring: task.isRecurring,
        start: localWall(task.scheduledStartTime, timeZone),
        end: localWall(task.scheduledEndTime, timeZone),
        earliest: localWall(task.earliestStartTime, timeZone),
        deadline: localWall(task.deadline, timeZone),
      }));
    const openTaskNames = openTasks.map((task) => task.name);
    const speech = alreadyClarified
      ? `${dto.previousTranscript || ''} ${transcript}`.trim()
      : transcript;

    const parseId = randomUUID();
    const mode = voiceCompanionMode(dto.mode);
    this.logger.log(
      `voice.parse transcript=${JSON.stringify(transcript)} parseId=${parseId} mode=${mode}`,
    );

    const routerRaw = await this.groq.completeJson(
      buildVoiceRouterSystemPrompt(),
      buildVoiceRouterUserPrompt({
        transcript,
        previousTranscript: dto.previousTranscript,
        clarificationAnswer: dto.clarificationAnswer,
        openTaskNames,
        openReminders: openReminderRows,
      }),
      { label: 'router' },
    );
    logVoiceLlm(this.logger, 'parse.router', routerRaw);

    let routerParsed: unknown;
    try {
      routerParsed = extractJsonObject(routerRaw);
    } catch {
      throw new BadRequestException('Could not classify the voice request');
    }

    const sniffed = sniffCommandIntent(speech) ?? sniffCommandIntent(transcript);
    const routerIntent = readVoiceIntent(routerParsed);
    let intent = routerIntent;
    const speechLanguage = readRouterLanguage(routerParsed) ||
      whisperLangToApp(settings.speechLanguage || settings.language);
    const routed = routeReminderIntent({
      transcript: speech,
      reminders: openReminderRows,
      taskNames: openTaskNames,
    });
    if (routed.kind === 'clarify') {
      const result: VoiceParseResult = {
        understanding: 'needs_clarification',
        clarifyingQuestion: t(isAppLanguage(speechLanguage) ? speechLanguage : 'en', 'voice.remindWhich', {
          name: routed.name,
        }),
        task: null,
        command: null,
      };
      this.logger.log(
        formatVoiceParseResultLog(
          buildVoiceParseResultLog({
            parseId,
            transcript: speech,
            previousTranscript: dto.previousTranscript,
            clarificationAnswer: dto.clarificationAnswer,
            timeZone,
            nowIso,
            routerIntent,
            sniffed,
            intent: 'remind',
            specialistIntent: 'remind',
            language: speechLanguage ?? null,
            result,
          }),
        ),
      );
      return result;
    }
    if (routed.kind === 'remind') intent = 'remind';
    else if (intent === 'remind') intent = 'create';
    else if (sniffed && intent === 'needs_clarification') intent = sniffed;

    const promptCtx = {
      transcript,
      timeZone,
      nowIso,
      phases,
      settings,
      previousTranscript: dto.previousTranscript,
      clarificationAnswer: dto.clarificationAnswer,
      openTaskNames,
      openReminders: openReminderRows,
      language: speechLanguage,
      defaultTaskDurationMinutes: taskDurationMinutes(settings),
      openTasks,
      mode,
    };

    const specialistIntent = normalizeParseIntent(intent);
    const specialist = buildVoiceIntentPrompt(specialistIntent, promptCtx);
    const content = await this.groq.completeJson(
      specialist.system,
      specialist.user,
      { label: `specialist.${specialistIntent}` },
    );
    logVoiceLlm(this.logger, `parse.${specialistIntent}`, content);

    let parsed: unknown;
    try {
      parsed = extractJsonObject(content);
    } catch {
      throw new BadRequestException('Could not parse the voice request into a task');
    }
    // Specialist may omit intent; keep router/sniffed intent authoritative.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      (parsed as { intent?: string }).intent = intent;
    }

    let result: VoiceParseResult;
    if (intent === 'needs_clarification') {
      result = clarificationOnlyResult(parsed, speechLanguage);
    } else if (intent === 'remind') {
      const resolved = resolveDayReminderVoice({
        raw: parsed,
        reminders: openReminderRows,
        taskNames: openTaskNames,
        language: speechLanguage,
      });
      if (resolved.type === 'clarify') {
        result = {
          understanding: 'needs_clarification',
          clarifyingQuestion: resolved.question,
          task: null,
          command: null,
        };
      } else {
        result = {
          understanding: 'complete',
          clarifyingQuestion: null,
          task: null,
          command: resolved.command,
        };
      }
    } else if (intent === 'create') {
      result = {
        ...normalizeVoiceParse(parsed, {
          validPhaseIds: new Set(phases.map((phase) => phase.id)),
          phases: phases.map((phase) => ({
            id: phase.id,
            startTime: phase.startTime,
            endTime: phase.endTime,
            weekDays: phase.weekDays,
            type: phase.type,
          })),
          alreadyClarified,
          timeZone,
          nowIso,
          wakeTime: settings.wakeTime,
          transcript: speech,
          clarificationAnswer: dto.clarificationAnswer,
          language: speechLanguage,
          defaultTaskDurationMinutes: taskDurationMinutes(settings),
        }),
        command: null,
      };
    } else if (specialistAsksWhichTask(parsed)) {
      result = {
        understanding: 'needs_clarification',
        clarifyingQuestion: String((parsed as { clarifyingQuestion: string }).clarifyingQuestion),
        task: null,
        command: null,
      };
    } else {
      const resolved = resolveVoiceCommand({
        draft: commandDraftFromRaw(parsed, intent),
        transcript: speech,
        timeZone,
        nowIso,
        alreadyClarified,
        tasks: tasks.map(toCommandTask),
        slots: slots.map(toCommandSlot),
        language: speechLanguage || settings.speechLanguage || settings.language,
        wakeTime: settings.wakeTime,
      });
      if (resolved.type === 'clarify') {
        result = {
          understanding: 'needs_clarification',
          clarifyingQuestion: resolved.question,
          task: null,
          command: null,
        };
      } else {
        result = {
          understanding: 'complete',
          clarifyingQuestion: null,
          task: null,
          command: resolved.command,
        };
      }
    }

    this.logger.log(
      formatVoiceParseResultLog(
        buildVoiceParseResultLog({
          parseId,
          transcript: speech,
          previousTranscript: dto.previousTranscript,
          clarificationAnswer: dto.clarificationAnswer,
          timeZone,
          nowIso,
          routerIntent,
          sniffed,
          intent,
          specialistIntent,
          language: speechLanguage ?? null,
          result,
        }),
      ),
    );
    return result;
  }
}

/** The specialist asked. A guessed title must not turn that question into an action. */
function specialistAsksWhichTask(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const root = parsed as {
    understanding?: unknown;
    clarifyingQuestion?: unknown;
  };
  if (root.understanding !== 'needs_clarification') return false;
  return typeof root.clarifyingQuestion === 'string' && root.clarifyingQuestion.trim().length > 0;
}

/** Local wall clock for the specialist. No Z and no offset. */
function localWall(
  value: Date | string | null | undefined,
  timeZone: string,
): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return `${localYmd(iso, timeZone)}T${localHm(iso, timeZone)}:00`;
}

function taskDurationMinutes(settings: {
  defaultTaskDurationMinutes?: number | null;
}): number {
  const minutes = settings.defaultTaskDurationMinutes;
  if (typeof minutes === 'number' && minutes >= 5) return minutes;
  return 30;
}

function normalizeParseIntent(
  intent: ReturnType<typeof readVoiceIntent>,
): VoiceParseIntentId {
  if (intent === 'reschedule' || intent === 'complete') return 'update';
  if ((VOICE_PARSE_INTENTS as readonly string[]).includes(intent)) {
    return intent as VoiceParseIntentId;
  }
  return 'create';
}

function readRouterLanguage(raw: unknown): 'uk' | 'en' | 'ru' | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const lang = String((raw as { language?: unknown }).language || '')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if (lang === 'uk' || lang === 'en' || lang === 'ru') return lang;
  return undefined;
}

function whisperLangToApp(value?: string | null): 'uk' | 'en' | 'ru' | undefined {
  const lang = (value || '').trim().toLowerCase().slice(0, 2);
  if (lang === 'uk' || lang === 'en' || lang === 'ru') return lang;
  return undefined;
}

function toCommandTask(task: Task): VoiceCommandTask {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    isRecurring: task.isRecurring,
    isUnscheduled: task.isUnscheduled,
    isFixedExternal: task.isFixedExternal,
    eventType: task.eventType,
    googleEventId: task.googleEventId,
    googleEventCalendarId: task.googleEventCalendarId,
    scheduledStartTime: task.scheduledStartTime
      ? new Date(task.scheduledStartTime).toISOString()
      : null,
    scheduledEndTime: task.scheduledEndTime
      ? new Date(task.scheduledEndTime).toISOString()
      : null,
  };
}

function toCommandSlot(slot: ScheduledTask): VoiceCommandSlot {
  return {
    id: slot.id,
    taskId: slot.taskId,
    startIso: new Date(slot.scheduledStartTime).toISOString(),
    endIso: new Date(slot.scheduledEndTime).toISOString(),
    googleEventId: slot.googleEventId,
    googleEventCalendarId: slot.googleEventCalendarId,
    synthetic: false,
  };
}

function stripDataUrl(value: string): string {
  const trimmed = value.trim();
  const comma = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && comma >= 0) {
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

/** Map app language to Whisper ISO-639-1. */
function whisperLanguageFromSettings(value?: string | null): string | undefined {
  const lang = (value || '').trim().toLowerCase();
  if (lang.startsWith('uk')) return 'uk';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('en')) return 'en';
  return undefined;
}
