import React, { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO, TaskEventType } from '../../../api/tasks.api';
import { PhaseDTO } from '../../../api/phases.api';

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const EVENT_TYPE_OPTIONS: { value: TaskEventType; label: string }[] = [
  { value: 'fixed', label: 'Fixed block (manual time)' },
  { value: 'daily_routine', label: 'Daily routine' },
  { value: 'quick_win', label: 'Quick win' },
  { value: 'deep_work', label: 'Deep work' },
  { value: 'errand', label: 'Errand' },
  { value: 'admin', label: 'Admin' },
  { value: 'focus_block', label: 'Focus block' },
  { value: 'learning', label: 'Learning' },
];

const SPLITTABLE_TYPES = new Set<TaskEventType>([
  'daily_routine',
  'deep_work',
  'admin',
  'focus_block',
  'learning',
]);

const DEFAULT_DURATION_BY_TYPE: Partial<Record<TaskEventType, number>> = {
  fixed: 60,
  daily_routine: 30,
  quick_win: 15,
  deep_work: 120,
  errand: 45,
  admin: 30,
  focus_block: 90,
  learning: 60,
};

const taskSchema = z
  .object({
    name: z.string().min(1, 'Task name is required'),
    description: z.string().optional(),
    eventType: z.enum([
      'fixed',
      'daily_routine',
      'quick_win',
      'deep_work',
      'errand',
      'admin',
      'focus_block',
      'learning',
    ]),
    phaseIds: z.array(z.string()).optional(),
    estimatedTimeInMinutes: z
      .number()
      .min(1, 'Time must be at least 1 minute')
      .max(1440, 'Time cannot exceed 24 hours'),
    isRecurring: z.boolean().optional(),
    recurrencePattern: z.string().optional(),
    allowSplit: z.boolean().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    deadline: z.string().optional(),
    scheduledStartTime: z.string().optional(),
    scheduledEndTime: z.string().optional(),
  })
  .superRefine((data, ctx) => {
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
    }
  });

type TaskFormData = z.infer<typeof taskSchema>;

interface TaskFormProps {
  initialData?: TaskDTO;
  phases: PhaseDTO[];
  onSubmit: (data: CreateTaskDTO | UpdateTaskDTO) => void;
  isSubmitting: boolean;
}

function initialPhaseIds(data?: TaskDTO): string[] {
  if (!data) return [];
  if (data.phases?.length) return data.phases.map((p) => p.id);
  if (data.phaseId) return [data.phaseId];
  return [];
}

const TaskForm: React.FC<TaskFormProps> = ({ initialData, phases, onSubmit, isSubmitting }) => {
  const [showRecurrenceOptions, setShowRecurrenceOptions] = useState(
    initialData?.isRecurring || false,
  );

  const defaultEventType = (initialData?.eventType ?? 'admin') as TaskEventType;

  const { control, handleSubmit, formState: { errors }, watch, setValue } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: initialData
      ? {
          name: initialData.name,
          description: initialData.description ?? '',
          eventType: defaultEventType,
          phaseIds: initialPhaseIds(initialData),
          estimatedTimeInMinutes: initialData.estimatedTimeInMinutes,
          isRecurring: initialData.isRecurring,
          recurrencePattern: initialData.recurrencePattern ?? '',
          allowSplit: initialData.allowSplit,
          priority: initialData.priority,
          deadline: initialData.deadline
            ? new Date(initialData.deadline).toISOString().substring(0, 16)
            : undefined,
          scheduledStartTime: initialData.scheduledStartTime
            ? new Date(initialData.scheduledStartTime).toISOString().substring(0, 16)
            : undefined,
          scheduledEndTime: initialData.scheduledEndTime
            ? new Date(initialData.scheduledEndTime).toISOString().substring(0, 16)
            : undefined,
        }
      : {
          name: '',
          description: '',
          eventType: 'admin',
          phaseIds: [],
          estimatedTimeInMinutes: 30,
          isRecurring: false,
          allowSplit: true,
          priority: 'medium',
        },
  });

  const isRecurring = watch('isRecurring');
  const eventType = watch('eventType') as TaskEventType;

  const typeAllowsSplit = SPLITTABLE_TYPES.has(eventType);

  useEffect(() => {
    setShowRecurrenceOptions(!!isRecurring);
  }, [isRecurring]);

  useEffect(() => {
    if (!typeAllowsSplit) {
      setValue('allowSplit', false);
    }
  }, [typeAllowsSplit, setValue]);

  const submitHandler = (data: TaskFormData) => {
    const phaseIds = (data.phaseIds ?? []).filter(Boolean);
    const payload: CreateTaskDTO | UpdateTaskDTO = {
      name: data.name,
      description: data.description || undefined,
      eventType: data.eventType,
      estimatedTimeInMinutes: data.estimatedTimeInMinutes,
      isRecurring: data.isRecurring,
      recurrencePattern: data.recurrencePattern || undefined,
      allowSplit: typeAllowsSplit ? data.allowSplit : false,
      priority: data.priority,
      deadline: data.deadline || undefined,
      phaseIds: phaseIds.length ? phaseIds : undefined,
      phaseId: phaseIds[0],
    };

    if (data.eventType === 'fixed' && data.scheduledStartTime && data.scheduledEndTime) {
      payload.scheduledStartTime = new Date(data.scheduledStartTime).toISOString();
      payload.scheduledEndTime = new Date(data.scheduledEndTime).toISOString();
    }

    onSubmit(payload);
  };

  const durationHint = useMemo(
    () => DEFAULT_DURATION_BY_TYPE[eventType] ?? 30,
    [eventType],
  );

  return (
    <form onSubmit={handleSubmit(submitHandler)} className="task-form">
      <div className="form-group">
        <label htmlFor="name">Task Name*</label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => <input {...field} id="name" className={errors.name ? 'error' : ''} />}
        />
        {errors.name && <span className="error-message">{errors.name.message}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="description">Description</label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => <textarea {...field} id="description" rows={3} />}
        />
      </div>

      <div className="form-group">
        <label htmlFor="eventType">Event type</label>
        <Controller
          name="eventType"
          control={control}
          render={({ field }) => (
            <select {...field} id="eventType">
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        />
        <p className="form-hint">
          Type drives default duration and whether the scheduler can move or split this task.
        </p>
      </div>

      {eventType === 'fixed' && (
        <>
          <div className="form-group">
            <label htmlFor="scheduledStartTime">Fixed start*</label>
            <Controller
              name="scheduledStartTime"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  id="scheduledStartTime"
                  type="datetime-local"
                  className={errors.scheduledStartTime ? 'error' : ''}
                />
              )}
            />
            {errors.scheduledStartTime && (
              <span className="error-message">{errors.scheduledStartTime.message}</span>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="scheduledEndTime">Fixed end*</label>
            <Controller
              name="scheduledEndTime"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  id="scheduledEndTime"
                  type="datetime-local"
                  className={errors.scheduledEndTime ? 'error' : ''}
                />
              )}
            />
            {errors.scheduledEndTime && (
              <span className="error-message">{errors.scheduledEndTime.message}</span>
            )}
          </div>
        </>
      )}

      <div className="form-group">
        <span className="form-label-static">Phases</span>
        <p className="form-hint">Eligible time windows (union). Leave empty to use full wake–sleep day.</p>
        <Controller
          name="phaseIds"
          control={control}
          render={({ field }) => (
            <div className="phase-checkboxes">
              {phases.map((phase) => (
                <label key={phase.id} className="phase-checkbox-row">
                  <input
                    type="checkbox"
                    checked={(field.value ?? []).includes(phase.id)}
                    onChange={(e) => {
                      const cur = field.value ?? [];
                      if (e.target.checked) {
                        field.onChange([...cur, phase.id]);
                      } else {
                        field.onChange(cur.filter((id) => id !== phase.id));
                      }
                    }}
                  />
                  <span>{phase.name}</span>
                </label>
              ))}
            </div>
          )}
        />
      </div>

      <div className="form-group">
        <label htmlFor="estimatedTimeInMinutes">Estimated time (minutes)*</label>
        <Controller
          name="estimatedTimeInMinutes"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="estimatedTimeInMinutes"
              type="number"
              min={1}
              max={1440}
              className={errors.estimatedTimeInMinutes ? 'error' : ''}
              onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
            />
          )}
        />
        <p className="form-hint">Default for this type is about {durationHint} min (backend applies if you use create without duration).</p>
        {errors.estimatedTimeInMinutes && (
          <span className="error-message">{errors.estimatedTimeInMinutes.message}</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="priority">Priority</label>
        <Controller
          name="priority"
          control={control}
          render={({ field }) => (
            <select {...field} id="priority">
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      <div className="form-group">
        <label htmlFor="deadline">Deadline</label>
        <Controller
          name="deadline"
          control={control}
          render={({ field }) => <input {...field} id="deadline" type="datetime-local" />}
        />
      </div>

      <div className="form-group checkbox">
        <Controller
          name="allowSplit"
          control={control}
          render={({ field }) => (
            <div className="checkbox-container">
              <input
                id="allowSplit"
                type="checkbox"
                checked={typeAllowsSplit && (field.value || false)}
                disabled={!typeAllowsSplit}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
              />
              <label htmlFor="allowSplit">
                Allow splitting this task into smaller blocks (only for splittable types)
              </label>
            </div>
          )}
        />
      </div>

      <div className="form-group checkbox">
        <Controller
          name="isRecurring"
          control={control}
          render={({ field }) => (
            <div className="checkbox-container">
              <input
                id="isRecurring"
                type="checkbox"
                checked={field.value || false}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
                disabled={field.disabled}
              />
              <label htmlFor="isRecurring">This is a recurring task</label>
            </div>
          )}
        />
      </div>

      {showRecurrenceOptions && (
        <div className="form-group">
          <label htmlFor="recurrencePattern">Recurrence Pattern</label>
          <Controller
            name="recurrencePattern"
            control={control}
            render={({ field }) => (
              <select {...field} id="recurrencePattern">
                <option value="">-- Select Pattern --</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            )}
          />
        </div>
      )}

      <div className="form-actions">
        <button type="submit" disabled={isSubmitting} className="primary-button">
          {isSubmitting ? 'Saving...' : initialData ? 'Update Task' : 'Create Task'}
        </button>
      </div>
    </form>
  );
};

export default TaskForm;
