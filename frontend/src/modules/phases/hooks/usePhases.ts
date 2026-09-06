import {
  useGetTimePhasesQuery,
  useGetTimePhasesForDateQuery,
  useGetSleepTimePhasesQuery,
} from '../../../api/phasesApi';
import { PhaseDTO } from '../../../api/phases.api';

export const useTimePhases = () => useGetTimePhasesQuery();
export const useTimePhasesForDate = (date: Date) => useGetTimePhasesForDateQuery(date.toISOString().split('T')[0]);
export const useSleepTimePhases = () => useGetSleepTimePhasesQuery();

export const getPhaseByTime = (phases: PhaseDTO[], time: string): PhaseDTO | null => {
    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };
    const timeMinutes = timeToMinutes(time);
    return phases.find(phase => {
        const startMinutes = timeToMinutes(phase.startTime);
        const endMinutes = timeToMinutes(phase.endTime);
        if (startMinutes > endMinutes) {
            return timeMinutes >= startMinutes || timeMinutes <= endMinutes;
        } else {
            return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
        }
    }) || null;
};
