import React, { useState } from 'react';
import { GoogleCalendarEvent, CreateEventParams, UpdateEventParams } from '../../../api/google-calendar.api';
import { useTimePhases, getPhaseByTime, useSleepTimePhases } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Modal } from '../../../ui/Modal';

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

const inp =
    'w-full rounded border border-ide-border bg-ide-input px-3 py-2 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-1 block text-sm text-ide-muted';

interface EventFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: CreateEventParams | UpdateEventParams) => void;
    event?: GoogleCalendarEvent | null;
    isSubmitting: boolean;
    error?: string | null;
}

const FORM_ID = 'event-form-main';

const EventForm: React.FC<EventFormProps> = ({
    open,
    onClose,
    onSubmit,
    event,
    isSubmitting,
    error,
}) => {
    const { data: timePhases = [] } = useTimePhases();
    const { data: sleepTimePhases = [] } = useSleepTimePhases();
    const { data: userSettings } = useGetUserSettingsQuery();

    const [formData, setFormData] = React.useState({
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
        selectedPhaseId: undefined as string | undefined,
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

    const isSleepTime = (time: string) => {
        if (!userSettings?.sleepTime || !userSettings?.wakeTime) {
            return sleepTimePhases.some((cat: any) => {
                const timeMinutes = timeToMinutes(time);
                const startMinutes = timeToMinutes(cat.startTime);
                const endMinutes = timeToMinutes(cat.endTime);
                if (startMinutes > endMinutes) {
                    return timeMinutes >= startMinutes || timeMinutes <= endMinutes;
                }
                return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
            });
        }
        const timeMinutes = timeToMinutes(time);
        const sleepStart = timeToMinutes(userSettings.sleepTime);
        const sleepEnd = timeToMinutes(userSettings.wakeTime);
        if (sleepStart > sleepEnd) {
            return timeMinutes >= sleepStart || timeMinutes <= sleepEnd;
        }
        return timeMinutes >= sleepStart && timeMinutes <= sleepEnd;
    };

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
            setColorId(event.colorId || '1');
            setEmoji((event as any)?.emoji || '');
            setPriority((event as any)?.priority || 'normal');
            setStatus((event as any)?.status || 'in_progress');
        } else {
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
            setColorId('1');
            setEmoji('');
            setPriority('normal');
            setStatus('in_progress');
        }
    }, [event, open]);

    React.useEffect(() => {
        if (isRecurring) setDeadline('');
    }, [isRecurring]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPhaseError(null);
        if (isSleepTime(formData.startTime) || isSleepTime(formData.endTime)) {
            alert('Events cannot be created during sleep time.');
            return;
        }
        if (timePhases.length > 0 && !formData.selectedPhaseId) {
            setPhaseError('Please select a phase');
            return;
        }
        const startDateTime =
            formData.startTime && formData.startDate
                ? new Date(`${formData.startDate}T${formData.startTime}`)
                : undefined;
        const endDateTime =
            formData.endTime && formData.endDate
                ? new Date(`${formData.endDate}T${formData.endTime}`)
                : undefined;
        const eventData = {
            summary: formData.summary,
            description: formData.description || undefined,
            location: formData.location || undefined,
            start: startDateTime
                ? {
                      dateTime: startDateTime.toISOString(),
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }
                : undefined,
            end: endDateTime
                ? {
                      dateTime: endDateTime.toISOString(),
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }
                : undefined,
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
            reminders: {
                useDefault: false,
                overrides: reminders.map((r) => ({
                    method: r.method as 'popup' | 'email',
                    minutes: r.minutes,
                })),
            },
        };
        onSubmit(eventData);
    };

    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => {
            const newData = { ...prev, [field]: value };
            if (field === 'startTime' && timePhases.length > 0) {
                const suggestedPhase = getPhaseByTime(timePhases, value);
                if (suggestedPhase) {
                    newData.selectedPhaseId = suggestedPhase.id;
                }
            }
            return newData;
        });
    };

    const sortedTimePhases = [...timePhases].sort((a: any, b: any) => {
        const toMinutes = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        return toMinutes(a.startTime) - toMinutes(b.startTime);
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={event ? 'Edit Event' : 'Create New Event'}
            maxWidthClass="max-w-lg"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="rounded border border-ide-border px-4 py-2 text-sm text-ide-text hover:bg-ide-surface disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form={FORM_ID}
                        disabled={isSubmitting || !formData.summary}
                        className="rounded bg-ide-accentBlue px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
                    </button>
                </>
            }
        >
            <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
                {error ? (
                    <div
                        className="rounded border border-ide-error bg-ide-error/10 px-3 py-2 text-sm text-ide-error"
                        role="alert"
                    >
                        {error}
                    </div>
                ) : null}

                <div>
                    <label htmlFor="ev-summary" className={lbl}>
                        Title *
                    </label>
                    <input
                        id="ev-summary"
                        required
                        className={inp}
                        value={formData.summary}
                        onChange={(e) => handleInputChange('summary', e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="ev-desc" className={lbl}>
                        Description
                    </label>
                    <textarea
                        id="ev-desc"
                        rows={3}
                        className={inp}
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="ev-loc" className={lbl}>
                        Location
                    </label>
                    <input
                        id="ev-loc"
                        className={inp}
                        value={formData.location}
                        onChange={(e) => handleInputChange('location', e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap gap-4">
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-sd" className={lbl}>
                            Start Date *
                        </label>
                        <input
                            id="ev-sd"
                            type="date"
                            required
                            className={inp}
                            value={formData.startDate}
                            onChange={(e) => handleInputChange('startDate', e.target.value)}
                        />
                    </div>
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-st" className={lbl}>
                            Start Time *
                        </label>
                        <input
                            id="ev-st"
                            type="time"
                            className={inp}
                            value={formData.startTime}
                            onChange={(e) => handleInputChange('startTime', e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="ev-phase" className={lbl}>
                        Time Phase
                    </label>
                    <select
                        id="ev-phase"
                        className={`${inp} ${phaseError ? 'border-ide-error' : ''}`}
                        value={formData.selectedPhaseId || ''}
                        onChange={(e) => handleInputChange('selectedPhaseId', e.target.value)}
                    >
                        <option value="">
                            {timePhases.length === 0 ? 'No phases available' : 'No phase'}
                        </option>
                        {sortedTimePhases.map((phase: any) => (
                            <option key={phase.id} value={phase.id}>
                                {phase.name} ({phase.startTime} - {phase.endTime})
                            </option>
                        ))}
                    </select>
                    {phaseError ? <p className="mt-1 text-xs text-ide-error">{phaseError}</p> : null}
                </div>

                <div className="flex flex-wrap gap-4">
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-ed" className={lbl}>
                            End Date *
                        </label>
                        <input
                            id="ev-ed"
                            type="date"
                            required
                            className={inp}
                            value={formData.endDate}
                            onChange={(e) => handleInputChange('endDate', e.target.value)}
                        />
                    </div>
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-et" className={lbl}>
                            End Time *
                        </label>
                        <input
                            id="ev-et"
                            type="time"
                            className={inp}
                            value={formData.endTime}
                            onChange={(e) => handleInputChange('endTime', e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-4">
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-color" className={lbl}>
                            Color
                        </label>
                        <select
                            id="ev-color"
                            className={inp}
                            value={colorId}
                            onChange={(e) => setColorId(e.target.value)}
                        >
                            {GOOGLE_COLORS.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.color}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-[140px] flex-1">
                        <span className={lbl}>Icon</span>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                className="rounded border border-ide-border px-3 py-2 text-sm text-ide-text hover:bg-ide-surface"
                                onClick={() => setShowEmojiPicker((v) => !v)}
                            >
                                {emoji || 'Select'}
                            </button>
                            {showEmojiPicker ? (
                                <div className="w-full">
                                    <EmojiPicker
                                        theme={Theme.DARK}
                                        onEmojiClick={(ev: any) => {
                                            setEmoji(ev.emoji);
                                            setShowEmojiPicker(false);
                                        }}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4">
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-prio" className={lbl}>
                            Priority
                        </label>
                        <select
                            id="ev-prio"
                            className={inp}
                            value={priority}
                            onChange={(e) => setPriority(e.target.value)}
                        >
                            {PRIORITIES.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-[140px] flex-1">
                        <label htmlFor="ev-stat" className={lbl}>
                            Status
                        </label>
                        <select
                            id="ev-stat"
                            className={inp}
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            {STATUSES.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-ide-text">
                    <input
                        type="checkbox"
                        checked={isRecurring}
                        onChange={(e) => setIsRecurring(e.target.checked)}
                        className="rounded border-ide-border"
                    />
                    Recurring Task
                </label>
                {isRecurring ? (
                    <div>
                        <label htmlFor="ev-rrule" className={lbl}>
                            RRULE (e.g. FREQ=DAILY;COUNT=5)
                        </label>
                        <input
                            id="ev-rrule"
                            className={inp}
                            value={recurrenceRule}
                            onChange={(e) => setRecurrenceRule(e.target.value)}
                        />
                    </div>
                ) : null}

                {!isRecurring ? (
                    <div>
                        <label htmlFor="ev-deadline" className={lbl}>
                            Deadline
                        </label>
                        <input
                            id="ev-deadline"
                            type="datetime-local"
                            className={inp}
                            value={deadline}
                            onChange={(e) => setDeadline(e.target.value)}
                        />
                    </div>
                ) : null}

                <div>
                    <label htmlFor="ev-est" className={lbl}>
                        Estimated Time (min)
                    </label>
                    <input
                        id="ev-est"
                        type="number"
                        className={inp}
                        value={estimatedTime}
                        onChange={(e) => setEstimatedTime(e.target.value)}
                    />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-ide-text">
                    <input
                        type="checkbox"
                        checked={splitTasks}
                        onChange={(e) => setSplitTasks(e.target.checked)}
                        className="rounded border-ide-border"
                    />
                    Allow split into subtasks
                </label>
                {splitTasks ? (
                    <div className="flex flex-wrap gap-4">
                        <div className="flex-1">
                            <label className={lbl}>Min subtask time (min)</label>
                            <input
                                type="number"
                                className={inp}
                                value={splitMin}
                                onChange={(e) => setSplitMin(e.target.value)}
                            />
                        </div>
                        <div className="flex-1">
                            <label className={lbl}>Max subtask time (min)</label>
                            <input
                                type="number"
                                className={inp}
                                value={splitMax}
                                onChange={(e) => setSplitMax(e.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                <div>
                    <h3 className="mb-2 text-sm font-semibold text-ide-text">Reminders</h3>
                    {reminders.map((rem, idx) => (
                        <div key={idx} className="mb-2 flex flex-wrap items-center gap-2">
                            <select
                                className={inp + ' w-auto min-w-[100px]'}
                                value={rem.method}
                                onChange={(e) =>
                                    setReminders((r) =>
                                        r.map((x, i) =>
                                            i === idx ? { ...x, method: e.target.value } : x
                                        )
                                    )
                                }
                            >
                                <option value="popup">Popup</option>
                                <option value="email">Email</option>
                            </select>
                            <input
                                type="number"
                                className={inp + ' w-24'}
                                value={rem.minutes}
                                onChange={(e) =>
                                    setReminders((r) =>
                                        r.map((x, i) =>
                                            i === idx ? { ...x, minutes: Number(e.target.value) } : x
                                        )
                                    )
                                }
                            />
                            <button
                                type="button"
                                className="text-sm text-ide-error hover:underline"
                                onClick={() => setReminders((r) => r.filter((_, i) => i !== idx))}
                            >
                                Delete
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="text-sm text-ide-link hover:underline"
                        onClick={() => setReminders((r) => [...r, { method: 'popup', minutes: 10 }])}
                    >
                        Add Reminder
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default EventForm;
