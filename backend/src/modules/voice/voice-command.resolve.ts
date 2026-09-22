import { isFixedEventType } from '../scheduling/event-type.enum';
import { googleRecurringInstanceId } from '../tasks/skipped-occurrence.util';
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
  VoiceCommandIntent,
  VoiceCommandSlot,
  VoiceCommandTask,
} from './voice-command.types';

const CURRENT_WORDS =
  /^(?:this|it|that|now|current|цю|це|зараз|поточну|эту|это|сейчас)$/i;

export type VoiceCommandResolveResult =
  | { type: 'clarify'; question: string }
  | { type: 'command'; command: VoiceCommand };

const EDGE = '(?![\\p{L}\\p{N}])';

function leading(body: string): RegExp {
  return new RegExp(`^(?:${body})${EDGE}`, 'iu');
}

export function sniffCommandIntent(transcript: string): VoiceCommandIntent | null {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (leading('add|create|new task|нагадай|створи|додай|создай|добавь').test(text)) {
    return null;
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
  const targetRaw = asString(command.target).toLowerCase();
  const taskName = asNullable(command.taskName) || asNullable(task.name);
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
}): VoiceCommandResolveResult {
  const draft = normalizeDraft(input.draft, input.transcript);
  const nowMs = Date.parse(input.nowIso);
  const picked = pickTask({ ...input, draft });
  if (picked.type === 'clarify') {
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: picked.question } }
      : picked;
  }
  if (picked.type === 'refuse') {
    return { type: 'command', command: { kind: 'refuse', message: picked.message } };
  }

  const task = picked.task;
  const slot = pickOpenSlot(task, input.slots, nowMs, draft.target === 'current');

  if (draft.intent === 'complete' && !task.isRecurring) {
    if (task.isFixedExternal) {
      return {
        type: 'command',
        command: { kind: 'refuse', message: 'That event is not an app task.' },
      };
    }
    return {
      type: 'command',
      command: {
        kind: 'complete',
        taskId: task.id,
        taskName: task.name,
        summary: `Mark "${task.name}" done?`,
      },
    };
  }

  if (draft.intent === 'complete' || draft.intent === 'skip') {
    return skipCommand(task, slot);
  }

  return rescheduleCommand({ ...input, draft }, task, slot, nowMs);
}

function skipCommand(
  task: VoiceCommandTask,
  slot: VoiceCommandSlot | null,
): VoiceCommandResolveResult {
  if (task.isFixedExternal || isFixedEventType(task.eventType)) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: 'Fixed events cannot be skipped.' },
    };
  }
  if (task.isUnscheduled) {
    return {
      type: 'command',
      command: {
        kind: 'refuse',
        message: 'Unscheduled tasks have no occurrence to skip.',
      },
    };
  }
  if (!slot) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: 'There is no open time to skip.' },
    };
  }
  const ids = googleIdsForOccurrence(task, slot);
  const summary = task.isRecurring
    ? `Skip today's "${task.name}"?`
    : `Skip "${task.name}"?`;
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
  },
  task: VoiceCommandTask,
  slot: VoiceCommandSlot | null,
  nowMs: number,
): VoiceCommandResolveResult {
  const when = planWhen(input.transcript, input.draft, input.timeZone, input.nowIso, slot);
  if (!when) {
    const question = 'When should I move it?';
    return input.alreadyClarified
      ? { type: 'command', command: { kind: 'refuse', message: question } }
      : { type: 'clarify', question };
  }

  if (when.kind === 'move' && slot && Date.parse(slot.endIso) > nowMs) {
    return moveSlot(task, slot, when.startIso, when.endIso, input.timeZone);
  }

  if (task.isRecurring || task.isFixedExternal) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: 'There is no open time to move.' },
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
        command: { kind: 'refuse', message: 'There is no open time to move.' },
      };
    }
    return {
      type: 'command',
      command: {
        kind: 'window',
        taskId: task.id,
        taskName: task.name,
        summary: `Move "${task.name}" to ${formatWhen(when.startIso, input.timeZone)}?`,
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
      summary: `Reschedule "${task.name}" to ${formatWhen(earliest, input.timeZone)} and replan?`,
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
): VoiceCommandResolveResult {
  if (!(Date.parse(endIso) > Date.parse(startIso))) {
    return {
      type: 'command',
      command: { kind: 'refuse', message: 'That end time is not after the start.' },
    };
  }
  const summary = `Move "${task.name}" to ${formatWhen(startIso, timeZone)}–${localHm(endIso, timeZone)}?`;
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
        summary: `Move "${task.name}" to ${formatWhen(startIso, timeZone)}?`,
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
}):
  | { type: 'task'; task: VoiceCommandTask }
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; message: string } {
  const open = input.tasks.filter(
    (task) => task.status !== 'completed' && task.status !== 'canceled',
  );
  if (input.draft.target === 'named' && input.draft.taskName) {
    return matchNamed(open, input.draft.taskName);
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
        question: `Which task? ${current
          .slice(0, 5)
          .map((task) => task.name)
          .join(', ')}`,
      };
    }
    return { type: 'refuse', message: 'Nothing is in progress.' };
  }
  return { type: 'clarify', question: 'Which task?' };
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
        `^(?:please\\s+|будь ласка\\s+)?(?:skip|пропусти(?:ти)?|пропустить|move|reschedule|перенес(?:и|ти|іть)?|перестав(?:ь|ити)?|зсунь|сдвин(?:ь|уть)|mark|закінч(?:ив|ила|ити)?|заверш(?:ив|ила)|зроби(?:в|ла)|готово|закончил(?:а)?|сделал(?:а)?|выполнил(?:а)?|done|complete|completed|finish(?:ed)?)${EDGE}\\s*`,
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
):
  | { type: 'task'; task: VoiceCommandTask }
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; message: string } {
  const needle = normalizeName(query);
  if (!needle || CURRENT_WORDS.test(needle)) {
    return { type: 'clarify', question: 'Which task?' };
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
      question: `Which task? ${hits
        .slice(0, 5)
        .map((task) => task.name)
        .join(', ')}`,
    };
  }
  return { type: 'refuse', message: 'I could not find that task.' };
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
