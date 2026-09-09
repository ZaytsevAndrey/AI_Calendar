import {
  useGetTimePhasesQuery,
  useGetTimePhasesForDateQuery,
  useGetSleepTimePhasesQuery,
} from '../../../api/phasesApi';

export { getPhaseByTime } from './phaseByTime';

export const useTimePhases = () => useGetTimePhasesQuery();
export const useTimePhasesForDate = (date: Date) => useGetTimePhasesForDateQuery(date.toISOString().split('T')[0]);
export const useSleepTimePhases = () => useGetSleepTimePhasesQuery();
