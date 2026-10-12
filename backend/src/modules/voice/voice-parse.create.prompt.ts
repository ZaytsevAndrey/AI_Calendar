import { createNameLanguageModule } from './prompt-modules/name-language';
import { CREATE_KIND_WHEN_MODULE } from './prompt-modules/kind-when';
import { CREATE_PHASE_MODULE } from './prompt-modules/phase';
import { CREATE_RECURRING_MODULE } from './prompt-modules/recurring';
import { CREATE_SCHEMA_MODULE } from './prompt-modules/schema';
import {
  buildVoiceParseSharedUserPrompt,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

/** Step 2 (create): one system string assembled from prompt modules. */
export function buildVoiceCreateSystemPrompt(language?: string | null): string {
  return [
    'You extract a NEW calendar task from speech.',
    createNameLanguageModule(language),
    'Reply with a single JSON object only. No markdown.',
    CREATE_SCHEMA_MODULE,
    CREATE_KIND_WHEN_MODULE,
    CREATE_RECURRING_MODULE,
    CREATE_PHASE_MODULE,
    'Do not invent Google metadata. Do not output command/habit objects.',
  ].join('\n\n');
}

export function buildVoiceCreateUserPrompt(
  input: VoiceParsePromptContext,
): string {
  const defaultMinutes = input.defaultTaskDurationMinutes ?? 30;
  return `${buildVoiceParseSharedUserPrompt(input, { includePhases: true })}

Default task duration: ${defaultMinutes} minutes.

Return create JSON (kind + name + when + duration).`;
}
