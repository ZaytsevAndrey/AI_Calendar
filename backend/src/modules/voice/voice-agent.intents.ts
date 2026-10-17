import { t, type MessageKey } from '../../i18n/t';
import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import type { VoiceParseResult, VoiceParsedTask } from './voice-parse.types';
import type { VoiceWriteIntent } from './voice-agent.types';
import {
  addDaysToYmd,
  localYmd,
  scheduleTodayYmd,
} from './voice-local-date.util';

const ALWAYS_CONFIRM = new Set(['cancel', 'delete', 'end_series']);

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
      needsConfirm: ALWAYS_CONFIRM.has(command.kind),
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
    needsConfirm: false,
    clarifyQuestion: null,
    refuseMessage: null,
  };
}

export function commandNeedsConfirm(
  intent: VoiceWriteIntent,
  confirmVoiceCommands: boolean,
): boolean {
  if (intent.type === 'create') return false;
  const kind = String(intent.command.kind || '');
  if (ALWAYS_CONFIRM.has(kind)) return true;
  return confirmVoiceCommands && kind !== 'refuse';
}

function resolveLang(value?: string | null): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

function vt(
  lang: AppLanguage,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(lang, key, params);
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
  const name = task.name;
  const timeZone = opts?.timeZone || task.timeZone;
  const nowIso = opts?.nowIso;
  if (!timeZone || !nowIso || !task.earliestStartTime) {
    return vt(lang, 'voice.createdTask', { name });
  }
  const day = localYmd(task.earliestStartTime, timeZone);
  const today = scheduleTodayYmd(
    nowIso,
    timeZone,
    opts?.wakeTime,
    opts?.sleepTime,
  );
  const tomorrow = addDaysToYmd(today, 1);
  if (day === tomorrow) {
    return vt(lang, 'voice.createdTaskFor', {
      name,
      when: vt(lang, 'voice.whenTomorrow'),
    });
  }
  if (day === today) {
    return vt(lang, 'voice.createdTaskFor', {
      name,
      when: vt(lang, 'voice.whenToday'),
    });
  }
  return vt(lang, 'voice.createdTaskFor', { name, when: day });
}
