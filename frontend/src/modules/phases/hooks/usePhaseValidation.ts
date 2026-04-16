import { useMemo } from 'react';
import { isRangeWithinActiveWindow } from '../utils/phasesTimeUtils';

interface UsePhaseValidationProps {
  startTime: string;
  endTime: string;
  selectedDays: number[];
  userSettings?: {
    sleepTime?: string;
    wakeTime?: string;
  };
}

/** Validates only the active-day bounds (wake–sleep). Overlaps between phases are allowed. */
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

    if (
      !isRangeWithinActiveWindow(
        startTime,
        endTime,
        userSettings.wakeTime,
        userSettings.sleepTime,
      )
    ) {
      return 'Phase cannot be outside of active day time!';
    }

    return null;
  }, [startTime, endTime, selectedDays, userSettings]);

  return { sleepError };
};
