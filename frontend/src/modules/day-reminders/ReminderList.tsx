import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { ActionMenu } from 'ui/ActionMenu';
import { cx } from 'ui/cx';
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
import { overdueDayCount } from './overdue';

const iconBtn =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ide-muted transition hover:bg-ide-elevated hover:text-ide-text disabled:opacity-50 md:h-8 md:w-8';

type ReminderListProps = {
  /** `due` is today and overdue. `all` is every open reminder. */
  scope: 'due' | 'all';
  onEdit: (reminder: DayReminderDTO) => void;
  /** Inside the «Сьогодні» panel, which draws its own section header. */
  headless?: boolean;
};

export function ReminderList({ scope, onEdit, headless = false }: ReminderListProps) {
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
      {headless ? null : (
        <div className="flex items-center gap-1.5 text-ide-muted">
          <Bell className="h-4 w-4" aria-hidden />
          <h2 className="text-body-sm font-medium">{t('dayReminders.title')}</h2>
          {visible.length > 0 ? (
            <span className="ml-auto text-body-sm tabular-nums">{visible.length}</span>
          ) : null}
        </div>
      )}
      {isLoading ? (
        <p className="text-body-sm text-ide-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="text-body-sm text-ide-muted">{t('dayReminders.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              today={today}
              busy={busyId === reminder.id}
              onResolve={() => void run(reminder.id, 'resolve')}
              onEdit={() => onEdit(reminder)}
              onDelete={() => removeWithUndo(reminder.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReminderRow({
  reminder,
  today,
  busy,
  onResolve,
  onEdit,
  onDelete,
}: {
  reminder: DayReminderDTO;
  today: string;
  busy: boolean;
  onResolve: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const days = overdueDayCount(reminder.dueYmd, today);
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-control bg-ide-surface pl-1">
      <button
        type="button"
        className={cx(iconBtn, 'group hover:text-ide-accent')}
        disabled={busy}
        aria-label={t('common.done')}
        title={t('common.done')}
        onClick={onResolve}
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-current">
          <Check className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </span>
      </button>
      <button type="button" className="min-w-0 flex-1 py-2 text-left" onClick={onEdit}>
        <span className="block truncate text-body text-ide-text">{reminder.name}</span>
        <span className={cx('block truncate text-caption', days > 0 ? 'text-ide-error' : 'text-ide-muted')}>
          {days > 0
            ? t('dayReminders.overdue', { count: days })
            : reminder.dueYmd === today
              ? t('dayReminders.dueToday')
              : reminder.dueYmd}
        </span>
      </button>
      <button
        ref={moreRef}
        type="button"
        className={iconBtn}
        disabled={busy}
        aria-label={t('common.moreActions')}
        aria-haspopup="menu"
        onClick={() => setMenu(true)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      <ActionMenu
        open={menu}
        onClose={() => setMenu(false)}
        anchorRef={moreRef}
        title={reminder.name}
        items={[
          { id: 'edit', label: t('common.edit'), icon: Pencil, onSelect: onEdit },
          { id: 'delete', label: t('common.delete'), icon: Trash2, danger: true, onSelect: onDelete },
        ]}
      />
    </li>
  );
}

export function reminderGoogleEventIds(reminders: DayReminderDTO[]): Set<string> {
  return new Set(
    reminders
      .map((reminder) => reminder.googleEventId)
      .filter((id): id is string => !!id),
  );
}
