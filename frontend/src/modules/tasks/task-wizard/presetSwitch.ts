import { dateTimeLocalYmd } from '../../../utils/ianaDateTime';
import { presetPatch, type TaskPresetId } from './constants';
import { splitDateTimeLocal } from './fixedSlot';
import type { TaskFormValues } from './schema';

const MINUTES_PER_DAY = 1440;

function localMinutes(value: string): number | null {
  const { ymd, hm } = splitDateTimeLocal(value);
  if (!ymd || !hm) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, m] = hm.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, m) / 60_000;
}

function addLocalMinutes(value: string, minutes: number): string {
  const base = localMinutes(value);
  if (base == null) return '';
  return new Date((base + minutes) * 60_000).toISOString().slice(0, 16);
}

export type PresetSwitch = {
  patch: Partial<TaskFormValues>;
  /** Civil day to preselect in the Fixed picker when no clock is known yet. */
  fixedDay: string;
};

/**
 * Mode switch that keeps what the user already chose: the window day becomes
 * the Fixed day (and slot, with a preferred clock), a Fixed slot becomes the
 * window and preferred clock, a typed duration survives, and the repeat rule
 * is never touched (Later excepted: the inbox cannot hold a series).
 */
export function switchPreset(
  values: TaskFormValues,
  id: TaskPresetId,
  defaultMinutes = 30,
): PresetSwitch {
  const patch = presetPatch(id, defaultMinutes);
  const wasFixed = !values.isUnscheduled && values.isFixed;
  const wasSoft = !values.isUnscheduled && !values.isFixed;
  const slotStart = values.scheduledStartTime?.trim() ?? '';
  const slotEnd = values.scheduledEndTime?.trim() ?? '';

  if (id === 'fixed') {
    if (!wasSoft) return { patch, fixedDay: '' };
    const day =
      dateTimeLocalYmd(values.earliestStartTime) || dateTimeLocalYmd(values.deadline) || '';
    const clock = values.preferredStartTime?.trim();
    if (day && clock) {
      const start = `${day}T${clock}`;
      const minutes = values.estimatedTimeInMinutes || defaultMinutes;
      return {
        patch: { ...patch, scheduledStartTime: start, scheduledEndTime: addLocalMinutes(start, minutes) },
        fixedDay: '',
      };
    }
    return { patch, fixedDay: day };
  }

  if (id === 'flexible') {
    if (wasFixed && slotStart && slotEnd) {
      const from = splitDateTimeLocal(slotStart);
      const to = splitDateTimeLocal(slotEnd);
      const startMin = localMinutes(slotStart);
      const endMin = localMinutes(slotEnd);
      const minutes =
        startMin != null && endMin != null && endMin > startMin
          ? Math.min(MINUTES_PER_DAY, endMin - startMin)
          : patch.estimatedTimeInMinutes;
      return {
        patch: {
          ...patch,
          estimatedTimeInMinutes: minutes,
          preferredStartTime: from.hm,
          earliestStartTime: `${from.ymd}T00:00`,
          // A one-off keeps the slot's days; a series only starts there and
          // keeps its own Until day.
          deadline: values.isRecurring
            ? (values.deadline?.trim() ?? '')
            : `${to.ymd || from.ymd}T23:59`,
        },
        fixedDay: '',
      };
    }
    if (wasSoft && values.estimatedTimeInMinutes) {
      return {
        patch: { ...patch, estimatedTimeInMinutes: values.estimatedTimeInMinutes },
        fixedDay: '',
      };
    }
  }

  return { patch, fixedDay: '' };
}
