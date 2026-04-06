import { useMemo } from 'react';
import { PhaseDTO } from 'api/phases.api';

interface UsePhaseValidationProps {
  startTime: string;
  endTime: string;
  selectedDays: number[];
  phases: PhaseDTO[];
  currentPhaseId?: string;
  userSettings?: any;
}

// Функція для порівняння часу (HH:mm формат)
const isFirstTimeBigger = (time1: string, time2: string): boolean => {
  const [hours1, minutes1] = time1.split(':').map(Number);
  const [hours2, minutes2] = time2.split(':').map(Number);
  
  const totalMinutes1 = hours1 * 60 + minutes1;
  const totalMinutes2 = hours2 * 60 + minutes2;
  
  return totalMinutes1 > totalMinutes2;
};

// Функція для перевірки перекриття інтервалів
const hasOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  // Якщо один інтервал повністю містить інший
  if ((isFirstTimeBigger(start1, start2) && isFirstTimeBigger(end1, end2)) ||
      (!isFirstTimeBigger(start1, start2) && !isFirstTimeBigger(end1, end2))) {
    return false;
  }
  
  // Якщо інтервали перетинаються
  return !(isFirstTimeBigger(end1, start2) || isFirstTimeBigger(end2, start1));
};

export const usePhaseValidation = ({
  startTime,
  endTime,
  selectedDays,
  phases,
  currentPhaseId,
  userSettings
}: UsePhaseValidationProps) => {
  
  const overlapError = useMemo(() => {
    if (!phases || phases.length === 0 || !startTime || !endTime) {
      return null;
    }
    
    // Перевіряємо кожну існуючу фазу
    for (const phase of phases) {
      if (currentPhaseId && phase.id === currentPhaseId) continue;
      
      const hasCommonDays = selectedDays.some(day => 
        !phase.weekDays || phase.weekDays.length === 0 || phase.weekDays.includes(day)
      );
      
      if (hasCommonDays && hasOverlap(startTime, endTime, phase.startTime, phase.endTime)) {
        return `Phase overlaps with "${phase.name}" (${phase.startTime}-${phase.endTime})`;
      }
    }
    return null;
  }, [startTime, endTime, selectedDays, phases, currentPhaseId]);

  const sleepError = useMemo(() => {
    if (!userSettings?.sleepTime || !userSettings?.wakeTime || !selectedDays || selectedDays.length === 0 || !startTime || !endTime) {
      return null;
    }
    
    const dayStart = userSettings.wakeTime;
    const dayEnd = userSettings.sleepTime;
    
    // Перевіряємо чи фаза не виходить за межі активного часу дня
    if (isFirstTimeBigger(startTime, dayEnd) || isFirstTimeBigger(dayStart, endTime)) {
      return 'Phase cannot be outside of active day time!';
    }
    
    return null;
  }, [startTime, endTime, selectedDays, userSettings]);

  return { overlapError, sleepError };
}; 