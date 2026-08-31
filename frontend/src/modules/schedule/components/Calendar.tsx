import React, { useState, useMemo } from 'react';
import { Calendar as BigCalendar, View, Views, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { ScheduledTaskDTO } from '../../../api/schedule.api';
import { PhaseDTO } from '../../../api/phases.api';

// Setup dateFnsLocalizer for react-big-calendar
const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
}); 

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

// CalendarEvent interface removed as it's not used

interface CalendarProps {
  tasks: ScheduledTaskDTO[];
  phases: PhaseDTO[];
  onEventSelect: (task: ScheduledTaskDTO) => void;
  onRangeChange: (start: Date, end: Date) => void;
  onEventDrop?: (taskId: string, start: Date, end: Date) => void;
}

const CalendarComponent: React.FC<CalendarProps> = ({
  tasks,
  onEventSelect,
  onRangeChange,
  onEventDrop,
}) => {
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());

  // Transform tasks into calendar events
  const events = useMemo(() => {
    const now = new Date();
    let rangeEnd = new Date(date);
    if (view === 'day') {
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (view === 'week') {
      const weekStart = startOfWeek(date, { locale: enUS });
      rangeEnd = new Date(weekStart);
      rangeEnd.setDate(rangeEnd.getDate() + 7);
    } else if (view === 'month') {
      rangeEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    const viewingPastRange = rangeEnd.getTime() < now.getTime();

    return tasks
      .filter((task) => {
        if (task.status === 'completed' || task.status === 'canceled') return false;
        if (viewingPastRange) return true;
        const endMs = new Date(task.scheduledEndTime).getTime();
        return !Number.isNaN(endMs) && endMs >= now.getTime();
      })
      .map((task) => ({
        id: task.id,
        title: task.name,
        start: new Date(task.scheduledStartTime),
        end: new Date(task.scheduledEndTime),
        priority: task.priority,
        phaseId: task.phaseId,
        phase: task.phase,
        resource: {},
      }));
  }, [tasks, view, date]);

  // Event styling based on task priority and phase
  const eventStyleGetter = (event: any) => {
    const priorityColors: Record<TaskPriority, string> = {
      low: '#8bc34a',
      medium: '#03a9f4',
      high: '#ff9800',
      urgent: '#f44336',
    };

    const priority = event.priority as TaskPriority;
    const backgroundColor = event.phase?.color || priorityColors[priority] || '#03a9f4';
    
    return {
      style: {
        backgroundColor,
        borderRadius: '4px',
        opacity: 0.8,
        color: '#fff',
        border: 'none',
        display: 'block',
      },
    };
  };

  // Handle view change (day, week, month)
  const handleViewChange = (newView: View) => {
    setView(newView);
  };

  // Handle date navigation
  const handleNavigate = (newDate: Date) => {
    setDate(newDate);
    
    let rangeStart = new Date(newDate);
    let rangeEnd = new Date(newDate);
    
    if (view === 'day') {
      // For day view, get start and end of day
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (view === 'week') {
      // For week view, get start of week and add 7 days
      rangeStart = startOfWeek(newDate, { locale: enUS });
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + 7);
    } else if (view === 'month') {
      // For month view, get first and last day of month
      rangeStart.setDate(1);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    
    onRangeChange(rangeStart, rangeEnd);
  };

  // Handle event selection
  const handleSelectEvent = (event: any) => {
    const task = tasks.find(t => t.id === event.id);
    if (task) {
      onEventSelect(task);
    }
  };

  // Handle event drag-and-drop if enabled
  const moveEvent = ({ event, start, end }: any) => {
    if (onEventDrop) {
      onEventDrop(event.id, start, end);
    }
  };

  // Workaround for TypeScript issues with react-big-calendar
  const BigCalendarAny = BigCalendar as any;

  return (
    <div className="calendar-container h-[min(55vh,520px)] w-full min-h-[280px] sm:min-h-[360px] sm:h-[min(58vh,600px)] lg:h-[min(62vh,720px)]">
      <BigCalendarAny
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: '100%' }}
        onSelectEvent={handleSelectEvent}
        onView={handleViewChange}
        onNavigate={handleNavigate}
        view={view}
        date={date}
        eventPropGetter={eventStyleGetter}
        onEventDrop={onEventDrop ? moveEvent : undefined}
        draggableAccessor={() => !!onEventDrop}
        selectable
        popup
        views={[Views.MONTH, Views.WEEK, Views.DAY]}
      />
    </div>
  );
};

export default CalendarComponent; 