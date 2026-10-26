import { t, type MessageKey } from '../../i18n/t';
import type { AppLanguage } from '../../i18n/types';
import {
  addDaysToYmd,
  localHm,
  localYmd,
  scheduleTodayYmd,
} from './voice-local-date.util';

/** Fields a create or an update can store. Absent means untouched. Null on an update clears. */
export type StoredFields = {
  name?: string | null;
  description?: string | null;
  eventType?: string | null;
  estimatedTimeInMinutes?: number | null;
  isRecurring?: boolean | null;
  isUnscheduled?: boolean | null;
  recurrencePattern?: string | null;
  recurrenceWeekDays?: number[] | null;
  allowSplit?: boolean | null;
  priority?: string | null;
  deadline?: string | null;
  earliestStartTime?: string | null;
  eligibleWeekDays?: number[] | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  location?: string | null;
  status?: string | null;
  scheduleState?: string | null;
};

export type StoredSummaryOptions = {
  timeZone?: string | null;
  nowIso?: string | null;
  wakeTime?: string | null;
  sleepTime?: string | null;
  /** Update: a name in the patch is a rename. */
  rename?: boolean;
  /** Update: medium and todo are real changes, not the create default. */
  mentionDefaults?: boolean;
  /** Update: null clears a field. Create leaves those keys empty. */
  mentionClears?: boolean;
};

const WEEKDAY_KEYS: MessageKey[] = [
  'voice.weekdaySun',
  'voice.weekdayMon',
  'voice.weekdayTue',
  'voice.weekdayWed',
  'voice.weekdayThu',
  'voice.weekdayFri',
  'voice.weekdaySat',
];

const PRIORITY_KEYS: Record<string, MessageKey> = {
  low: 'voice.priorityLow',
  medium: 'voice.priorityMedium',
  high: 'voice.priorityHigh',
  urgent: 'voice.priorityUrgent',
};

const REPEAT_KEYS: Record<string, MessageKey> = {
  DAILY: 'voice.repeatDaily',
  WEEKLY: 'voice.repeatWeekly',
  BIWEEKLY: 'voice.repeatBiweekly',
  MONTHLY: 'voice.repeatMonthly',
};

const STATUS_KEYS: Record<string, MessageKey> = {
  todo: 'voice.statusTodo',
  in_progress: 'voice.statusInProgress',
  completed: 'voice.statusCompleted',
  canceled: 'voice.statusCanceled',
};

const CLEAR_KEYS: Record<string, MessageKey> = {
  description: 'voice.fieldDescription',
  deadline: 'voice.fieldDeadline',
  earliestStartTime: 'voice.fieldEarliest',
  scheduledStartTime: 'voice.fieldStart',
  scheduledEndTime: 'voice.fieldEnd',
  location: 'voice.fieldPlace',
  recurrencePattern: 'voice.fieldRepeat',
};

export function summarizeCreatedTask(
  task: StoredFields & { name: string },
  lang: AppLanguage,
  opts?: StoredSummaryOptions,
): string {
  const details = describeStoredFields(task, lang, opts);
  if (!details) return t(lang, 'voice.createdTask', { name: task.name });
  return t(lang, 'voice.createdTaskDetails', { name: task.name, details });
}

export function summarizeUpdatedTask(
  name: string,
  patch: StoredFields,
  lang: AppLanguage,
  opts?: StoredSummaryOptions,
): string {
  const details = describeStoredFields(patch, lang, {
    ...opts,
    rename: true,
    mentionDefaults: true,
    mentionClears: true,
  });
  if (!details) return t(lang, 'voice.updateTask', { name });
  return t(lang, 'voice.updateTaskDetails', { name, details });
}

/** Comma-separated facts that were actually stored. Empty when nothing to say. */
export function describeStoredFields(
  fields: StoredFields,
  lang: AppLanguage,
  opts?: StoredSummaryOptions,
): string {
  const parts: string[] = [];

  if (fields.isUnscheduled) {
    parts.push(t(lang, 'voice.seatUnscheduled'));
  }

  const start = text(fields.scheduledStartTime);
  const end = text(fields.scheduledEndTime);
  if (start) {
    parts.push(spanPhrase(start, end, lang, opts));
  } else if (!fields.isUnscheduled) {
    const from = text(fields.earliestStartTime);
    const until = text(fields.deadline);
    const window = windowPhrase(from, until, lang, opts);
    if (window) parts.push(window);
  }

  const deadline = text(fields.deadline);
  const earliest = text(fields.earliestStartTime);
  if (start && deadline && deadline !== start && deadline !== end) {
    parts.push(t(lang, 'voice.seatUntil', { when: stamp(deadline, lang, opts) }));
  }
  if (start && earliest && earliest !== start) {
    parts.push(t(lang, 'voice.seatFrom', { when: stamp(earliest, lang, opts) }));
  }

  if (fields.scheduleState === 'problematic') {
    parts.push(t(lang, 'voice.seatUnplaced'));
  }

  if (typeof fields.estimatedTimeInMinutes === 'number' && fields.estimatedTimeInMinutes > 0) {
    parts.push(t(lang, 'voice.detailMinutes', { minutes: fields.estimatedTimeInMinutes }));
  }

  const priority = text(fields.priority);
  if (priority && PRIORITY_KEYS[priority] && (priority !== 'medium' || opts?.mentionDefaults)) {
    parts.push(t(lang, PRIORITY_KEYS[priority]));
  }

  if (fields.eventType === 'fixed') {
    parts.push(t(lang, 'voice.detailFixed'));
  }

  const pattern = text(fields.recurrencePattern)?.toUpperCase();
  if (fields.isRecurring || pattern) {
    const repeat = pattern && REPEAT_KEYS[pattern] ? t(lang, REPEAT_KEYS[pattern]) : pattern;
    const days = dayList(fields.recurrenceWeekDays, lang);
    if (repeat && days) {
      parts.push(t(lang, 'voice.repeatOnDays', { pattern: repeat, days }));
    } else if (repeat) {
      parts.push(repeat);
    } else if (days) {
      parts.push(days);
    }
  } else {
    const days = dayList(fields.eligibleWeekDays, lang);
    if (days) parts.push(t(lang, 'voice.detailDays', { days }));
  }

  if (fields.allowSplit) parts.push(t(lang, 'voice.detailCanSplit'));

  const place = text(fields.location);
  if (place) parts.push(t(lang, 'voice.detailPlace', { place }));

  const status = text(fields.status);
  if (status && STATUS_KEYS[status] && (status !== 'todo' || opts?.mentionDefaults)) {
    parts.push(t(lang, STATUS_KEYS[status]));
  }

  if (opts?.rename && text(fields.name)) {
    parts.push(t(lang, 'voice.detailRename', { name: text(fields.name)! }));
  }

  const note = text(fields.description);
  if (note) {
    const clipped = note.length > 80 ? `${note.slice(0, 77)}…` : note;
    parts.push(t(lang, 'voice.detailNote', { text: clipped }));
  }

  if (opts?.mentionClears) {
    for (const [key, label] of Object.entries(CLEAR_KEYS)) {
      if (fields[key as keyof StoredFields] === null) {
        parts.push(t(lang, 'voice.cleared', { field: t(lang, label) }));
      }
    }
  }

  return parts.join(', ');
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function spanPhrase(
  start: string,
  end: string | null,
  lang: AppLanguage,
  opts?: StoredSummaryOptions,
): string {
  if (!end) return t(lang, 'voice.seatOn', { when: stamp(start, lang, opts) });
  const zone = opts?.timeZone;
  if (zone && localYmd(start, zone) === localYmd(end, zone)) {
    const from = clock(start, zone) || '00:00';
    const until = clock(end, zone) || '00:00';
    if (from === '00:00' && until === '00:00') {
      return t(lang, 'voice.seatOn', { when: dayLabel(start, lang, opts) });
    }
    return t(lang, 'voice.seatSpan', {
      day: dayLabel(start, lang, opts),
      start: from,
      end: until,
    });
  }
  return t(lang, 'voice.seatFromUntil', {
    from: stamp(start, lang, opts),
    until: stamp(end, lang, opts),
  });
}

function windowPhrase(
  from: string | null,
  until: string | null,
  lang: AppLanguage,
  opts?: StoredSummaryOptions,
): string | null {
  if (!from && !until) return null;
  if (from && until) {
    const zone = opts?.timeZone;
    if (zone && localYmd(from, zone) === localYmd(until, zone)) {
      const fromClock = clock(from, zone);
      const untilClock = clock(until, zone);
      if (fromClock && untilClock) {
        return t(lang, 'voice.seatWindow', {
          day: dayLabel(from, lang, opts),
          from: fromClock,
          until: untilClock,
        });
      }
      if (fromClock) return t(lang, 'voice.seatFrom', { when: `${dayLabel(from, lang, opts)} ${fromClock}` });
      if (untilClock) {
        return t(lang, 'voice.seatUntil', { when: `${dayLabel(until, lang, opts)} ${untilClock}` });
      }
      return t(lang, 'voice.seatOn', { when: dayLabel(from, lang, opts) });
    }
    return t(lang, 'voice.seatFromUntil', {
      from: stamp(from, lang, opts),
      until: stamp(until, lang, opts),
    });
  }
  if (from) return t(lang, 'voice.seatOn', { when: stamp(from, lang, opts) });
  return t(lang, 'voice.seatUntil', { when: stamp(until!, lang, opts) });
}

function stamp(iso: string, lang: AppLanguage, opts?: StoredSummaryOptions): string {
  const zone = opts?.timeZone;
  if (!zone) return iso;
  const day = dayLabel(iso, lang, opts);
  const hm = clock(iso, zone);
  return hm ? `${day} ${hm}` : day;
}

function dayLabel(iso: string, lang: AppLanguage, opts?: StoredSummaryOptions): string {
  const zone = opts?.timeZone;
  if (!zone) return iso.slice(0, 10);
  const day = localYmd(iso, zone);
  if (!opts?.nowIso) return day;
  const today = scheduleTodayYmd(opts.nowIso, zone, opts.wakeTime, opts.sleepTime);
  if (day === today) return t(lang, 'voice.whenToday');
  if (day === addDaysToYmd(today, 1)) return t(lang, 'voice.whenTomorrow');
  return day;
}

function clock(iso: string, timeZone: string): string | null {
  if (/T00:00/.test(iso)) return null;
  const hm = localHm(iso, timeZone);
  return hm === '00:00' ? null : hm;
}

function dayList(days: number[] | null | undefined, lang: AppLanguage): string | null {
  if (!days?.length) return null;
  const labels = [...new Set(days.filter((day) => day >= 0 && day <= 6))].sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
  if (!labels.length || labels.length >= 7) return null;
  return labels.map((day) => t(lang, WEEKDAY_KEYS[day])).join(', ');
}
