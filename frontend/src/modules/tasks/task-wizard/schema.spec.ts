import { taskFormSchema } from './schema';

const base = {
  name: 'Buy milk',
  isFixed: false,
  isUnscheduled: false,
  estimatedTimeInMinutes: 30,
};

describe('taskFormSchema', () => {
  it('accepts an unscheduled task with only a name', () => {
    const parsed = taskFormSchema.safeParse({
      name: 'Buy milk',
      isFixed: false,
      isUnscheduled: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('does not require duration or start/end for unscheduled tasks', () => {
    const parsed = taskFormSchema.safeParse({
      name: 'Call dentist',
      isFixed: true,
      isUnscheduled: true,
      scheduledStartTime: '',
      scheduledEndTime: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('still requires duration for flexible tasks', () => {
    const parsed = taskFormSchema.safeParse({
      ...base,
      estimatedTimeInMinutes: undefined,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === 'estimatedTimeInMinutes')).toBe(
        true,
      );
    }
  });

  it('requires start and end for fixed tasks', () => {
    const parsed = taskFormSchema.safeParse({
      name: 'Doctor',
      isFixed: true,
      isUnscheduled: false,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path[0]);
      expect(paths).toEqual(expect.arrayContaining(['scheduledStartTime', 'scheduledEndTime']));
    }
  });
});
