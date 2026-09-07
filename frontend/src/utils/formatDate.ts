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

export function formatDateTime(value?: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return format(d, 'd MMM yyyy, HH:mm', loc);
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
