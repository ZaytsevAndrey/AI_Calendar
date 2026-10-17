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

export type DueReminder = {
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
};

function minutesUntil(startMs: number, nowMs: number): number {
  return Math.max(1, Math.round((startMs - nowMs) / 60_000));
}

function reminderLanguage(value: string | undefined): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

export function selectDueReminders(input: {
  nowMs: number;
  lookaheadMs?: number;
  blocks: TimedReminderBlock[];
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

  return items;
}
