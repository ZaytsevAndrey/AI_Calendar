import React from 'react';
import { 
    Box, 
    Typography, 
    CircularProgress, 
    Alert,
    Paper,
    Chip,
    Button
} from '@mui/material';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor, isEventToday } from '../hooks/useCalendar';

interface CalendarEventsProps {
    events: GoogleCalendarEvent[];
    isLoading: boolean;
    error: any;
    title?: string;
    onEditEvent?: (eventId: string) => void;
    onDeleteEvent?: (eventId: string, eventName: string) => void;
}

const CalendarEvents: React.FC<CalendarEventsProps> = ({ 
    events, 
    isLoading, 
    error, 
    title = "Events",
    onEditEvent,
    onDeleteEvent
}) => {
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                Failed to load events: {error.message}
            </Alert>
        );
    }

    if (!events || events.length === 0) {
        return (
            <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body1" color="text.secondary">
                    No events found for this period
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="h6" gutterBottom>
                {title} ({events.length})
            </Typography>
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {events.map((event) => (
                    <Paper 
                        key={event.id} 
                        sx={{ 
                            p: 2, 
                            borderLeft: `4px solid ${getEventColor(event)}`,
                            '&:hover': {
                                boxShadow: 2,
                                transform: 'translateY(-1px)',
                                transition: 'all 0.2s ease'
                            }
                        }}
                    >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                                {event.summary || 'Untitled Event'}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                {isEventToday(event) && (
                                    <Chip 
                                        label="Today" 
                                        size="small" 
                                        color="primary" 
                                        variant="outlined"
                                    />
                                )}
                                {onEditEvent && (
                                    <Button 
                                        size="small" 
                                        onClick={() => onEditEvent(event.id)}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        ✏️ Edit
                                    </Button>
                                )}
                                {onDeleteEvent && (
                                    <Button 
                                        size="small" 
                                        color="error"
                                        onClick={() => onDeleteEvent(event.id, event.summary || 'Untitled Event')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        🗑️ Delete
                                    </Button>
                                )}
                            </Box>
                        </Box>
                        
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {formatEventTime(event)}
                        </Typography>
                        
                        {event.description && (
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {event.description}
                            </Typography>
                        )}
                        
                        {event.location && (
                            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                📍 {event.location}
                            </Typography>
                        )}
                        
                        {event.attendees && event.attendees.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Attendees: {event.attendees.length}
                                </Typography>
                            </Box>
                        )}
                        
                        {event.status && event.status !== 'confirmed' && (
                            <Chip 
                                label={event.status} 
                                size="small" 
                                color={event.status === 'cancelled' ? 'error' : 'warning'}
                                sx={{ mt: 1 }}
                            />
                        )}
                    </Paper>
                ))}
            </Box>
        </Box>
    );
};

export default CalendarEvents; 