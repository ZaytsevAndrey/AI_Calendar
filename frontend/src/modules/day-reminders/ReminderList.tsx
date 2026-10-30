import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, Pencil, Trash2 } from 'lucide-react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import {
  type DayReminderDTO,
  useDeleteDayReminderMutation,
  useGetDayRemindersQuery,
  useResolveDayReminderMutation,
} from 'api/dayReminders.api';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { localYmd } from 'utils/ianaDateTime';
import { runWithUndo, showErrorToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import { OVERDUE_ROW_CLASS, overdueDayCount, overdueTone } from './overdue';

const iconBtn = 'ui-icon-btn h-7 w-7 text-ide-muted hover:text-ide-text';

type ReminderListProps = {
  /** `due` is today and overdue. `all` is every open reminder. */
  scope: 'due' | 'all';
  onEdit: (reminder: DayReminderDTO) => void;
};

export function ReminderList({ scope, onEdit }: ReminderListProps) {
  const { t } = useTranslation();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const today = localYmd(new Date().toISOString(), timeZone);
  const { data: reminders = [], isLoading } = useGetDayRemindersQuery();
  const [resolveReminder] = useResolveDayReminderMutation();
  const [deleteReminder] = useDeleteDayReminderMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(() => new Set());

  const visible = reminders.filter((reminder) => {
    if (pendingDelete.has(reminder.id)) return false;
    if (scope === 'all') return true;
    return reminder.dueYmd <= today;
  });

  if (scope === 'due' && visible.length === 0) return null;

  const forget = (id: string) =>
    setPendingDelete((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const removeWithUndo = (id: string) => {
    setPendingDelete((prev) => new Set(prev).add(id));
    runWithUndo({
      title: t('dayReminders.deleted'),
      undoLabel: t('common.undo'),
      onUndo: () => forget(id),
      commit: async () => {
        await run(id, 'delete');
        forget(id);
      },
    });
  };

  const run = async (id: string, action: 'resolve' | 'delete') => {
    setBusyId(id);
    try {
      if (action === 'resolve') await resolveReminder(id).unwrap();
      else await deleteReminder(id).unwrap();
    } catch (err) {
      showErrorToast({
        title: action === 'resolve' ? t('dayReminders.resolveFailed') : t('dayReminders.deleteFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-ide-warn">
        <Bell className="h-3.5 w-3.5" aria-hidden />
        <h2 className="text-xs font-medium uppercase tracking-wide">{t('dayReminders.title')}</h2>
        {visible.length > 0 ? (
          <span className="ml-auto text-xs font-normal normal-case tracking-normal opacity-70">
            {visible.length}
          </span>
        ) : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-ide-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ide-muted">{t('dayReminders.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((reminder) => {
            const days = overdueDayCount(reminder.dueYmd, today);
            const tone = overdueTone(days);
            const busy = busyId === reminder.id;
            return (
              <li
                key={reminder.id}
                className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 ${OVERDUE_ROW_CLASS[tone]}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm text-ide-text"
                  onClick={() => onEdit(reminder)}
                >
                  <span className="block truncate">{reminder.name}</span>
                  <span className="block truncate text-xs text-ide-muted">
                    {days > 0
                      ? t('dayReminders.overdue', { count: days })
                      : reminder.dueYmd === today
                        ? t('dayReminders.dueToday')
                        : reminder.dueYmd}
                  </span>
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={busy}
                  aria-label={t('common.done')}
                  title={t('common.done')}
                  onClick={() => void run(reminder.id, 'resolve')}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={busy}
                  aria-label={t('common.edit')}
                  title={t('common.edit')}
                  onClick={() => onEdit(reminder)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={busy}
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  onClick={() => removeWithUndo(reminder.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function reminderGoogleEventIds(reminders: DayReminderDTO[]): Set<string> {
  return new Set(
    reminders
      .map((reminder) => reminder.googleEventId)
      .filter((id): id is string => !!id),
  );
}
