import { PhaseDTO } from '../../../api/phases.api';

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Half-open [start, end) so 19:00 is Evening 19–22, not Day 11–19. */
export const getPhaseByTime = (phases: PhaseDTO[], time: string): PhaseDTO | null => {
  const timeMinutes = timeToMinutes(time);
  return (
    phases.find((phase) => {
      const startMinutes = timeToMinutes(phase.startTime);
      const endMinutes = timeToMinutes(phase.endTime);
      if (startMinutes > endMinutes) {
        return timeMinutes >= startMinutes || timeMinutes < endMinutes;
      }
      return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    }) || null
  );
};
