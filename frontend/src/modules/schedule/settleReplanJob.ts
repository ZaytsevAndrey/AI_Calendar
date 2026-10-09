import {
  emitScheduleConflicts,
  notifyScheduleJobSettled,
  type SchedulingConflictDTO,
} from './conflictChoiceBus';
import {
  waitForScheduleJob,
  type ScheduleJobStatusResponse,
} from 'api/schedule.api';
import type { MutationStage } from './taskMutationProgress';

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

const STAGE_SET = new Set<MutationStage>([
  'saving',
  'placing',
  'syncing',
  'done',
  'error',
]);

export function mutationStageFromJob(
  job: Pick<ScheduleJobStatusResponse, 'status' | 'progressStage'>,
): MutationStage | null {
  if (job.status === 'failed') return 'error';
  if (job.status === 'done') return 'done';
  const stage = job.progressStage;
  if (stage && STAGE_SET.has(stage as MutationStage)) {
    return stage as MutationStage;
  }
  return null;
}

/** Poll a mutation/replan job: progress stages + conflict sheet + recurring moves. */
export async function settleReplanJob(
  jobId: string | null | undefined,
  onStage?: (stage: MutationStage) => void,
): Promise<{ recurringMoved: string[] }> {
  if (!jobId) {
    notifyScheduleJobSettled();
    return { recurringMoved: [] };
  }
  try {
    const job = await waitForScheduleJob(jobId, 120_000, (snapshot) => {
      const stage = mutationStageFromJob(snapshot);
      if (stage) onStage?.(stage);
    });
    emitScheduleConflicts(conflictsFromJobResult(job.result));
    onStage?.('done');
    return { recurringMoved: recurringMovedNamesFromJobResult(job.result) };
  } catch (err) {
    onStage?.('error');
    notifyScheduleJobSettled();
    throw err;
  }
}
