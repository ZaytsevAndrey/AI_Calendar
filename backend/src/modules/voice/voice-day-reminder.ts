import { t } from '../../i18n/t';
import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import {
  DAY_REMINDER_PATTERNS,
  isYmd,
  normalizeHm,
  type DayReminderPattern,
} from '../day-reminders/day-reminder.dates';
import type { VoiceCommand } from './voice-command.types';

export type VoiceReminderRow = {
  id: string;
  name: string;
  dueYmd: string;
  notificationTime: string | null;
  description: string | null;
  recurrencePattern: DayReminderPattern | null;
  recurrenceWeekDays: number[] | null;
};

export type ReminderRoute =
  | { kind: 'remind' }
  | { kind: 'clarify'; name: string }
  | { kind: 'keep' };

const REMIND_PHRASE =
  /(?:^|[^\p{L}])(?:нагадайте|нагадай|напомните|напомни|remind me|set a reminder|поставте нагадування|постав нагадування|поставьте напоминание|поставь напоминание)(?=[^\p{L}]|$)/iu;

const EXISTING_OP =
  /(?:^|[^\p{L}])(?:done|complete|completed|finish(?:ed)?|delete|remove|rename|update|change|move|зроблено|зробив|зробила|готово|видали(?:ти)?|зміни(?:ти)?|перенес(?:и|ти)|удали(?:ть)?|измени(?:ть)?|перенеси)(?=[^\p{L}]|$)/iu;

export function utteranceAsksForReminder(transcript: string): boolean {
  return REMIND_PHRASE.test(transcript);
}

/**
 * Explicit remind words become a reminder. Done, change, and delete do too
 * when they name an open reminder. The same name on a task asks which one.
 * Anything else stays on the task router.
 */
export function routeReminderIntent(input: {
  transcript: string;
  reminders: Array<{ name: string }>;
  taskNames: string[];
}): ReminderRoute {
  if (utteranceAsksForReminder(input.transcript)) return { kind: 'remind' };
  if (!EXISTING_OP.test(input.transcript)) return { kind: 'keep' };
  const names = mentionedNames(
    input.transcript,
    input.reminders.map((row) => row.name),
  );
  if (!names.length) return { kind: 'keep' };
  const tasks = new Set(input.taskNames.map(normalizeName));
  const colliding = names.filter((name) => tasks.has(normalizeName(name)));
  if (colliding.length === names.length) return { kind: 'clarify', name: colliding[0] };
  return { kind: 'remind' };
}

export function resolveDayReminderVoice(input: {
  raw: unknown;
  reminders: VoiceReminderRow[];
  taskNames: string[];
  language?: string | null;
}): { type: 'clarify'; question: string } | { type: 'command'; command: VoiceCommand } {
  const lang = resolveLang(input.language);
  const root = asRecord(input.raw);
  if (root.understanding === 'needs_clarification') {
    const question = asString(root.clarifyingQuestion);
    if (question) return { type: 'clarify', question };
  }
  const action = asString(root.action).toLowerCase();
  if (action === 'create') return resolveCreate(root, lang);
  if (action === 'update' || action === 'resolve' || action === 'delete') {
    return resolveExisting(action, root, input.reminders, input.taskNames, lang);
  }
  return { type: 'clarify', question: t(lang, 'voice.remindNeedName') };
}

function resolveCreate(
  root: Record<string, unknown>,
  lang: AppLanguage,
): { type: 'clarify'; question: string } | { type: 'command'; command: VoiceCommand } {
  const name = asString(root.name);
  if (!name) return { type: 'clarify', question: t(lang, 'voice.remindNeedName') };
  const dueYmd = asString(root.dueYmd);
  if (!isYmd(dueYmd)) return { type: 'clarify', question: t(lang, 'voice.remindNeedDay') };
  const fields = fieldsFrom(root, {
    dueYmd,
    notificationTime: null,
    description: null,
    recurrencePattern: null,
    recurrenceWeekDays: null,
  });
  const summary = summaryFor(lang, 'voice.remindCreated', 'voice.remindCreatedAt', name, fields);
  return {
    type: 'command',
    command: {
      kind: 'remind_create',
      name,
      summary,
      dueYmd: fields.dueYmd,
      notificationTime: fields.notificationTime,
      description: fields.description,
      recurrencePattern: fields.recurrencePattern,
      recurrenceWeekDays: fields.recurrenceWeekDays,
    },
  };
}

function resolveExisting(
  action: 'update' | 'resolve' | 'delete',
  root: Record<string, unknown>,
  reminders: VoiceReminderRow[],
  taskNames: string[],
  lang: AppLanguage,
): { type: 'clarify'; question: string } | { type: 'command'; command: VoiceCommand } {
  const query = asString(root.targetName) || asString(root.name);
  const matches = matchReminders(query, reminders);
  if (!matches.length) {
    return { type: 'clarify', question: t(lang, 'voice.remindMissing') };
  }
  if (matches.length > 1) {
    return {
      type: 'clarify',
      question: t(lang, 'voice.remindWhichOne', {
        names: matches.map((row) => row.name).join(', '),
      }),
    };
  }
  const row = matches[0];
  if (taskNames.some((name) => normalizeName(name) === normalizeName(row.name))) {
    return {
      type: 'clarify',
      question: t(lang, 'voice.remindWhich', { name: row.name }),
    };
  }
  if (action === 'resolve') {
    return {
      type: 'command',
      command: {
        kind: 'remind_resolve',
        reminderId: row.id,
        name: row.name,
        summary: t(lang, 'voice.remindResolved', { name: row.name }),
      },
    };
  }
  if (action === 'delete') {
    return {
      type: 'command',
      command: {
        kind: 'remind_delete',
        reminderId: row.id,
        name: row.name,
        summary: t(lang, 'voice.remindDeleted', { name: row.name }),
      },
    };
  }
  const fields = fieldsFrom(root, row);
  return {
    type: 'command',
    command: {
      kind: 'remind_update',
      reminderId: row.id,
      name: asString(root.name) || row.name,
      summary: summaryFor(
        lang,
        'voice.remindUpdated',
        'voice.remindUpdatedAt',
        asString(root.name) || row.name,
        fields,
      ),
      dueYmd: fields.dueYmd,
      notificationTime: fields.notificationTime,
      description: fields.description,
      recurrencePattern: fields.recurrencePattern,
      recurrenceWeekDays: fields.recurrenceWeekDays,
    },
  };
}

function fieldsFrom(
  root: Record<string, unknown>,
  base: Pick<
    VoiceReminderRow,
    'dueYmd' | 'notificationTime' | 'description' | 'recurrencePattern' | 'recurrenceWeekDays'
  >,
) {
  const dueYmd = isYmd(asString(root.dueYmd)) ? asString(root.dueYmd) : base.dueYmd;
  let notificationTime = base.notificationTime;
  if ('notificationTime' in root) {
    const clock = asString(root.notificationTime);
    notificationTime = clock ? normalizeHm(clock) : null;
  }
  let description = base.description;
  if ('description' in root) {
    description = asString(root.description) || null;
  }
  let recurrencePattern = base.recurrencePattern;
  if ('recurrencePattern' in root) {
    recurrencePattern = readPattern(root.recurrencePattern);
  }
  let recurrenceWeekDays = recurrencePattern === 'WEEKLY' ? base.recurrenceWeekDays : null;
  if (recurrencePattern === 'WEEKLY' && 'recurrenceWeekDays' in root) {
    recurrenceWeekDays = readWeekDays(root.recurrenceWeekDays);
  }
  return { dueYmd, notificationTime, description, recurrencePattern, recurrenceWeekDays };
}

function summaryFor(
  lang: AppLanguage,
  plain: 'voice.remindCreated' | 'voice.remindUpdated',
  withTime: 'voice.remindCreatedAt' | 'voice.remindUpdatedAt',
  name: string,
  fields: { dueYmd: string; notificationTime: string | null },
): string {
  if (fields.notificationTime) {
    return t(lang, withTime, { name, day: fields.dueYmd, time: fields.notificationTime });
  }
  return t(lang, plain, { name, day: fields.dueYmd });
}

function matchReminders(query: string, reminders: VoiceReminderRow[]): VoiceReminderRow[] {
  const needle = normalizeName(query);
  if (!needle) return [];
  const exact = reminders.filter((row) => normalizeName(row.name) === needle);
  if (exact.length) return exact;
  if (needle.length < 3) return [];
  return reminders.filter((row) => {
    const name = normalizeName(row.name);
    return name.length >= 3 && (name.includes(needle) || needle.includes(name));
  });
}

function mentionedNames(transcript: string, names: string[]): string[] {
  const hay = normalizeName(transcript);
  const found: string[] = [];
  for (const name of names) {
    const needle = normalizeName(name);
    if (needle.length < 3) continue;
    if (hay.includes(needle) && !found.some((item) => normalizeName(item) === needle)) {
      found.push(name);
    }
  }
  return found;
}

function readPattern(value: unknown): DayReminderPattern | null {
  const text = asString(value).toUpperCase();
  return DAY_REMINDER_PATTERNS.includes(text as DayReminderPattern)
    ? (text as DayReminderPattern)
    : null;
}

function readWeekDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.filter((day) => typeof day === 'number' && day >= 0 && day <= 6))];
  return days.length ? days : null;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function resolveLang(value?: string | null): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
