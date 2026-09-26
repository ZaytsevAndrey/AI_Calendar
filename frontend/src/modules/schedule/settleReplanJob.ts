import {
  emitScheduleConflicts,
  notifyScheduleJobSettled,
  type SchedulingConflictDTO,
} from './conflictChoiceBus';
import { waitForScheduleJob, type ScheduleJobStatusResponse } from 'api/schedule.api';

function conflictsFromJobResult(result: unknown): SchedulingConflictDTO[] {
  if (!result || typeof result !== 'object') return [];
  const conflicts = (result as { conflicts?: unknown }).conflicts;
  return Array.isArray(conflicts) ? (conflicts as SchedulingConflictDTO[]) : [];
}

export function recurringMovedNamesFromJobResult(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const warnings = (result as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  const names: string[] = [];
  for (const raw of warnings) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as { code?: unknown; taskName?: unknown; message?: unknown };
    if (w.code !== 'SCHEDULING_RECURRING_MOVED') continue;
    if (typeof w.taskName === 'string' && w.taskName.trim()) {
      names.push(w.taskName.trim());
    } else if (typeof w.message === 'string' && w.message.trim()) {
      names.push(w.message.trim());
    }
  }
  return names;
}

/** Poll a silent replan job: open conflict sheet and report recurring moves. */
export async function settleReplanJob(
  jobId: string | null | undefined,
): Promise<{ recurringMoved: string[] }> {
  if (!jobId) {
    notifyScheduleJobSettled();
    return { recurringMoved: [] };
  }
  try {
    const job: ScheduleJobStatusResponse = await waitForScheduleJob(jobId);
    emitScheduleConflicts(conflictsFromJobResult(job.result));
    return { recurringMoved: recurringMovedNamesFromJobResult(job.result) };
  } catch {
    notifyScheduleJobSettled();
    return { recurringMoved: [] };
  }
}
