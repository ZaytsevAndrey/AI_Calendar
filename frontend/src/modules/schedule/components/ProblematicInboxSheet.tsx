import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDTO } from 'api/tasks.api';
import {
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

type Props = {
  open: boolean;
  tasks: TaskDTO[];
  onClose: () => void;
  onOpenTask: (task: TaskDTO) => void;
};

export function ProblematicInboxSheet({
  open,
  tasks,
  onClose,
  onOpenTask,
}: Props) {
  const { t } = useTranslation();
  const [updateEvent] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const resolve = async (task: TaskDTO) => {
    setBusyId(task.id);
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
      setBusyId(null);
    }
  };

  const skip = async (task: TaskDTO) => {
    setBusyId(task.id);
    try {
      const at =
        task.scheduledStartTime ?? new Date().toISOString();
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
      setBusyId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('schedule.problematicTitle')}
      maxWidthClass="max-w-md"
      footer={
        <button type="button" className="ui-btn-ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">{t('schedule.problematicIntro')}</p>
      {tasks.length === 0 ? (
        <p className="text-sm text-ide-muted">{t('schedule.problematicEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => {
            const busy = busyId === task.id;
            return (
              <li
                key={task.id}
                className="rounded-lg border border-ide-border bg-ide-surface px-3 py-3"
              >
                <div className="mb-2 font-medium text-ide-text">{task.name}</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="ui-btn-secondary text-sm"
                    disabled={busy}
                    onClick={() => {
                      onOpenTask(task);
                      onClose();
                    }}
                  >
                    {t('schedule.problematicOpen')}
                  </button>
                  <button
                    type="button"
                    className="ui-btn-secondary text-sm"
                    disabled={busy}
                    onClick={() => {
                      onOpenTask(task);
                      onClose();
                    }}
                  >
                    {t('schedule.problematicMove')}
                  </button>
                  {task.isRecurring ? (
                    <button
                      type="button"
                      className="ui-btn-ghost text-sm"
                      disabled={busy}
                      onClick={() => void skip(task)}
                    >
                      {t('schedule.problematicSkip')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ui-btn-primary text-sm"
                    disabled={busy}
                    onClick={() => void resolve(task)}
                  >
                    {t('schedule.problematicResolve')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
