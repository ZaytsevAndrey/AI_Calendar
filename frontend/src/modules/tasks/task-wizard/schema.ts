import { z } from 'zod';
import i18n from 'i18n';

const reminderOverrideSchema = z.object({
  method: z.enum(['popup', 'email']),
  minutes: z.number(),
});

export const taskFormSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    isFixed: z.boolean(),
    isUnscheduled: z.boolean().optional(),
    phaseId: z.string().optional(),
    estimatedTimeInMinutes: z.number().optional(),
    isRecurring: z.boolean().optional(),
    recurrencePattern: z.string().optional(),
    recurrenceWeekDays: z.array(z.number().int().min(0).max(6)).optional(),
    allowSplit: z.boolean().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    deadline: z.string().optional(),
    earliestStartTime: z.string().optional(),
    eligibleWeekDays: z.array(z.number().int().min(0).max(6)).optional(),
    scheduledStartTime: z.string().optional(),
    scheduledEndTime: z.string().optional(),
    preferredStartTime: z.string().optional(),
    location: z.string().optional(),
    googleColorId: z.string().optional(),
    googleVisibility: z.string().optional(),
    googleTransparency: z.string().optional(),
    googleReminderUseDefault: z.boolean().optional(),
    googleReminderOverrides: z.array(reminderOverrideSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.name?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('tasks.validation.nameRequired'),
        path: ['name'],
      });
    }

    if (data.isUnscheduled) {
      return;
    }

    if (data.isFixed) {
      if (!data.scheduledStartTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: i18n.t('tasks.validation.startRequired'),
          path: ['scheduledStartTime'],
        });
      }
      if (!data.scheduledEndTime?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: i18n.t('tasks.validation.endRequired'),
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
          message: i18n.t('tasks.validation.endAfterStart'),
          path: ['scheduledEndTime'],
        });
      }
      return;
    }

    if (typeof data.estimatedTimeInMinutes !== 'number' || Number.isNaN(data.estimatedTimeInMinutes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('tasks.validation.estimatedRequired'),
        path: ['estimatedTimeInMinutes'],
      });
    } else if (data.estimatedTimeInMinutes < 1 || data.estimatedTimeInMinutes > 1440) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('tasks.validation.estimatedRange'),
        path: ['estimatedTimeInMinutes'],
      });
    }

    if (data.isRecurring && !data.recurrencePattern?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('tasks.validation.recurrenceRequired'),
        path: ['recurrencePattern'],
      });
    }

    if (
      data.earliestStartTime?.trim() &&
      data.deadline?.trim() &&
      data.deadline.trim() <= data.earliestStartTime.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i18n.t('tasks.validation.untilAfterFrom'),
        path: ['deadline'],
      });
    }
  });

export type TaskFormValues = z.infer<typeof taskFormSchema>;
