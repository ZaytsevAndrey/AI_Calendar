import type { TaskDTO } from 'api/tasks.api';
import type { ParkDayHint } from './parkDayHints';
import { remainingProblematicDays } from './problematicDays';

/**
 * What one inbox card is, which decides its actions:
 * - `seriesDay`: one parked day of a series (Move as a copy, Skip the day)
 * - `seriesCopy`: a one-off copy of a series day (Move, Skip the day, Place on top)
 * - `oneOff`: a plain task (Move, Place on top, Delete)
 * - `seriesNoDay`: a parked series with no known day (Edit only)
 */
export type ProblematicItemKind = 'seriesDay' | 'seriesCopy' | 'oneOff' | 'seriesNoDay';

export type ProblematicItem = {
  key: string;
  task: TaskDTO;
  /** Parked civil day, or null when the park has no day. */
  ymd: string | null;
  kind: ProblematicItemKind;
};

export type ProblematicDayGroup = {
  ymd: string | null;
  items: ProblematicItem[];
};

/** One card per parked day; a series parked on two days gives two cards. */
export function problematicItems(
  tasks: TaskDTO[],
  hints: Record<string, ParkDayHint>,
  todayYmd: string,
): ProblematicItem[] {
  const out: ProblematicItem[] = [];
  for (const task of tasks) {
    const days = remainingProblematicDays(task, hints[task.id], todayYmd);
    if (task.isRecurring) {
      if (!days.length) {
        out.push({ key: `${task.id}:none`, task, ymd: null, kind: 'seriesNoDay' });
        continue;
      }
      for (const ymd of days) {
        out.push({ key: `${task.id}:${ymd}`, task, ymd, kind: 'seriesDay' });
      }
      continue;
    }
    out.push({
      key: task.id,
      task,
      ymd: days[0] ?? null,
      kind: task.parentSeriesId ? 'seriesCopy' : 'oneOff',
    });
  }
  return out;
}

/** Day groups in date order; items without a day come last. */
export function groupProblematicByDay(items: ProblematicItem[]): ProblematicDayGroup[] {
  const byDay = new Map<string, ProblematicItem[]>();
  for (const item of items) {
    const key = item.ymd ?? '';
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([ymd, list]) => ({
      ymd: ymd || null,
      items: list.sort((x, y) => x.task.name.localeCompare(y.task.name)),
    }));
}
