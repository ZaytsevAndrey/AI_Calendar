import { z } from 'zod';

const eventTypeEnum = z.enum([
  'fixed',
  'daily_routine',
  'quick_win',
  'deep_work',
  'errand',
  'admin',
  'focus_block',
  'learning',
]);

export const taskWizardSchema = z
  .object({
    name: z.string().min(1, 'Task name is required'),
    description: z.string().optional(),
    eventType: eventTypeEnum.optional(),
    phaseIds: z.array(z.string()).optional(),
    estimatedTimeInMinutes: z.number().optional(),
    isRecurring: z.boolean().optional(),
    recurrencePattern: z.string().optional(),
    allowSplit: z.boolean().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    deadline: z.string().optional(),
    scheduledStartTime: z.string().optional(),
    scheduledEndTime: z.string().optional(),
    preferredStartTime: z.string().optional(),
    preferredEndTime: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.eventType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Task type is required',
        path: ['eventType'],
      });
      return;
    }

    if (data.eventType === 'fixed') {
      if (!data.scheduledStartTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Start time is required for fixed blocks',
          path: ['scheduledStartTime'],
        });
      }
      if (!data.scheduledEndTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End time is required for fixed blocks',
          path: ['scheduledEndTime'],
        });
      }
      if (
        data.scheduledStartTime?.trim() &&
        data.scheduledEndTime?.trim() &&
        new Date(data.scheduledEndTime).getTime() <= new Date(data.scheduledStartTime).getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End must be after start',
          path: ['scheduledEndTime'],
        });
      }
    }
    if (data.eventType !== 'fixed') {
      if (typeof data.estimatedTimeInMinutes !== 'number' || Number.isNaN(data.estimatedTimeInMinutes)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Estimated time is required',
          path: ['estimatedTimeInMinutes'],
        });
      } else if (data.estimatedTimeInMinutes < 1 || data.estimatedTimeInMinutes > 1440) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Time must be between 1 and 1440 minutes',
          path: ['estimatedTimeInMinutes'],
        });
      }
    }
    if (data.isRecurring && !data.recurrencePattern?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a recurrence pattern',
        path: ['recurrencePattern'],
      });
    }

    if (data.eventType === 'daily_routine') {
      const hasStart = !!data.preferredStartTime?.trim();
      const hasEnd = !!data.preferredEndTime?.trim();
      if (hasStart !== hasEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide both start and end time',
          path: [hasStart ? 'preferredEndTime' : 'preferredStartTime'],
        });
      }
      if (hasStart && hasEnd) {
        const start = data.preferredStartTime!;
        const end = data.preferredEndTime!;
        if (end <= start) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preferred end must be after start',
            path: ['preferredEndTime'],
          });
        }
      }
    }
  });

export type TaskWizardFormValues = z.infer<typeof taskWizardSchema>;

/** RHF resolver path keys for per-step validation */
export const STEP_0_FIELDS = ['eventType'] as const;
export const STEP_1_FIELDS = ['name', 'priority'] as const;
