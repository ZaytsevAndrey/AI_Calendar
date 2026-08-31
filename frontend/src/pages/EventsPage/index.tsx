import React, { useState } from 'react';
import {
  useGetEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import EventList from 'modules/events/components/EventList';
import EventForm from 'modules/events/components/EventForm';
import { hasTaskAlreadyEnded, isCurrentTask } from 'modules/events/utils/isCurrentTask';
import { TaskDTO } from 'api/tasks.api';
import { CreateTaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import { Modal } from '../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const EventsPage: React.FC = () => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [sortField, setSortField] = useState<
    'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes'
  >('deadline');
  const [filterStatus, setFilterStatus] = useState<string>('active');

  const { data: events = [], isLoading: isLoadingEvents } = useGetEventsQuery();
  const { data: phases = [] } = useGetAllPhasesQuery();

  const [createEvent, createEventState] = useCreateEventMutation();
  const [updateEvent, updateEventState] = useUpdateEventMutation();
  const [deleteEvent, deleteEventState] = useDeleteEventMutation();

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

  const closeWizard = () => {
    setWizardOpen(false);
    setEditingEvent(null);
  };

  const openCreate = () => {
    setEditingEvent(null);
    setWizardOpen(true);
  };

  const openEdit = (event: TaskDTO) => {
    setEditingEvent(event);
    setWizardOpen(true);
  };

  const handleSubmitEvent = async (data: CreateTaskDTO | UpdateTaskDTO) => {
    const cleanData = { ...data };
    if ((cleanData as { phaseId?: string }).phaseId === '') {
      delete (cleanData as { phaseId?: string }).phaseId;
    }
    try {
      if (editingEvent) {
        await updateEvent({ id: editingEvent.id, body: cleanData as UpdateTaskDTO }).unwrap();
        showSuccessToast('Event updated.');
      } else {
        await createEvent(cleanData as CreateTaskDTO).unwrap();
        showSuccessToast('Event created.');
      }
      closeWizard();
    } catch (err) {
      showErrorToast(extractApiErrorMessage(err));
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this event?')) return;
    try {
      await deleteEvent(id).unwrap();
      showSuccessToast('Event deleted.');
    } catch (err) {
      showErrorToast(extractApiErrorMessage(err));
    }
  };

  const handleSort = (field: 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes') => {
    setSortField(field);
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

  const wizardTitle = editingEvent ? 'Edit event' : 'Create event';
  const isSaving = createEventState.isLoading || updateEventState.isLoading;

  return (
    <div className="page-shell">
      <header className="page-head">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-lead">Current and upcoming events. Use the filter to see completed or past items.</p>
        </div>
        <button type="button" onClick={openCreate} className="ui-btn-primary w-full shrink-0 sm:w-auto">
          Create event
        </button>
      </header>

      <div className="filter-bar">
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
      </div>

      <EventList
        events={filteredEvents}
        onEdit={openEdit}
        onDelete={handleDeleteEvent}
        onStatusChange={() => {}}
        onSort={handleSort}
        isLoading={isLoadingEvents || deleteEventState.isLoading}
      />

      <Modal
        open={wizardOpen}
        onClose={closeWizard}
        title={wizardTitle}
        maxWidthClass="max-w-xl"
        footer={null}
      >
        <div className="p-4 pt-0 sm:p-6 sm:pt-0">
          <EventForm
            key={editingEvent?.id ?? 'new'}
            initialData={editingEvent || undefined}
            phases={phases}
            onSubmit={handleSubmitEvent}
            isSubmitting={isSaving}
            onCancel={closeWizard}
            mode={editingEvent ? 'edit' : 'create'}
          />
        </div>
      </Modal>
    </div>
  );
};

export default EventsPage;
