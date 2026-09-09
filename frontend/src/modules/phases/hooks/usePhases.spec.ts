import { PhaseDTO } from '../../../api/phases.api';
import { getPhaseByTime } from './phaseByTime';

function phase(
  name: string,
  startTime: string,
  endTime: string,
): PhaseDTO {
  return {
    id: name,
    name,
    color: '#000',
    startTime,
    endTime,
    createdAt: '',
    updatedAt: '',
  };
}

const screenshotPhases = [
  phase('Morning', '09:00', '11:00'),
  phase('Day', '11:00', '19:00'),
  phase('Evening', '19:00', '22:00'),
  phase('Rest', '22:00', '02:00'),
];

describe('getPhaseByTime', () => {
  it('assigns the start of a phase, not the previous phase end', () => {
    expect(getPhaseByTime(screenshotPhases, '09:00')?.name).toBe('Morning');
    expect(getPhaseByTime(screenshotPhases, '10:00')?.name).toBe('Morning');
    expect(getPhaseByTime(screenshotPhases, '11:00')?.name).toBe('Day');
    expect(getPhaseByTime(screenshotPhases, '19:00')?.name).toBe('Evening');
    expect(getPhaseByTime(screenshotPhases, '22:00')?.name).toBe('Rest');
    expect(getPhaseByTime(screenshotPhases, '00:00')?.name).toBe('Rest');
    expect(getPhaseByTime(screenshotPhases, '01:00')?.name).toBe('Rest');
  });

  it('leaves the exclusive end of an overnight phase for the next window', () => {
    expect(getPhaseByTime(screenshotPhases, '02:00')).toBeNull();
  });
});
