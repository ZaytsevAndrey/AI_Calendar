import React from 'react';
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
  const messages = result ? previewMessages(result) : { errors: [], warnings: [] };
  const moves = result?.diff ?? [];
  const canApply = Boolean(result) && !loading && !error;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Generate preview"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn-secondary w-full sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            className="ui-btn-primary w-full sm:w-auto"
          >
            Apply generate
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-3 text-sm text-ide-muted">
          <Spinner className="h-4 w-4" />
          Checking what will change…
        </div>
      ) : null}
      {error ? <p className="text-sm text-ide-error">{error}</p> : null}
      {result ? (
        <div className="space-y-4">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ide-text">What will move</h2>
            {moves.length === 0 ? (
              <p className="text-sm text-ide-muted">Nothing will move.</p>
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
            <h2 className="mb-2 text-sm font-semibold text-ide-text">Fit</h2>
            {messages.errors.length === 0 && messages.warnings.length === 0 ? (
              <p className="text-sm text-ide-muted">Everything fits in the planning window.</p>
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
          <p className="text-xs text-ide-muted">
            Apply runs Generate from the current tasks. Cancel leaves the calendar unchanged.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
