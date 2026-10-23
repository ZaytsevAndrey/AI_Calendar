import i18n from 'i18n';
import { localHm, localYmd } from 'utils/ianaDateTime';

export type StoredTaskFields = {
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

export type StoredTaskOptions = {
  timeZone?: string | null;
  nowIso?: string | null;
  rename?: boolean;
  mentionDefaults?: boolean;
  mentionClears?: boolean;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const PRIORITY: Record<string, string> = {
  low: 'voice.priorityLow',
  medium: 'voice.priorityMedium',
  high: 'voice.priorityHigh',
  urgent: 'voice.priorityUrgent',
};

const REPEAT: Record<string, string> = {
  DAILY: 'voice.repeatDaily',
  WEEKLY: 'voice.repeatWeekly',
  BIWEEKLY: 'voice.repeatBiweekly',
  MONTHLY: 'voice.repeatMonthly',
};

const STATUS: Record<string, string> = {
  todo: 'voice.statusTodo',
  in_progress: 'voice.statusInProgress',
  completed: 'voice.statusCompleted',
  canceled: 'voice.statusCanceled',
};

const CLEARS: Record<string, string> = {
  description: 'voice.fieldDescription',
  deadline: 'voice.fieldDeadline',
  earliestStartTime: 'voice.fieldEarliest',
  scheduledStartTime: 'voice.fieldStart',
  scheduledEndTime: 'voice.fieldEnd',
  location: 'voice.fieldPlace',
  recurrencePattern: 'voice.fieldRepeat',
};

function say(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

/** Facts that were stored. Empty when there is nothing to add past the name. */
export function describeStoredTask(fields: StoredTaskFields, opts?: StoredTaskOptions): string {
  const parts: string[] = [];

  if (fields.isUnscheduled) parts.push(say('voice.seatUnscheduled'));

  const start = text(fields.scheduledStartTime);
  const end = text(fields.scheduledEndTime);
  if (start) {
    parts.push(spanPhrase(start, end, opts));
  } else if (!fields.isUnscheduled) {
    const window = windowPhrase(text(fields.earliestStartTime), text(fields.deadline), opts);
    if (window) parts.push(window);
  }

  const deadline = text(fields.deadline);
  const earliest = text(fields.earliestStartTime);
  if (start && deadline && deadline !== start && deadline !== end) {
    parts.push(say('voice.seatUntil', { when: stamp(deadline, opts) }));
  }
  if (start && earliest && earliest !== start) {
    parts.push(say('voice.seatFrom', { when: stamp(earliest, opts) }));
  }
  if (fields.isUnscheduled && deadline) {
    parts.push(say('voice.seatUntil', { when: stamp(deadline, opts) }));
  }

  if (fields.scheduleState === 'problematic') parts.push(say('voice.seatUnplaced'));

  if (typeof fields.estimatedTimeInMinutes === 'number' && fields.estimatedTimeInMinutes > 0) {
    parts.push(say('voice.detailMinutes', { minutes: fields.estimatedTimeInMinutes }));
  }

  const priority = text(fields.priority);
  if (priority && PRIORITY[priority] && (priority !== 'medium' || opts?.mentionDefaults)) {
    parts.push(say(PRIORITY[priority]));
  }

  if (fields.eventType === 'fixed') parts.push(say('voice.detailFixed'));

  const pattern = text(fields.recurrencePattern)?.toUpperCase();
  if (fields.isRecurring || pattern) {
    const repeat = pattern && REPEAT[pattern] ? say(REPEAT[pattern]) : pattern;
    const days = dayList(fields.recurrenceWeekDays);
    if (repeat && days) parts.push(say('voice.repeatOnDays', { pattern: repeat, days }));
    else if (repeat) parts.push(repeat);
    else if (days) parts.push(days);
  } else {
    const days = dayList(fields.eligibleWeekDays);
    if (days) parts.push(say('voice.detailDays', { days }));
  }

  if (fields.allowSplit) parts.push(say('voice.detailCanSplit'));

  const place = text(fields.location);
  if (place) parts.push(say('voice.detailPlace', { place }));

  const status = text(fields.status);
  if (status && STATUS[status] && (status !== 'todo' || opts?.mentionDefaults)) {
    parts.push(say(STATUS[status]));
  }

  if (opts?.rename && text(fields.name)) {
    parts.push(say('voice.detailRename', { name: text(fields.name)! }));
  }

  const note = text(fields.description);
  if (note) {
    const clipped = note.length > 80 ? `${note.slice(0, 77)}…` : note;
    parts.push(say('voice.detailNote', { text: clipped }));
  }

  if (opts?.mentionClears) {
    for (const [key, label] of Object.entries(CLEARS)) {
      if (fields[key as keyof StoredTaskFields] === null) {
        parts.push(say('voice.cleared', { field: say(label) }));
      }
    }
  }

  return parts.join(', ');
}

export function summarizeCreatedTask(
  task: StoredTaskFields & { name: string },
  opts?: StoredTaskOptions,
): string {
  const details = describeStoredTask(task, opts);
  if (!details) return say('voice.createdTask', { name: task.name });
  return say('voice.createdTaskDetails', { name: task.name, details });
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function spanPhrase(start: string, end: string | null, opts?: StoredTaskOptions): string {
  if (!end) return say('voice.seatOn', { when: stamp(start, opts) });
  const zone = opts?.timeZone;
  if (zone && localYmd(start, zone) === localYmd(end, zone)) {
    const from = clock(start, zone) || '00:00';
    const until = clock(end, zone) || '00:00';
    if (from === '00:00' && until === '00:00') {
      return say('voice.seatOn', { when: dayLabel(start, opts) });
    }
    return say('voice.seatSpan', { day: dayLabel(start, opts), start: from, end: until });
  }
  return say('voice.seatFromUntil', { from: stamp(start, opts), until: stamp(end, opts) });
}

function windowPhrase(
  from: string | null,
  until: string | null,
  opts?: StoredTaskOptions,
): string | null {
  if (!from && !until) return null;
  if (from && until) {
    const zone = opts?.timeZone;
    if (zone && localYmd(from, zone) === localYmd(until, zone)) {
      const fromClock = clock(from, zone);
      const untilClock = clock(until, zone);
      if (fromClock && untilClock) {
        return say('voice.seatWindow', {
          day: dayLabel(from, opts),
          from: fromClock,
          until: untilClock,
        });
      }
      if (fromClock) return say('voice.seatFrom', { when: `${dayLabel(from, opts)} ${fromClock}` });
      if (untilClock) return say('voice.seatUntil', { when: `${dayLabel(until, opts)} ${untilClock}` });
      return say('voice.seatOn', { when: dayLabel(from, opts) });
    }
    return say('voice.seatFromUntil', { from: stamp(from, opts), until: stamp(until, opts) });
  }
  if (from) return say('voice.seatOn', { when: stamp(from, opts) });
  return say('voice.seatUntil', { when: stamp(until!, opts) });
}

function stamp(iso: string, opts?: StoredTaskOptions): string {
  const zone = opts?.timeZone;
  if (!zone) return iso;
  const day = dayLabel(iso, opts);
  const hm = clock(iso, zone);
  return hm ? `${day} ${hm}` : day;
}

function dayLabel(iso: string, opts?: StoredTaskOptions): string {
  const zone = opts?.timeZone;
  if (!zone) return iso.slice(0, 10);
  const day = localYmd(iso, zone);
  if (!opts?.nowIso) return day;
  const today = localYmd(opts.nowIso, zone);
  if (day === today) return say('voice.whenToday');
  if (day === addDays(today, 1)) return say('voice.whenTomorrow');
  return day;
}

function clock(iso: string, timeZone: string): string | null {
  if (/T00:00/.test(iso)) return null;
  const hm = localHm(iso, timeZone);
  return hm === '00:00' ? null : hm;
}

function dayList(days: number[] | null | undefined): string | null {
  if (!days?.length) return null;
  const labels = [...new Set(days.filter((day) => day >= 0 && day <= 6))].sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
  if (!labels.length || labels.length >= 7) return null;
  return labels.map((day) => say(`voice.weekday${WEEKDAYS[day]}`)).join(', ');
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
