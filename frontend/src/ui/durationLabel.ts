type Translate = (key: string, options?: Record<string, unknown>) => string;

/** «45 хв», «1 год», «1 год 30 хв». */
export function formatDurationShort(minutes: number, t: Translate): string {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return t('common.minutesShort', { count: m });
    const hours = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? t('common.hoursMinutesShort', { hours, minutes: rest }) : t('common.hoursShort', { count: hours });
}
