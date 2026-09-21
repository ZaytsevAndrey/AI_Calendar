import React, { useState } from 'react';
import { useGetEventsQuery, useDeleteEventMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import EventList from 'modules/events/components/EventList';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { hasTaskAlreadyEnded, isCurrentTask } from 'modules/events/utils/isCurrentTask';
import { deadlineTone } from 'modules/events/utils/deadlineTone';
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
  const [sortField, setSortField] = useState<SortField>('deadline');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({
    open: false,
    id: null,
    name: '',
  });

  const { data: events = [], isLoading: isLoadingEvents } = useGetEventsQuery();
  const [deleteEvent] = useDeleteEventMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { openCreate, openCreateFromPrefill, openEdit, openSchedule, createFromPayload, editorModal } =
    useEventEditor();
  const voice = useVoiceTask({
    onComplete: createFromPayload,
    onSufficient: openCreateFromPrefill,
  });

  const scheduledTasks = events.filter((event) => !event.isUnscheduled);
  const sortedEvents = sortTasks(scheduledTasks, sortField);

  const markDone = (task: TaskDTO) => {
    setBusyId(task.id);
    void updateEvent({ id: task.id, body: { status: 'completed' } })
      .unwrap()
      .then(() => {
        showSuccessToast({ title: 'Task completed', detail: task.name });
      })
      .catch((err) => {
        showErrorToast({
          title: 'Could not complete task',
          detail: extractApiErrorMessage(err),
        });
      })
      .finally(() => setBusyId(null));
  };

  const requestDelete = (id: string) => {
    const task = events.find((item) => item.id === id);
    setDeleteConfirm({ open: true, id, name: task?.name || 'this task' });
  };

  const confirmDelete = () => {
    if (!deleteConfirm.id) return;
    const id = deleteConfirm.id;
    const name = deleteConfirm.name;
    setDeleteConfirm({ open: false, id: null, name: '' });
    void deleteEvent(id)
      .unwrap()
      .then(() => {
        showSuccessToast({
          title: 'Task deleted',
          detail: name !== 'this task' ? name : undefined,
        });
      })
      .catch((err) => {
        showErrorToast({
          title: 'Could not delete task',
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const unscheduledInbox = sortUnscheduled(
    events.filter((event) => event.isUnscheduled && isCurrentTask(event)),
  );

  const filteredEvents = sortedEvents.filter((event) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return isCurrentTask(event);
    if (event.status !== filterStatus) return false;
    if (filterStatus === 'todo' || filterStatus === 'in_progress') {
      return !hasTaskAlreadyEnded(event);
    }
    return true;
  });

  return (
    <div className="page-shell-fill">
      <header className="page-head shrink-0">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-lead">
            Inbox for things to do later, plus scheduled tasks. Unscheduled items stay off Google Calendar
            until you schedule them.
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => openCreate({ unscheduled: true })}
            className="ui-btn-secondary w-full sm:w-auto"
          >
            Add unscheduled
          </button>
          <button type="button" onClick={() => openCreate()} className="ui-btn-primary w-full sm:w-auto">
            Create task
          </button>
          <VoiceTaskButton onClick={voice.open} />
        </div>
      </header>

      <div className="filter-bar shrink-0">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="statusFilter" className="ui-label">
            Status
          </label>
          <select
            id="statusFilter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="ui-select"
          >
            <option value="active">Active</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="canceled">Canceled</option>
            <option value="all">All (including past)</option>
          </select>
        </div>
        <div className="w-full sm:max-w-xs">
          <label htmlFor="sortField" className="ui-label">
            Sort by
          </label>
          <select
            id="sortField"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            className="ui-select"
          >
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="name">Name</option>
            <option value="estimatedTimeInMinutes">Duration</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-6">
        <section>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-ide-muted">Unscheduled</h2>
              <p className="text-xs text-ide-muted">No time slot. Mark done or schedule when you know when.</p>
            </div>
          </div>
          {isLoadingEvents ? (
            <div className="loading">Loading tasks…</div>
          ) : unscheduledInbox.length === 0 ? (
            <p className="text-sm text-ide-muted">No unscheduled tasks.</p>
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
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ide-muted">Scheduled</h2>
          <EventList
            events={filteredEvents}
            onEdit={openEdit}
            onDelete={requestDelete}
            onCreate={() => openCreate()}
            isLoading={isLoadingEvents}
            emptyTitle="No scheduled tasks in this filter."
          />
        </section>
      </div>

      <Modal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        title="Delete task"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })}
              className="ui-btn-secondary w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="ui-btn-danger w-full sm:w-auto"
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-ide-text">
          Are you sure you want to delete &quot;{deleteConfirm.name}&quot;? This cannot be undone.
        </p>
      </Modal>

      {editorModal}
      <VoiceTaskSheet voice={voice} />
    </div>
  );
};

export default TasksPage;
