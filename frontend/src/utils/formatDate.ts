import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';

const loc = { locale: enGB };

export function formatLongDate(date: Date): string {
    return format(date, 'EEEE, d MMMM yyyy', loc);
}

export function formatMonthYear(date: Date): string {
    return format(date, 'MMMM yyyy', loc);
}

export function formatWeekRange(start: Date, end: Date): string {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const sameYear = start.getFullYear() === end.getFullYear();
    if (sameMonth) {
        return `${format(start, 'd', loc)}–${format(end, 'd MMM yyyy', loc)}`;
    }
    if (sameYear) {
        return `${format(start, 'd MMM', loc)} – ${format(end, 'd MMM yyyy', loc)}`;
    }
    return `${format(start, 'd MMM yyyy', loc)} – ${format(end, 'd MMM yyyy', loc)}`;
}

export function formatDateTime(value?: string | null): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return format(d, 'd MMM yyyy, HH:mm', loc);
}

function isSameLocalDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

export function formatDateTimeRange(
    start?: string | null,
    end?: string | null,
): string | null {
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    const startOk = Boolean(startDate && !Number.isNaN(startDate.getTime()));
    const endOk = Boolean(endDate && !Number.isNaN(endDate.getTime()));
    if (!startOk && !endOk) return null;
    if (startOk && !endOk) return format(startDate!, 'EEE d MMM yyyy, HH:mm', loc);
    if (!startOk && endOk) return format(endDate!, 'EEE d MMM yyyy, HH:mm', loc);
    if (isSameLocalDay(startDate!, endDate!)) {
        return `${format(startDate!, 'EEE d MMM yyyy', loc)}, ${format(startDate!, 'HH:mm', loc)}–${format(endDate!, 'HH:mm', loc)}`;
    }
    return `${format(startDate!, 'd MMM yyyy, HH:mm', loc)} – ${format(endDate!, 'd MMM yyyy, HH:mm', loc)}`;
}

export function joinToastDetail(
    ...parts: Array<string | null | undefined>
): string | undefined {
    const items = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
    return items.length ? items.join(' · ') : undefined;
}

function recurrenceLabel(pattern?: string | null): string | undefined {
    switch ((pattern || '').toUpperCase()) {
        case 'DAILY':
            return 'Repeats daily';
        case 'WEEKLY':
            return 'Repeats weekly';
        case 'MONTHLY':
            return 'Repeats monthly';
        default:
            return 'Repeats';
    }
}

export function describeTaskWhen(task: {
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
    earliestStartTime?: string | null;
    deadline?: string | null;
    estimatedTimeInMinutes?: number | null;
    isRecurring?: boolean;
    recurrencePattern?: string | null;
}): string | undefined {
    const slot = formatDateTimeRange(task.scheduledStartTime, task.scheduledEndTime);
    let when: string | undefined;
    if (slot) {
        when = slot;
    } else if (task.earliestStartTime && task.deadline) {
        const window = formatDateTimeRange(task.earliestStartTime, task.deadline);
        when = window ? `Between ${window}` : undefined;
    } else if (task.deadline) {
        const due = formatDateTime(task.deadline);
        when = due ? `Due ${due}` : undefined;
    } else if (task.earliestStartTime) {
        const from = formatDateTime(task.earliestStartTime);
        when = from ? `From ${from}` : undefined;
    }
    const duration =
        !(task.scheduledStartTime && task.scheduledEndTime) &&
        task.estimatedTimeInMinutes &&
        task.estimatedTimeInMinutes > 0
            ? formatMinutes(task.estimatedTimeInMinutes)
            : undefined;
    const repeats = task.isRecurring ? recurrenceLabel(task.recurrencePattern) : undefined;
    return joinToastDetail(when, duration, repeats);
}

export function describeTaskToastDetail(task: {
    name?: string | null;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
    earliestStartTime?: string | null;
    deadline?: string | null;
    estimatedTimeInMinutes?: number | null;
    isRecurring?: boolean;
    recurrencePattern?: string | null;
}): string | undefined {
    return joinToastDetail(task.name, describeTaskWhen(task));
}

export function formatClock(date: Date): string {
    return format(date, 'HH:mm');
}

export function formatMinutes(mins: number): string {
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function startOfLocalDayIso(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

export function endOfLocalDayIso(date: Date): string {
    const d = new Date(date);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
}

export function toLocalDateTimeInput(value?: string | Date): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
