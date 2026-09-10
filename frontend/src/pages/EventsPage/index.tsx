import React, { useState } from 'react';
import { useGetEventsQuery, useDeleteEventMutation } from 'api/eventTasksApi';
import EventList from 'modules/events/components/EventList';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { hasTaskAlreadyEnded, isCurrentTask } from 'modules/events/utils/isCurrentTask';
import { Modal } from '../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';

type Priority = 'urgent' | 'high' | 'medium' | 'low';
type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

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
  const { openCreate, openCreateFromPrefill, openEdit, createFromPayload, editorModal } = useEventEditor();
  const voice = useVoiceTask({
    onComplete: createFromPayload,
    onSufficient: openCreateFromPrefill,
  });

  const sortedEvents = [...events].sort((a, b) => {
    switch (sortField) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'priority': {
        const priorityOrder: Record<Priority, number> = {
          urgent: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
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
          <p className="page-lead">Current and upcoming tasks. Use the filter to see completed or past items.</p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EventList
          events={filteredEvents}
          onEdit={openEdit}
          onDelete={requestDelete}
          onCreate={() => openCreate()}
          isLoading={isLoadingEvents}
        />
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
