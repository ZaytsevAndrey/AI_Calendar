import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import {
  addDaysToYmd,
  localYmd,
  civilDayStartIso,
} from '../voice/voice-local-date.util';

const DEFAULT_HORIZON_DAYS = 30;
const MIN_HORIZON_DAYS = 1;
const MAX_HORIZON_DAYS = 365;
const MAX_FIXED_EVENT_BUFFER_MINUTES = 180;

/** 0 disables the gap. Non-positive and non-finite values are off. */
export function normalizeFixedEventBufferMinutes(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_FIXED_EVENT_BUFFER_MINUTES, Math.floor(value));
}

function normalizeHorizonDays(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_HORIZON_DAYS;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.floor(value)));
}

/** Today (midnight in the settings time zone) through `recurringScheduleHorizonDays` — exclusive end. */
export function planningHorizonRange(
  settings: {
    recurringScheduleHorizonDays?: number | null;
    timeZone?: string | null;
  },
  now = new Date(),
): { start: Date; end: Date; horizonDays: number } {
  const timeZone = resolveIanaTimeZone(settings.timeZone);
  const horizonDays = normalizeHorizonDays(settings.recurringScheduleHorizonDays);
  const startYmd = localYmd(now.toISOString(), timeZone);
  const endYmd = addDaysToYmd(startYmd, horizonDays);
  return {
    start: new Date(civilDayStartIso(startYmd, timeZone)),
    end: new Date(civilDayStartIso(endYmd, timeZone)),
    horizonDays,
  };
}
