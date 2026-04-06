import React, { useState } from 'react';
import { 
    Box, 
    Typography, 
    Paper,
    TextField,
    InputAdornment,
    Chip,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid
} from '@mui/material';
// import { Search, FilterList } from '@mui/icons-material';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor, isEventToday, isEventThisWeek } from '../hooks/useCalendar';

interface EventsListProps {
    events: GoogleCalendarEvent[];
    isLoading: boolean;
    error: any;
}

type FilterType = 'all' | 'today' | 'this-week' | 'upcoming';

const EventsList: React.FC<EventsListProps> = ({ events, isLoading, error }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('all');

    const filteredEvents = events.filter(event => {
        // Search filter
        const matchesSearch = !searchTerm || 
            (event.summary && event.summary.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (event.description && event.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (event.location && event.location.toLowerCase().includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        // Date filter
        switch (filterType) {
            case 'today': {
                return isEventToday(event);
            }
            case 'this-week': {
                return isEventThisWeek(event);
            }
            case 'upcoming': {
                const eventDate = event.start.dateTime 
                    ? new Date(event.start.dateTime)
                    : new Date(event.start.date!);
                return eventDate >= new Date();
            }
            default: {
                return true;
            }
        }
    });

    const sortedEvents = [...filteredEvents].sort((a, b) => {
        const dateA = a.start.dateTime ? new Date(a.start.dateTime) : new Date(a.start.date!);
        const dateB = b.start.dateTime ? new Date(b.start.dateTime) : new Date(b.start.date!);
        return dateA.getTime() - dateB.getTime();
    });

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <Typography>Loading events...</Typography>
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="error">
                    Failed to load events: {error.message}
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            {/* Filters */}
            <Box sx={{ mb: 3 }}>
                <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                        <TextField
                            fullWidth
                            placeholder="Search events..."
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
                    <Grid item xs={12} md={6}>
                        <FormControl fullWidth>
                            <InputLabel>Filter</InputLabel>
                            <Select
                                value={filterType}
                                label="Filter"
                                onChange={(e) => setFilterType(e.target.value as FilterType)}
                                startAdornment={
                                    <InputAdornment position="start">
                                        ⚙️
                                    </InputAdornment>
                                }
                            >
                                <MenuItem value="all">All Events</MenuItem>
                                <MenuItem value="today">Today</MenuItem>
                                <MenuItem value="this-week">This Week</MenuItem>
                                <MenuItem value="upcoming">Upcoming</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </Box>

            {/* Results count */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                    Showing {sortedEvents.length} of {events.length} events
                </Typography>
            </Box>

            {/* Events list */}
            {sortedEvents.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {sortedEvents.map((event) => (
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
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    {isEventToday(event) && (
                                        <Chip 
                                            label="Today" 
                                            size="small" 
                                            color="primary" 
                                            variant="outlined"
                                        />
                                    )}
                                    {event.status && event.status !== 'confirmed' && (
                                        <Chip 
                                            label={event.status} 
                                            size="small" 
                                            color={event.status === 'cancelled' ? 'error' : 'warning'}
                                        />
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
                        </Paper>
                    ))}
                </Box>
            ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body1" color="text.secondary">
                        {searchTerm || filterType !== 'all' 
                            ? 'No events match your search criteria'
                            : 'No events found'
                        }
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export default EventsList; 