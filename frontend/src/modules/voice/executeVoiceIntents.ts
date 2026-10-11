import type { VoiceCommandAction, VoiceParsedTask, VoiceWriteIntent } from 'api/voice.api';
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

/**
 * Run write intents sequentially. Stops when a schedule conflict sheet appears.
 */
export async function executeVoiceIntents(
  intents: VoiceWriteIntent[],
  deps: ExecuteDeps,
): Promise<{ conflict: SchedulingConflictDTO | null }> {
  for (const intent of intents) {
    if (intent.type === 'create') {
      const waitConflict = waitForScheduleConflict(12_000);
      await deps.onCreate(intent.task as VoiceParsedTask);
      const conflict = await waitConflict;
      if (conflict) return { conflict };
      continue;
    }
    const command = intent.command as VoiceCommandAction;
    const waitConflict =
      command.kind === 'window' ? waitForScheduleConflict(12_000) : Promise.resolve(null);
    await executeVoiceCommand(command, deps);
    const conflict = await waitConflict;
    if (conflict) return { conflict };
  }
  return { conflict: null };
}
