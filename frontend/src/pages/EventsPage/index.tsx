import React, { useState } from 'react';
import { Mic, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGetEventsQuery, useDeleteEventMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import EventList from 'modules/events/components/EventList';
import TaskSectionFilters from 'modules/events/components/TaskSectionFilters';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { deadlineTone } from 'modules/events/utils/deadlineTone';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import {
  filterScheduledTasks,
  filterUnscheduledTasks,
  type ScheduleModeFilter,
  type TaskStatusFilter,
} from 'modules/events/utils/taskListFilters';
import { Modal } from '../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';
import type { TaskDTO } from 'api/tasks.api';

type Priority = 'urgent' | 'high' | 'medium' | 'low';
type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TONE_ORDER = { overdue: 0, today: 1, soon: 2, none: 3 } as const;

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
    const tone = TONE_ORDER[deadlineTone(a.deadline)] - TONE_ORDER[deadlineTone(b.deadline)];
    if (tone !== 0) return tone;
    if (a.deadline && b.deadline) {
      const due = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (due !== 0) return due;
    }
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
  const [inboxOverdue, setInboxOverdue] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({
    open: false,
    id: null,
    name: '',
  });
  const phone = usePhoneLayout();

  const { data: events = [], isLoading: isLoadingEvents } = useGetEventsQuery();
  const { data: phases = [] } = useGetAllPhasesQuery();
  const [deleteEvent] = useDeleteEventMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { openCreate, openCreateFromPrefill, openEdit, openSchedule, createFromPayload, editorModal } =
    useEventEditor();
  const voice = useVoiceTask({
    onComplete: createFromPayload,
    onSufficient: openCreateFromPrefill,
  });

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
    overdueOnly: inboxOverdue,
  };
  const sortedEvents = sortTasks(filterScheduledTasks(events, scheduledFilters), sortField);

  const markDone = (task: TaskDTO) => {
    setBusyId(task.id);
    void updateEvent({ id: task.id, body: { status: 'completed' } })
      .unwrap()
      .then(() => {
        showSuccessToast({ title: t('tasks.completed'), detail: task.name });
      })
      .catch((err) => {
        showErrorToast({
          title: t('tasks.completeFailed'),
          detail: extractApiErrorMessage(err),
        });
      })
      .finally(() => setBusyId(null));
  };

  const requestDelete = (id: string) => {
    const task = events.find((item) => item.id === id);
    setDeleteConfirm({ open: true, id, name: task?.name || t('tasks.thisTask') });
  };

  const confirmDelete = () => {
    if (!deleteConfirm.id) return;
    const id = deleteConfirm.id;
    const name = deleteConfirm.name;
    const thisTaskLabel = t('tasks.thisTask');
    setDeleteConfirm({ open: false, id: null, name: '' });
    void deleteEvent(id)
      .unwrap()
      .then(() => {
        showSuccessToast({
          title: t('tasks.deleted'),
          detail: name !== thisTaskLabel ? name : undefined,
        });
      })
      .catch((err) => {
        showErrorToast({
          title: t('tasks.deleteFailed'),
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const unscheduledInbox = sortUnscheduled(filterUnscheduledTasks(events, inboxFilters));
  const inboxFiltersNarrow =
    inboxQuery.trim() !== '' || inboxStatus !== 'active' || inboxOverdue;

  return (
    <div className="page-shell-fill">
      <header className="page-head shrink-0">
        <div>
          <h1 className="page-title">{t('tasks.title')}</h1>
          <p className="page-lead max-md:hidden">
            {t('tasks.pageLead')}
          </p>
        </div>
        {phone ? null : (
          <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <button type="button" onClick={() => openCreate()} className="ui-btn-primary min-w-[9rem] flex-1 sm:flex-none">
              {t('calendar.createTask')}
            </button>
            <VoiceTaskButton onClick={voice.open} />
          </div>
        )}
      </header>

      <div className="page-scroll space-y-6 max-md:pb-28">
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ide-muted">{t('tasks.unscheduled')}</h2>
            <p className="text-xs text-ide-muted">{t('tasks.unscheduledHint')}</p>
          </div>
          <TaskSectionFilters
            idPrefix="inbox"
            query={inboxQuery}
            onQueryChange={setInboxQuery}
            status={inboxStatus}
            onStatusChange={setInboxStatus}
            overdueOnly={inboxOverdue}
            onOverdueOnlyChange={setInboxOverdue}
            searchAriaLabel={t('tasks.searchUnscheduled')}
            statusAriaLabel={t('tasks.statusUnscheduled')}
            overdueAriaLabel={t('tasks.overdueUnscheduled')}
          />
          {isLoadingEvents ? (
            <div className="loading">{t('common.loading')}</div>
          ) : unscheduledInbox.length === 0 ? (
            <p className="text-sm text-ide-muted">
              {inboxFiltersNarrow ? t('tasks.noUnscheduledMatch') : t('tasks.noUnscheduled')}
            </p>
          ) : (
            <EventList
              events={unscheduledInbox}
              onEdit={openEdit}
              onDelete={requestDelete}
              onCreate={() => openCreate({ unscheduled: true })}
              onDone={markDone}
              onSchedule={openSchedule}
              busyId={busyId}
              isLoading={false}
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ide-muted">{t('tasks.scheduled')}</h2>
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
            onCreate={() => openCreate()}
            isLoading={isLoadingEvents}
            emptyTitle={t('tasks.noScheduledFilter')}
          />
        </section>
      </div>

      <Modal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        title={t('tasks.deleteTitle')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })}
              className="ui-btn-secondary w-full sm:w-auto"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="ui-btn-danger w-full sm:w-auto"
            >
              {t('common.delete')}
            </button>
          </>
        }
      >
        <p className="text-ide-text">
          {t('tasks.deleteConfirm', { name: deleteConfirm.name })}
        </p>
      </Modal>

      {editorModal}
      <VoiceTaskSheet voice={voice} />
      {phone ? (
        <div
          className="fixed z-[1250] flex items-center gap-2 md:hidden"
          style={{ right: '1rem', bottom: 'calc(var(--phone-tab-offset) + 0.75rem)' }}
        >
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-ide-border bg-ide-panel text-ide-text shadow-ide-md"
            aria-label={t('calendar.addByVoice')}
            onClick={() => voice.open()}
          >
            <Mic className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-ide-accentBlue text-white shadow-ide-md"
            aria-label={t('calendar.createTask')}
            onClick={() => openCreate()}
          >
            <Plus className="h-7 w-7" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default TasksPage;
