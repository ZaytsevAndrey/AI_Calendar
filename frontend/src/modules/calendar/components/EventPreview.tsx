import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import type { SeriesDragScope } from 'modules/schedule/seriesDragChoice';
import { Modal } from 'ui/Modal';
import { formatDateTimeRange, joinToastDetail } from 'utils/formatDate';
import i18n from 'i18n';
import { eventEndDate, eventStartDate } from '../calendarView';
import {
  planEventPreviewDelete,
  planEventPreviewEdit,
} from '../planEventPreviewActions';
import { SeriesScopeMenu } from './SeriesScopeMenu';

const DESCRIPTION_MAX = 280;

type Props = {
  open: boolean;
  event: GoogleCalendarEvent | null;
  task: TaskDTO | null;
  onClose: () => void;
  onEdit: (scope?: SeriesDragScope) => void;
  onDelete: (scope?: SeriesDragScope) => void;
  busy?: boolean;
};

function recurrenceHint(
  task: TaskDTO | null,
  event: GoogleCalendarEvent,
): string | undefined {
  if (task?.isRecurring) {
    const pattern = (task.recurrencePattern || '').toUpperCase();
    switch (pattern) {
      case 'DAILY':
        return i18n.t('tasks.item.repeatsDaily');
      case 'WEEKLY':
        return i18n.t('tasks.item.repeatsWeekly');
      case 'MONTHLY':
        return i18n.t('tasks.item.repeatsMonthly');
      default:
        return i18n.t('tasks.item.repeats');
    }
  }
  if (event.recurringEventId) {
    return i18n.t('calendar.recurring');
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function EventPreview({
  open,
  event,
  task,
  onClose,
  onEdit,
  onDelete,
  busy = false,
}: Props) {
  const { t } = useTranslation();

  const title = useMemo(() => {
    if (!event) return '';
    return (
      task?.name?.trim() ||
      event.summary?.trim() ||
      t('calendar.untitledEvent')
    );
  }, [event, task, t]);

  const timeLabel = useMemo(() => {
    if (!event) return null;
    const start = eventStartDate(event);
    const end = eventEndDate(event);
    return (
      formatDateTimeRange(
        start?.toISOString() ?? null,
        end?.toISOString() ?? null,
      ) || t('calendar.timeNotSet')
    );
  }, [event, t]);

  const description = useMemo(() => {
    const raw = (task?.description || event?.description || '').trim();
    if (!raw) return null;
    return truncate(raw, DESCRIPTION_MAX);
  }, [event, task]);

  const location = useMemo(() => {
    const raw = (task?.location || event?.location || '').trim();
    return raw || null;
  }, [event, task]);

  const repeats = event ? recurrenceHint(task, event) : undefined;

  const editPlan = planEventPreviewEdit({
    taskIsRecurring: task?.isRecurring,
    recurringEventId: event?.recurringEventId,
  });
  const deletePlan = planEventPreviewDelete({
    hasLinkedTask: Boolean(task),
    taskIsRecurring: task?.isRecurring,
    recurringEventId: event?.recurringEventId,
  });

  const metaLine = joinToastDetail(repeats);

  return (
    <Modal
      open={open && !!event}
      onClose={onClose}
      title={t('calendar.preview.title')}
      maxWidthClass="max-w-lg"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {deletePlan === 'series_menu' ? (
            <SeriesScopeMenu
              label={t('common.delete')}
              variant="danger"
              disabled={busy}
              menuAlign="left"
              onChoose={(scope) => onDelete(scope)}
            />
          ) : (
            <button
              type="button"
              className="ui-btn-danger w-full sm:w-auto"
              disabled={busy}
              onClick={() => onDelete()}
            >
              {t('common.delete')}
            </button>
          )}
          {editPlan === 'series_menu' ? (
            <SeriesScopeMenu
              label={t('common.edit')}
              variant="secondary"
              disabled={busy}
              onChoose={(scope) => onEdit(scope)}
            />
          ) : (
            <button
              type="button"
              className="ui-btn-primary w-full sm:w-auto"
              disabled={busy}
              onClick={() => onEdit()}
            >
              {t('common.edit')}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-ide-text">{title}</h2>
        <p className="text-sm text-ide-muted">{timeLabel}</p>
        {metaLine ? (
          <p className="text-sm text-ide-muted">{metaLine}</p>
        ) : null}
        {location ? (
          <p className="text-sm text-ide-text">
            {t('calendar.locationPrefix', { location })}
          </p>
        ) : null}
        {description ? (
          <p className="whitespace-pre-wrap text-sm text-ide-text">{description}</p>
        ) : null}
      </div>
    </Modal>
  );
}
