import { TaskStatus } from '../tasks/entities/task.entity';
import type { VoiceToolContext } from './voice-agent.tools';
import type { DayPlanProposal, VoiceWriteIntent } from './voice-agent.types';
import {
  addDaysToYmd,
  inferDueYmd,
  scheduleTodayYmd,
} from './voice-local-date.util';

/**
 * Seat open unscheduled tasks into free gaps for a civil day (preview only).
 * Apply uses the same window writes the UI would send.
 */
export function buildDayPlanProposal(
  ctx: VoiceToolContext,
  dayRaw: string,
  gapsResult: {
    day: string;
    gaps: Array<{ start: string; end: string; minutes: number }>;
  },
): DayPlanProposal {
  const today = scheduleTodayYmd(
    ctx.nowIso,
    ctx.timeZone,
    ctx.settings.wakeTime,
  );
  const day =
    gapsResult.day ||
    (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw.trim())
      ? dayRaw.trim()
      : inferDueYmd(dayRaw, today) ||
        (/tomorrow|завтра/i.test(dayRaw) ? addDaysToYmd(today, 1) : today));

  const candidates = ctx.tasks
    .filter(
      (task) =>
        task.isUnscheduled &&
        task.status !== TaskStatus.COMPLETED &&
        task.status !== TaskStatus.CANCELED,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const gaps = [...gapsResult.gaps].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const items: DayPlanProposal['items'] = [];
  let gapIndex = 0;
  let gapCursorMs =
    gaps.length > 0 ? new Date(gaps[0].start).getTime() : Number.NaN;

  for (const task of candidates) {
    const duration = Math.max(5, task.estimatedTimeInMinutes || 30);
    while (gapIndex < gaps.length) {
      const gap = gaps[gapIndex];
      const gapEnd = new Date(gap.end).getTime();
      if (Number.isNaN(gapCursorMs)) {
        gapCursorMs = new Date(gap.start).getTime();
      }
      const need = duration * 60_000;
      if (gapCursorMs + need <= gapEnd) {
        const startMs = gapCursorMs;
        const endMs = startMs + need;
        items.push({
          taskId: task.id,
          name: task.name,
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          durationMinutes: duration,
        });
        gapCursorMs = endMs;
        break;
      }
      gapIndex += 1;
      gapCursorMs =
        gapIndex < gaps.length
          ? new Date(gaps[gapIndex].start).getTime()
          : Number.NaN;
    }
  }

  return { day, items };
}

export function dayPlanToIntents(proposal: DayPlanProposal): VoiceWriteIntent[] {
  return proposal.items.map((item) => ({
    type: 'command' as const,
    summary: `Schedule ${item.name}`,
    command: {
      kind: 'window',
      taskId: item.taskId,
      taskName: item.name,
      summary: `Schedule ${item.name}`,
      earliestStartTime: item.start,
      deadline: item.end,
      scheduledStartTime: item.start,
      scheduledEndTime: item.end,
      clearUnscheduled: true,
    },
  }));
}
