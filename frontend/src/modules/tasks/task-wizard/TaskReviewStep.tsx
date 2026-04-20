import React from 'react';
import type { UseFormGetValues } from 'react-hook-form';
import type { TaskWizardFormValues } from './schema';
import { buildTaskPayload } from './buildPayload';
import { EVENT_TYPE_OPTIONS, SPLITTABLE_TYPES } from './constants';
import type { PhaseDTO } from '../../../api/phases.api';
import type { TaskEventType } from '../../../api/tasks.api';

type Props = {
  getValues: UseFormGetValues<TaskWizardFormValues>;
  phases: PhaseDTO[];
};

function formatLocal(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export const TaskReviewStep: React.FC<Props> = ({ getValues, phases }) => {
  const values = getValues();
  const payload = buildTaskPayload(values);
  const isFixed = values.eventType === 'fixed';

  const eventLabel =
    EVENT_TYPE_OPTIONS.find((o) => o.value === values.eventType)?.label ?? values.eventType;

  const phaseLabel = values.phaseId
    ? phases.find((p) => p.id === values.phaseId)?.name ?? values.phaseId
    : '';

  const typeAllowsSplit = SPLITTABLE_TYPES.has(values.eventType as TaskEventType);

  const payloadJson = JSON.stringify(payload, null, 2);

  return (
    <div className="space-y-5">
      <p className="text-sm text-ide-muted">
        Confirm details below. The JSON block matches what will be sent to the server.
      </p>
      <dl className="divide-y divide-ide-border rounded-md border border-ide-border text-sm">
        <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="font-medium text-ide-muted">Name</dt>
          <dd className="text-ide-text">{values.name || '—'}</dd>
        </div>
        <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="font-medium text-ide-muted">Description</dt>
          <dd className="whitespace-pre-wrap text-ide-text">{values.description?.trim() || '—'}</dd>
        </div>
        <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="font-medium text-ide-muted">Event type</dt>
          <dd className="text-ide-text">{eventLabel}</dd>
        </div>
        {values.eventType === 'fixed' ? (
          <>
            <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-medium text-ide-muted">Fixed start</dt>
              <dd className="text-ide-text">{formatLocal(values.scheduledStartTime)}</dd>
            </div>
            <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-medium text-ide-muted">Fixed end</dt>
              <dd className="text-ide-text">{formatLocal(values.scheduledEndTime)}</dd>
            </div>
          </>
        ) : null}
        <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="font-medium text-ide-muted">Phase</dt>
          <dd className="text-ide-text">{phaseLabel || 'Any (full day window)'}</dd>
        </div>
        {isFixed ? (
          <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
            <dt className="font-medium text-ide-muted">Deadline</dt>
            <dd className="text-ide-text">{formatLocal(values.deadline)}</dd>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <dt className="font-medium text-ide-muted">Priority</dt>
          <dd className="text-ide-text capitalize">{values.priority ?? '—'}</dd>
        </div>
        {!isFixed ? (
          <>
            <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-medium text-ide-muted">Estimated</dt>
              <dd className="text-ide-text">{values.estimatedTimeInMinutes} minutes</dd>
            </div>
            <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-medium text-ide-muted">Allow split</dt>
              <dd className="text-ide-text">
                {typeAllowsSplit ? (values.allowSplit ? 'Yes' : 'No') : 'N/A for this type'}
              </dd>
            </div>
            <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-medium text-ide-muted">Recurring</dt>
              <dd className="text-ide-text">
                {values.isRecurring
                  ? values.recurrencePattern || '(pattern missing — go back)'
                  : 'No'}
              </dd>
            </div>
            {values.eventType === 'daily_routine' ? (
              <>
                <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
                  <dt className="font-medium text-ide-muted">Preferred start</dt>
                  <dd className="text-ide-text">{values.preferredStartTime?.trim() || '—'}</dd>
                </div>
                <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-4">
                  <dt className="font-medium text-ide-muted">Computed window</dt>
                  <dd className="text-ide-text">
                    {payload.scheduledStartTime && payload.scheduledEndTime
                      ? `${formatLocal(payload.scheduledStartTime)} → ${formatLocal(payload.scheduledEndTime)}`
                      : '— (set a preferred start to preview)'}
                  </dd>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ide-text">Request payload (preview)</h3>
        <pre className="max-h-48 overflow-auto rounded-md border border-ide-border bg-ide-bg p-3 text-xs text-ide-text">
          {payloadJson}
        </pre>
      </div>
    </div>
  );
};
