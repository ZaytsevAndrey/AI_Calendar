import React from 'react';
import { 
    Box, 
    Typography, 
    Paper,
    Tooltip,
    Button
} from '@mui/material';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor } from '../hooks/useCalendar';
import { useTimePhasesForDate, getPhaseByTime } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';

interface CalendarGridProps {
    view: 'day' | 'week' | 'month';
    date: Date;
    events: GoogleCalendarEvent[];
    onEditEvent?: (eventId: string) => void;
    onDeleteEvent?: (eventId: string, eventName: string) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({ view, date, events, onEditEvent, onDeleteEvent }) => {
    const { data: timePhases = [] } = useTimePhasesForDate(date);
    // Замість useQuery використати useGetUserSettingsQuery з RTK Query slice userSettingsApi
    const { data: userSettings } = useGetUserSettingsQuery();
    
    const getDaysInView = () => {
        const days = [];
        
        switch (view) {
            case 'day': {
                const day = new Date(date);
                days.push(day);
                break;
            }
            case 'week': {
                const startOfWeek = new Date(date);
                // Monday = 1, Sunday = 0, so we need to adjust
                const dayOfWeek = date.getDay();
                const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday becomes 6 days back
                startOfWeek.setDate(date.getDate() - daysToSubtract);
                
                for (let i = 0; i < 7; i++) {
                    const day = new Date(startOfWeek);
                    day.setDate(startOfWeek.getDate() + i);
                    days.push(day);
                }
                break;
            }
            case 'month': {
                const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                
                // Get start of week for the first day of month (Monday)
                const startOfWeek = new Date(startOfMonth);
                const firstDayOfWeek = startOfMonth.getDay();
                const daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Sunday becomes 6 days back
                startOfWeek.setDate(startOfMonth.getDate() - daysToSubtract);
                
                // Get end of week for the last day of month (Sunday)
                const endOfWeek = new Date(endOfMonth);
                const lastDayOfWeek = endOfMonth.getDay();
                const daysToAdd = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek; // Sunday = 0, so no days to add
                endOfWeek.setDate(endOfMonth.getDate() + daysToAdd);
                
                const current = new Date(startOfWeek);
                while (current <= endOfWeek) {
                    days.push(new Date(current));
                    current.setDate(current.getDate() + 1);
                }
                break;
            }
        }
        
        return days;
    };

    const getEventsForDay = (day: Date) => {
        return events.filter(event => {
            const eventDate = event.start.dateTime 
                ? new Date(event.start.dateTime)
                : new Date(event.start.date!);
            
            return eventDate.toDateString() === day.toDateString();
        });
    };

    const isToday = (day: Date) => {
        return day.toDateString() === new Date().toDateString();
    };

    const isCurrentMonth = (day: Date) => {
        return day.getMonth() === date.getMonth();
    };

    // Get phase for a specific time
    const getPhaseForTime = (time: string) => {
        // Only use non-sleep phases for display
        const displayPhases = timePhases.filter((phase: any) => phase.type !== 'sleep_time');
        return getPhaseByTime(displayPhases, time);
    };

    // Check if time is in sleep time
    const isSleepTime = (time: string) => {
        if (!userSettings?.sleepTime || !userSettings?.wakeTime) {
            // Fallback to default sleep time if settings not loaded
            const timeMinutes = timeToMinutes(time);
            const defaultSleepStart = 23 * 60; // 23:00
            const defaultSleepEnd = 6 * 60;    // 06:00
            
            if (defaultSleepStart > defaultSleepEnd) {
                return timeMinutes >= defaultSleepStart || timeMinutes <= defaultSleepEnd;
            } else {
                return timeMinutes >= defaultSleepStart && timeMinutes <= defaultSleepEnd;
            }
        }
        
        const timeMinutes = timeToMinutes(time);
        const sleepStart = timeToMinutes(userSettings.sleepTime);
        const sleepEnd = timeToMinutes(userSettings.wakeTime);
        
        if (sleepStart > sleepEnd) {
            // Sleep time spans midnight (e.g., 23:00 to 06:00)
            return timeMinutes >= sleepStart || timeMinutes <= sleepEnd;
        } else {
            return timeMinutes >= sleepStart && timeMinutes <= sleepEnd;
        }
    };

    // Get non-sleep phases for display
    const getDisplayPhases = () => {
        return timePhases
            .filter((phase: any) => phase.type !== 'sleep_time')
            .sort((a: any, b: any) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    };

    // Create time slots for day view (excluding sleep time)
    const createTimeSlots = () => {
        const slots = [];
        for (let hour = 0; hour < 24; hour++) {
            const time = `${hour.toString().padStart(2, '0')}:00`;
            
            // Skip sleep time slots completely
            if (isSleepTime(time)) {
                continue;
            }
            
            const phase = getPhaseForTime(time);
            slots.push({ time, phase });
        }
        return slots;
    };

    // Utility function to convert time string to minutes
    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const days = getDaysInView();

    if (view === 'day') {
        const dayEvents = getEventsForDay(days[0]);
        const timeSlots = createTimeSlots();
        
        return (
            <Paper sx={{ p: 2, minHeight: '600px' }}>
                <Typography variant="h6" gutterBottom>
                    {days[0].toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}
                </Typography>
                
                {/* Phases Legend */}
                {getDisplayPhases().length > 0 && (
                    <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {getDisplayPhases().map((phase: any) => (
                            <Box 
                                key={phase.id}
                                sx={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 0.5,
                                    p: 0.5,
                                    borderRadius: 1,
                                    backgroundColor: `${phase.color}10`,
                                    border: `1px solid ${phase.color}30`
                                }}
                            >
                                <Box 
                                    sx={{ 
                                        width: 12, 
                                        height: 12, 
                                        borderRadius: '50%', 
                                        backgroundColor: phase.color,
                                        border: '1px solid #ccc'
                                    }} 
                                />
                                <Typography variant="caption" color="text.secondary">
                                    {phase.name} ({phase.startTime}-{phase.endTime})
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                )}
                
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    {timeSlots.map((slot, index) => {
                        const eventsInSlot = dayEvents.filter(event => {
                            if (!event.start.dateTime) return false;
                            const eventHour = new Date(event.start.dateTime).getHours();
                            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                                hour12: false, 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            });
                            
                            // Skip events that are in sleep time
                            if (isSleepTime(eventTime)) {
                                return false;
                            }
                            
                            return eventHour === parseInt(slot.time.split(':')[0]);
                        });
                        
                        return (
                            <Box
                                key={index}
                                sx={{
                                    display: 'flex',
                                    minHeight: '40px',
                                    borderBottom: '1px solid #e0e0e0',
                                    position: 'relative',
                                    backgroundColor: slot.phase 
                                        ? `${slot.phase.color}10` // 10% opacity
                                        : 'transparent',
                                    '&:hover': {
                                        backgroundColor: slot.phase 
                                            ? `${slot.phase.color}20` // 20% opacity on hover
                                            : 'rgba(0,0,0,0.05)'
                                    }
                                }}
                            >
                                {/* Time label */}
                                <Box sx={{ 
                                    width: '60px', 
                                    p: 1, 
                                    borderRight: '1px solid #e0e0e0',
                                    backgroundColor: 'grey.50',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {slot.time}
                                    </Typography>
                                </Box>
                                
                                {/* Phase label */}
                                <Box sx={{ 
                                    width: '120px', 
                                    p: 1, 
                                    borderRight: '1px solid #e0e0e0',
                                    backgroundColor: 'grey.50',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}>
                                    {slot.phase && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Box 
                                                sx={{ 
                                                    width: 8, 
                                                    height: 8, 
                                                    borderRadius: '50%', 
                                                    backgroundColor: slot.phase.color,
                                                    border: '1px solid #ccc'
                                                }} 
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                {slot.phase.name}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                                
                                {/* Events area */}
                                <Box sx={{ 
                                    flex: 1, 
                                    p: 1, 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    gap: 0.5 
                                }}>
                                    {eventsInSlot.map((event) => (
                                        <Tooltip key={event.id} title={
                                            <Box>
                                                <Typography variant="subtitle2">{event.summary || 'Event'}</Typography>
                                                {event.description && <Typography variant="body2">{event.description}</Typography>}
                                                <Typography variant="caption">{formatEventTime(event)}</Typography>
                                                {event.location && <Typography variant="caption">Location: {event.location}</Typography>}
                                            </Box>
                                        } arrow>
                                            <Box
                                                key={event.id}
                                                sx={{
                                                    p: 0.5,
                                                    backgroundColor: getEventColor(event),
                                                    color: 'white',
                                                    borderRadius: 0.5,
                                                    fontSize: '0.7rem',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    border: '1px solid rgba(255,255,255,0.3)',
                                                    position: 'relative',
                                                    cursor: 'pointer',
                                                    '&:hover .event-actions': { display: 'flex' }
                                                }}
                                                title={undefined}
                                                onClick={() => onEditEvent && onEditEvent(event.id)}
                                            >
                                                {event.summary || 'Event'}
                                                <Box className="event-actions" sx={{
                                                    display: 'none',
                                                    position: 'absolute',
                                                    top: 2,
                                                    right: 2,
                                                    gap: 0.5,
                                                    zIndex: 2
                                                }}>
                                                    <Button size="small" color="inherit" sx={{ minWidth: 0, p: 0.5 }} onClick={e => { e.stopPropagation(); onEditEvent && onEditEvent(event.id); }}>✏️</Button>
                                                    <Button size="small" color="error" sx={{ minWidth: 0, p: 0.5 }} onClick={e => { e.stopPropagation(); onDeleteEvent && onDeleteEvent(event.id, event.summary || 'Event'); }}>🗑️</Button>
                                                </Box>
                                            </Box>
                                        </Tooltip>
                                    ))}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            </Paper>
        );
    }

    // Create weeks array for proper grid layout
    const createWeeks = (days: Date[]) => {
        const weeks = [];
        for (let i = 0; i < days.length; i += 7) {
            weeks.push(days.slice(i, i + 7));
        }
        return weeks;
    };

    const weeks = createWeeks(days);

    return (
        <Box sx={{ width: '100%' }}>
            {/* Phases Legend for week/month view */}
            {getDisplayPhases().length > 0 && (
                <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {getDisplayPhases().map((phase: any) => (
                            <Box 
                                key={phase.id}
                                sx={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 0.5,
                                    p: 0.5,
                                    borderRadius: 1,
                                    backgroundColor: `${phase.color}10`,
                                    border: `1px solid ${phase.color}30`
                                }}
                            >
                                <Box 
                                    sx={{ 
                                        width: 12, 
                                        height: 12, 
                                        borderRadius: '50%', 
                                        backgroundColor: phase.color,
                                        border: '1px solid #ccc'
                                    }} 
                                />
                                <Typography variant="caption" color="text.secondary">
                                    {phase.name} ({phase.startTime}-{phase.endTime})
                                </Typography>
                            </Box>
                        ))}
                </Box>
            )}
            
            {/* Header with day names */}
            <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(7, 1fr)', 
                mb: 1,
                borderBottom: '1px solid #e0e0e0'
            }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                    <Box key={dayName}>
                        <Typography 
                            variant="subtitle2" 
                            sx={{ 
                                p: 1, 
                                textAlign: 'center', 
                                fontWeight: 'bold',
                                backgroundColor: 'grey.100',
                                borderRight: '1px solid #e0e0e0'
                            }}
                        >
                            {dayName}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Calendar grid */}
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {weeks.map((week, weekIndex) => (
                    <Box 
                        key={weekIndex} 
                        sx={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(7, 1fr)',
                            borderBottom: '1px solid #e0e0e0'
                        }}
                    >
                        {week.map((day, dayIndex) => {
                            const dayEvents = getEventsForDay(day);
                            const isCurrentDay = isToday(day);
                            const isInCurrentMonth = isCurrentMonth(day);
                            
                            return (
                                <Box
                                    key={dayIndex}
                                    sx={{
                                        p: 1,
                                        minHeight: view === 'month' ? '120px' : '100px',
                                        backgroundColor: isCurrentDay ? 'primary.light' : 'background.paper',
                                        border: isCurrentDay ? '2px solid' : '1px solid',
                                        borderColor: isCurrentDay ? 'primary.main' : '#e0e0e0',
                                        borderRight: '1px solid #e0e0e0',
                                        opacity: view === 'month' && !isInCurrentMonth ? 0.5 : 1,
                                        position: 'relative',
                                        '&:last-child': {
                                            borderRight: 'none'
                                        }
                                    }}
                                >
                                    <Typography 
                                        variant="caption" 
                                        sx={{ 
                                            fontWeight: isCurrentDay ? 'bold' : 'normal',
                                            color: isCurrentDay ? 'primary.contrastText' : 'text.primary'
                                        }}
                                    >
                                        {day.getDate()}
                                    </Typography>
                                    
                                    {/* Events for this day */}
                                    <Box sx={{ mt: 0.5 }}>
                                        {dayEvents
                                            .filter(event => {
                                                if (!event.start?.dateTime) return true;
                                                const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                                                    hour12: false, 
                                                    hour: '2-digit', 
                                                    minute: '2-digit' 
                                                });
                                                // Skip events in sleep time
                                                return !isSleepTime(eventTime);
                                            })
                                            .slice(0, view === 'month' ? 2 : 3)
                                            .map((event) => {
                                                // Get phase for this event
                                                let eventPhase = null;
                                                if (event.start?.dateTime) {
                                                    const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                                                        hour12: false, 
                                                        hour: '2-digit', 
                                                        minute: '2-digit' 
                                                    });
                                                    eventPhase = getPhaseForTime(eventTime);
                                                }
                                            
                                            return (
                                                <Tooltip key={event.id} title={
                                                    <Box>
                                                        <Typography variant="subtitle2">{event.summary || 'Event'}</Typography>
                                                        {event.description && <Typography variant="body2">{event.description}</Typography>}
                                                        <Typography variant="caption">{formatEventTime(event)}</Typography>
                                                        {event.location && <Typography variant="caption">Location: {event.location}</Typography>}
                                                    </Box>
                                                } arrow>
                                                    <Box
                                                        key={event.id}
                                                        sx={{
                                                            p: 0.5,
                                                            mb: 0.5,
                                                            backgroundColor: getEventColor(event),
                                                            color: 'white',
                                                            borderRadius: 0.5,
                                                            fontSize: '0.7rem',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            border: eventPhase 
                                                                ? `2px solid ${eventPhase.color}` 
                                                                : '1px solid rgba(255,255,255,0.3)',
                                                            position: 'relative'
                                                        }}
                                                        title={undefined}
                                                        onClick={() => onEditEvent && onEditEvent(event.id)}
                                                    >
                                                        {event.summary || 'Event'}
                                                        {eventPhase && (
                                                            <Box 
                                                                sx={{ 
                                                                    position: 'absolute',
                                                                    top: -2,
                                                                    right: -2,
                                                                    width: 8,
                                                                    height: 8,
                                                                    borderRadius: '50%',
                                                                    backgroundColor: eventPhase.color,
                                                                    border: '1px solid white'
                                                                }}
                                                            />
                                                        )}
                                                    </Box>
                                                </Tooltip>
                                            );
                                        })}
                                        {(() => {
                                            const filteredEvents = dayEvents.filter(event => {
                                                if (!event.start?.dateTime) return true;
                                                const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                                                    hour12: false, 
                                                    hour: '2-digit', 
                                                    minute: '2-digit' 
                                                });
                                                return !isSleepTime(eventTime);
                                            });
                                            const maxEvents = view === 'month' ? 2 : 3;
                                            return filteredEvents.length > maxEvents ? (
                                                <Typography 
                                                    variant="caption" 
                                                    color="text.secondary"
                                                    sx={{ fontSize: '0.6rem' }}
                                                >
                                                    +{filteredEvents.length - maxEvents} more
                                                </Typography>
                                            ) : null;
                                        })()}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default CalendarGrid; 