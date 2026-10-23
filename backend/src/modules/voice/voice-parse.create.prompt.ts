import { FAST_CREATE_SPECIALIST_MODULE } from './prompt-modules/fast-create';
import { CREATE_KIND_WHEN_MODULE } from './prompt-modules/kind-when';
import { createNameLanguageModule } from './prompt-modules/name-language';
import { CREATE_PHASE_MODULE } from './prompt-modules/phase';
import { CREATE_RECURRING_MODULE } from './prompt-modules/recurring';
import { CREATE_SCHEMA_MODULE } from './prompt-modules/schema';
import { TASK_FIELDS_MODULE } from './prompt-modules/task-fields';
import type { VoiceCompanionMode } from './voice-companion-mode';
import {
  buildVoiceParseSharedUserPrompt,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** Step 2 (create): one system string assembled from prompt modules. */
export function buildVoiceCreateSystemPrompt(
  language?: string | null,
  mode?: VoiceCompanionMode | null,
): string {
  const parts = [
    'You extract a NEW calendar task from speech.',
    createNameLanguageModule(language),
    'Reply with a single JSON object only. No markdown.',
    CREATE_SCHEMA_MODULE,
    TASK_FIELDS_MODULE,
    CREATE_KIND_WHEN_MODULE,
    CREATE_RECURRING_MODULE,
    CREATE_PHASE_MODULE,
    'Do not invent Google metadata. Do not output a command object.',
  ];
  if (mode === 'fast_create') parts.push(FAST_CREATE_SPECIALIST_MODULE);
  return parts.join('\n\n');
}

export function buildVoiceCreateUserPrompt(
  input: VoiceParsePromptContext,
): string {
  const defaultMinutes = input.defaultTaskDurationMinutes ?? 30;
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: true })}

Default task duration: ${defaultMinutes} minutes.

Return create JSON (kind + name + when + duration).`;
}
