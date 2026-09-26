import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { GroqClient } from './groq.client';
import { ParseVoiceTaskDto } from './dto/parse-voice-task.dto';
import { TranscribeVoiceDto } from './dto/transcribe-voice.dto';
import {
  commandDraftFromRaw,
  readVoiceIntent,
  resolveVoiceCommand,
  sniffCommandIntent,
} from './voice-command.resolve';
import type { VoiceCommandSlot, VoiceCommandTask } from './voice-command.types';
import {
  buildVoiceParseSystemPrompt,
  buildVoiceParseUserPrompt,
} from './voice-parse.prompt';
import { extractJsonObject, normalizeVoiceParse } from './voice-parse.util';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import type { VoiceParseResult } from './voice-parse.types';

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
  constructor(
    private readonly groq: GroqClient,
    private readonly userSettingsService: UserSettingsService,
    @InjectRepository(Phase)
    private readonly phasesRepository: Repository<Phase>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepository: Repository<ScheduledTask>,
  ) {}

  async transcribe(
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
    const result = await this.groq.transcribe(
      buffer,
      `voice.${ext}`,
      mimeType,
    );
    return { transcript: result.text, language: result.language };
  }

  async parseTask(
    userId: string,
    dto: ParseVoiceTaskDto,
  ): Promise<VoiceParseResult> {
    const transcript = (dto.transcript || '').trim();
    if (!transcript) {
      throw new BadRequestException('transcript is required');
    }

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

    // Settings IANA first so "tomorrow" matches the calendar, not the browser.
    const timeZone = resolveIanaTimeZone(settings.timeZone || dto.timeZone);
    const nowIso = dto.clientNowIso?.trim() || new Date().toISOString();
    const alreadyClarified = Boolean(dto.clarificationAnswer?.trim());
    const openTaskNames = tasks
      .filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELED,
      )
      .map((task) => task.name)
      .slice(0, 40);
    const content = await this.groq.completeJson(
      buildVoiceParseSystemPrompt(),
      buildVoiceParseUserPrompt({
        transcript,
        timeZone,
        nowIso,
        phases,
        settings,
        previousTranscript: dto.previousTranscript,
        clarificationAnswer: dto.clarificationAnswer,
        openTaskNames,
      }),
    );

    let parsed: unknown;
    try {
      parsed = extractJsonObject(content);
    } catch {
      throw new BadRequestException('Could not parse the voice request into a task');
    }

    const speech = alreadyClarified
      ? `${dto.previousTranscript || ''} ${dto.clarificationAnswer || ''} ${transcript}`.trim()
      : transcript;
    const sniffed = sniffCommandIntent(speech) ?? sniffCommandIntent(transcript);
    let intent = readVoiceIntent(parsed);
    if (sniffed && (intent === 'create' || intent === 'needs_clarification')) {
      intent = sniffed;
    }

    if (intent === 'create') {
      return {
        ...normalizeVoiceParse(parsed, {
          validPhaseIds: new Set(phases.map((phase) => phase.id)),
          alreadyClarified,
          timeZone,
          nowIso,
          transcript: speech,
        }),
        command: null,
      };
    }

    if (intent === 'needs_clarification') {
      return {
        ...normalizeVoiceParse(parsed, {
          validPhaseIds: new Set(phases.map((phase) => phase.id)),
          alreadyClarified,
          timeZone,
          nowIso,
          transcript: speech,
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
      language: settings.language,
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
