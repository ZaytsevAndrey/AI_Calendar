import { addDaysToYmd, localDateTimeIso, localYmd } from '../voice/voice-local-date.util';
import { isAppLanguage, t, type AppLanguage } from '../../i18n';

/** One reminder if the start is still ahead and no further than this. */
export const REMINDER_LOOKAHEAD_MS = 30 * 60 * 1000;

export function startsWithinLookahead(
  startMs: number,
  nowMs: number,
  lookaheadMs = REMINDER_LOOKAHEAD_MS,
): boolean {
  return startMs > nowMs && startMs - nowMs <= lookaheadMs;
}

export type TimedReminderBlock = {
  key: string;
  title: string;
  startMs: number;
};

export type HabitReminderSource = {
  id: string;
  name: string;
  /** HH:mm in the user zone. Null means check-in only. */
  blockStartTime: string | null;
  checkedToday: boolean;
};

export type DueReminder = {
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
};

function clockMs(ymd: string, hm: string, timeZone: string): number | null {
  const ms = new Date(localDateTimeIso(ymd, hm, timeZone)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Next clock that is still ahead: later today, or tomorrow if today's time has passed. */
export function upcomingClockMs(
  nowMs: number,
  todayYmd: string,
  hm: string,
  timeZone: string,
): number | null {
  const today = clockMs(todayYmd, hm, timeZone);
  if (today != null && today > nowMs) return today;
  return clockMs(addDaysToYmd(todayYmd, 1), hm, timeZone);
}

function minutesUntil(startMs: number, nowMs: number): number {
  return Math.max(1, Math.round((startMs - nowMs) / 60_000));
}

function reminderLanguage(value: string | undefined): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

export function selectDueReminders(input: {
  nowMs: number;
  lookaheadMs?: number;
  todayYmd: string;
  timeZone: string;
  wakeHm: string;
  blocks: TimedReminderBlock[];
  habits: HabitReminderSource[];
  alreadySent: ReadonlySet<string>;
  language?: string;
}): DueReminder[] {
  const lang = reminderLanguage(input.language);
  const lookaheadMs = input.lookaheadMs ?? REMINDER_LOOKAHEAD_MS;
  const due = (startMs: number) => startsWithinLookahead(startMs, input.nowMs, lookaheadMs);
  const items: DueReminder[] = [];
  const seen = new Set<string>();

  const push = (item: DueReminder) => {
    if (input.alreadySent.has(item.dedupeKey) || seen.has(item.dedupeKey)) return;
    seen.add(item.dedupeKey);
    items.push(item);
  };

  for (const block of input.blocks) {
    const title = block.title.trim();
    if (!title || !due(block.startMs)) continue;
    const minutes = minutesUntil(block.startMs, input.nowMs);
    push({
      dedupeKey: `block:${block.key}:${block.startMs}`,
      title: t(lang, 'push.startingIn', { minutes }),
      body: title,
      url: '/',
    });
  }

  const wakeOnly: string[] = [];
  for (const habit of input.habits) {
    const name = habit.name.trim();
    if (!name) continue;
    if (!habit.blockStartTime) {
      wakeOnly.push(name);
      continue;
    }
    const startMs = upcomingClockMs(
      input.nowMs,
      input.todayYmd,
      habit.blockStartTime,
      input.timeZone,
    );
    if (startMs == null || !due(startMs)) continue;
    const fireYmd = localYmd(new Date(startMs).toISOString(), input.timeZone);
    if (fireYmd === input.todayYmd && habit.checkedToday) continue;
    push({
      dedupeKey: `habit:${habit.id}:${fireYmd}`,
      title: t(lang, 'push.habitIn', {
        minutes: minutesUntil(startMs, input.nowMs),
      }),
      body: name,
      url: '/',
    });
  }

  const wakeMs = upcomingClockMs(input.nowMs, input.todayYmd, input.wakeHm, input.timeZone);
  if (wakeOnly.length && wakeMs != null && due(wakeMs)) {
    const fireYmd = localYmd(new Date(wakeMs).toISOString(), input.timeZone);
    const names = input.habits
      .filter((habit) => !habit.blockStartTime && habit.name.trim())
      .filter((habit) => fireYmd !== input.todayYmd || !habit.checkedToday)
      .map((habit) => habit.name.trim());
    if (names.length) {
      const body = names.join(', ');
      push({
        dedupeKey: `habits-wake:${fireYmd}`,
        title: t(lang, 'push.habits'),
        body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
        url: '/',
      });
    }
  }

  return items;
}
