import React, { useState } from 'react';
import { 
    Box, 
    Container, 
    Typography, 
    CircularProgress,
    Alert,
    Button,
    TextField,
    InputAdornment,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    Card,
    CardContent,
    CardActions,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@mui/material';
import {
  useEventsForDay,
  useEventsForWeek,
  useEventsForMonth,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import { useTimePhases } from 'modules/phases/hooks/usePhases';
import { EventType } from 'modules/calendar/types';

type CalendarView = 'day' | 'week' | 'month';

const EventsPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<CalendarView>('week');
    const [currentDate] = useState(new Date());
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPhase, setSelectedPhase] = useState<string>('all');
    const { data: timePhases = [] } = useTimePhases();

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
    
    const getEventsQuery = {
        queryKey: [currentView, currentDate],
        queryFn: async () => {
            const query = queryMap[currentView];
            if (query) {
                return { events: (query.data?.events || []) as EventType[] };
            }
            return { events: [] };
        },
    };
    const [createEventTrigger, createEventState] = useCreateEvent();
    const [updateEventTrigger, updateEventState] = useUpdateEvent();
    const [deleteEventTrigger, deleteEventState] = useDeleteEvent();

    // Filter events based on search and phase
    const events = queryMap[currentView].data?.events || [];
    const filteredEvents = events.filter((event: EventType) => {
        const matchesSearch = event.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            event.description?.toLowerCase().includes(searchTerm.toLowerCase());
        // Filter by time phase
        let matchesPhase = selectedPhase === 'all';
        if (selectedPhase !== 'all' && event.start?.dateTime) {
            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const selectedPhaseData = timePhases.find(phase => phase.id === selectedPhase);
            if (selectedPhaseData) {
                const eventMinutes = timeToMinutes(eventTime);
                const startMinutes = timeToMinutes(selectedPhaseData.startTime);
                const endMinutes = timeToMinutes(selectedPhaseData.endTime);
                if (startMinutes > endMinutes) {
                    matchesPhase = eventMinutes >= startMinutes || eventMinutes <= endMinutes;
                } else {
                    matchesPhase = eventMinutes >= startMinutes && eventMinutes <= endMinutes;
                }
            }
        }
        return matchesSearch && matchesPhase;
    });

    // Utility function to convert time string to minutes
    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const handleCreateEvent = () => {
        setEventFormDialog({ open: true, event: null });
    };

    const handleEditEvent = (eventId: string) => {
        getEventsQuery.queryFn().then(data => {
            const event = data?.events?.find((e: EventType) => e.id === eventId);
            if (event) {
                setEventFormDialog({ open: true, event });
            }
        });
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
                // You could show an error toast here
            }
        }
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
    };

    const handleEventFormSubmit = async (data: any) => {
        try {
            if (eventFormDialog.event) {
                // Update existing event
                await updateEventTrigger({ 
                    eventId: eventFormDialog.event.id, 
                    eventData: data 
                });
            } else {
                // Create new event
                await createEventTrigger({ eventData: data });
            }
            setEventFormDialog({ open: false, event: null });
        } catch (error) {
            console.error('Failed to save event:', error);
            // You could show an error toast here
        }
    };

    const closeEventForm = () => {
        setEventFormDialog({ open: false, event: null });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (queryMap[currentView].isLoading) {
        return (
            <Container maxWidth="lg">
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (queryMap[currentView].isError) {
        return (
            <Container maxWidth="lg">
                <Alert severity="error" sx={{ mb: 3 }}>
                    Failed to load events. Please check your Google Calendar connection.
                </Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ pt: 2 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Events Management
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                    Manage and organize your calendar events
                </Typography>
            </Box>

            {/* Controls */}
            <Box sx={{ mb: 4 }}>
                <Grid container spacing={3} alignItems="center">
                    <Grid item xs={12} md={3}>
                        <TextField
                            fullWidth
                            label="Search events"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        🔍
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <FormControl fullWidth>
                            <InputLabel>Time Phase</InputLabel>
                            <Select
                                value={selectedPhase}
                                label="Time Phase"
                                onChange={(e) => setSelectedPhase(e.target.value)}
                            >
                                <MenuItem value="all">All Phases</MenuItem>
                                {timePhases.map((phase) => (
                                    <MenuItem key={phase.id} value={phase.id}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box 
                                                sx={{ 
                                                    width: 12, 
                                                    height: 12, 
                                                    borderRadius: '50%', 
                                                    backgroundColor: phase.color,
                                                    border: '1px solid #ccc'
                                                }} 
                                            />
                                            {phase.name} ({phase.startTime} - {phase.endTime})
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <FormControl fullWidth>
                            <InputLabel>Time Range</InputLabel>
                            <Select
                                value={currentView}
                                label="Time Range"
                                onChange={(e) => setCurrentView(e.target.value as CalendarView)}
                            >
                                <MenuItem value="day">Today</MenuItem>
                                <MenuItem value="week">This Week</MenuItem>
                                <MenuItem value="month">This Month</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Button
                            variant="contained"
                            onClick={handleCreateEvent}
                            fullWidth
                            sx={{ height: '56px' }}
                        >
                            ➕ Create Event
                        </Button>
                    </Grid>
                </Grid>
            </Box>

            {/* Events List */}
            <Box>
                <Typography variant="h6" gutterBottom>
                    Events ({filteredEvents.length})
                </Typography>
                
                {filteredEvents.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 8 }}>
                        <Typography variant="body1" color="text.secondary">
                            No events found. Try adjusting your search criteria or create a new event.
                        </Typography>
                    </Box>
                ) : (
                    <Grid container spacing={2}>
                        {filteredEvents.map((event: EventType) => (
                            <Grid item xs={12} md={6} lg={4} key={event.id}>
                                <Card>
                                    <CardContent>
                                        <Typography variant="h6" gutterBottom>
                                            {event.summary || 'Untitled Event'}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" gutterBottom>
                                            📅 {formatDate(event.start?.dateTime || event.start?.date || '')}
                                        </Typography>
                                        {event.description && (
                                            <Typography variant="body2" sx={{ mb: 2 }}>
                                                {event.description.length > 100 
                                                    ? `${event.description.substring(0, 100)}...` 
                                                    : event.description}
                                            </Typography>
                                        )}
                                        {/* Show time phase if available */}
                                        {event.start?.dateTime && (() => {
                                            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
                                                hour12: false, 
                                                hour: '2-digit', 
                                                minute: '2-digit' 
                                            });
                                            const phase = timePhases.find(cat => {
                                                const eventMinutes = timeToMinutes(eventTime);
                                                const startMinutes = timeToMinutes(cat.startTime);
                                                const endMinutes = timeToMinutes(cat.endTime);
                                                
                                                if (startMinutes > endMinutes) {
                                                    return eventMinutes >= startMinutes || eventMinutes <= endMinutes;
                                                } else {
                                                    return eventMinutes >= startMinutes && eventMinutes <= endMinutes;
                                                }
                                            });
                                            
                                            return phase ? (
                                                <Box sx={{ mb: 2 }}>
                                                    <Chip 
                                                        label={phase.name}
                                                        size="small" 
                                                        sx={{ 
                                                            mr: 1, 
                                                            mb: 1,
                                                            backgroundColor: phase.color,
                                                            color: 'white'
                                                        }}
                                                    />
                                                </Box>
                                            ) : null;
                                        })()}
                                        {event.location && (
                                            <Typography variant="body2" color="text.secondary">
                                                📍 {event.location}
                                            </Typography>
                                        )}
                                    </CardContent>
                                    <CardActions>
                                        <Button 
                                            size="small" 
                                            onClick={() => handleEditEvent(event.id)}
                                        >
                                            ✏️ Edit
                                        </Button>
                                        <Button 
                                            size="small" 
                                            color="error"
                                            onClick={() => handleDeleteEvent(event.id, event.summary || 'Untitled Event')}
                                        >
                                            🗑️ Delete
                                        </Button>
                                    </CardActions>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Box>

            {/* Event Form Dialog */}
            <EventForm
                open={eventFormDialog.open}
                onClose={closeEventForm}
                onSubmit={handleEventFormSubmit}
                event={eventFormDialog.event}
                isSubmitting={createEventState.isLoading || updateEventState.isLoading}
                error={
                    (createEventState.error instanceof Error ? createEventState.error.message : undefined) ||
                    (updateEventState.error instanceof Error ? updateEventState.error.message : undefined)
                }
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

export default EventsPage; 