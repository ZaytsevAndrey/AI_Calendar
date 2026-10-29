import type { VoiceWriteIntent } from '../../voice-agent.types';
import type { SemanticOperationV1 } from '../contracts/types';
import type { TargetResolution } from '../reference/reference-resolver';
import type { ResolvedWhen } from '../temporal/temporal-resolver';

/**
 * The preview must still carry the constraints the resolver accepted.
 * A mismatch blocks the operation. It does not invent a replacement.
 */
export function integrityFailure(
  operation: SemanticOperationV1,
  intent: VoiceWriteIntent,
  when: ResolvedWhen[],
  resolution: TargetResolution,
): string | null {
  if (operation.action === 'create' && intent.type === 'create') {
    const task = intent.task;
    const start = typeof task.scheduledStartTime === 'string' ? task.scheduledStartTime : null;
    const end = typeof task.scheduledEndTime === 'string' ? task.scheduledEndTime : null;
    const minutes = typeof task.estimatedTimeInMinutes === 'number' ? task.estimatedTimeInMinutes : null;
    if (operation.constraints.some((constraint) => constraint.kind === 'all_day') && (!start || !end)) return 'lost_all_day';
    if (when.some((row) => row.status === 'preserved') && start && !operation.constraints.some((constraint) => constraint.kind === 'all_day')) return 'invented_time';
    if (operation.constraints.some((constraint) => constraint.kind === 'recurrence') && task.isRecurring !== true) return 'lost_recurrence';
    if (operation.changes.reminder) return 'lost_reminder';
    const duration = when.find((row) => row.status === 'duration');
    if (duration && duration.status === 'duration' && minutes != null && minutes !== duration.minutes) return 'lost_duration';
    const instant = when.find((row) => row.status === 'instant' && row.role === 'start');
    if (instant && instant.status === 'instant' && start && start !== instant.iso) return 'lost_clock';
  }
  if (operation.action === 'delete' && intent.type === 'command') {
    const taskId = typeof intent.command.taskId === 'string' ? intent.command.taskId : '';
    if (resolution.status === 'resolved' && taskId !== resolution.entityId) return 'wrong_target';
  }
  if (intent.type === 'command' && intent.command.kind === 'move') {
    const start = typeof intent.command.scheduledStartTime === 'string' ? intent.command.scheduledStartTime : null;
    const instant = when.find((row) => row.status === 'instant' && (row.role === 'start' || row.role === 'preferred'));
    if (instant && instant.status === 'instant' && start && start !== instant.iso) return 'lost_clock';
  }
  return null;
}
