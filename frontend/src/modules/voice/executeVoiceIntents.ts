import type {
  VoiceCommandAction,
  VoiceExecutionReport,
  VoiceIntentExecutionStatus,
  VoiceParsedTask,
  VoiceWriteIntent,
} from 'api/voice.api';
import type { UpdateTaskDTO } from 'api/tasks.api';
import { executeVoiceCommand } from './executeVoiceCommand';
import {
  waitForScheduleConflict,
  type SchedulingConflictDTO,
} from 'modules/schedule/conflictChoiceBus';

type Mutation<T> = (arg: T) => { unwrap: () => Promise<unknown> };

type ExecuteDeps = {
  updateTask: Mutation<{ id: string; body: UpdateTaskDTO }>;
  skipOccurrence: Mutation<{ id: string; body: any }>;
  deleteTask: Mutation<string>;
  dispatch: (action: any) => void;
  onCreate: (task: VoiceParsedTask) => Promise<void>;
};

export type ExecuteVoiceIntentsResult = {
  conflict: SchedulingConflictDTO | null;
  /** First failure; intents after it are reported as skipped. */
  error: unknown;
  report: VoiceExecutionReport;
};

/**
 * Run write intents sequentially. Stops at a schedule conflict sheet or the
 * first error; every intent gets a status for the server report and the cards.
 */
export async function executeVoiceIntents(
  intents: VoiceWriteIntent[],
  deps: ExecuteDeps,
): Promise<ExecuteVoiceIntentsResult> {
  const statuses: VoiceIntentExecutionStatus[] = intents.map(() => 'skipped');
  const done = (
    conflict: SchedulingConflictDTO | null,
    error: unknown,
  ): ExecuteVoiceIntentsResult => ({
    conflict,
    error,
    report: {
      results: intents.map((intent, index) => ({
        summary: intent.summary,
        status: statuses[index],
      })),
    },
  });

  for (let index = 0; index < intents.length; index += 1) {
    const intent = intents[index];
    const waitConflict =
      intent.type === 'create' ||
      (intent.command as VoiceCommandAction).kind === 'window'
        ? waitForScheduleConflict(12_000)
        : Promise.resolve(null);
    try {
      if (intent.type === 'create') {
        await deps.onCreate(intent.task as VoiceParsedTask);
      } else {
        await executeVoiceCommand(intent.command as VoiceCommandAction, deps);
      }
    } catch (err) {
      statuses[index] = 'error';
      return done(null, err);
    }
    const conflict = await waitConflict;
    if (conflict) {
      statuses[index] = 'conflict';
      return done(conflict, null);
    }
    statuses[index] = 'applied';
  }
  return done(null, null);
}
