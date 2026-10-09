import { useSyncExternalStore } from 'react';
import {
  getTaskMutationStage,
  getTaskMutationStagesEpoch,
  subscribeTaskMutationStages,
  type MutationStage,
} from './taskMutationProgress';

/** Re-render when any task mutation stage changes. */
export function useTaskMutationStagesTick(): number {
  return useSyncExternalStore(
    subscribeTaskMutationStages,
    getTaskMutationStagesEpoch,
    () => 0,
  );
}

/** Latest mutation stage for a calendar/task id (or null). */
export function useTaskMutationStage(
  ...keys: Array<string | null | undefined>
): MutationStage | null {
  useTaskMutationStagesTick();
  for (const key of keys) {
    const stage = getTaskMutationStage(key);
    if (stage) return stage;
  }
  return null;
}
