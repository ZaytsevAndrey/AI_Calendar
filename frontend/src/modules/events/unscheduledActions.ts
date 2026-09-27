import type { UpdateTaskDTO } from 'api/tasks.api';
import { civilDayStartEndIso, localYmd } from 'utils/ianaDateTime';

/** PATCH body for Unscheduled “Do now” (same window as Voice do-now). */
export function buildDoNowPatch(
  timeZone: string,
  now: Date = new Date(),
): UpdateTaskDTO {
  const nowIso = now.toISOString();
  const ymd = localYmd(nowIso, timeZone);
  const { end } = civilDayStartEndIso(ymd, timeZone);
  return {
    isUnscheduled: false,
    earliestStartTime: nowIso,
    deadline: end,
    scheduledStartTime: null,
    scheduledEndTime: null,
  };
}
