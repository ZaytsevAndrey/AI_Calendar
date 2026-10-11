import { TaskEventType } from '../scheduling/event-type.enum';
import { placementNotBefore } from './placement-bounds.util';

describe('placementNotBefore', () => {
  const now = new Date('2026-10-11T00:23:00.000Z'); // 03:23 Asia/Nicosia

  it('raises the floor to earliestStartTime for flexible day windows', () => {
    const bound = placementNotBefore(
      {
        isRecurring: false,
        eventType: TaskEventType.ADMIN,
        earliestStartTime: new Date('2026-10-12T00:00:00+03:00'),
      },
      now,
      'Asia/Nicosia',
      '08:00',
    );
    expect(bound.toISOString()).toBe(
      new Date('2026-10-12T08:00:00+03:00').toISOString(),
    );
  });

  it('keeps now when earliest is already in the past', () => {
    const bound = placementNotBefore(
      {
        isRecurring: false,
        eventType: TaskEventType.ADMIN,
        earliestStartTime: new Date('2026-10-10T00:00:00+03:00'),
      },
      now,
      'Asia/Nicosia',
      '08:00',
    );
    expect(bound.getTime()).toBe(now.getTime());
  });

  it('ignores earliest for fixed tasks', () => {
    const bound = placementNotBefore(
      {
        isRecurring: false,
        eventType: TaskEventType.FIXED,
        earliestStartTime: new Date('2026-10-12T00:00:00+03:00'),
      },
      now,
      'Asia/Nicosia',
      '08:00',
    );
    expect(bound.getTime()).toBe(now.getTime());
  });
});
