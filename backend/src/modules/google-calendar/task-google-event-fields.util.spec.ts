import { applyTaskGoogleEventFields } from './task-google-event-fields.util';

describe('applyTaskGoogleEventFields', () => {
  it('copies stored Google fields and prefers explicit color over phase fallback', () => {
    const payload = applyTaskGoogleEventFields(
      { summary: 'Gym' },
      {
        location: 'Pool',
        googleColorId: '7',
        googleVisibility: 'private',
        googleTransparency: 'transparent',
        googleReminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      },
      '11',
    );
    expect(payload).toEqual({
      summary: 'Gym',
      location: 'Pool',
      colorId: '7',
      visibility: 'private',
      transparency: 'transparent',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    });
  });

  it('uses phase color when the task has no googleColorId', () => {
    const payload = applyTaskGoogleEventFields({ summary: 'Gym' }, {}, '3');
    expect(payload.colorId).toBe('3');
  });

  it('leaves Google extras off when they are empty', () => {
    const payload = applyTaskGoogleEventFields({ summary: 'Gym' }, {
      location: null,
      googleColorId: null,
      googleVisibility: null,
      googleTransparency: null,
      googleReminders: null,
    });
    expect(payload).toEqual({ summary: 'Gym' });
  });
});
