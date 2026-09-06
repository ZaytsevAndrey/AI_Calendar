import React, { useState } from 'react';
import { GoogleCalendarEvent, CreateEventParams, UpdateEventParams } from '../../../api/google-calendar.api';
import { useTimePhases, getPhaseByTime, useSleepTimePhases } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Modal } from '../../../ui/Modal';
import { toLocalDateTimeInput } from '../../../utils/formatDate';

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
    'w-full rounded border border-ide-border bg-ide-input px-2.5 py-1.5 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

interface EventFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: CreateEventParams | UpdateEventParams) => void;
    event?: GoogleCalendarEvent | null;
    isSubmitting: boolean;
    error?: string | null;
}

function defaultRange() {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    return {
        start: toLocalDateTimeInput(start),
        end: toLocalDateTimeInput(end),
    };
}

function timeFromDateTime(value: string): string {
    return value.slice(11, 16);
}

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

    const [summary, setSummary] = useState(event?.summary || '');
    const [description, setDescription] = useState(event?.description || '');
    const [location, setLocation] = useState(event?.location || '');
    const [start, setStart] = useState(
        event?.start.dateTime ? toLocalDateTimeInput(event.start.dateTime) : defaultRange().start,
    );
    const [end, setEnd] = useState(
        event?.end.dateTime ? toLocalDateTimeInput(event.end.dateTime) : defaultRange().end,
    );
    const [selectedPhaseId, setSelectedPhaseId] = useState<string>(event?.phaseId || '');
    const [colorId, setColorId] = useState(event?.colorId || '1');
    const [emoji, setEmoji] = useState((event as { emoji?: string })?.emoji || '');
    const [priority, setPriority] = useState((event as { priority?: string })?.priority || 'normal');
    const [status, setStatus] = useState((event as { status?: string })?.status || 'in_progress');
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceRule, setRecurrenceRule] = useState('');
    const [deadline, setDeadline] = useState('');
    const [estimatedTime, setEstimatedTime] = useState('');
    const [splitTasks, setSplitTasks] = useState(false);
    const [splitMin, setSplitMin] = useState('');
    const [splitMax, setSplitMax] = useState('');
    const [reminders, setReminders] = useState(() =>
        event?.reminders?.overrides?.length
            ? event.reminders.overrides.map((r) => ({ method: r.method, minutes: r.minutes }))
            : [{ method: 'popup', minutes: 10 }],
    );
    const [keepDefaultReminders, setKeepDefaultReminders] = useState(
        !!event?.reminders?.useDefault && !event?.reminders?.overrides?.length,
    );
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showDescription, setShowDescription] = useState(!!event?.description);
    const [showMore, setShowMore] = useState(false);
    const [sleepError, setSleepError] = useState<string | null>(null);

    const isSleepTime = (time: string) => {
        if (!time) return false;
        if (!userSettings?.sleepTime || !userSettings?.wakeTime) {
            return sleepTimePhases.some((cat: { startTime: string; endTime: string }) => {
                const timeMinutes = timeToMinutes(time);
                const startMinutes = timeToMinutes(cat.startTime);
                const endMinutes = timeToMinutes(cat.endTime);
                if (startMinutes > endMinutes) {
                    return timeMinutes >= startMinutes || timeMinutes < endMinutes;
                }
                return timeMinutes >= startMinutes && timeMinutes < endMinutes;
            });
        }
        const timeMinutes = timeToMinutes(time);
        const sleepStart = timeToMinutes(userSettings.sleepTime);
        const sleepEnd = timeToMinutes(userSettings.wakeTime);
        if (sleepStart > sleepEnd) {
            return timeMinutes >= sleepStart || timeMinutes < sleepEnd;
        }
        return timeMinutes >= sleepStart && timeMinutes < sleepEnd;
    };

    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    React.useEffect(() => {
        if (event) {
            setSummary(event.summary || '');
            setDescription(event.description || '');
            setLocation(event.location || '');
            setStart(event.start.dateTime ? toLocalDateTimeInput(event.start.dateTime) : defaultRange().start);
            setEnd(event.end.dateTime ? toLocalDateTimeInput(event.end.dateTime) : defaultRange().end);
            setSelectedPhaseId(event.phaseId || '');
            setColorId(event.colorId || '1');
            setEmoji((event as { emoji?: string }).emoji || '');
            setPriority((event as { priority?: string }).priority || 'normal');
            setStatus(
                event.status === 'confirmed' || event.status === 'tentative' || event.status === 'cancelled'
                    ? 'in_progress'
                    : (event as { status?: string }).status || 'in_progress',
            );
            setShowDescription(!!event.description);
            setShowMore(!!event.location || !!(event as { emoji?: string }).emoji);
            setReminders(
                event.reminders?.overrides?.length
                    ? event.reminders.overrides.map((r) => ({ method: r.method, minutes: r.minutes }))
                    : [{ method: 'popup', minutes: 10 }],
            );
            setKeepDefaultReminders(!!event.reminders?.useDefault && !event.reminders?.overrides?.length);
        } else {
            const range = defaultRange();
            setSummary('');
            setDescription('');
            setLocation('');
            setStart(range.start);
            setEnd(range.end);
            setSelectedPhaseId('');
            setColorId('1');
            setEmoji('');
            setPriority('normal');
            setStatus('in_progress');
            setShowDescription(false);
            setShowMore(false);
            setReminders([{ method: 'popup', minutes: 10 }]);
            setKeepDefaultReminders(false);
        }
        setIsRecurring(false);
        setRecurrenceRule('');
        setDeadline('');
        setEstimatedTime('');
        setSplitTasks(false);
        setSplitMin('');
        setSplitMax('');
        setShowEmojiPicker(false);
        setSleepError(null);
    }, [event, open]);

    React.useEffect(() => {
        if (isRecurring) setDeadline('');
    }, [isRecurring]);

    const handleStartChange = (value: string) => {
        setStart(value);
        const time = timeFromDateTime(value);
        if (time && timePhases.length > 0) {
            const suggestedPhase = getPhaseByTime(timePhases, time);
            if (suggestedPhase) setSelectedPhaseId(suggestedPhase.id);
        }
    };

    const handlePhaseChange = (value: string) => {
        setSelectedPhaseId(value);
        if (!value || timePhases.length === 0) return;
        const selected = timePhases.find((phase: { id: string; startTime?: string }) => phase.id === value);
        if (selected?.startTime && start) {
            setStart(`${start.slice(0, 10)}T${selected.startTime}`);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSleepError(null);
        const startTime = timeFromDateTime(start);
        const endTime = timeFromDateTime(end);
        if (isSleepTime(startTime) || isSleepTime(endTime)) {
            setSleepError('Events cannot be created during sleep time.');
            return;
        }
        const startDateTime = start ? new Date(start) : undefined;
        const endDateTime = end ? new Date(end) : undefined;
        const eventData = {
            summary,
            description: description || undefined,
            location: location || undefined,
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
            phaseId: selectedPhaseId || undefined,
            recurrence: isRecurring && recurrenceRule ? [recurrenceRule] : undefined,
            deadline,
            estimatedTime,
            splitTasks,
            splitMin,
            splitMax,
            reminders: keepDefaultReminders
                ? { useDefault: true }
                : {
                      useDefault: false,
                      overrides: reminders.map((r) => ({
                          method: r.method as 'popup' | 'email',
                          minutes: r.minutes,
                      })),
                  },
        };
        onSubmit(eventData);
    };

    const sortedTimePhases = [...timePhases].sort((a: { startTime: string }, b: { startTime: string }) => {
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
            title={event ? 'Edit event' : 'Create event'}
            maxWidthClass="max-w-xl"
            footer={null}
        >
            <form onSubmit={handleSubmit} className="task-form">
                <div className="space-y-3">
                    {error ? (
                        <div
                            className="rounded border border-ide-error bg-ide-error/10 px-3 py-2 text-sm text-ide-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    ) : null}
                    {sleepError ? (
                        <p className="text-xs text-ide-error" role="alert">
                            {sleepError}
                        </p>
                    ) : null}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8.5rem]">
                        <div>
                            <label htmlFor="ev-summary" className={lbl}>
                                Name <span className="text-ide-error">*</span>
                            </label>
                            <input
                                id="ev-summary"
                                required
                                autoComplete="off"
                                placeholder="e.g. Prepare quarterly review"
                                className={inp}
                                value={summary}
                                onChange={(e) => setSummary(e.target.value)}
                            />
                        </div>
                        <div>
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
                    </div>

                    {showDescription ? (
                        <div>
                            <label htmlFor="ev-desc" className={lbl}>
                                Description
                            </label>
                            <textarea
                                id="ev-desc"
                                rows={2}
                                className={inp}
                                placeholder="Optional context"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="text-xs text-ide-link hover:underline"
                            onClick={() => setShowDescription(true)}
                        >
                            + Description
                        </button>
                    )}

                    <div>
                        <label htmlFor="ev-phase" className={lbl}>
                            Phase
                        </label>
                        <select
                            id="ev-phase"
                            className={inp}
                            value={selectedPhaseId}
                            onChange={(e) => handlePhaseChange(e.target.value)}
                        >
                            <option value="">
                                {timePhases.length === 0 ? 'No phases available' : 'Any time'}
                            </option>
                            {sortedTimePhases.map((phase: { id: string; name: string; startTime: string; endTime: string }) => (
                                <option key={phase.id} value={phase.id}>
                                    {phase.name} ({phase.startTime}–{phase.endTime})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ide-text">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={isRecurring}
                                onChange={(e) => setIsRecurring(e.target.checked)}
                            />
                            Recurring
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={splitTasks}
                                onChange={(e) => setSplitTasks(e.target.checked)}
                            />
                            Allow split
                        </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label htmlFor="ev-start" className={lbl}>
                                Start <span className="text-ide-error">*</span>
                            </label>
                            <input
                                id="ev-start"
                                type="datetime-local"
                                required
                                className={inp}
                                value={start}
                                onChange={(e) => handleStartChange(e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="ev-end" className={lbl}>
                                End <span className="text-ide-error">*</span>
                            </label>
                            <input
                                id="ev-end"
                                type="datetime-local"
                                required
                                className={inp}
                                value={end}
                                onChange={(e) => setEnd(e.target.value)}
                            />
                        </div>
                    </div>

                    {isRecurring ? (
                        <div>
                            <label htmlFor="ev-rrule" className={lbl}>
                                Repeat (RRULE)
                            </label>
                            <input
                                id="ev-rrule"
                                className={inp}
                                placeholder="FREQ=DAILY;COUNT=5"
                                value={recurrenceRule}
                                onChange={(e) => setRecurrenceRule(e.target.value)}
                            />
                        </div>
                    ) : (
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
                    )}

                    <div>
                        <label htmlFor="ev-est" className={lbl}>
                            Duration (min)
                        </label>
                        <input
                            id="ev-est"
                            type="number"
                            min={1}
                            className={inp}
                            value={estimatedTime}
                            onChange={(e) => setEstimatedTime(e.target.value)}
                        />
                    </div>

                    {splitTasks ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label className={lbl}>Min split (min)</label>
                                <input
                                    type="number"
                                    className={inp}
                                    value={splitMin}
                                    onChange={(e) => setSplitMin(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={lbl}>Max split (min)</label>
                                <input
                                    type="number"
                                    className={inp}
                                    value={splitMax}
                                    onChange={(e) => setSplitMax(e.target.value)}
                                />
                            </div>
                        </div>
                    ) : null}

                    {showMore ? (
                        <>
                            <div>
                                <label htmlFor="ev-loc" className={lbl}>
                                    Location
                                </label>
                                <input
                                    id="ev-loc"
                                    className={inp}
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                />
                            </div>
                            <div>
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
                            <div>
                                <span className={lbl}>Color</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {GOOGLE_COLORS.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            title={c.color}
                                            aria-label={`Color ${c.color}`}
                                            className={`h-7 w-7 rounded-full border ${
                                                colorId === c.id
                                                    ? 'border-ide-link ring-2 ring-ide-link'
                                                    : 'border-ide-border'
                                            }`}
                                            style={{ backgroundColor: c.color }}
                                            onClick={() => setColorId(c.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span className={lbl}>Icon</span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        className="rounded border border-ide-border px-2.5 py-1.5 text-sm text-ide-text hover:bg-ide-surface"
                                        onClick={() => setShowEmojiPicker((v) => !v)}
                                    >
                                        {emoji || 'Select'}
                                    </button>
                                    {showEmojiPicker ? (
                                        <div className="w-full">
                                            <EmojiPicker
                                                theme={Theme.DARK}
                                                onEmojiClick={(ev: { emoji: string }) => {
                                                    setEmoji(ev.emoji);
                                                    setShowEmojiPicker(false);
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            <div>
                                <span className={lbl}>Reminders</span>
                                {reminders.map((rem, idx) => (
                                    <div key={idx} className="mb-2 flex flex-wrap items-center gap-2">
                                        <select
                                            className={`${inp} w-auto min-w-[100px]`}
                                            value={rem.method}
                                            onChange={(e) => {
                                                setKeepDefaultReminders(false);
                                                setReminders((r) =>
                                                    r.map((x, i) =>
                                                        i === idx ? { ...x, method: e.target.value } : x
                                                    )
                                                );
                                            }}
                                        >
                                            <option value="popup">Popup</option>
                                            <option value="email">Email</option>
                                        </select>
                                        <input
                                            type="number"
                                            className={`${inp} w-24`}
                                            value={rem.minutes}
                                            onChange={(e) => {
                                                setKeepDefaultReminders(false);
                                                setReminders((r) =>
                                                    r.map((x, i) =>
                                                        i === idx ? { ...x, minutes: Number(e.target.value) } : x
                                                    )
                                                );
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="text-xs text-ide-error hover:underline"
                                            onClick={() => {
                                                setKeepDefaultReminders(false);
                                                setReminders((r) => r.filter((_, i) => i !== idx));
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="text-xs text-ide-link hover:underline"
                                    onClick={() => {
                                        setKeepDefaultReminders(false);
                                        setReminders((r) => [...r, { method: 'popup', minutes: 10 }]);
                                    }}
                                >
                                    + Reminder
                                </button>
                            </div>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="text-xs text-ide-link hover:underline"
                            onClick={() => setShowMore(true)}
                        >
                            + More options
                        </button>
                    )}
                </div>

                <div className="mt-4 flex flex-col-reverse gap-2 border-t border-ide-border pt-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="ui-btn-secondary w-full sm:w-auto"
                        disabled={isSubmitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="ui-btn-primary w-full sm:w-auto"
                        disabled={isSubmitting || !summary}
                    >
                        {isSubmitting ? 'Saving…' : event ? 'Save changes' : 'Create event'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default EventForm;
