import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import { t } from '../../i18n/t';
import {
  endOfLocalDayIso,
  localYmd,
  rezoneWallClockIso,
  startOfLocalDayIso,
} from './voice-local-date.util';
import type {
  VoiceParsedTask,
  VoiceParseResult,
  VoiceTaskKind,
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

function normalizeGoogleReminders(
  value: unknown,
): VoiceParsedTask['googleReminders'] {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const rem = value as {
    useDefault?: unknown;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  };
  return {
    useDefault: Boolean(rem.useDefault),
    overrides: Array.isArray(rem.overrides) ? rem.overrides : undefined,
  };
}

function isIsoLike(value: string | null): value is string {
  if (!value) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time);
}

function compactText(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

/** Clarification answer used as title when the model left name empty. */
function titleFromAnswer(answer: string): string | null {
  let text = answer.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '').trim();
  if (text.length < 2) return null;
  const titled = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  return titled.length > 80 ? `${titled.slice(0, 77)}…` : titled;
}

/** Drop past preferred/fixed slots so the placer starts from now, not history. */
function rejectPastScheduleSlot(task: VoiceParsedTask, nowIso: string): void {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return;

  const startMs = task.scheduledStartTime
    ? Date.parse(task.scheduledStartTime)
    : NaN;
  if (!Number.isNaN(startMs) && startMs < nowMs) {
    task.scheduledStartTime = null;
    task.scheduledEndTime = null;
  }

  const earliestMs = task.earliestStartTime
    ? Date.parse(task.earliestStartTime)
    : NaN;
  if (!Number.isNaN(earliestMs) && earliestMs < nowMs) {
    task.earliestStartTime = nowIso;
  }

  const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;
  if (!Number.isNaN(deadlineMs) && deadlineMs < nowMs) {
    task.deadline = null;
  }
}

function readTaskKind(root: Record<string, unknown>, taskRaw: Record<string, unknown>): VoiceTaskKind | null {
  const raw = asString(taskRaw.kind || root.kind).toLowerCase();
  if (
    raw === 'fixed' ||
    raw === 'flexible' ||
    raw === 'unscheduled' ||
    raw === 'recurring'
  ) {
    return raw;
  }
  return null;
}

function hasScheduleWhen(task: VoiceParsedTask): boolean {
  if (task.isUnscheduled) return true;
  if (task.isRecurring && task.recurrencePattern) return true;
  if (task.scheduledStartTime) return true;
  if (task.deadline || task.earliestStartTime) return true;
  return false;
}

/** Named task with no when → inbox; never block create on day/time. */
function markUnscheduledInbox(task: VoiceParsedTask): void {
  task.isUnscheduled = true;
  task.eventType = 'admin';
  task.isRecurring = false;
  task.recurrencePattern = null;
  task.recurrenceWeekDays = [];
  task.scheduledStartTime = null;
  task.scheduledEndTime = null;
  task.deadline = null;
  task.earliestStartTime = null;
  task.allowSplit = true;
}

/**
 * Language-agnostic: if the model left only one side of a day envelope,
 * finish 00:00–23:59 on that civil day (using the IANA zone).
 */
function completePartialDayEnvelope(
  task: VoiceParsedTask,
  timeZone?: string,
  nowIso?: string,
): void {
  const zone = timeZone?.trim();
  if (!zone || task.isRecurring || task.isUnscheduled || task.scheduledStartTime) {
    return;
  }
  const one = task.earliestStartTime || task.deadline;
  if (!one || (task.earliestStartTime && task.deadline)) return;
  const ymd = localYmd(one, zone);
  let earliest = startOfLocalDayIso(ymd, zone);
  if (nowIso && Date.parse(earliest) < Date.parse(nowIso)) {
    earliest = nowIso;
  }
  task.earliestStartTime = earliest;
  task.deadline = endOfLocalDayIso(ymd, zone);
  task.eventType = 'admin';
  task.allowSplit = true;
}

function resolveLang(value?: string | null): AppLanguage {
  if (value && isAppLanguage(value)) return value;
  const short = (value || '').trim().toLowerCase().slice(0, 2);
  if (short === 'uk') return 'uk';
  return 'en';
}

/**
 * Normalize LLM create JSON.
 * Meaning of speech (when, title, empty create) is the model's job.
 * TypeScript only: clamp fields, rezone offsets, drop past slots, structural inbox,
 * and require a non-empty name (fallback i18n question — not speech parsing).
 */
export function normalizeVoiceParse(
  raw: unknown,
  ctx: {
    validPhaseIds: Set<string>;
    alreadyClarified: boolean;
    transcript: string;
    timeZone?: string;
    nowIso?: string;
    wakeTime?: string | null;
    language?: string | null;
    defaultTaskDurationMinutes?: number;
    /** The follow-up utterance, when this turn answers a clarifying question. */
    clarificationAnswer?: string | null;
  },
): VoiceParseResult {
  const root = asRecord(raw);
  const taskRaw = asRecord(root.task);
  const lang = resolveLang(ctx.language);

  let understanding = UNDERSTANDING.has(root.understanding as VoiceUnderstanding)
    ? (root.understanding as VoiceUnderstanding)
    : 'sufficient';

  const kind = readTaskKind(root, taskRaw);
  let isUnscheduled =
    asBool(taskRaw.isUnscheduled, false) || kind === 'unscheduled';

  let eventType: 'fixed' | 'admin' =
    kind === 'fixed' || asString(taskRaw.eventType) === 'fixed' ? 'fixed' : 'admin';
  let isRecurring =
    kind === 'recurring' ||
    (eventType !== 'fixed' && asBool(taskRaw.isRecurring, false));
  if (isUnscheduled) {
    eventType = 'admin';
    isRecurring = false;
  }
  if (eventType === 'fixed') isRecurring = false;

  const patternRaw = asString(taskRaw.recurrencePattern).toUpperCase();
  const recurrencePattern =
    isRecurring && PATTERNS.has(patternRaw) ? patternRaw : null;
  const phaseCandidate = asNullableString(taskRaw.phaseId);
  const phaseId =
    phaseCandidate && ctx.validPhaseIds.has(phaseCandidate)
      ? phaseCandidate
      : null;

  const zone = ctx.timeZone?.trim() || '';
  const rezone = (value: string | null): string | null =>
    zone && value ? rezoneWallClockIso(value, zone) || value : value;
  let scheduledStartTime = rezone(
    isIsoLike(asNullableString(taskRaw.scheduledStartTime))
      ? asNullableString(taskRaw.scheduledStartTime)
      : null,
  );
  let scheduledEndTime = rezone(
    isIsoLike(asNullableString(taskRaw.scheduledEndTime))
      ? asNullableString(taskRaw.scheduledEndTime)
      : null,
  );
  let deadline = rezone(
    isIsoLike(asNullableString(taskRaw.deadline))
      ? asNullableString(taskRaw.deadline)
      : null,
  );
  let earliestStartTime = rezone(
    isIsoLike(asNullableString(taskRaw.earliestStartTime))
      ? asNullableString(taskRaw.earliestStartTime)
      : null,
  );

  if (isUnscheduled) {
    scheduledStartTime = null;
    scheduledEndTime = null;
    deadline = null;
    earliestStartTime = null;
  }

  let name = asString(taskRaw.name);
  const task: VoiceParsedTask = {
    name,
    description: asNullableString(taskRaw.description) ?? undefined,
    eventType,
    estimatedTimeInMinutes: clampDuration(
      taskRaw.estimatedTimeInMinutes,
      ctx.defaultTaskDurationMinutes ?? 30,
    ),
    isRecurring,
    isUnscheduled: isUnscheduled || undefined,
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
    timeZone: ctx.timeZone,
    location: asNullableString(taskRaw.location),
    googleColorId: asNullableString(taskRaw.googleColorId),
    googleVisibility: asNullableString(taskRaw.googleVisibility),
    googleTransparency: asNullableString(taskRaw.googleTransparency),
    googleReminders: normalizeGoogleReminders(taskRaw.googleReminders),
  };

  if (
    eventType === 'fixed' &&
    scheduledStartTime &&
    scheduledEndTime &&
    Date.parse(scheduledEndTime) <= Date.parse(scheduledStartTime)
  ) {
    task.scheduledEndTime = null;
  }

  if (ctx.nowIso && !isUnscheduled) {
    rejectPastScheduleSlot(task, ctx.nowIso);
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

  completePartialDayEnvelope(task, ctx.timeZone, ctx.nowIso);
  if (ctx.nowIso && !isUnscheduled) {
    rejectPastScheduleSlot(task, ctx.nowIso);
  }

  let clarifyingQuestion = asNullableString(root.clarifyingQuestion);

  // Prefer model name; after a clarify turn, allow the answer text as title.
  if (!name && ctx.clarificationAnswer?.trim()) {
    name = titleFromAnswer(ctx.clarificationAnswer) || '';
    task.name = name;
  }
  if (!name && ctx.alreadyClarified) {
    name =
      titleFromAnswer(ctx.clarificationAnswer || '') ||
      compactText(ctx.clarificationAnswer || ctx.transcript) ||
      'New task';
    task.name = name;
  }

  // Model sometimes copies the title into clarifyingQuestion — ignore that.
  if (
    clarifyingQuestion &&
    name &&
    clarifyingQuestion.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
  ) {
    clarifyingQuestion = null;
  }

  const modelWantsClarify =
    understanding === 'needs_clarification' && Boolean(clarifyingQuestion);

  if (!name) {
    understanding = 'needs_clarification';
    clarifyingQuestion =
      clarifyingQuestion || t(lang, 'voice.whatTaskName');
  } else if (!ctx.alreadyClarified && modelWantsClarify) {
    understanding = 'needs_clarification';
  } else if (!hasScheduleWhen(task)) {
    markUnscheduledInbox(task);
    understanding = 'complete';
    clarifyingQuestion = null;
  } else {
    understanding = 'complete';
    clarifyingQuestion = null;
  }

  if (understanding !== 'needs_clarification' && !task.name) {
    task.name = compactText(ctx.transcript) || 'New task';
  }

  return {
    understanding,
    clarifyingQuestion:
      understanding === 'needs_clarification' ? clarifyingQuestion : null,
    task: understanding === 'needs_clarification' && !task.name ? null : task,
  };
}

/** Router chose needs_clarification. Do not invent a task from the transcript. */
export function clarificationOnlyResult(
  raw: unknown,
  language?: string | null,
): VoiceParseResult {
  const question = asNullableString(asRecord(raw).clarifyingQuestion);
  return {
    understanding: 'needs_clarification',
    clarifyingQuestion:
      question || t(resolveLang(language), 'voice.didNotUnderstand'),
    task: null,
    command: null,
  };
}
