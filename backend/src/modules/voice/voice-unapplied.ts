import { t } from '../../i18n/t';
import type { AppLanguage } from '../../i18n/types';
import type { VoiceWriteIntent } from './voice-agent.types';
import { describeStoredFields, type StoredFields } from './voice-stored-summary';

/** What a cancelled batch will not do. The success summary on the intent stays as it is. */
export function unappliedIntentLine(intent: VoiceWriteIntent, lang: AppLanguage): string {
  if (intent.type === 'create') {
    const name = text(intent.task.name);
    const details = describeStoredFields(intent.task as StoredFields, lang);
    if (!name) return t(lang, 'voice.notApply', { name: intent.summary });
    return details
      ? t(lang, 'voice.notCreateDetails', { name, details })
      : t(lang, 'voice.notCreate', { name });
  }

  const command = intent.command;
  const kind = text(command.kind);
  const name = text(command.taskName) || text(command.name) || text(command.habitName);
  if (kind === 'delete') return named(lang, 'voice.notDelete', name, intent.summary);
  if (kind === 'update') {
    const patch = command.patch;
    const details =
      patch && typeof patch === 'object'
        ? describeStoredFields(patch as StoredFields, lang, {
            rename: true,
            mentionDefaults: true,
            mentionClears: true,
          })
        : '';
    if (!name) return t(lang, 'voice.notApply', { name: intent.summary });
    return details
      ? t(lang, 'voice.notUpdateDetails', { name, details })
      : t(lang, 'voice.notUpdate', { name });
  }
  if (kind === 'remind_create') return remindCreate(lang, name, command, intent.summary);
  if (kind === 'remind_update') return named(lang, 'voice.notRemindUpdate', name, intent.summary);
  if (kind === 'remind_delete') return named(lang, 'voice.notRemindDelete', name, intent.summary);
  if (kind === 'remind_resolve') return named(lang, 'voice.notRemindResolve', name, intent.summary);
  return named(lang, 'voice.notApply', name, intent.summary);
}

function remindCreate(
  lang: AppLanguage,
  name: string,
  command: Record<string, unknown>,
  summary: string,
): string {
  if (!name) return t(lang, 'voice.notApply', { name: summary });
  const day = text(command.dueYmd);
  const time = text(command.notificationTime);
  if (day && time) return t(lang, 'voice.notRemindCreateAt', { name, day, time });
  if (day) return t(lang, 'voice.notRemindCreate', { name, day });
  return t(lang, 'voice.notApply', { name });
}

function named(
  lang: AppLanguage,
  key: 'voice.notDelete' | 'voice.notUpdate' | 'voice.notRemindUpdate' | 'voice.notRemindDelete' | 'voice.notRemindResolve' | 'voice.notApply',
  name: string,
  summary: string,
): string {
  return t(lang, key, { name: name || summary });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
