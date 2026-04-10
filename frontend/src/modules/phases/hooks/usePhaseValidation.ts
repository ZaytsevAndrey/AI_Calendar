import { useMemo } from 'react';

interface UsePhaseValidationProps {
  startTime: string;
  endTime: string;
  selectedDays: number[];
  userSettings?: {
    sleepTime?: string;
    wakeTime?: string;
  };
}

const isFirstTimeBigger = (time1: string, time2: string): boolean => {
  const [hours1, minutes1] = time1.split(':').map(Number);
  const [hours2, minutes2] = time2.split(':').map(Number);
  const totalMinutes1 = hours1 * 60 + minutes1;
  const totalMinutes2 = hours2 * 60 + minutes2;
  return totalMinutes1 > totalMinutes2;
};

/** Перевірка лише меж активного дня (wake–sleep). Перетини між фазами дозволені. */
export const usePhaseValidation = ({
  startTime,
  endTime,
  selectedDays,
  userSettings,
}: UsePhaseValidationProps) => {
  const sleepError = useMemo(() => {
    if (
      !userSettings?.sleepTime ||
      !userSettings?.wakeTime ||
      !selectedDays ||
      selectedDays.length === 0 ||
      !startTime ||
      !endTime
    ) {
      return null;
    }

    const dayStart = userSettings.wakeTime;
    const dayEnd = userSettings.sleepTime;

    if (isFirstTimeBigger(startTime, dayEnd) || isFirstTimeBigger(dayStart, endTime)) {
      return 'Phase cannot be outside of active day time!';
    }

    return null;
  }, [startTime, endTime, selectedDays, userSettings]);

  return { sleepError };
};
