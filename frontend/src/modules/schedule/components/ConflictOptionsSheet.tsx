import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'api/axios';
import {
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import type { SkipOccurrenceDTO, UpdateTaskDTO } from 'api/tasks.api';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { applyConflictOption } from '../applyConflictOption';
import {
  openVoiceForConflictChoice,
  type ConflictOptionId,
  type SchedulingConflictDTO,
} from '../conflictChoiceBus';

type Phrase = { id: ConflictOptionId; title: string; detail: string };

type Props = {
  conflict: SchedulingConflictDTO | null;
  onClose: (resolved: boolean) => void;
};

function i18nPhrases(
  conflict: SchedulingConflictDTO,
  t: (key: string) => string,
): Phrase[] {
  return conflict.options.map((id) => ({
    id,
    title: t(`schedule.conflictOption.${id}.title`),
    detail: t(`schedule.conflictOption.${id}.detail`),
  }));
}

export function ConflictOptionsSheet({ conflict, onClose }: Props) {
  const { t } = useTranslation();
  const [updateEvent] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [busyId, setBusyId] = useState<ConflictOptionId | null>(null);

  useEffect(() => {
    if (!conflict) {
      setPhrases([]);
      return;
    }
    const local = i18nPhrases(conflict, t);
    setPhrases(local);
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.post<{ options: Phrase[] }>(
          '/schedule/conflict-option-phrases',
          conflict,
        );
        if (!cancelled && Array.isArray(data?.options) && data.options.length) {
          setPhrases(data.options);
        }
      } catch {
        /* keep i18n templates */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conflict, t]);

  if (!conflict) return null;

  const pick = async (optionId: ConflictOptionId) => {
    setBusyId(optionId);
    try {
      await applyConflictOption(conflict, optionId, {
        updateTask: (id: string, body: UpdateTaskDTO) =>
          updateEvent({ id, body }).unwrap(),
        skipOccurrence: (id: string, body: SkipOccurrenceDTO) =>
          skipOccurrence({ id, body }).unwrap(),
      });
      showSuccessToast({ title: t('schedule.conflictApplied') });
      onClose(true);
    } catch (e) {
      showErrorToast({
        title: t('schedule.conflictApplyFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async () => {
    setBusyId('leave_problematic');
    try {
      await applyConflictOption(conflict, 'leave_problematic', {
        updateTask: (id: string, body: UpdateTaskDTO) =>
          updateEvent({ id, body }).unwrap(),
        skipOccurrence: (id: string, body: SkipOccurrenceDTO) =>
          skipOccurrence({ id, body }).unwrap(),
      });
      onClose(true);
    } catch (e) {
      showErrorToast({
        title: t('schedule.conflictApplyFailed'),
        detail: extractApiErrorMessage(e),
      });
      onClose(false);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      open={!!conflict}
      onClose={() => void dismiss()}
      title={t('schedule.conflictTitle')}
      maxWidthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            className="ui-btn-secondary"
            disabled={!!busyId}
            onClick={() => openVoiceForConflictChoice()}
          >
            {t('schedule.conflictAnswerVoice')}
          </button>
          <button
            type="button"
            className="ui-btn-ghost"
            disabled={!!busyId}
            onClick={() => void dismiss()}
          >
            {t('schedule.conflictDismiss')}
          </button>
        </>
      }
    >
      <p className="mb-1 text-sm font-medium text-ide-text">{conflict.taskName}</p>
      <p className="mb-4 text-sm text-ide-muted">{t('schedule.conflictIntro')}</p>
      <ul className="flex flex-col gap-2">
        {phrases.map((phrase) => (
          <li key={phrase.id}>
            <button
              type="button"
              className="w-full rounded-lg border border-ide-border bg-ide-surface px-3 py-3 text-left hover:bg-ide-selection/40"
              disabled={!!busyId}
              onClick={() => void pick(phrase.id)}
            >
              <span className="block text-sm font-medium text-ide-text">{phrase.title}</span>
              {phrase.detail ? (
                <span className="mt-0.5 block text-xs text-ide-muted">{phrase.detail}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
