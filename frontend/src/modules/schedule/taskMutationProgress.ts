import i18n from 'i18next';
import { toast, type Id } from 'react-toastify';
import React from 'react';
import {
  noteMotionStage,
  setMotionStageSource,
  trackMotion,
  type MotionFrom,
  type MotionKind,
} from '../calendar/motion/cardMotion';

export type MutationStage =
  | 'saving'
  | 'placing'
  | 'syncing'
  | 'done'
  | 'error';

export type TaskMutationProgressOptions = {
  /** Stable id for toast + calendar tint (task id, temp id, or google event id). */
  taskKey: string;
  title: string;
  /** Also mark these calendar event ids (series instances). */
  relatedKeys?: string[];
  /**
   * How the card animates (see calendar/motion). Defaults to an edit; `false`
   * when the caller drives the motion itself.
   */
  motion?: { kind?: MotionKind; from?: MotionFrom; targetMs?: number } | false;
};

type Listener = () => void;

const stageByKey = new Map<string, MutationStage>();
const listeners = new Set<Listener>();
let stagesEpoch = 0;

function notify() {
  stagesEpoch += 1;
  for (const cb of listeners) cb();
}

/** Changes whenever any mutation stage map entry changes (for useSyncExternalStore). */
export function getTaskMutationStagesEpoch(): number {
  return stagesEpoch;
}

function setKeysStage(keys: string[], stage: MutationStage | null) {
  for (const key of keys) {
    if (!key) continue;
    if (stage === null) stageByKey.delete(key);
    else stageByKey.set(key, stage);
  }
  notify();
  noteMotionStage();
}

export function getTaskMutationStage(key: string | null | undefined): MutationStage | null {
  if (!key) return null;
  return stageByKey.get(key) ?? null;
}

setMotionStageSource(getTaskMutationStage);

export function subscribeTaskMutationStages(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type FinalStage = Extract<MutationStage, 'done' | 'error'>;

const FINAL_CLASS: Record<FinalStage, string> = {
  done: 'app-toast-stage-done',
  error: 'app-toast-stage-error',
};

function stageLabel(stage: MutationStage): string {
  return i18n.t(`tasks.toast.progress.${stage}`);
}

function ToastBody({ title, detail }: { title: string; detail: string }) {
  return React.createElement(
    'div',
    { className: 'app-toast-body' },
    React.createElement('p', { className: 'app-toast-title' }, title),
    React.createElement('p', { className: 'app-toast-detail' }, detail),
  );
}

function allKeys(taskKey: string, relatedKeys?: string[]): string[] {
  return [taskKey, ...(relatedKeys ?? [])].filter(Boolean);
}

export type TaskMutationProgressHandle = {
  setStage: (stage: MutationStage) => void;
  /** Point the card marks at the real task id after a temp optimistic id. */
  retarget: (nextKey: string) => void;
  finish: (detail?: string) => void;
  fail: (detail?: string) => void;
  /** End without a result toast (e.g. user cancelled series scope). */
  dismiss: () => void;
};

/**
 * Progress of one task write. The card on the calendar shows the stages
 * (calendar/motion); the toast only reports the result.
 */
export function startTaskMutationProgress(
  opts: TaskMutationProgressOptions,
): TaskMutationProgressHandle {
  let taskKey = opts.taskKey;
  let keys = allKeys(taskKey, opts.relatedKeys);
  let stage: MutationStage = 'saving';
  const toastId: Id = `task-mutation-${opts.taskKey}-${Date.now()}`;
  const motion =
    opts.motion === false
      ? null
      : trackMotion({
          keys,
          kind: opts.motion?.kind ?? 'edit',
          from: opts.motion?.from,
          targetMs: opts.motion?.targetMs,
        });

  const report = (next: FinalStage, detail?: string) => {
    toast(
      React.createElement(ToastBody, {
        title: opts.title,
        detail: detail?.trim() || stageLabel(next),
      }),
      {
        toastId,
        className: FINAL_CLASS[next],
        autoClose: next === 'done' ? 2200 : 5000,
        closeOnClick: true,
        draggable: false,
      },
    );
  };

  const setStage = (next: MutationStage) => {
    stage = next;
    setKeysStage(keys, next);
  };

  setStage('saving');

  return {
    setStage,
    retarget: (nextKey: string) => {
      if (!nextKey || nextKey === taskKey) return;
      setKeysStage(keys, null);
      taskKey = nextKey;
      keys = allKeys(taskKey, opts.relatedKeys);
      motion?.addKey(nextKey);
      setKeysStage(keys, stage);
    },
    finish: (detail?: string) => {
      stage = 'done';
      setKeysStage(keys, null);
      motion?.settle('done');
      report('done', detail);
    },
    fail: (detail?: string) => {
      stage = 'error';
      setKeysStage(keys, null);
      motion?.settle('error');
      report('error', detail);
    },
    dismiss: () => {
      setKeysStage(keys, null);
      motion?.settle('cancel');
      toast.dismiss(toastId);
    },
  };
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Starts progress, runs `run`, then finish/fail.
 * Caller advances saving → placing → syncing inside `run`.
 */
export async function runTaskMutationProgress<T>(
  opts: TaskMutationProgressOptions & {
    run: (progress: TaskMutationProgressHandle) => Promise<T>;
    /** Replaces the generic done line. Empty keeps the stage label. */
    doneDetail?: (result: T) => string | undefined;
  },
): Promise<T> {
  const progress = startTaskMutationProgress(opts);
  try {
    const result = await opts.run(progress);
    const detail = opts.doneDetail?.(result)?.trim();
    progress.finish(detail || undefined);
    return result;
  } catch (err) {
    const detail =
      err &&
      typeof err === 'object' &&
      'data' in err &&
      err.data &&
      typeof err.data === 'object' &&
      'message' in err.data &&
      typeof (err.data as { message: unknown }).message === 'string'
        ? (err.data as { message: string }).message
        : err instanceof Error
          ? err.message
          : undefined;
    progress.fail(detail?.trim() || undefined);
    throw err;
  }
}
