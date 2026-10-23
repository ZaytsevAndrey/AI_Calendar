import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import type { VoiceParseResult, VoiceParsedTask } from './voice-parse.types';
import type { VoiceWriteIntent } from './voice-agent.types';
import { summarizeCreatedTask } from './voice-stored-summary';

export function intentsFromParseResult(
  parsed: VoiceParseResult,
  opts?: {
    language?: string | null;
    timeZone?: string;
    nowIso?: string;
    wakeTime?: string | null;
    sleepTime?: string | null;
  },
): {
  intents: VoiceWriteIntent[];
  needsConfirm: boolean;
  clarifyQuestion: string | null;
  refuseMessage: string | null;
} {
  if (parsed.command) {
    const command = parsed.command;
    if (command.kind === 'refuse') {
      return {
        intents: [],
        needsConfirm: false,
        clarifyQuestion: null,
        refuseMessage: command.message,
      };
    }
    const summary = String(
      (command as { summary?: string }).summary || command.kind,
    );
    return {
      intents: [
        {
          type: 'command',
          summary,
          command: command as unknown as Record<string, unknown>,
        },
      ],
      needsConfirm: true,
      clarifyQuestion: null,
      refuseMessage: null,
    };
  }

  if (parsed.understanding === 'needs_clarification' || !parsed.task?.name) {
    return {
      intents: [],
      needsConfirm: false,
      clarifyQuestion:
        parsed.clarifyingQuestion || 'Could you add a bit more detail?',
      refuseMessage: null,
    };
  }

  const lang = resolveLang(opts?.language);
  const summary = summarizeCreate(parsed.task, lang, opts);
  const notice = parsed.scheduleNotice?.trim();
  return {
    intents: [
      {
        type: 'create',
        summary: notice ? `${summary} ${notice}` : summary,
        task: parsed.task as unknown as Record<string, unknown>,
      },
    ],
    needsConfirm: true,
    clarifyQuestion: null,
    refuseMessage: null,
  };
}

/** Every write waits for the preview card. A refusal is not a write. */
export function commandNeedsConfirm(intent: VoiceWriteIntent): boolean {
  if (intent.type === 'create') return true;
  return String(intent.command.kind || '') !== 'refuse';
}

function resolveLang(value?: string | null): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

function summarizeCreate(
  task: VoiceParsedTask,
  lang: AppLanguage,
  opts?: {
    timeZone?: string;
    nowIso?: string;
    wakeTime?: string | null;
    sleepTime?: string | null;
  },
): string {
  return summarizeCreatedTask(task, lang, {
    timeZone: opts?.timeZone || task.timeZone,
    nowIso: opts?.nowIso,
    wakeTime: opts?.wakeTime,
    sleepTime: opts?.sleepTime,
  });
}
