import i18n from 'i18next';
import { toast, type Id } from 'react-toastify';
import React from 'react';

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
  /** Also tint these calendar event ids (series instances). */
  relatedKeys?: string[];
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
}

export function getTaskMutationStage(key: string | null | undefined): MutationStage | null {
  if (!key) return null;
  return stageByKey.get(key) ?? null;
}

export function subscribeTaskMutationStages(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const STAGE_CLASS: Record<MutationStage, string> = {
  saving: 'app-toast-stage-saving',
  placing: 'app-toast-stage-placing',
  syncing: 'app-toast-stage-syncing',
  done: 'app-toast-stage-done',
  error: 'app-toast-stage-error',
};

/** Overlay colors for calendar blocks (match toast stages). */
export const MUTATION_STAGE_COLORS: Record<MutationStage, string> = {
  saving: '#bbb529',
  placing: '#589df6',
  syncing: '#a78bfa',
  done: '#4e9f4e',
  error: '#bc3f3c',
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
  /** Point tint at the real task id after a temp optimistic id. */
  retarget: (nextKey: string) => void;
  finish: (detail?: string) => void;
  fail: (detail?: string) => void;
  /** Clear toast + tint without an error (e.g. user cancelled series scope). */
  dismiss: () => void;
};

export function startTaskMutationProgress(
  opts: TaskMutationProgressOptions,
): TaskMutationProgressHandle {
  let taskKey = opts.taskKey;
  let keys = allKeys(taskKey, opts.relatedKeys);
  let stage: MutationStage = 'saving';
  const toastId: Id = `task-mutation-${opts.taskKey}-${Date.now()}`;
  let started = false;

  const render = (next: MutationStage, detail?: string) => {
    const content = React.createElement(ToastBody, {
      title: opts.title,
      detail: detail?.trim() || stageLabel(next),
    });
    const className = STAGE_CLASS[next];
    if (!started) {
      started = true;
      toast(content, {
        toastId,
        autoClose: false,
        closeOnClick: false,
        draggable: false,
        className,
      });
    } else {
      toast.update(toastId, {
        render: content,
        className,
        autoClose: next === 'done' ? 2200 : next === 'error' ? 5000 : false,
        closeOnClick: next === 'done' || next === 'error',
      });
    }
  };

  const setStage = (next: MutationStage) => {
    stage = next;
    setKeysStage(keys, next);
    render(next);
  };

  setStage('saving');

  return {
    setStage,
    retarget: (nextKey: string) => {
      if (!nextKey || nextKey === taskKey) return;
      setKeysStage(keys, null);
      taskKey = nextKey;
      keys = allKeys(taskKey, opts.relatedKeys);
      setKeysStage(keys, stage);
    },
    finish: (detail?: string) => {
      stage = 'done';
      setKeysStage(keys, 'done');
      render('done', detail);
      window.setTimeout(() => setKeysStage(keys, null), 2400);
    },
    fail: (detail?: string) => {
      stage = 'error';
      setKeysStage(keys, 'error');
      render('error', detail);
      window.setTimeout(() => setKeysStage(keys, null), 5200);
    },
    dismiss: () => {
      setKeysStage(keys, null);
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
  },
): Promise<T> {
  const progress = startTaskMutationProgress(opts);
  try {
    const result = await opts.run(progress);
    progress.finish();
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
