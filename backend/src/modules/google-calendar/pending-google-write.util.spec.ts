import {
  googleContentDiffers,
  googleEditedAfterEnqueue,
  googleEventFieldsFromApi,
} from './pending-google-write.util';

describe('pending-google-write.util', () => {
  it('reads time fields from a Google event', () => {
    expect(
      googleEventFieldsFromApi({
        summary: 'Gym',
        description: 'legs',
        start: { dateTime: '2026-10-08T09:00:00.000Z' },
        end: { dateTime: '2026-10-08T10:00:00.000Z' },
        updated: '2026-10-08T08:00:00.000Z',
      }),
    ).toEqual({
      summary: 'Gym',
      description: 'legs',
      startIso: '2026-10-08T09:00:00.000Z',
      endIso: '2026-10-08T10:00:00.000Z',
      updatedIso: '2026-10-08T08:00:00.000Z',
    });
  });

  it('detects title or time changes', () => {
    const local = {
      summary: 'Gym',
      description: '',
      startIso: '2026-10-08T09:00:00.000Z',
      endIso: '2026-10-08T10:00:00.000Z',
    };
    expect(googleContentDiffers(local, { ...local, summary: 'Run' })).toBe(true);
    expect(
      googleContentDiffers(local, {
        ...local,
        startIso: '2026-10-08T11:00:00.000Z',
      }),
    ).toBe(true);
    expect(googleContentDiffers(local, { ...local })).toBe(false);
  });

  it('treats a Google update after enqueue as a user edit', () => {
    const enqueuedAt = new Date('2026-10-08T08:00:00.000Z');
    expect(
      googleEditedAfterEnqueue('2026-10-08T08:05:00.000Z', enqueuedAt),
    ).toBe(true);
    expect(
      googleEditedAfterEnqueue('2026-10-08T07:59:00.000Z', enqueuedAt),
    ).toBe(false);
  });
});
