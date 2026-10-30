import { taskTraits } from './schedulingTraits';

describe('taskTraits', () => {
  it('keeps behavior and recurrence independent (all four combinations)', () => {
    expect(taskTraits({ eventType: 'fixed', isRecurring: false })).toMatchObject({
      behavior: 'fixed',
      recurring: false,
    });
    expect(taskTraits({ eventType: 'fixed', isRecurring: true })).toMatchObject({
      behavior: 'fixed',
      recurring: true,
    });
    expect(taskTraits({ eventType: 'admin', isRecurring: false })).toMatchObject({
      behavior: 'flexible',
      recurring: false,
    });
    expect(taskTraits({ eventType: 'admin', isRecurring: true })).toMatchObject({
      behavior: 'flexible',
      recurring: true,
    });
  });

  it('treats a day copy as a series member that does not itself repeat', () => {
    expect(
      taskTraits({ eventType: 'fixed', isRecurring: false, seriesGroupId: 'series-1' }),
    ).toEqual({ behavior: 'fixed', recurring: false, seriesMember: true, unscheduled: false });
  });

  it('an external fixed event is fixed', () => {
    expect(taskTraits({ eventType: 'admin', isFixedExternal: true }).behavior).toBe('fixed');
  });
});
