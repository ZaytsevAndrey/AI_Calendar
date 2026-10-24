export function parseTimeValue(value: string | undefined | null): { hours: number; minutes: number } | null {
    if (!value) return null;
    const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
}

export function formatTimeValue(hours: number, minutes: number): string {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Minutes shown in the picker. The current minute stays selectable when it falls off the step. */
export function minuteOptions(step: number, current: number | null): number[] {
    const safe = Number.isFinite(step) ? Math.min(30, Math.max(1, Math.trunc(step))) : 1;
    const values: number[] = [];
    for (let minute = 0; minute < 60; minute += safe) {
        values.push(minute);
    }
    if (current != null && current >= 0 && current <= 59 && !values.includes(current)) {
        values.push(current);
        values.sort((a, b) => a - b);
    }
    return values;
}
