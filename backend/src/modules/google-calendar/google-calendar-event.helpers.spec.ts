import {
  extractPhaseId,
  stripAppManagedEventProperties,
} from './google-calendar-event.helpers';

describe('stripAppManagedEventProperties', () => {
  it('keeps native Google fields used by expanded event settings', () => {
    const stripped = stripAppManagedEventProperties({
      summary: 'Gym',
      location: 'Pool',
      colorId: '7',
      visibility: 'private',
      transparency: 'transparent',
      reminders: { useDefault: true },
      phaseId: 'phase-1',
      emoji: '🏋️',
      priority: 'high',
      status: 'in_progress',
    });
    expect(stripped).toEqual({
      summary: 'Gym',
      location: 'Pool',
      colorId: '7',
      visibility: 'private',
      transparency: 'transparent',
      reminders: { useDefault: true },
    });
  });
});

describe('extractPhaseId', () => {
  it('returns a phase id only when it is a non-empty string', () => {
    expect(extractPhaseId({ phaseId: 'abc' })).toBe('abc');
    expect(extractPhaseId({ phaseId: '' })).toBeUndefined();
    expect(extractPhaseId({})).toBeUndefined();
  });
});
