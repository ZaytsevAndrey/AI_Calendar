import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScheduleJobResultPayload } from 'api/schedule.api';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { describeScheduleMove, previewMessages } from '../generatePreview';

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  result: ScheduleJobResultPayload | null;
  onCancel: () => void;
  onApply: () => void;
};

export function GeneratePreviewDialog({
  open,
  loading,
  error,
  result,
  onCancel,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const messages = result ? previewMessages(result) : { errors: [], warnings: [] };
  const moves = result?.diff ?? [];
  const canApply = Boolean(result) && !loading && !error;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('schedule.previewTitle')}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn-secondary w-full sm:w-auto"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            className="ui-btn-primary w-full sm:w-auto"
          >
            {t('schedule.applyGenerate')}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-3 text-sm text-ide-muted">
          <Spinner className="h-4 w-4" />
          {t('schedule.checkingChanges')}
        </div>
      ) : null}
      {error ? <p className="text-sm text-ide-error">{error}</p> : null}
      {result ? (
        <div className="space-y-4">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ide-text">{t('schedule.whatWillMove')}</h2>
            {moves.length === 0 ? (
              <p className="text-sm text-ide-muted">{t('schedule.nothingWillMove')}</p>
            ) : (
              <ul className="space-y-2">
                {moves.map((item) => (
                  <li key={item.taskId} className="text-sm text-ide-text">
                    <span className="font-medium">{item.taskName}</span>
                    <span className="mt-0.5 block text-ide-muted">
                      {describeScheduleMove(item)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ide-text">{t('schedule.fit')}</h2>
            {messages.errors.length === 0 && messages.warnings.length === 0 ? (
              <p className="text-sm text-ide-muted">{t('schedule.everythingFits')}</p>
            ) : (
              <>
                {messages.errors.length > 0 ? (
                  <ul className="mb-2 list-inside list-disc text-sm text-ide-error">
                    {messages.errors.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                ) : null}
                {messages.warnings.length > 0 ? (
                  <ul className="list-inside list-disc text-sm text-ide-warn">
                    {messages.warnings.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>
          <p className="text-xs text-ide-muted">{t('schedule.applyHint')}</p>
        </div>
      ) : null}
    </Modal>
  );
}
