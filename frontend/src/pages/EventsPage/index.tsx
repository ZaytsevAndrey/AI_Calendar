import React, { useState } from 'react';
import { useGetEventsQuery, useDeleteEventMutation } from 'api/eventTasksApi';
import EventList from 'modules/events/components/EventList';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { hasTaskAlreadyEnded, isCurrentTask } from 'modules/events/utils/isCurrentTask';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const EventsPage: React.FC = () => {
  const [sortField, setSortField] = useState<
    'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes'
  >('deadline');
  const [filterStatus, setFilterStatus] = useState<string>('active');

  const { data: events = [], isLoading: isLoadingEvents } = useGetEventsQuery();
  const [deleteEvent, deleteEventState] = useDeleteEventMutation();
  const { openCreate, openEdit, editorModal } = useEventEditor();

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

      {editorModal}
    </div>
  );
};

export default EventsPage;
