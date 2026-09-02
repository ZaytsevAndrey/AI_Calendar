import {
  planGoogleSegmentSync,
  planGoogleMasterEventSync,
  uniqueGoogleEventRefs,
} from './google-segment-sync.util';

describe('google-segment-sync.util', () => {
  it('dedupes event ids', () => {
    expect(
      uniqueGoogleEventRefs([
        { eventId: 'a', calendarId: 'cal' },
        { eventId: 'a', calendarId: 'other' },
        { eventId: 'b', calendarId: 'cal' },
        null,
      ]),
    ).toEqual([
      { eventId: 'a', calendarId: 'cal' },
      { eventId: 'b', calendarId: 'cal' },
    ]);
  });

  it('deletes a single master when expanding to many segments', () => {
    expect(
      planGoogleSegmentSync(3, [{ eventId: 'master', calendarId: 'cal' }]),
    ).toEqual({
      reuse: [],
      createCount: 3,
      deleteRefs: [{ eventId: 'master', calendarId: 'cal' }],
    });
  });

  it('reuses matching counts in order and deletes leftovers', () => {
    expect(
      planGoogleSegmentSync(2, [
        { eventId: 'e1', calendarId: 'cal' },
        { eventId: 'e2', calendarId: 'cal' },
        { eventId: 'e3', calendarId: 'cal' },
      ]),
    ).toEqual({
      reuse: [
        { eventId: 'e1', calendarId: 'cal' },
        { eventId: 'e2', calendarId: 'cal' },
      ],
      createCount: 0,
      deleteRefs: [{ eventId: 'e3', calendarId: 'cal' }],
    });
  });

  it('creates extras when more segments than existing events', () => {
    expect(
      planGoogleSegmentSync(3, [{ eventId: 'e1', calendarId: 'cal' }, { eventId: 'e2', calendarId: 'cal' }]),
    ).toEqual({
      reuse: [
        { eventId: 'e1', calendarId: 'cal' },
        { eventId: 'e2', calendarId: 'cal' },
      ],
      createCount: 1,
      deleteRefs: [],
    });
  });

  it('deletes all when desired count is zero', () => {
    expect(
      planGoogleSegmentSync(0, [{ eventId: 'e1', calendarId: 'cal' }]),
    ).toEqual({
      reuse: [],
      createCount: 0,
      deleteRefs: [{ eventId: 'e1', calendarId: 'cal' }],
    });
  });

  it('reuses a single master for a recurring series', () => {
    expect(
      planGoogleMasterEventSync(8, [{ eventId: 'master', calendarId: 'cal' }]),
    ).toEqual({
      reuse: [{ eventId: 'master', calendarId: 'cal' }],
      createCount: 0,
      deleteRefs: [],
    });
  });

  it('replaces many instance events with one new master', () => {
    expect(
      planGoogleMasterEventSync(8, [
        { eventId: 'e1', calendarId: 'cal' },
        { eventId: 'e2', calendarId: 'cal' },
      ]),
    ).toEqual({
      reuse: [],
      createCount: 1,
      deleteRefs: [
        { eventId: 'e1', calendarId: 'cal' },
        { eventId: 'e2', calendarId: 'cal' },
      ],
    });
  });
});
