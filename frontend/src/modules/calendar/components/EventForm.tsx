import React from 'react';
import { 
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Alert,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormControlLabel,
    Checkbox,
    Typography
} from '@mui/material';
import { GoogleCalendarEvent, CreateEventParams, UpdateEventParams } from '../../../api/google-calendar.api';
import { useTimePhases, getPhaseByTime, useSleepTimePhases } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import EmojiPicker from 'emoji-picker-react';
import { useState } from 'react';

// Google Calendar default colors (colorId)
const GOOGLE_COLORS = [
  { id: '1', color: '#7986cb' },
  { id: '2', color: '#33b679' },
  { id: '3', color: '#8e24aa' },
  { id: '4', color: '#e67c73' },
  { id: '5', color: '#f6c026' },
  { id: '6', color: '#f5511d' },
  { id: '7', color: '#039be5' },
  { id: '8', color: '#616161' },
  { id: '9', color: '#3f51b5' },
  { id: '10', color: '#0b8043' },
  { id: '11', color: '#d60000' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
];

const STATUSES = [
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface EventFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: CreateEventParams | UpdateEventParams) => void;
    event?: GoogleCalendarEvent | null;
    isSubmitting: boolean;
    error?: string | null;
}

const EventForm: React.FC<EventFormProps> = ({ 
    open, 
    onClose, 
    onSubmit, 
    event, 
    isSubmitting,
    error 
}) => {
    const { data: timePhases = [] } = useTimePhases();
    const { data: sleepTimePhases = [] } = useSleepTimePhases();
    // Prefer useGetUserSettingsQuery from userSettingsApi (RTK Query) over useQuery
    const { data: userSettings } = useGetUserSettingsQuery();
    
    const [formData, setFormData] = React.useState<{
        summary: string;
        description: string;
        location: string;
        startDate: string;
        startTime: string;
        endDate: string;
        endTime: string;
        selectedPhaseId?: string;
        colorId?: string;
        emoji?: string;
        priority?: string;
        status?: string;
    }>({
        summary: event?.summary || '',
        description: event?.description || '',
        location: event?.location || '',
        startDate: event?.start.dateTime 
            ? new Date(event.start.dateTime).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        startTime: event?.start.dateTime 
            ? new Date(event.start.dateTime).toISOString().split('T')[1].substring(0, 5)
            : '09:00',
        endDate: event?.end.dateTime 
            ? new Date(event.end.dateTime).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        endTime: event?.end.dateTime 
            ? new Date(event.end.dateTime).toISOString().split('T')[1].substring(0, 5)
            : '10:00',
        selectedPhaseId: undefined,
        colorId: event?.colorId || '1',
        emoji: (event as any)?.emoji || '',
        priority: (event as any)?.priority || 'normal',
        status: (event as any)?.status || 'in_progress',
    });

    const [colorId, setColorId] = useState(formData.colorId || '1');
    const [emoji, setEmoji] = useState(formData.emoji || '');
    const [priority, setPriority] = useState(formData.priority || 'normal');
    const [status, setStatus] = useState(formData.status || 'in_progress');
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceRule, setRecurrenceRule] = useState('');
    const [deadline, setDeadline] = useState('');
    const [estimatedTime, setEstimatedTime] = useState('');
    const [splitTasks, setSplitTasks] = useState(false);
    const [splitMin, setSplitMin] = useState('');
    const [splitMax, setSplitMax] = useState('');
    const [reminders, setReminders] = useState([{ method: 'popup', minutes: 10 }]);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [phaseError, setPhaseError] = useState<string | null>(null);

    // Check if time is in sleep time
    const isSleepTime = (time: string) => {
        if (!userSettings?.sleepTime || !userSettings?.wakeTime) {
            // Fallback to sleep phases if settings not loaded
            return sleepTimePhases.some((cat: any) => {
                const timeMinutes = timeToMinutes(time);
                const startMinutes = timeToMinutes(cat.startTime);
                const endMinutes = timeToMinutes(cat.endTime);
                
                if (startMinutes > endMinutes) {
                    // Sleep time spans midnight
                    return timeMinutes >= startMinutes || timeMinutes <= endMinutes;
                } else {
                    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
                }
            });
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

    // Utility function to convert time string to minutes
    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    React.useEffect(() => {
        if (event) {
            setFormData({
                summary: event.summary || '',
                description: event.description || '',
                location: event.location || '',
                startDate: event.start.dateTime 
                    ? new Date(event.start.dateTime).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0],
                startTime: event.start.dateTime 
                    ? new Date(event.start.dateTime).toISOString().split('T')[1].substring(0, 5)
                    : '09:00',
                endDate: event.end.dateTime 
                    ? new Date(event.end.dateTime).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0],
                endTime: event.end.dateTime 
                    ? new Date(event.end.dateTime).toISOString().split('T')[1].substring(0, 5)
                    : '10:00',
                selectedPhaseId: undefined,
                colorId: event.colorId || '1',
                emoji: (event as any)?.emoji || '',
                priority: (event as any)?.priority || 'normal',
                status: (event as any)?.status || 'in_progress',
            });
        } else {
            // Reset form for new event
            const now = new Date();
            setFormData({
                summary: '',
                description: '',
                location: '',
                startDate: now.toISOString().split('T')[0],
                startTime: '09:00',
                endDate: now.toISOString().split('T')[0],
                endTime: '10:00',
                selectedPhaseId: undefined,
                colorId: '1',
                emoji: '',
                priority: 'normal',
                status: 'in_progress',
            });
        }
    }, [event, open]);

    // Clear deadline when isRecurring becomes true
    React.useEffect(() => {
        if (isRecurring) setDeadline('');
    }, [isRecurring]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPhaseError(null);
        // Check if start or end time is in sleep time
        if (isSleepTime(formData.startTime) || isSleepTime(formData.endTime)) {
            alert('Events cannot be created during sleep time.');
            return;
        }
        // When phases exist, phaseId is required
        if (timePhases.length > 0 && !formData.selectedPhaseId) {
            setPhaseError('Please select a phase');
            return;
        }
        const startDateTime = formData.startTime && formData.startDate ? new Date(`${formData.startDate}T${formData.startTime}`) : undefined;
        const endDateTime = formData.endTime && formData.endDate ? new Date(`${formData.endDate}T${formData.endTime}`) : undefined;
        const eventData = {
            summary: formData.summary,
            description: formData.description || undefined,
            location: formData.location || undefined,
            start: startDateTime ? {
                dateTime: startDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            } : undefined,
            end: endDateTime ? {
                dateTime: endDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            } : undefined,
            colorId,
            emoji,
            priority,
            status,
            phaseId: formData.selectedPhaseId || undefined,
            recurrence: isRecurring && recurrenceRule ? [recurrenceRule] : undefined,
            deadline,
            estimatedTime,
            splitTasks,
            splitMin,
            splitMax,
            reminders: { useDefault: false, overrides: reminders.map(r => ({ method: r.method as 'popup' | 'email', minutes: r.minutes })) },
        };
        onSubmit(eventData);
    };

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => {
            const newData = {
                ...prev,
                [field]: value
            };
            
            // Auto-select phase based on start time
            if (field === 'startTime' && timePhases.length > 0) {
                const suggestedPhase = getPhaseByTime(timePhases, value);
                if (suggestedPhase) {
                    newData.selectedPhaseId = suggestedPhase.id;
                }
            }
            
            return newData;
        });
    };

    // Phases sorted for the select
    const sortedTimePhases = [...timePhases].sort((a: any, b: any) => {
      const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      return toMinutes(a.startTime) - toMinutes(b.startTime);
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {event ? 'Edit Event' : 'Create New Event'}
            </DialogTitle>
            <form onSubmit={handleSubmit}>
                <DialogContent>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {error}
                        </Alert>
                    )}
                    
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            label="Title *"
                            value={formData.summary}
                            onChange={(e) => handleInputChange('summary', e.target.value)}
                            required
                            fullWidth
                        />
                        
                        <TextField
                            label="Description"
                            value={formData.description}
                            onChange={(e) => handleInputChange('description', e.target.value)}
                            multiline
                            rows={3}
                            fullWidth
                        />
                        
                        <TextField
                            label="Location"
                            value={formData.location}
                            onChange={(e) => handleInputChange('location', e.target.value)}
                            fullWidth
                        />
                        
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TextField
                                label="Start Date *"
                                type="date"
                                value={formData.startDate}
                                onChange={(e) => handleInputChange('startDate', e.target.value)}
                                required
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                            
                            <TextField
                                label="Start Time *"
                                type="time"
                                value={formData.startTime}
                                onChange={(e) => handleInputChange('startTime', e.target.value)}
                                required={false}
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                        </Box>
                        
                        {/* Time Phase Selection */}
                        <FormControl fullWidth error={!!phaseError}>
                            <InputLabel>Time Phase</InputLabel>
                            <Select
                                value={formData.selectedPhaseId || ''}
                                label="Time Phase"
                                onChange={(e) => handleInputChange('selectedPhaseId', e.target.value)}
                            >
                                <MenuItem value="">
                                    <em>{timePhases.length === 0 ? 'No phases available' : 'No phase'}</em>
                                </MenuItem>
                                {sortedTimePhases.map((phase: any) => (
                                    <MenuItem key={phase.id} value={phase.id}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box 
                                                sx={{ 
                                                    width: 16, 
                                                    height: 16, 
                                                    borderRadius: '50%', 
                                                    backgroundColor: phase.color,
                                                    border: '1px solid #ccc'
                                                }} 
                                            />
                                            <Box>
                                                <Box sx={{ fontWeight: 500 }}>{phase.name}</Box>
                                                <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                                    {phase.startTime} - {phase.endTime}
                                                </Box>
                                            </Box>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                            {phaseError && <Typography color="error" variant="caption">{phaseError}</Typography>}
                        </FormControl>
                        
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TextField
                                label="End Date *"
                                type="date"
                                value={formData.endDate}
                                onChange={(e) => handleInputChange('endDate', e.target.value)}
                                required
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                            
                            <TextField
                                label="End Time *"
                                type="time"
                                value={formData.endTime}
                                onChange={(e) => handleInputChange('endTime', e.target.value)}
                                required={false}
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel>Color</InputLabel>
                                <Select value={colorId} label="Color" onChange={e => setColorId(e.target.value)}>
                                    {GOOGLE_COLORS.map(c => (
                                        <MenuItem key={c.id} value={c.id}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box sx={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: c.color, border: '1px solid #ccc' }} />
                                                {c.color}
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth>
                                <InputLabel>Icon</InputLabel>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Button onClick={() => setShowEmojiPicker(v => !v)}>{emoji || 'Select'}</Button>
                                    {showEmojiPicker && <EmojiPicker onEmojiClick={(e: any) => { setEmoji(e.emoji); setShowEmojiPicker(false); }} />}
                                </Box>
                            </FormControl>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel>Priority</InputLabel>
                                <Select value={priority} label="Priority" onChange={e => setPriority(e.target.value)}>
                                    {PRIORITIES.map(p => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth>
                                <InputLabel>Status</InputLabel>
                                <Select value={status} label="Status" onChange={e => setStatus(e.target.value)}>
                                    {STATUSES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControlLabel control={<Checkbox checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />} label="Recurring Task" />
                            {isRecurring && (
                                <TextField label="RRULE (e.g. FREQ=DAILY;COUNT=5)" value={recurrenceRule} onChange={e => setRecurrenceRule(e.target.value)} fullWidth />
                            )}
                        </Box>
                        {!isRecurring && (
                            <TextField 
                                label="Deadline" 
                                type="datetime-local" 
                                value={deadline} 
                                onChange={e => setDeadline(e.target.value)} 
                                fullWidth 
                                InputLabelProps={{ shrink: true }}
                                placeholder="Select deadline"
                            />
                        )}
                        <TextField label="Estimated Time (min)" type="number" value={estimatedTime} onChange={e => setEstimatedTime(e.target.value)} fullWidth />
                        <FormControlLabel control={<Checkbox checked={splitTasks} onChange={e => setSplitTasks(e.target.checked)} />} label="Allow split into subtasks" />
                        {splitTasks && (
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <TextField label="Min subtask time (min)" type="number" value={splitMin} onChange={e => setSplitMin(e.target.value)} fullWidth />
                                <TextField label="Max subtask time (min)" type="number" value={splitMax} onChange={e => setSplitMax(e.target.value)} fullWidth />
                            </Box>
                        )}
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2">Reminders</Typography>
                            {reminders.map((rem, idx) => (
                                <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                                    <Select value={rem.method} onChange={e => setReminders(r => r.map((x, i) => i === idx ? { ...x, method: e.target.value } : x))}>
                                        <MenuItem value="popup">Popup</MenuItem>
                                        <MenuItem value="email">Email</MenuItem>
                                    </Select>
                                    <TextField type="number" value={rem.minutes} onChange={e => setReminders(r => r.map((x, i) => i === idx ? { ...x, minutes: Number(e.target.value) } : x))} label="Minutes before event" />
                                    <Button onClick={() => setReminders(r => r.filter((_, i) => i !== idx))}>Delete</Button>
                                </Box>
                            ))}
                            <Button onClick={() => setReminders(r => [...r, { method: 'popup', minutes: 10 }])}>Add Reminder</Button>
                        </Box>
                    </Box>
                </DialogContent>
                
                <DialogActions>
                    <Button onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button 
                        type="submit" 
                        variant="contained" 
                        disabled={isSubmitting || !formData.summary}
                    >
                        {isSubmitting ? 'Saving...' : (event ? 'Update Event' : 'Create Event')}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default EventForm; 