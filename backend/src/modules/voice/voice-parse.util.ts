import {
  endOfLocalDayIso,
  inferClockHmRange,
  inferScheduleWindow,
  localDateTimeIso,
  localYmd,
  startOfLocalDayIso,
} from './voice-local-date.util';
import type {
  VoiceParsedTask,
  VoiceParseResult,
  VoiceUnderstanding,
} from './voice-parse.types';

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const PATTERNS = new Set(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']);
const UNDERSTANDING = new Set<VoiceUnderstanding>([
  'complete',
  'sufficient',
  'needs_clarification',
]);

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('LLM response was not JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = asString(value);
  return text ? text : null;
}

function clampDuration(value: unknown, fallback = 30): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1440, Math.max(1, Math.round(n)));
}

function asWeekDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = [
    ...new Set(
      value
        .map((item) => Number(item))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((a, b) => a - b);
  return days.length ? days : null;
}

function isIsoLike(value: string | null): value is string {
  if (!value) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time);
}

function fallbackNameFromTranscript(transcript: string): string {
  const compact = transcript.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New task';
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

function isMidnightIso(iso: string): boolean {
  return /T00:00/.test(iso);
}

function applyInferredScheduleWindow(
  task: VoiceParsedTask,
  ctx: {
    transcript: string;
    timeZone: string;
    nowIso: string;
    eventType: 'fixed' | 'admin';
  },
): void {
  const window = inferScheduleWindow(
    ctx.transcript,
    localYmd(ctx.nowIso, ctx.timeZone),
  );
  const clocks = inferClockHmRange(ctx.transcript);

  if (window) {
    if (!task.earliestStartTime) {
      task.earliestStartTime = clocks
        ? localDateTimeIso(window.startYmd, clocks.startHm, ctx.timeZone)
        : startOfLocalDayIso(window.startYmd, ctx.timeZone);
    }
    if (!task.deadline) {
      task.deadline =
        clocks && window.startYmd === window.endYmd
          ? localDateTimeIso(window.endYmd, clocks.endHm, ctx.timeZone)
          : endOfLocalDayIso(window.endYmd, ctx.timeZone);
    }
    if (
      ctx.eventType !== 'fixed' &&
      !task.isRecurring &&
      window.weekDays?.length &&
      !task.eligibleWeekDays?.length
    ) {
      task.eligibleWeekDays = window.weekDays;
    }
  } else if (clocks && !task.earliestStartTime && !task.deadline) {
    const today = localYmd(ctx.nowIso, ctx.timeZone);
    task.earliestStartTime = localDateTimeIso(today, clocks.startHm, ctx.timeZone);
    task.deadline = localDateTimeIso(today, clocks.endHm, ctx.timeZone);
  }

  if (
    ctx.eventType !== 'fixed' &&
    task.scheduledStartTime &&
    isMidnightIso(task.scheduledStartTime)
  ) {
    if (!task.earliestStartTime) {
      task.earliestStartTime = task.scheduledStartTime;
    }
    task.scheduledStartTime = null;
    task.scheduledEndTime = null;
  }
}

export function normalizeVoiceParse(
  raw: unknown,
  ctx: {
    validPhaseIds: Set<string>;
    alreadyClarified: boolean;
    transcript: string;
    timeZone?: string;
    nowIso?: string;
  },
): VoiceParseResult {
  const root = asRecord(raw);
  const taskRaw = asRecord(root.task);

  let understanding = UNDERSTANDING.has(root.understanding as VoiceUnderstanding)
    ? (root.understanding as VoiceUnderstanding)
    : 'sufficient';

  const eventType = asString(taskRaw.eventType) === 'fixed' ? 'fixed' : 'admin';
  const isRecurring = eventType === 'fixed' ? false : asBool(taskRaw.isRecurring, false);
  const patternRaw = asString(taskRaw.recurrencePattern).toUpperCase();
  const recurrencePattern =
    isRecurring && PATTERNS.has(patternRaw) ? patternRaw : null;
  const phaseCandidate = asNullableString(taskRaw.phaseId);
  const phaseId =
    phaseCandidate && ctx.validPhaseIds.has(phaseCandidate)
      ? phaseCandidate
      : null;

  const scheduledStartTime = isIsoLike(asNullableString(taskRaw.scheduledStartTime))
    ? asNullableString(taskRaw.scheduledStartTime)
    : null;
  const scheduledEndTime = isIsoLike(asNullableString(taskRaw.scheduledEndTime))
    ? asNullableString(taskRaw.scheduledEndTime)
    : null;
  const deadline = isIsoLike(asNullableString(taskRaw.deadline))
    ? asNullableString(taskRaw.deadline)
    : null;
  const earliestStartTime = isIsoLike(asNullableString(taskRaw.earliestStartTime))
    ? asNullableString(taskRaw.earliestStartTime)
    : null;

  let name = asString(taskRaw.name);
  const task: VoiceParsedTask = {
    name,
    description: asNullableString(taskRaw.description) ?? undefined,
    eventType,
    estimatedTimeInMinutes: clampDuration(taskRaw.estimatedTimeInMinutes),
    isRecurring,
    recurrencePattern,
    recurrenceWeekDays: isRecurring ? asWeekDays(taskRaw.recurrenceWeekDays) : [],
    allowSplit: eventType === 'fixed' ? false : asBool(taskRaw.allowSplit, true),
    priority: PRIORITIES.has(asString(taskRaw.priority))
      ? (asString(taskRaw.priority) as VoiceParsedTask['priority'])
      : 'medium',
    deadline,
    earliestStartTime,
    eligibleWeekDays:
      eventType !== 'fixed' && !isRecurring
        ? asWeekDays(taskRaw.eligibleWeekDays)
        : null,
    scheduledStartTime,
    scheduledEndTime,
    phaseId,
    phaseIds: phaseId ? [phaseId] : undefined,
  };

  if (ctx.timeZone && ctx.nowIso) {
    applyInferredScheduleWindow(task, {
      transcript: ctx.transcript,
      timeZone: ctx.timeZone,
      nowIso: ctx.nowIso,
      eventType,
    });
  }

  if (
    eventType === 'fixed' &&
    scheduledStartTime &&
    scheduledEndTime &&
    Date.parse(scheduledEndTime) <= Date.parse(scheduledStartTime)
  ) {
    task.scheduledEndTime = null;
  }

  if (
    task.eventType === 'fixed' &&
    (!task.scheduledStartTime || !task.scheduledEndTime)
  ) {
    task.eventType = 'admin';
    task.allowSplit = asBool(taskRaw.allowSplit, true);
    task.scheduledStartTime = null;
    task.scheduledEndTime = null;
  }

  if (task.isRecurring && !task.recurrencePattern) {
    task.isRecurring = false;
    task.recurrencePattern = null;
    task.recurrenceWeekDays = [];
  }

  let clarifyingQuestion = asNullableString(root.clarifyingQuestion);

  if (!name && ctx.alreadyClarified) {
    name = fallbackNameFromTranscript(ctx.transcript);
    task.name = name;
  }

  if (!name) {
    understanding = 'needs_clarification';
    if (!clarifyingQuestion) {
      clarifyingQuestion = 'What should I call this task?';
    }
  } else {
    understanding = 'complete';
    clarifyingQuestion = null;
  }

  if (understanding !== 'needs_clarification' && !task.name) {
    task.name = fallbackNameFromTranscript(ctx.transcript);
  }

  return {
    understanding,
    clarifyingQuestion:
      understanding === 'needs_clarification' ? clarifyingQuestion : null,
    task: understanding === 'needs_clarification' && !task.name ? null : task,
  };
}
