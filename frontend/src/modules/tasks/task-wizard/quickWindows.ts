import { addDaysToYmd, localYmd } from '../../../utils/ianaDateTime';

export type QuickWindowId = 'today' | 'tomorrow' | 'thisWeek';

export type QuickWindow = { id: QuickWindowId; start: string; end: string };

/** One-tap windows in the Settings zone. The week ends on Sunday. */
export function quickWindows(nowIso: string, timeZone: string): QuickWindow[] {
  const today = localYmd(nowIso, timeZone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sunday = addDaysToYmd(today, (7 - weekday) % 7);
  return [
    { id: 'today', start: today, end: today },
    { id: 'tomorrow', start: addDaysToYmd(today, 1), end: addDaysToYmd(today, 1) },
    { id: 'thisWeek', start: today, end: sunday },
  ];
}
