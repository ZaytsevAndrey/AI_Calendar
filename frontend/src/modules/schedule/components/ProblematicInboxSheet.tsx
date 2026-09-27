import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDTO } from 'api/tasks.api';
import {
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { formatMinutes } from '../../../utils/formatDate';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

type Props = {
  open: boolean;
  tasks: TaskDTO[];
  onClose: () => void;
  onOpenTask: (task: TaskDTO) => void;
};

type ActionId = 'open' | 'move' | 'skip' | 'resolve';

function taskMeta(task: TaskDTO, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const parts: string[] = [];
  if (task.isRecurring) parts.push(t('tasks.item.repeats'));
  if (task.estimatedTimeInMinutes && task.estimatedTimeInMinutes > 0) {
    parts.push(formatMinutes(task.estimatedTimeInMinutes));
  }
  return parts.join(' · ');
}

export function ProblematicInboxSheet({
  open,
  tasks,
  onClose,
  onOpenTask,
}: Props) {
  const { t } = useTranslation();
  const [updateEvent] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const resolve = async (task: TaskDTO) => {
    setBusyKey(`${task.id}:resolve`);
    try {
      await updateEvent({
        id: task.id,
        body: { isProblematic: false },
      }).unwrap();
      showSuccessToast({ title: t('schedule.problematicResolved') });
    } catch (e) {
      showErrorToast({
        title: t('schedule.problematicActionFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const skip = async (task: TaskDTO) => {
    setBusyKey(`${task.id}:skip`);
    try {
      const at = task.scheduledStartTime ?? new Date().toISOString();
      await skipOccurrence({
        id: task.id,
        body: { occurrenceStart: at },
      }).unwrap();
      await updateEvent({
        id: task.id,
        body: { isProblematic: false },
      }).unwrap();
      showSuccessToast({ title: t('schedule.problematicSkipped') });
    } catch (e) {
      showErrorToast({
        title: t('schedule.problematicActionFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const openTask = (task: TaskDTO, action: ActionId) => {
    setBusyKey(`${task.id}:${action}`);
    onOpenTask(task);
    onClose();
    setBusyKey(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('schedule.problematicTitle')}
      maxWidthClass="max-w-md"
      footer={
        <button
          type="button"
          className="ui-btn-secondary w-full sm:w-auto"
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">{t('schedule.problematicIntro')}</p>
      {tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-ide-muted">
          {t('schedule.problematicEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {tasks.map((task) => {
            const rowBusy = busyKey?.startsWith(`${task.id}:`) ?? false;
            const meta = taskMeta(task, t);
            const actions: Array<{
              id: ActionId;
              title: string;
              detail: string;
              onClick: () => void;
              primary?: boolean;
              show: boolean;
            }> = [
              {
                id: 'open',
                title: t('schedule.problematicOpen'),
                detail: t('schedule.problematicOpenDetail'),
                onClick: () => openTask(task, 'open'),
                show: true,
              },
              {
                id: 'move',
                title: t('schedule.problematicMove'),
                detail: t('schedule.problematicMoveDetail'),
                onClick: () => openTask(task, 'move'),
                show: true,
              },
              {
                id: 'skip',
                title: t('schedule.problematicSkip'),
                detail: t('schedule.problematicSkipDetail'),
                onClick: () => void skip(task),
                show: Boolean(task.isRecurring),
              },
              {
                id: 'resolve',
                title: t('schedule.problematicResolve'),
                detail: t('schedule.problematicResolveDetail'),
                onClick: () => void resolve(task),
                primary: true,
                show: true,
              },
            ];

            return (
              <li
                key={task.id}
                className="rounded-lg border border-ide-border bg-ide-surface"
                aria-busy={rowBusy}
              >
                <div className="border-b border-ide-border px-3 py-3">
                  <p className="text-sm font-medium text-ide-text">{task.name}</p>
                  {meta ? (
                    <p className="mt-0.5 text-xs text-ide-muted">{meta}</p>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-0 divide-y divide-ide-border">
                  {actions
                    .filter((action) => action.show)
                    .map((action) => {
                      const thisBusy = busyKey === `${task.id}:${action.id}`;
                      return (
                        <li key={action.id}>
                          <button
                            type="button"
                            className={`flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-ide-selection/40 disabled:opacity-60 ${
                              action.primary ? 'bg-ide-selection/15' : ''
                            }`}
                            disabled={rowBusy}
                            onClick={action.onClick}
                          >
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block text-sm font-medium ${
                                  action.primary ? 'text-ide-link' : 'text-ide-text'
                                }`}
                              >
                                {action.title}
                              </span>
                              <span className="mt-0.5 block text-xs text-ide-muted">
                                {action.detail}
                              </span>
                            </span>
                            {thisBusy ? (
                              <Spinner className="mt-0.5 h-4 w-4 shrink-0" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
