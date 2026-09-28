import { isFixedEventType } from '../scheduling/event-type.enum';
import { googleRecurringInstanceId } from '../tasks/skipped-occurrence.util';
import { isAppLanguage, t, type AppLanguage, type MessageKey } from '../../i18n';
import {
  endOfLocalDayIso,
  inferScheduleWindow,
  localDateTimeIso,
  localHm,
  localYmd,
  startOfLocalDayIso,
} from './voice-local-date.util';
import type {
  VoiceCommand,
  VoiceCommandDraft,
  VoiceCommandHabit,
  VoiceCommandIntent,
  VoiceCommandSlot,
  VoiceCommandTask,
  VoiceHabitFields,
  VoiceTaskPatch,
} from './voice-command.types';

const CURRENT_WORDS =
  /^(?:this|it|that|now|current|цю|це|зараз|поточну|эту|это|сейчас)$/i;

export type VoiceCommandResolveResult =
  | { type: 'clarify'; question: string }
  | { type: 'command'; command: VoiceCommand };

const EDGE = '(?![\\p{L}\\p{N}])';

function vt(
  lang: AppLanguage,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(lang, key, params);
}

function resolveLang(value?: string): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

function leading(body: string): RegExp {
  return new RegExp(`^(?:${body})${EDGE}`, 'iu');
}

export function sniffDoNow(transcript: string): boolean {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return leading(
    'do\\s+now|schedule\\s+(?:it\\s+)?now|place\\s+(?:it\\s+)?now|зроби\\s+зараз|заплануй(?:\\s+це)?\\s+зараз|сделай\\s+сейчас',
  ).test(text);
}

export function sniffCommandIntent(transcript: string): VoiceCommandIntent | null {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (leading('add|create|new task|нагадай|створи|додай|создай|добавь').test(text)) {
    // Habit create may still start with "create habit" / "створи звичку".
    if (
      leading(
        'create\\s+habit|new\\s+habit|add\\s+habit|створи(?:ти)?\\s+звичк|додай(?:ти)?\\s+звичк|создай\\s+привычк|добавь\\s+привычк',
      ).test(text)
    ) {
      return 'habit_create';
    }
    return null;
  }
  if (
    leading(
      'delete\\s+habit|remove\\s+habit|видалити\\s+звичк|удалить\\s+привычк',
    ).test(text)
  ) {
    return 'habit_delete';
  }
  if (
    leading(
      'uncheck|clear\\s+check(?:[-\\s]?in)?|зняти\\s+відмітк|скасувати\\s+відмітк|снять\\s+отметк',
    ).test(text)
  ) {
    return 'habit_uncheck';
  }
  if (
    leading(
      'update\\s+habit|edit\\s+habit|change\\s+habit|rename\\s+habit|зміни(?:ти)?\\s+звичк|перейменуй\\s+звичк|измени\\s+привычк',
    ).test(text)
  ) {
    return 'habit_update';
  }
  if (leading('create\\s+habit|new\\s+habit|add\\s+habit|створи(?:ти)?\\s+звичк|додай(?:ти)?\\s+звичк').test(text)) {
    return 'habit_create';
  }
  if (sniffDoNow(text)) return 'reschedule';
  if (
    leading(
      'check(?:ed)?\\s*in|mark\\s+(?:my\\s+)?habit|habit\\s+check|i\\s+(?:did|have\\s+done)(?:\\s+my)?\\s+habit|відміт(?:ив|ила|ити)(?:\\s+звичку)?|звичк[ауіи]',
    ).test(text)
  ) {
    return 'habit_check_in';
  }
  if (
    leading(
      'delete|remove|видалити|видали|удалить|удали',
    ).test(text)
  ) {
    return 'delete';
  }
  if (
    leading(
      'rename|reopen|update|edit|change|set|перейменуй|зміни(?:ти)?|онов(?:и|ити)|відкрий(?:\\s+знову)?|продолж|возобнов',
    ).test(text)
  ) {
    return 'update';
  }
  if (leading('skip|пропусти(?:ти)?|пропустить').test(text)) return 'skip';
  if (
    leading('move|reschedule|перенес(?:и|ти|іть)?|перестав(?:ь|ити)?|зсунь|сдвин(?:ь|уть)').test(
      text,
    )
  ) {
    return 'reschedule';
  }
  if (
    leading(
      'закінч(?:ив|ила|ити)?|заверш(?:ив|ила)|зроби(?:в|ла)|готово|закончил(?:а)?|сделал(?:а)?|выполнил(?:а)?',
    ).test(text)
  ) {
    return 'complete';
  }
  if (
    leading("(?:i'm|i am)\\s+done|done|complete|completed|finish(?:ed)?").test(text) &&
    (/^(?:i'm|i am)\s+/i.test(text) ||
      /^(?:done|complete|completed|finish(?:ed)?)(?:\s+(?:with|this|it|that|the task))?$/i.test(text))
  ) {
    return 'complete';
  }
  if (leading('mark').test(text) && /\b(?:done|complete|finished)$/i.test(text)) return 'complete';
  return null;
}

export function readVoiceIntent(
  raw: unknown,
): VoiceCommandIntent | 'create' | 'needs_clarification' {
  const intent =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? String((raw as { intent?: unknown }).intent ?? '')
          .trim()
          .toLowerCase()
      : '';
  if (
    intent === 'complete' ||
    intent === 'skip' ||
    intent === 'reschedule' ||
    intent === 'habit_check_in' ||
    intent === 'update' ||
    intent === 'delete' ||
    intent === 'habit_create' ||
    intent === 'habit_update' ||
    intent === 'habit_delete' ||
    intent === 'habit_uncheck' ||
    intent === 'create' ||
    intent === 'needs_clarification'
  ) {
    return intent;
  }
  return 'create';
}

export function commandDraftFromRaw(
  raw: unknown,
  intent: VoiceCommandIntent,
): VoiceCommandDraft {
  const root =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const command =
    root.command && typeof root.command === 'object' && !Array.isArray(root.command)
      ? (root.command as Record<string, unknown>)
      : {};
  const task =
    root.task && typeof root.task === 'object' && !Array.isArray(root.task)
      ? (root.task as Record<string, unknown>)
      : {};
  const habit =
    root.habit && typeof root.habit === 'object' && !Array.isArray(root.habit)
      ? (root.habit as Record<string, unknown>)
      : {};
  const targetRaw = asString(command.target).toLowerCase();
  const taskName =
    asNullable(command.taskName) || asNullable(task.name) || asNullable(habit.name);
  const target =
    targetRaw === 'current' || targetRaw === 'named'
      ? targetRaw
      : taskName
        ? 'named'
        : 'current';
  return {
    intent,
    target: target === 'current' ? 'current' : 'named',
    taskName,
    spokenStart:
      asIso(command.start) ||
      asIso(task.scheduledStartTime) ||
      asIso(task.earliestStartTime),
    spokenEnd: asIso(command.end) || asIso(task.scheduledEndTime) || asIso(task.deadline),
    patch: extractTaskPatch(task, command),
    habitFields: extractHabitFields(habit, task, command),
  };
}

export function resolveVoiceCommand(input: {
  draft: VoiceCommandDraft;
  transcript: string;
  timeZone: string;
  nowIso: string;
  alreadyClarified: boolean;
  tasks: VoiceCommandTask[];
  slots: VoiceCommandSlot[];
  habits?: VoiceCommandHabit[];
  language?: string;
}): VoiceCommandResolveResult {
  const lang = resolveLang(input.language);
  const draft = normalizeDraft(input.draft, input.transcript);
  const habits = input.habits ?? [];

  if (draft.intent === 'habit_create') {
    return resolveHabitCreate({
      draft,
      alreadyClarified: input.alreadyClarified,
      language: lang,
    });
  }

  if (
    draft.intent === 'habit_update' ||
    draft.intent === 'habit_delete' ||
    draft.intent === 'habit_uncheck'
  ) {
    return resolveHabitMutation({
      draft,
      habits,
      timeZone: input.timeZone,
      nowIso: input.nowIso,
      alreadyClarified: input.alreadyClarified,
      language: lang,
    });
  }

  if (draft.intent === 'habit_check_in') {
    return resolveHabitCheckIn({
      draft,
      habits,
      timeZone: input.timeZone,
      nowIso: input.nowIso,
      alreadyClarified: input.alreadyClarified,
      language: lang,
    });
  }

  if (draft.intent === 'update' || draft.intent === 'delete') {
    const picked = pickTask({ ...input, draft, language: lang });
    if (picked.type === 'clarify') {
      return input.alreadyClarified
        ? { type: 'command', command: { kind: 'refuse', message: picked.question } }
        : picked;
    }
    if (picked.type === 'refuse') {
      return { type: 'command', command: { kind: 'refuse', message: picked.message } };
    }
    if (picked.task.isFixedExternal) {
      return {
        type: 'command',
        command: { kind: 'refuse', message: vt(lang, 'voice.notAppTask') },
      };
    }
    if (draft.intent === 'delete') {
      return {
        type: 'command',
        command: {
          kind: 'delete',
          taskId: picked.task.id,
          taskName: picked.task.name,
          summary: vt(lang, 'voice.deleteTask', { name: picked.task.name }),
        },
      };
    }
    const patch = applyReopenHints(draft.patch || {}, input.transcript);
    if (!Object.keys(patch).length) {
      const question = vt(lang, 'voice.whatToChange');
      return input.alreadyClarified
        ? { type: 'command', command: { kind: 'refuse', message: question } }
        : { type: 'clarify', question };
    }
    return {
      type: 'command',
      command: {
        kind: 'update',
        taskId: picked.task.id,
        taskName: picked.task.name,
        summary: vt(lang, 'voice.updateTask', { name: picked.task.name }),
        patch,
      },
    };
  }

  const nowMs = Date.parse(input.nowIso);
  const picked = pickTask({ ...input, draft, language: lang });
  if (picked.type === 'clarify') {
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: picked.question } }
      : picked;
  }
  if (picked.type === 'refuse') {
    if (draft.intent === 'complete' && habits.length > 0) {
      const habitResult = resolveHabitCheckIn({
        draft: { ...draft, intent: 'habit_check_in' },
        habits,
        timeZone: input.timeZone,
        nowIso: input.nowIso,
        alreadyClarified: input.alreadyClarified,
        language: lang,
      });
      if (
        habitResult.type === 'command' &&
        habitResult.command.kind === 'habit_check_in'
      ) {
        return habitResult;
      }
      if (habitResult.type === 'clarify') {
        return input.alreadyClarified
          ? { type: 'command', command: { kind: 'refuse', message: habitResult.question } }
          : habitResult;
      }
    }
    return { type: 'command', command: { kind: 'refuse', message: picked.message } };
  }

  const task = picked.task;
  const slot = pickOpenSlot(task, input.slots, nowMs, draft.target === 'current');

  if (draft.intent === 'complete' && !task.isRecurring) {
    if (task.isFixedExternal) {
      return {
        type: 'command',
        command: { kind: 'refuse', message: vt(lang, 'voice.notAppTask') },
      };
    }
    return {
      type: 'command',
      command: {
        kind: 'complete',
        taskId: task.id,
        taskName: task.name,
        summary: vt(lang, 'voice.markDone', { name: task.name }),
      },
    };
  }

  if (draft.intent === 'complete' || draft.intent === 'skip') {
    return skipCommand(task, slot, lang);
  }

  return rescheduleCommand({ ...input, draft, language: lang }, task, slot, nowMs);
}

function resolveHabitCreate(input: {
  draft: VoiceCommandDraft;
  alreadyClarified: boolean;
  language: AppLanguage;
}): VoiceCommandResolveResult {
  const lang = input.language;
  const fields = { ...(input.draft.habitFields || {}) };
  const name = (fields.name || input.draft.taskName || '').trim();
  if (!name) {
    const question = vt(lang, 'voice.habitName');
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: question } }
      : { type: 'clarify', question };
  }
  fields.name = name;
  return {
    type: 'command',
    command: {
      kind: 'habit_create',
      summary: vt(lang, 'voice.createHabit', { name }),
      fields: fields as VoiceHabitFields & { name: string },
    },
  };
}

function resolveHabitMutation(input: {
  draft: VoiceCommandDraft;
  habits: VoiceCommandHabit[];
  timeZone: string;
  nowIso: string;
  alreadyClarified: boolean;
  language: AppLanguage;
}): VoiceCommandResolveResult {
  const lang = input.language;
  if (input.habits.length === 0) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.noHabits') },
    };
  }
  const query = input.draft.taskName;
  if (!query) {
    if (input.habits.length === 1) {
      return finishHabitMutation(input.habits[0], input);
    }
    return input.alreadyClarified
      ? {
          type: 'command',
          command: { kind: 'refuse', message: vt(lang, 'voice.whichHabit') },
        }
      : {
          type: 'clarify',
          question: vt(lang, 'voice.whichHabitList', {
            names: input.habits
              .slice(0, 5)
              .map((habit) => habit.name)
              .join(', '),
          }),
        };
  }
  const matched = matchNamedHabit(input.habits, query, lang);
  if (matched.type === 'clarify') {
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: matched.question } }
      : matched;
  }
  if (matched.type === 'refuse') {
    return { type: 'command', command: { kind: 'refuse', message: matched.message } };
  }
  return finishHabitMutation(matched.habit, input);
}

function finishHabitMutation(
  habit: VoiceCommandHabit,
  input: {
    draft: VoiceCommandDraft;
    timeZone: string;
    nowIso: string;
    alreadyClarified: boolean;
    language: AppLanguage;
  },
): VoiceCommandResolveResult {
  const lang = input.language;
  const date = localYmd(input.nowIso, input.timeZone);
  if (input.draft.intent === 'habit_delete') {
    return {
      type: 'command',
      command: {
        kind: 'habit_delete',
        habitId: habit.id,
        habitName: habit.name,
        summary: vt(lang, 'voice.deleteHabit', { name: habit.name }),
      },
    };
  }
  if (input.draft.intent === 'habit_uncheck') {
    return {
      type: 'command',
      command: {
        kind: 'habit_uncheck',
        habitId: habit.id,
        habitName: habit.name,
        date,
        summary: vt(lang, 'voice.uncheckHabit', { name: habit.name }),
      },
    };
  }
  const patch = { ...(input.draft.habitFields || {}) };
  delete (patch as { name?: string }).name;
  // Rename: draft.taskName is the target; habitFields.name is the new name.
  if (input.draft.habitFields?.name && input.draft.habitFields.name !== habit.name) {
    patch.name = input.draft.habitFields.name;
  }
  if (!Object.keys(patch).length) {
    const question = vt(lang, 'voice.whatToChangeHabit');
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: question } }
      : { type: 'clarify', question };
  }
  return {
    type: 'command',
    command: {
      kind: 'habit_update',
      habitId: habit.id,
      habitName: habit.name,
      summary: vt(lang, 'voice.updateHabit', { name: habit.name }),
      patch,
    },
  };
}

function applyReopenHints(patch: VoiceTaskPatch, transcript: string): VoiceTaskPatch {
  const next = { ...patch };
  if (
    /\b(reopen|відкрий(?:\s+знову)?|возобнов|продолж)/iu.test(transcript) &&
    !next.status
  ) {
    next.status = 'todo';
  }
  if (/\bin[_\s-]?progress|в\s+роботі|в\s+процессе/iu.test(transcript) && !next.status) {
    next.status = 'in_progress';
  }
  return next;
}

function extractTaskPatch(
  task: Record<string, unknown>,
  command: Record<string, unknown>,
): VoiceTaskPatch | null {
  const patch: VoiceTaskPatch = {};
  const name = asNullable(task.name);
  // Named target uses command.taskName; task.name / newName is a rename.
  const newName = asNullable(command.newName) || asNullable(task.newName);
  if (newName) patch.name = newName;
  else if (asBool(command.rename) && name) patch.name = name;

  const description = asNullable(task.description);
  if (task.description !== undefined) patch.description = description;

  const phaseId = asNullable(task.phaseId);
  if (task.phaseId !== undefined) patch.phaseId = phaseId;

  const eventType = asString(task.eventType);
  if (eventType === 'fixed' || eventType === 'admin') patch.eventType = eventType;

  if (task.estimatedTimeInMinutes !== undefined) {
    const n =
      typeof task.estimatedTimeInMinutes === 'number'
        ? task.estimatedTimeInMinutes
        : Number(task.estimatedTimeInMinutes);
    if (Number.isFinite(n) && n > 0) patch.estimatedTimeInMinutes = Math.round(n);
  }

  if (typeof task.isRecurring === 'boolean') patch.isRecurring = task.isRecurring;
  if (task.recurrencePattern !== undefined) {
    patch.recurrencePattern = asNullable(task.recurrencePattern);
  }
  if (task.recurrenceWeekDays !== undefined) {
    patch.recurrenceWeekDays = asWeekDays(task.recurrenceWeekDays);
  }
  if (typeof task.allowSplit === 'boolean') patch.allowSplit = task.allowSplit;

  const priority = asString(task.priority);
  if (['low', 'medium', 'high', 'urgent'].includes(priority)) {
    patch.priority = priority as VoiceTaskPatch['priority'];
  }

  for (const key of [
    'deadline',
    'earliestStartTime',
    'scheduledStartTime',
    'scheduledEndTime',
  ] as const) {
    if (task[key] !== undefined) {
      const iso = asIso(task[key]);
      patch[key] = iso;
    }
  }
  if (task.eligibleWeekDays !== undefined) {
    patch.eligibleWeekDays = asWeekDays(task.eligibleWeekDays);
  }

  const status = asString(task.status || command.status).toLowerCase();
  if (['todo', 'in_progress', 'completed', 'canceled'].includes(status)) {
    patch.status = status as VoiceTaskPatch['status'];
  }

  if (task.location !== undefined) patch.location = asNullable(task.location);
  if (task.googleColorId !== undefined) patch.googleColorId = asNullable(task.googleColorId);
  if (task.googleVisibility !== undefined) {
    patch.googleVisibility = asNullable(task.googleVisibility);
  }
  if (task.googleTransparency !== undefined) {
    patch.googleTransparency = asNullable(task.googleTransparency);
  }
  if (task.googleReminders === null) {
    patch.googleReminders = null;
  } else if (
    task.googleReminders !== undefined &&
    typeof task.googleReminders === 'object' &&
    !Array.isArray(task.googleReminders)
  ) {
    const rem = task.googleReminders as {
      useDefault?: unknown;
      overrides?: { method: 'email' | 'popup'; minutes: number }[];
    };
    patch.googleReminders = {
      useDefault: Boolean(rem.useDefault),
      overrides: Array.isArray(rem.overrides) ? rem.overrides : undefined,
    };
  }

  return Object.keys(patch).length ? patch : null;
}

function extractHabitFields(
  habit: Record<string, unknown>,
  task: Record<string, unknown>,
  command: Record<string, unknown>,
): VoiceHabitFields | null {
  const src = Object.keys(habit).length ? habit : task;
  const fields: VoiceHabitFields = {};
  const name = asNullable(src.name) || asNullable(command.newName);
  if (name) fields.name = name;
  if (src.color !== undefined) {
    const color = asNullable(src.color);
    if (color) fields.color = color;
  }
  if (src.description !== undefined) fields.description = asNullable(src.description);
  if (src.blockStartTime !== undefined) {
    fields.blockStartTime = asNullable(src.blockStartTime);
  }
  if (src.blockMinutes !== undefined) {
    const n =
      typeof src.blockMinutes === 'number' ? src.blockMinutes : Number(src.blockMinutes);
    fields.blockMinutes = Number.isFinite(n) ? Math.round(n) : null;
  }
  return Object.keys(fields).length ? fields : null;
}

function asBool(value: unknown): boolean {
  return value === true;
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

function resolveHabitCheckIn(input: {
  draft: VoiceCommandDraft;
  habits: VoiceCommandHabit[];
  timeZone: string;
  nowIso: string;
  alreadyClarified: boolean;
  language: AppLanguage;
}): VoiceCommandResolveResult {
  const lang = input.language;
  if (input.habits.length === 0) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.noHabits') },
    };
  }
  const query = input.draft.taskName;
  if (!query) {
    if (input.habits.length === 1) {
      return habitCheckInCommand(input.habits[0], input.timeZone, input.nowIso, lang);
    }
    return input.alreadyClarified
      ? {
          type: 'command',
          command: { kind: 'refuse', message: vt(lang, 'voice.whichHabit') },
        }
      : {
          type: 'clarify',
          question: vt(lang, 'voice.whichHabitList', {
            names: input.habits
              .slice(0, 5)
              .map((habit) => habit.name)
              .join(', '),
          }),
        };
  }
  const matched = matchNamedHabit(input.habits, query, lang);
  if (matched.type === 'clarify') {
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: matched.question } }
      : matched;
  }
  if (matched.type === 'refuse') {
    return { type: 'command', command: { kind: 'refuse', message: matched.message } };
  }
  return habitCheckInCommand(matched.habit, input.timeZone, input.nowIso, lang);
}

function habitCheckInCommand(
  habit: VoiceCommandHabit,
  timeZone: string,
  nowIso: string,
  lang: AppLanguage,
): VoiceCommandResolveResult {
  return {
    type: 'command',
    command: {
      kind: 'habit_check_in',
      habitId: habit.id,
      habitName: habit.name,
      date: localYmd(nowIso, timeZone),
      summary: vt(lang, 'voice.habitCheckIn', { name: habit.name }),
    },
  };
}

function skipCommand(
  task: VoiceCommandTask,
  slot: VoiceCommandSlot | null,
  lang: AppLanguage,
): VoiceCommandResolveResult {
  if (task.isFixedExternal || isFixedEventType(task.eventType)) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.fixedCannotSkip') },
    };
  }
  if (task.isUnscheduled) {
    return {
      type: 'command',
      command: {
        kind: 'cancel',
        taskId: task.id,
        taskName: task.name,
        summary: vt(lang, 'voice.cancelUnscheduled', { name: task.name }),
      },
    };
  }
  if (!slot) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.noOpenTimeToSkip') },
    };
  }
  const ids = googleIdsForOccurrence(task, slot);
  const summary = task.isRecurring
    ? vt(lang, 'voice.skipToday', { name: task.name })
    : vt(lang, 'voice.skip', { name: task.name });
  return {
    type: 'command',
    command: {
      kind: 'skip',
      taskId: task.id,
      taskName: task.name,
      summary,
      occurrenceStart: slot.startIso,
      googleEventId: ids.googleEventId,
      googleEventCalendarId: slot.googleEventCalendarId || task.googleEventCalendarId,
    },
  };
}

function rescheduleCommand(
  input: {
    draft: VoiceCommandDraft;
    transcript: string;
    timeZone: string;
    nowIso: string;
    alreadyClarified: boolean;
    language: AppLanguage;
  },
  task: VoiceCommandTask,
  slot: VoiceCommandSlot | null,
  nowMs: number,
): VoiceCommandResolveResult {
  const lang = input.language;

  if (sniffDoNow(input.transcript)) {
    if (task.isFixedExternal || isFixedEventType(task.eventType)) {
      return {
        type: 'command',
        command: { kind: 'refuse', message: vt(lang, 'voice.noOpenTimeToMove') },
      };
    }
    const earliest = input.nowIso;
    const deadline = endOfLocalDayIso(localYmd(earliest, input.timeZone), input.timeZone);
    return {
      type: 'command',
      command: {
        kind: 'window',
        taskId: task.id,
        taskName: task.name,
        summary: vt(lang, 'voice.doNowReplan', { name: task.name }),
        earliestStartTime: earliest,
        deadline,
        scheduledStartTime: null,
        scheduledEndTime: null,
        clearUnscheduled: true,
      },
    };
  }

  const when = planWhen(input.transcript, input.draft, input.timeZone, input.nowIso, slot);
  if (!when) {
    const question = vt(lang, 'voice.whenMove');
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: question } }
      : { type: 'clarify', question };
  }

  if (when.kind === 'move' && slot && Date.parse(slot.endIso) > nowMs) {
    return moveSlot(task, slot, when.startIso, when.endIso, input.timeZone, lang);
  }

  if (task.isRecurring || task.isFixedExternal) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.noOpenTimeToMove') },
    };
  }

  const earliest = when.kind === 'move' ? when.startIso : when.earliest;
  const deadline =
    when.kind === 'move'
      ? when.explicitEnd
        ? when.endIso
        : endOfLocalDayIso(localYmd(when.startIso, input.timeZone), input.timeZone)
      : when.deadline;
  if (isFixedEventType(task.eventType)) {
    if (when.kind !== 'move') {
      return {
        type: 'command',
        command: { kind: 'refuse', message: vt(lang, 'voice.noOpenTimeToMove') },
      };
    }
    return {
      type: 'command',
      command: {
        kind: 'window',
        taskId: task.id,
        taskName: task.name,
        summary: vt(lang, 'voice.moveTo', {
          name: task.name,
          when: formatWhen(when.startIso, input.timeZone),
        }),
        earliestStartTime: null,
        deadline: null,
        scheduledStartTime: when.startIso,
        scheduledEndTime: when.endIso,
        clearUnscheduled: false,
      },
    };
  }

  return {
    type: 'command',
    command: {
      kind: 'window',
      taskId: task.id,
      taskName: task.name,
      summary: vt(lang, 'voice.rescheduleReplan', {
        name: task.name,
        when: formatWhen(earliest, input.timeZone),
      }),
      earliestStartTime: earliest,
      deadline,
      scheduledStartTime: null,
      scheduledEndTime: null,
      clearUnscheduled: task.isUnscheduled,
    },
  };
}

function moveSlot(
  task: VoiceCommandTask,
  slot: VoiceCommandSlot,
  startIso: string,
  endIso: string,
  timeZone: string,
  lang: AppLanguage,
): VoiceCommandResolveResult {
  if (!(Date.parse(endIso) > Date.parse(startIso))) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: vt(lang, 'voice.endNotAfterStart') },
    };
  }
  const summary = vt(lang, 'voice.moveRange', {
    name: task.name,
    when: `${formatWhen(startIso, timeZone)}–${localHm(endIso, timeZone)}`,
  });
  const ids = googleIdsForOccurrence(task, slot);
  if (!slot.synthetic && !ids.googleEventId) {
    return {
      type: 'command',
      command: {
        kind: 'shift',
        taskId: task.id,
        taskName: task.name,
        summary,
        slotId: slot.id,
        start: startIso,
        end: endIso,
      },
    };
  }
  if (!ids.googleEventId) {
    return {
      type: 'command',
      command: {
        kind: 'window',
        taskId: task.id,
        taskName: task.name,
        summary: vt(lang, 'voice.moveTo', {
          name: task.name,
          when: formatWhen(startIso, timeZone),
        }),
        earliestStartTime: null,
        deadline: null,
        scheduledStartTime: startIso,
        scheduledEndTime: endIso,
        clearUnscheduled: false,
      },
    };
  }
  return {
    type: 'command',
    command: {
      kind: 'move',
      taskId: task.id,
      taskName: task.name,
      summary,
      googleEventId: ids.googleEventId,
      calendarId: slot.googleEventCalendarId || task.googleEventCalendarId,
      recurringEventId: task.isRecurring ? task.googleEventId : null,
      originalStart: slot.startIso,
      originalEnd: slot.endIso,
      start: startIso,
      end: endIso,
    },
  };
}

type PlannedWhen =
  | { kind: 'move'; startIso: string; endIso: string; explicitEnd: boolean }
  | { kind: 'window'; earliest: string; deadline: string };

function planWhen(
  transcript: string,
  draft: VoiceCommandDraft,
  timeZone: string,
  nowIso: string,
  slot: VoiceCommandSlot | null,
): PlannedWhen | null {
  const today = localYmd(nowIso, timeZone);
  const window = inferScheduleWindow(transcript, today);
  const clocks = clockRange(transcript);
  const durationMs = slot
    ? Math.max(60_000, Date.parse(slot.endIso) - Date.parse(slot.startIso))
    : 30 * 60_000;
  const dayYmd = window?.startYmd ?? (slot ? localYmd(slot.startIso, timeZone) : today);

  if (clocks) {
    const startIso = localDateTimeIso(window?.startYmd ?? dayYmd, clocks.startHm, timeZone);
    const endIso =
      clocks.endHm !== clocks.startHm
        ? localDateTimeIso(window?.startYmd ?? dayYmd, clocks.endHm, timeZone)
        : new Date(Date.parse(startIso) + durationMs).toISOString();
    return { kind: 'move', startIso, endIso, explicitEnd: clocks.endHm !== clocks.startHm };
  }

  if (window && slot) {
    const hm = localHm(slot.startIso, timeZone);
    const startIso = localDateTimeIso(window.startYmd, hm, timeZone);
    return {
      kind: 'move',
      startIso,
      endIso: new Date(Date.parse(startIso) + durationMs).toISOString(),
      explicitEnd: false,
    };
  }

  if (window) {
    return {
      kind: 'window',
      earliest: startOfLocalDayIso(window.startYmd, timeZone),
      deadline: endOfLocalDayIso(window.endYmd, timeZone),
    };
  }

  const spokenStart = draft.spokenStart;
  if (spokenStart && !isMidnight(spokenStart)) {
    const startIso = spokenStart;
    const spokenEnd = draft.spokenEnd;
    const endIso =
      spokenEnd && !isMidnight(spokenEnd) && Date.parse(spokenEnd) > Date.parse(startIso)
        ? spokenEnd
        : new Date(Date.parse(startIso) + durationMs).toISOString();
    return {
      kind: 'move',
      startIso,
      endIso,
      explicitEnd: !!(spokenEnd && !isMidnight(spokenEnd)),
    };
  }

  if (spokenStart && isMidnight(spokenStart)) {
    const startYmd = localYmd(spokenStart, timeZone);
    const endYmd = draft.spokenEnd ? localYmd(draft.spokenEnd, timeZone) : startYmd;
    if (slot) {
      const hm = localHm(slot.startIso, timeZone);
      const startIso = localDateTimeIso(startYmd, hm, timeZone);
      return {
        kind: 'move',
        startIso,
        endIso: new Date(Date.parse(startIso) + durationMs).toISOString(),
        explicitEnd: false,
      };
    }
    return {
      kind: 'window',
      earliest: startOfLocalDayIso(startYmd, timeZone),
      deadline: endOfLocalDayIso(endYmd, timeZone),
    };
  }

  return null;
}

function pickTask(input: {
  draft: VoiceCommandDraft;
  transcript: string;
  nowIso: string;
  alreadyClarified: boolean;
  tasks: VoiceCommandTask[];
  slots: VoiceCommandSlot[];
  language: AppLanguage;
}):
  | { type: 'task'; task: VoiceCommandTask }
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; message: string } {
  const lang = input.language;
  const open = input.tasks.filter(
    (task) => task.status !== 'completed' && task.status !== 'canceled',
  );
  if (input.draft.target === 'named' && input.draft.taskName) {
    return matchNamed(open, input.draft.taskName, lang);
  }
  if (input.draft.target === 'current' || !input.draft.taskName) {
    const nowMs = Date.parse(input.nowIso);
    const current = open.filter((task) =>
      occurrences(task, input.slots).some(
        (slot) => Date.parse(slot.startIso) <= nowMs && nowMs < Date.parse(slot.endIso),
      ),
    );
    if (current.length === 1) return { type: 'task', task: current[0] };
    if (current.length > 1) {
      return {
        type: 'clarify',
        question: vt(lang, 'voice.whichTaskList', {
          names: current
            .slice(0, 5)
            .map((task) => task.name)
            .join(', '),
        }),
      };
    }
    return { type: 'refuse', message: vt(lang, 'voice.nothingInProgress') };
  }
  return { type: 'clarify', question: vt(lang, 'voice.whichTask') };
}

function normalizeDraft(draft: VoiceCommandDraft, transcript: string): VoiceCommandDraft {
  let taskName = cleanTaskName(draft.taskName);
  if (!taskName) taskName = cleanTaskName(stripCommandPrefix(transcript));
  if (!taskName) return { ...draft, target: 'current', taskName: null };
  return { ...draft, target: 'named', taskName };
}

function cleanTaskName(value: string | null): string | null {
  if (!value) return null;
  const stripped = sniffCommandIntent(value) ? stripCommandPrefix(value) : value.trim();
  if (!stripped) return null;
  if (CURRENT_WORDS.test(normalizeName(stripped)) || isWhenPhrase(stripped)) return null;
  return stripped;
}

function isWhenPhrase(text: string): boolean {
  const when = new Set([
    'to',
    'at',
    'on',
    'from',
    'tomorrow',
    'today',
    'завтра',
    'сьогодні',
    'сегодня',
    'післязавтра',
    'послезавтра',
    'на',
    'о',
    'в',
    'у',
  ]);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}:.]+/u)
    .filter(Boolean)
    .filter((token) => !when.has(token) && !/^\d{1,2}([:.]\d{2})?$/.test(token));
  return tokens.length === 0;
}

function stripCommandPrefix(text: string): string | null {
  const stripped = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      new RegExp(
        `^(?:please\\s+|будь ласка\\s+)?(?:do\\s+now|schedule\\s+(?:it\\s+)?now|place\\s+(?:it\\s+)?now|зроби\\s+зараз|заплануй(?:\\s+це)?\\s+зараз|сделай\\s+сейчас|check(?:ed)?\\s*in|mark\\s+(?:my\\s+)?habit|habit\\s+check|i\\s+(?:did|have\\s+done)(?:\\s+my)?\\s+habit|відміт(?:ив|ила|ити)(?:\\s+звичку)?|звичк[ауіи]|create\\s+habit|new\\s+habit|add\\s+habit|створи(?:ти)?\\s+звичк|додай(?:ти)?\\s+звичк|delete\\s+habit|remove\\s+habit|видалити\\s+звичк|update\\s+habit|edit\\s+habit|change\\s+habit|uncheck|clear\\s+check(?:[-\\s]?in)?|зняти\\s+відмітк|delete|remove|видалити|видали|удалить|удали|rename|reopen|update|edit|change|set|перейменуй|зміни(?:ти)?|онов(?:и|ити)|відкрий(?:\\s+знову)?|skip|пропусти(?:ти)?|пропустить|move|reschedule|перенес(?:и|ти|іть)?|перестав(?:ь|ити)?|зсунь|сдвин(?:ь|уть)|mark|закінч(?:ив|ила|ити)?|заверш(?:ив|ила)|зроби(?:в|ла)|готово|закончил(?:а)?|сделал(?:а)?|выполнил(?:а)?|done|complete|completed|finish(?:ed)?)${EDGE}\\s*`,
        'iu',
      ),
      '',
    )
    .replace(/^(?:with|this|it|that|the task|цю|це)\b\s*/i, '')
    .replace(/\b(?:done|complete|finished)\s*$/i, '')
    .trim();
  return stripped || null;
}

function matchNamed(
  open: VoiceCommandTask[],
  query: string,
  lang: AppLanguage,
):
  | { type: 'task'; task: VoiceCommandTask }
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; message: string } {
  const needle = normalizeName(query);
  if (!needle || CURRENT_WORDS.test(needle)) {
    return { type: 'clarify', question: vt(lang, 'voice.whichTask') };
  }
  const exact = open.filter((task) => normalizeName(task.name) === needle);
  const hits = exact.length
    ? exact
    : open.filter((task) => {
        const name = normalizeName(task.name);
        if (!name) return false;
        if (name.includes(needle)) return true;
        return needle.includes(name) && name.length >= 3;
      });
  if (hits.length === 1) return { type: 'task', task: hits[0] };
  if (hits.length > 1) {
    return {
      type: 'clarify',
      question: vt(lang, 'voice.whichTaskList', {
        names: hits
          .slice(0, 5)
          .map((task) => task.name)
          .join(', '),
      }),
    };
  }
  return { type: 'refuse', message: vt(lang, 'voice.couldNotFindTask') };
}

function matchNamedHabit(
  habits: VoiceCommandHabit[],
  query: string,
  lang: AppLanguage,
):
  | { type: 'habit'; habit: VoiceCommandHabit }
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; message: string } {
  const needle = normalizeName(query);
  if (!needle || CURRENT_WORDS.test(needle)) {
    return { type: 'clarify', question: vt(lang, 'voice.whichHabit') };
  }
  const exact = habits.filter((habit) => normalizeName(habit.name) === needle);
  const hits = exact.length
    ? exact
    : habits.filter((habit) => {
        const name = normalizeName(habit.name);
        if (!name) return false;
        if (name.includes(needle)) return true;
        return needle.includes(name) && name.length >= 3;
      });
  if (hits.length === 1) return { type: 'habit', habit: hits[0] };
  if (hits.length > 1) {
    return {
      type: 'clarify',
      question: vt(lang, 'voice.whichHabitList', {
        names: hits
          .slice(0, 5)
          .map((habit) => habit.name)
          .join(', '),
      }),
    };
  }
  return { type: 'refuse', message: vt(lang, 'voice.couldNotFindHabit') };
}

function pickOpenSlot(
  task: VoiceCommandTask,
  slots: VoiceCommandSlot[],
  nowMs: number,
  currentOnly: boolean,
): VoiceCommandSlot | null {
  const open = occurrences(task, slots)
    .filter((slot) => Date.parse(slot.endIso) > nowMs)
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  const overlapping = open.filter((slot) => Date.parse(slot.startIso) <= nowMs);
  if (overlapping.length) return overlapping[overlapping.length - 1];
  if (currentOnly) return null;
  return open[0] ?? null;
}

function occurrences(task: VoiceCommandTask, slots: VoiceCommandSlot[]): VoiceCommandSlot[] {
  const rows = slots.filter((slot) => slot.taskId === task.id);
  if (rows.length) return rows;
  if (
    isFixedEventType(task.eventType) &&
    task.scheduledStartTime &&
    task.scheduledEndTime &&
    Date.parse(task.scheduledEndTime) > Date.parse(task.scheduledStartTime)
  ) {
    return [
      {
        id: task.id,
        taskId: task.id,
        startIso: task.scheduledStartTime,
        endIso: task.scheduledEndTime,
        googleEventId: task.googleEventId,
        googleEventCalendarId: task.googleEventCalendarId,
        synthetic: true,
      },
    ];
  }
  return [];
}

function googleIdsForOccurrence(
  task: VoiceCommandTask,
  slot: VoiceCommandSlot,
): { googleEventId: string | null } {
  const master = task.googleEventId;
  const slotId = slot.googleEventId;
  if (task.isRecurring && master) {
    if (slotId && slotId !== master) return { googleEventId: slotId };
    return {
      googleEventId: googleRecurringInstanceId(master, new Date(slot.startIso)),
    };
  }
  return { googleEventId: slotId || master };
}

function clockRange(transcript: string): { startHm: string; endHm: string } | null {
  const text = transcript.toLowerCase();
  const stamped = [...text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)];
  if (stamped.length >= 2) {
    const start = minutes(stamped[0][1], stamped[0][2]);
    const end = minutes(stamped[1][1], stamped[1][2]);
    if (start != null && end != null && end > start) {
      return { startHm: hm(start), endHm: hm(end) };
    }
  }
  if (stamped.length === 1) {
    const start = minutes(stamped[0][1], stamped[0][2]);
    if (start != null) {
      const value = hm(start);
      return { startHm: value, endHm: value };
    }
  }
  return null;
}

function minutes(hourRaw: string, minuteRaw: string): number | null {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function hm(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isMidnight(iso: string): boolean {
  return /T00:00/.test(iso);
}

function formatWhen(iso: string, timeZone: string): string {
  return `${localYmd(iso, timeZone)} ${localHm(iso, timeZone)}`;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullable(value: unknown): string | null {
  const text = asString(value);
  return text || null;
}

function asIso(value: unknown): string | null {
  const text = asNullable(value);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}
