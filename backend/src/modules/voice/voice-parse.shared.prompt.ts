import type { Phase } from '../phases/entities/phase.entity';
import type { UserSettings } from '../user-settings/entities/user-settings.entity';
import { buildLocalCalendarContext } from './voice-local-date.util';

export type VoiceParsePromptContext = {
  transcript: string;
  timeZone: string;
  nowIso: string;
  phases: Phase[];
  settings: Pick<UserSettings, 'wakeTime' | 'sleepTime' | 'weekendWorkEnabled'>;
  previousTranscript?: string;
  clarificationAnswer?: string;
  openTaskNames?: string[];
  /** Same tasks as openTaskNames, with the series flag the specialists must ask about. */
  openTasks?: { name: string; recurring: boolean }[];
  habitNames?: string[];
  /** From router; used so specialist prompts answer in the same language. */
  language?: 'uk' | 'en' | 'ru';
  /** User setting: default length of a new task, in minutes. */
  defaultTaskDurationMinutes?: number;
};

export const VOICE_PARSE_INTENTS = [
  'create',
  'update',
  'delete',
  'complete',
  'habit_check_in',
  'habit_create',
  'habit_update',
  'habit_delete',
  'habit_uncheck',
  'skip',
  'reschedule',
  'needs_clarification',
] as const;

export type VoiceParseIntentId = (typeof VOICE_PARSE_INTENTS)[number];

export function languageInstruction(language?: string | null): string {
  const lang = (language || '').trim().toLowerCase().slice(0, 2);
  if (lang === 'uk') {
    return 'Write any clarifyingQuestion in Ukrainian.';
  }
  if (lang === 'ru') {
    return 'Write any clarifyingQuestion in Russian.';
  }
  if (lang === 'en') {
    return 'Write any clarifyingQuestion in English.';
  }
  return 'Write any clarifyingQuestion in the same language as the transcript.';
}

function formatOpenTasks(input: VoiceParsePromptContext): string {
  const rows = input.openTasks?.length
    ? input.openTasks
    : (input.openTaskNames ?? []).map((name) => ({ name, recurring: false }));
  if (!rows.length) return '(none)';
  return rows
    .map((task) =>
      task.recurring
        ? `- ${JSON.stringify(task.name)} recurring`
        : `- ${JSON.stringify(task.name)}`,
    )
    .join('\n');
}

export function buildVoiceParseSharedUserPrompt(
  input: VoiceParsePromptContext,
  extras?: { includePhases?: boolean },
): string {
  const includePhases = extras?.includePhases !== false;
  const phaseLines =
    includePhases && input.phases.length
      ? input.phases
          .map((phase) => {
            const days =
              phase.weekDays && phase.weekDays.length
                ? `days=${phase.weekDays.join(',')}`
                : 'days=all';
            return `- id=${phase.id} name=${JSON.stringify(phase.name)} window=${phase.startTime}-${phase.endTime} type=${phase.type} ${days}`;
          })
          .join('\n')
      : '(none)';

  const clarification = input.clarificationAnswer
    ? `\nPrevious utterance: ${JSON.stringify(input.previousTranscript ?? '')}\nClarification answer: ${JSON.stringify(input.clarificationAnswer)}`
    : '';

  const langLine = input.language
    ? `Speech language (from router): ${input.language}\n`
    : '';

  return `${langLine}${buildLocalCalendarContext(
    input.nowIso,
    input.timeZone,
    input.settings.wakeTime,
    input.settings.sleepTime,
  )}
Wake: ${input.settings.wakeTime}  Sleep: ${input.settings.sleepTime}
Weekend work: ${input.settings.weekendWorkEnabled ? 'yes' : 'no'}
${
  includePhases
    ? `
Phases:
${phaseLines}
`
    : ''
}
Open tasks (incomplete):
${formatOpenTasks(input)}

Habits:
${
  input.habitNames?.length
    ? input.habitNames.map((name) => `- ${JSON.stringify(name)}`).join('\n')
    : '(none)'
}

Transcript: ${JSON.stringify(input.transcript)}${clarification}`;
}
