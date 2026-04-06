import React, { useState } from 'react';
import { 
    Box, 
    Container, 
    Typography, 
    ToggleButtonGroup, 
    ToggleButton,
    CircularProgress,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button
} from '@mui/material';
import {
  useEventsForDay,
  useEventsForWeek,
  useEventsForMonth,
  useUpdateEvent,
  useDeleteEvent,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import CalendarEvents from 'modules/calendar/components/CalendarEvents';
import CalendarGrid from 'modules/calendar/components/CalendarGrid';
import { EventType } from 'modules/calendar/types';

type CalendarView = 'day' | 'week' | 'month';

const CalendarPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<CalendarView>('week');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ open: boolean; eventId: string | null; eventName: string }>({
        open: false,
        eventId: null,
        eventName: ''
    });
    const [eventFormDialog, setEventFormDialog] = useState<{ open: boolean; event: GoogleCalendarEvent | null }>({
        open: false,
        event: null
    });

    // Get events for the current view
    const dayEventsQuery = useEventsForDay(currentDate);
    const weekEventsQuery = useEventsForWeek(currentDate);
    const monthEventsQuery = useEventsForMonth(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1
    );

    // Select the appropriate query based on current view
    const queryMap = {
        day: dayEventsQuery,
        week: weekEventsQuery,
        month: monthEventsQuery,
    };
    
    const getEventsQuery = queryMap[currentView];
    const [updateEventTrigger, updateEventState] = useUpdateEvent();
    const [deleteEventTrigger, deleteEventState] = useDeleteEvent();

    const handleViewChange = (
        event: React.MouseEvent<HTMLElement>,
        newView: CalendarView | null,
    ) => {
        if (newView !== null) {
            setCurrentView(newView);
        }
    };

    const formatDate = (date: Date, view: CalendarView): string => {
        switch (view) {
            case 'day': {
                return date.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            }
            case 'week': {
                const startOfWeek = new Date(date);
                // Monday = 1, Sunday = 0, so we need to adjust
                const dayOfWeek = date.getDay();
                const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday becomes 6 days back
                startOfWeek.setDate(date.getDate() - daysToSubtract);
                
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                return `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`;
            }
            case 'month': {
                return date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long' 
                });
            }
            default: {
                return date.toLocaleDateString();
            }
        }
    };

    const handleDeleteEvent = (eventId: string, eventName: string) => {
        setDeleteConfirmDialog({
            open: true,
            eventId,
            eventName
        });
    };

    const confirmDeleteEvent = async () => {
        if (deleteConfirmDialog.eventId) {
            try {
                await deleteEventTrigger({ eventId: deleteConfirmDialog.eventId });
                setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
            } catch (error) {
                console.error('Failed to delete event:', error);
            }
        }
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
    };

    const handleEditEvent = (eventId: string) => {
        const event = getEventsQuery.data?.events?.find((e: EventType) => e.id === eventId);
        if (event) {
            setEventFormDialog({ open: true, event });
        }
    };

    const handleEventFormSubmit = async (data: any) => {
        try {
            if (eventFormDialog.event) {
                await updateEventTrigger({ 
                    eventId: eventFormDialog.event.id, 
                    eventData: data 
                });
            }
            setEventFormDialog({ open: false, event: null });
        } catch (error) {
            console.error('Failed to update event:', error);
        }
    };

    const closeEventForm = () => {
        setEventFormDialog({ open: false, event: null });
    };

    if (getEventsQuery.isLoading) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (getEventsQuery.isError) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Alert severity="error" sx={{ mb: 3 }}>
                    Failed to load calendar events. Please check your Google Calendar connection.
                </Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 2 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Calendar
                </Typography>

                {/* View Controls */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <ToggleButtonGroup
                        value={currentView}
                        exclusive
                        onChange={handleViewChange}
                        aria-label="calendar view"
                    >
                        <ToggleButton value="day" aria-label="day view">
                            Day
                        </ToggleButton>
                        <ToggleButton value="week" aria-label="week view">
                            Week
                        </ToggleButton>
                        <ToggleButton value="month" aria-label="month view">
                            Month
                        </ToggleButton>
                    </ToggleButtonGroup>

                    <Typography variant="h6" component="h2">
                        {formatDate(currentDate, currentView)}
                    </Typography>
                    {currentView === 'day' && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button size="small" onClick={() => setCurrentDate(prev => {
                                const d = new Date(prev);
                                d.setDate(d.getDate() - 1);
                                return d;
                            })}>
                                ←
                            </Button>
                            <Button size="small" onClick={() => setCurrentDate(new Date())}>
                                Today
                            </Button>
                            <Button size="small" onClick={() => setCurrentDate(prev => {
                                const d = new Date(prev);
                                d.setDate(d.getDate() + 1);
                                return d;
                            })}>
                                →
                            </Button>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* Calendar Grid */}
            <Box sx={{ mb: 3 }}>
                <CalendarGrid
                    view={currentView}
                    date={currentDate}
                    events={getEventsQuery.data?.events || []}
                    onEditEvent={handleEditEvent}
                    onDeleteEvent={handleDeleteEvent}
                />
            </Box>

            {/* Events List */}
            <CalendarEvents
                events={getEventsQuery.data?.events || []}
                isLoading={getEventsQuery.isLoading}
                error={getEventsQuery.error}
                title={`${currentView.charAt(0).toUpperCase() + currentView.slice(1)} Events`}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
            />

            {/* Event Form Dialog */}
            <EventForm
                open={eventFormDialog.open}
                onClose={closeEventForm}
                onSubmit={handleEventFormSubmit}
                event={eventFormDialog.event}
                isSubmitting={updateEventState.isLoading}
                error={updateEventState.error instanceof Error ? updateEventState.error.message : undefined}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirmDialog.open} onClose={cancelDeleteEvent} maxWidth="sm" fullWidth>
                <DialogTitle>Delete Event</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" gutterBottom>
                        Are you sure you want to delete the event &quot;{deleteConfirmDialog.eventName}&quot;?
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        This action cannot be undone. The event will be permanently removed from your Google Calendar.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancelDeleteEvent} disabled={deleteEventState.isLoading}>
                        Cancel
                    </Button>
                    <Button 
                        variant="contained" 
                        color="error" 
                        onClick={confirmDeleteEvent}
                        disabled={deleteEventState.isLoading}
                    >
                        {deleteEventState.isLoading ? 'Deleting...' : 'Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default CalendarPage; 