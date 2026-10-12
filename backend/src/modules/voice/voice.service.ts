import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from '../phases/entities/phase.entity';
import { Habit } from '../habits/entities/habit.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { GroqClient } from './groq.client';
import { ParseVoiceTaskDto } from './dto/parse-voice-task.dto';
import { TranscribeVoiceDto } from './dto/transcribe-voice.dto';
import { VoiceTurnDto } from './dto/voice-turn.dto';
import {
  commandDraftFromRaw,
  readVoiceIntent,
  resolveVoiceCommand,
  sniffCommandIntent,
} from './voice-command.resolve';
import type {
  VoiceCommandHabit,
  VoiceCommandSlot,
  VoiceCommandTask,
} from './voice-command.types';
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
import type { VoiceParseResult } from './voice-parse.types';
import { VoiceAgentOrchestrator } from './voice-agent.orchestrator';
import type { VoiceTurnResponse } from './voice-agent.types';
import { logVoiceLlm } from './voice-llm-log.util';

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
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
    @InjectRepository(Habit)
    private readonly habitsRepository: Repository<Habit>,
  ) {}

  turn(userId: string, dto: VoiceTurnDto): Promise<VoiceTurnResponse> {
    return this.agentOrchestrator.turn(userId, dto, (ctx) => {
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
      });
    });
  }

  endVoiceSession(userId: string, sessionId: string): { ok: true } {
    this.agentOrchestrator.endSession(userId, sessionId);
    return { ok: true };
  }

  async transcribe(
    userId: string,
    dto: TranscribeVoiceDto,
  ): Promise<{ transcript: string; language?: string }> {
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
    const settings = await this.userSettingsService.getSettings(userId);
    // Prefer speech language (not UI language) so Whisper does not guess.
    const sttLanguage = whisperLanguageFromSettings(
      dto.language || settings.speechLanguage || settings.language,
    );
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
      `voice.stt raw=${JSON.stringify(result.text)} cleaned=${JSON.stringify(cleaned)} kept=${JSON.stringify(transcript)}`,
    );
    return { transcript, language: result.language || sttLanguage };
  }

  async parseTask(
    userId: string,
    dto: ParseVoiceTaskDto,
  ): Promise<VoiceParseResult> {
    const transcript = (dto.transcript || '').trim();
    if (!transcript) {
      throw new BadRequestException('transcript is required');
    }

    const [settings, phases, tasks, slots, habits] = await Promise.all([
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
      this.habitsRepository.find({
        where: { userId },
        order: { createdAt: 'ASC' },
      }),
    ]);

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
      .map((task) => ({ name: task.name, recurring: task.isRecurring }));
    const openTaskNames = openTasks.map((task) => task.name);
    const habitNames = habits.map((habit) => habit.name).slice(0, 40);
    const speech = alreadyClarified
      ? `${dto.previousTranscript || ''} ${transcript}`.trim()
      : transcript;

    this.logger.log(`voice.parse transcript=${JSON.stringify(transcript)}`);
    const routerRaw = await this.groq.completeJson(
      buildVoiceRouterSystemPrompt(),
      buildVoiceRouterUserPrompt({
        transcript,
        previousTranscript: dto.previousTranscript,
        clarificationAnswer: dto.clarificationAnswer,
        openTaskNames,
        habitNames,
      }),
    );
    logVoiceLlm(this.logger, 'parse.router', routerRaw);

    let routerParsed: unknown;
    try {
      routerParsed = extractJsonObject(routerRaw);
    } catch {
      throw new BadRequestException('Could not classify the voice request');
    }

    const sniffed = sniffCommandIntent(speech) ?? sniffCommandIntent(transcript);
    let intent = readVoiceIntent(routerParsed);
    if (sniffed && (intent === 'create' || intent === 'needs_clarification')) {
      intent = sniffed;
    }
    const speechLanguage = readRouterLanguage(routerParsed) ||
      whisperLangToApp(settings.speechLanguage || settings.language);

    const promptCtx = {
      transcript,
      timeZone,
      nowIso,
      phases,
      settings,
      previousTranscript: dto.previousTranscript,
      clarificationAnswer: dto.clarificationAnswer,
      openTaskNames,
      habitNames,
      language: speechLanguage,
      defaultTaskDurationMinutes: taskDurationMinutes(settings),
      openTasks,
    };

    const specialistIntent = normalizeParseIntent(intent);
    const specialist = buildVoiceIntentPrompt(specialistIntent, promptCtx);
    const content = await this.groq.completeJson(
      specialist.system,
      specialist.user,
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

    if (intent === 'needs_clarification') {
      return clarificationOnlyResult(parsed, speechLanguage);
    }

    if (intent === 'create') {
      return {
        ...normalizeVoiceParse(parsed, {
          validPhaseIds: new Set(phases.map((phase) => phase.id)),
          alreadyClarified,
          timeZone,
          nowIso,
          wakeTime: settings.wakeTime,
          transcript: speech,
          language: speechLanguage,
          defaultTaskDurationMinutes: taskDurationMinutes(settings),
        }),
        command: null,
      };
    }

    const resolved = resolveVoiceCommand({
      draft: commandDraftFromRaw(parsed, intent),
      transcript: speech,
      timeZone,
      nowIso,
      alreadyClarified,
      tasks: tasks.map(toCommandTask),
      slots: slots.map(toCommandSlot),
      habits: habits.map(toCommandHabit),
      language: speechLanguage || settings.speechLanguage || settings.language,
      wakeTime: settings.wakeTime,
    });
    if (resolved.type === 'clarify') {
      return {
        understanding: 'needs_clarification',
        clarifyingQuestion: resolved.question,
        task: null,
        command: null,
      };
    }
    return {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: resolved.command,
    };
  }
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

function toCommandHabit(habit: Habit): VoiceCommandHabit {
  return { id: habit.id, name: habit.name };
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
