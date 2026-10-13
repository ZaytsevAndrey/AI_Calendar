import type { VoiceParseResult } from './voice-parse.types';

/** Compact, harvestable fields from one voice parse turn (no raw LLM blob). */
export type VoiceParseResultLog = {
  parseId: string;
  transcript: string;
  previousTranscript: string | null;
  clarificationAnswer: string | null;
  timeZone: string;
  nowIso: string;
  routerIntent: string;
  sniffed: string | null;
  intent: string;
  specialistIntent: string;
  language: string | null;
  understanding: VoiceParseResult['understanding'];
  clarifyingQuestion: string | null;
  kind: string | null;
  taskName: string | null;
  isUnscheduled: boolean | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  earliestStartTime: string | null;
  deadline: string | null;
  isRecurring: boolean | null;
  recurrencePattern: string | null;
  recurrenceWeekDays: number[] | null;
  commandKind: string | null;
  commandTaskName: string | null;
};

export type BuildVoiceParseResultLogInput = {
  parseId: string;
  transcript: string;
  previousTranscript?: string | null;
  clarificationAnswer?: string | null;
  timeZone: string;
  nowIso: string;
  routerIntent: string;
  sniffed: string | null;
  intent: string;
  specialistIntent: string;
  language?: string | null;
  result: VoiceParseResult;
};

/** Build a stable JSON payload for `voice.parse.result` logs / golden harvest. */
export function buildVoiceParseResultLog(
  input: BuildVoiceParseResultLogInput,
): VoiceParseResultLog {
  const { result } = input;
  const task = result.task;
  const command = result.command ?? null;
  const commandKind =
    command && typeof command === 'object' && 'kind' in command
      ? String(command.kind)
      : null;
  const commandTaskName =
    command &&
    typeof command === 'object' &&
    'taskName' in command &&
    typeof (command as { taskName?: unknown }).taskName === 'string'
      ? (command as { taskName: string }).taskName
      : null;

  return {
    parseId: input.parseId,
    transcript: input.transcript,
    previousTranscript: input.previousTranscript?.trim() || null,
    clarificationAnswer: input.clarificationAnswer?.trim() || null,
    timeZone: input.timeZone,
    nowIso: input.nowIso,
    routerIntent: input.routerIntent,
    sniffed: input.sniffed,
    intent: input.intent,
    specialistIntent: input.specialistIntent,
    language: input.language ?? null,
    understanding: result.understanding,
    clarifyingQuestion: result.clarifyingQuestion,
    kind: inferKindFromTask(task) ?? commandKind,
    taskName: task?.name ?? null,
    isUnscheduled: task?.isUnscheduled ?? null,
    scheduledStartTime: task?.scheduledStartTime ?? null,
    scheduledEndTime: task?.scheduledEndTime ?? null,
    earliestStartTime: task?.earliestStartTime ?? null,
    deadline: task?.deadline ?? null,
    isRecurring: task?.isRecurring ?? null,
    recurrencePattern: task?.recurrencePattern ?? null,
    recurrenceWeekDays: task?.recurrenceWeekDays ?? null,
    commandKind,
    commandTaskName,
  };
}

export function formatVoiceParseResultLog(payload: VoiceParseResultLog): string {
  return `voice.parse.result ${JSON.stringify(payload)}`;
}

function inferKindFromTask(
  task: VoiceParseResult['task'],
): string | null {
  if (!task) return null;
  if (task.isUnscheduled) return 'unscheduled';
  if (task.isRecurring) return 'recurring';
  if (task.eventType === 'fixed') return 'fixed';
  if (task.earliestStartTime || task.deadline || task.scheduledStartTime) {
    return 'flexible';
  }
  return null;
}
