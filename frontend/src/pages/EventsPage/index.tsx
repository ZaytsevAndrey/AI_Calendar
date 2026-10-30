import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { cx } from 'ui/cx';
import { ListSkeleton } from 'ui/ListSkeleton';
import { localYmd } from 'utils/ianaDateTime';
import { useGetDayRemindersQuery } from 'api/dayReminders.api';
import { MoveOccurrenceSheet } from 'modules/schedule/components/MoveOccurrenceSheet';
import { useTranslation } from 'react-i18next';
import { useGetEventsQuery, useDeleteEventMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import EventList from 'modules/events/components/EventList';
import TaskSectionFilters from 'modules/events/components/TaskSectionFilters';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { buildDoNowPatch } from 'modules/events/unscheduledActions';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { SeriesDragHost } from 'modules/schedule/components/SeriesDragHost';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { useVoiceLauncher } from 'modules/voice/voiceLauncher';
import { setConflictVoiceOpener } from 'modules/schedule/conflictChoiceBus';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import {
  filterScheduledTasks,
  filterUnscheduledTasks,
  matchesTaskName,
  type ScheduleModeFilter,
  type TaskStatusFilter,
} from 'modules/events/utils/taskListFilters';
import { Modal } from '../../ui/Modal';
import { showErrorToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';
import type { TaskDTO } from 'api/tasks.api';
import { ReminderList } from 'modules/day-reminders/ReminderList';

type Priority = 'urgent' | 'high' | 'medium' | 'low';
type TasksTab = 'scheduled' | 'later' | 'reminders' | 'done';
const isTasksTab = (value: string | null): boolean =>
  value === 'scheduled' || value === 'later' || value === 'reminders' || value === 'done';
type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function sortTasks(list: TaskDTO[], sortField: SortField): TaskDTO[] {
  return [...list].sort((a, b) => {
    switch (sortField) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      case 'deadline': {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      case 'estimatedTimeInMinutes':
        return a.estimatedTimeInMinutes - b.estimatedTimeInMinutes;
      default:
        return 0;
    }
  });
}

function sortUnscheduled(list: TaskDTO[]): TaskDTO[] {
  return [...list].sort((a, b) => {
    const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priority !== 0) return priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

const TasksPage: React.FC = () => {
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<SortField>('deadline');
  const [filterStatus, setFilterStatus] = useState<TaskStatusFilter>('active');
  const [scheduledQuery, setScheduledQuery] = useState('');
  const [phaseId, setPhaseId] = useState('any');
  const [scheduleMode, setScheduleMode] = useState<ScheduleModeFilter>('any');
  const [scheduledOverdue, setScheduledOverdue] = useState(false);
  const [inboxQuery, setInboxQuery] = useState('');
  const [inboxStatus, setInboxStatus] = useState<TaskStatusFilter>('active');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    ids: string[];
    name: string;
    group: boolean;
  }>({
    open: false,
    ids: [],
    name: '',
    group: false,
  });
  const phone = usePhoneLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TasksTab = isTasksTab(searchParams.get('tab')) ? (searchParams.get('tab') as TasksTab) : 'scheduled';
  const setTab = (next: TasksTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'scheduled') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [laterTarget, setLaterTarget] = useState<{ task: TaskDTO; occurrenceYmd: string } | null>(null);
  const { data: dayReminders = [] } = useGetDayRemindersQuery();

  const { data: events = [], isLoading: isLoadingEvents } = useGetEventsQuery();
  const { data: phases = [] } = useGetAllPhasesQuery();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const todayYmd = localYmd(new Date().toISOString(), timeZone);
  const [deleteEvent] = useDeleteEventMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { openCreate, openCreateFromPrefill, openEdit, openEditReminder, openSchedule, createFromPayload, editorModal } =
    useEventEditor();
  const voice = useVoiceTask({
    onComplete: createFromPayload,
    onSufficient: openCreateFromPrefill,
  });
  useVoiceLauncher(voice.open);
  useEffect(() => {
    setConflictVoiceOpener(() => voice.open());
    return () => setConflictVoiceOpener(null);
  }, [voice.open]);

  const scheduledFilters = {
    query: scheduledQuery,
    status: filterStatus,
    overdueOnly: scheduledOverdue,
    phaseId,
    mode: scheduleMode,
  };
  const inboxFilters = {
    query: inboxQuery,
    status: inboxStatus,
    overdueOnly: false,
  };
  const sortedEvents = sortTasks(filterScheduledTasks(events, scheduledFilters), sortField);

  const markDone = (task: TaskDTO) => {
    setBusyId(task.id);
    void updateEvent({ id: task.id, body: { status: 'completed' } })
      .unwrap()
      .catch((err) => {
        showErrorToast({
          title: t('tasks.completeFailed'),
          detail: extractApiErrorMessage(err),
        });
      })
      .finally(() => setBusyId(null));
  };

  const markSkipped = (task: TaskDTO) => {
    setBusyId(task.id);
    void updateEvent({ id: task.id, body: { status: 'canceled' } })
      .unwrap()
      .catch((err) => {
        showErrorToast({
          title: t('tasks.skipFailed'),
          detail: extractApiErrorMessage(err),
        });
      })
      .finally(() => setBusyId(null));
  };

  const doNow = (task: TaskDTO) => {
    setBusyId(task.id);
    void updateEvent({ id: task.id, body: buildDoNowPatch(timeZone) })
      .unwrap()
      .catch((err) => {
        showErrorToast({
          title: t('tasks.doNowFailed'),
          detail: extractApiErrorMessage(err),
        });
      })
      .finally(() => setBusyId(null));
  };

  const requestDelete = (id: string) => {
    const task = events.find((item) => item.id === id);
    setDeleteConfirm({
      open: true,
      ids: [id],
      name: task?.name || t('tasks.thisTask'),
      group: false,
    });
  };

  const deleteIds = (ids: string[]) => {
    if (ids.length === 0) return;
    void (async () => {
      try {
        for (const id of ids) {
          await deleteEvent(id).unwrap();
        }
      } catch (err) {
        showErrorToast({
          title: t('tasks.deleteFailed'),
          detail: extractApiErrorMessage(err),
        });
      }
    })();
  };

  // Series group parent Delete: remove every member with no confirm step.
  const requestDeleteGroup = (ids: string[]) => {
    deleteIds(ids);
  };

  const confirmDelete = () => {
    if (deleteConfirm.ids.length === 0) return;
    const ids = deleteConfirm.ids;
    setDeleteConfirm({ open: false, ids: [], name: '', group: false });
    deleteIds(ids);
  };

  const unscheduledInbox = sortUnscheduled(filterUnscheduledTasks(events, inboxFilters));
  const inboxFiltersNarrow = inboxQuery.trim() !== '' || inboxStatus !== 'active';

  const doneTasks = [...events]
    .filter((task) => task.status === 'completed' || task.status === 'canceled')
    .filter((task) => matchesTaskName(task.name, scheduledQuery))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const reminderCount = dayReminders.length;
  const tabs: Array<{ id: TasksTab; label: string; count?: number }> = [
    { id: 'scheduled', label: t('tasks.scheduled'), count: filterScheduledTasks(events, { ...scheduledFilters, query: '', overdueOnly: false, phaseId: 'any', mode: 'any', status: 'active' }).length },
    { id: 'later', label: t('tasks.unscheduled'), count: filterUnscheduledTasks(events, { query: '', status: 'active', overdueOnly: false }).length },
    { id: 'reminders', label: t('dayReminders.title'), count: reminderCount },
    { id: 'done', label: t('tasks.tabs.done') },
  ];

  return (
    <div className="page-shell-fill">
      <header className="page-head shrink-0">
        <div>
          <h1 className="page-title">{t('tasks.title')}</h1>
        </div>
        {phone ? null : (
          <div className="flex shrink-0 gap-2">
            <VoiceTaskButton onClick={voice.open} />
            <Button icon={Plus} onClick={() => openCreate(tab === 'later' ? { unscheduled: true } : undefined)}>
              {t('calendar.createTask')}
            </Button>
          </div>
        )}
      </header>

      <div
        role="tablist"
        aria-label={t('tasks.title')}
        className="-mx-4 mb-4 flex shrink-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((item) => {
          const on = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(item.id)}
              className={cx(
                'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-body-sm font-medium transition md:h-9',
                on
                  ? 'border-transparent bg-ide-text text-ide-bg'
                  : 'border-ide-border bg-ide-panel text-ide-muted hover:text-ide-text',
              )}
            >
              {item.label}
              {item.count ? (
                <span className={cx('tabular-nums', on ? 'opacity-70' : 'text-ide-subtle')}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="page-scroll max-md:pb-28">
        {tab === 'later' ? (
          <section aria-labelledby="tasks-later-title">
            <h2 id="tasks-later-title" className="sr-only">
              {t('tasks.unscheduled')}
            </h2>
            <p className="mb-3 text-body-sm text-ide-muted">{t('tasks.unscheduledHint')}</p>
            <TaskSectionFilters
              idPrefix="inbox"
              query={inboxQuery}
              onQueryChange={setInboxQuery}
              status={inboxStatus}
              onStatusChange={setInboxStatus}
              overdueOnly={false}
              onOverdueOnlyChange={() => undefined}
              showOverdue={false}
              searchAriaLabel={t('tasks.searchUnscheduled')}
              statusAriaLabel={t('tasks.statusUnscheduled')}
              overdueAriaLabel={t('tasks.overdueUnscheduled')}
            />
            {isLoadingEvents ? (
              <ListSkeleton label={t('common.loading')} />
            ) : unscheduledInbox.length === 0 ? (
              <p className="rounded-control border border-dashed border-ide-border px-4 py-8 text-center text-body-sm text-ide-muted">
                {inboxFiltersNarrow ? t('tasks.noUnscheduledMatch') : t('tasks.noUnscheduled')}
              </p>
            ) : (
              <EventList
                events={unscheduledInbox}
                onEdit={openEdit}
                onDelete={requestDelete}
                onDeleteGroup={requestDeleteGroup}
                onCreate={() => openCreate({ unscheduled: true })}
                onDone={markDone}
                onSkip={markSkipped}
                onDoNow={doNow}
                onSchedule={(task) => setLaterTarget({ task, occurrenceYmd: todayYmd })}
                busyId={busyId}
                isLoading={false}
              />
            )}
          </section>
        ) : tab === 'reminders' ? (
          <section aria-labelledby="tasks-reminders-title">
            <h2 id="tasks-reminders-title" className="sr-only">
              {t('dayReminders.title')}
            </h2>
            <ReminderList scope="all" headless onEdit={openEditReminder} />
          </section>
        ) : tab === 'done' ? (
          <section aria-labelledby="tasks-done-title">
            <h2 id="tasks-done-title" className="sr-only">
              {t('tasks.tabs.done')}
            </h2>
            {doneTasks.length === 0 ? (
              <p className="rounded-control border border-dashed border-ide-border px-4 py-8 text-center text-body-sm text-ide-muted">
                {t('tasks.tabs.doneEmpty')}
              </p>
            ) : (
              <EventList
                events={doneTasks}
                onEdit={openEdit}
                onDelete={requestDelete}
                onDeleteGroup={requestDeleteGroup}
                onCreate={() => openCreate()}
                isLoading={false}
              />
            )}
          </section>
        ) : (
          <section aria-labelledby="tasks-scheduled-title">
            <h2 id="tasks-scheduled-title" className="sr-only">
              {t('tasks.scheduled')}
            </h2>
            <TaskSectionFilters
              idPrefix="scheduled"
              query={scheduledQuery}
              onQueryChange={setScheduledQuery}
              status={filterStatus}
              onStatusChange={setFilterStatus}
              overdueOnly={scheduledOverdue}
              onOverdueOnlyChange={setScheduledOverdue}
              searchAriaLabel={t('tasks.searchScheduled')}
              overdueAriaLabel={t('tasks.overdueScheduled')}
              phases={phases}
              phaseId={phaseId}
              onPhaseIdChange={setPhaseId}
              mode={scheduleMode}
              onModeChange={setScheduleMode}
              sortField={sortField}
              onSortFieldChange={setSortField}
            />
            <EventList
              events={sortedEvents}
              onEdit={openEdit}
              onDelete={requestDelete}
              onDeleteGroup={requestDeleteGroup}
              onCreate={() => openCreate()}
              onDone={markDone}
              isLoading={isLoadingEvents}
              emptyTitle={t('tasks.noScheduledFilter')}
            />
          </section>
        )}
      </div>

      <Modal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, ids: [], name: '', group: false })}
        title={deleteConfirm.group ? t('tasks.group.deleteTitle') : t('tasks.deleteTitle')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size={dialogButtonSize}
              onClick={() => setDeleteConfirm({ open: false, ids: [], name: '', group: false })}
              className="w-full sm:w-auto"
              icon={X}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="dangerSolid"
              size={dialogButtonSize}
              onClick={confirmDelete}
              className="w-full sm:w-auto"
              icon={Trash2}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-ide-text">
          {deleteConfirm.group
            ? t('tasks.group.deleteConfirm', {
                name: deleteConfirm.name,
                count: deleteConfirm.ids.length,
              })
            : t('tasks.deleteConfirm', { name: deleteConfirm.name })}
        </p>
      </Modal>

      {editorModal}
      <VoiceTaskSheet voice={voice} />
      <SeriesDragHost />
      <MoveOccurrenceSheet
        mode="later"
        target={laterTarget}
        timeZone={timeZone}
        onClose={() => setLaterTarget(null)}
        onDone={() => setLaterTarget(null)}
      />
      {phone ? (
        <div
          className="fixed z-[1250] flex items-center gap-2 md:hidden"
          style={{ right: '1rem', bottom: 'calc(var(--phone-tab-offset) + 0.75rem)' }}
        >
          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-ide-accentBlue text-white shadow-ide-md"
            aria-label={t('calendar.createTask')}
            onClick={() => openCreate(tab === 'later' ? { unscheduled: true } : undefined)}
          >
            <Plus className="h-7 w-7" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default TasksPage;
