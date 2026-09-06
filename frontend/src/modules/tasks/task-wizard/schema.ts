import { z } from 'zod';

export const taskFormSchema = z
  .object({
    name: z.string().min(1, 'Task name is required'),
    description: z.string().optional(),
    isFixed: z.boolean(),
    phaseId: z.string().optional(),
    estimatedTimeInMinutes: z.number().optional(),
    isRecurring: z.boolean().optional(),
    recurrencePattern: z.string().optional(),
    recurrenceWeekDays: z.array(z.number().int().min(0).max(6)).optional(),
    allowSplit: z.boolean().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    deadline: z.string().optional(),
    scheduledStartTime: z.string().optional(),
    scheduledEndTime: z.string().optional(),
    preferredStartTime: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isFixed) {
      if (!data.scheduledStartTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Start time is required for fixed tasks',
          path: ['scheduledStartTime'],
        });
      }
      if (!data.scheduledEndTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End time is required for fixed tasks',
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
      return;
    }

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

    if (data.isRecurring && !data.recurrencePattern?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a recurrence pattern',
        path: ['recurrencePattern'],
      });
    }
  });

export type TaskFormValues = z.infer<typeof taskFormSchema>;
