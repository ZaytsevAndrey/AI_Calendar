import React, { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';
import { PhaseDTO } from '../../../api/phases.api';

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const taskSchema = z.object({
  name: z.string().min(1, 'Task name is required'),
  description: z.string().optional(),
  phaseId: z.string().optional(),
  estimatedTimeInMinutes: z.number().min(1, 'Time must be at least 1 minute').max(1440, 'Time cannot exceed 24 hours'),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().optional(),
  allowSplit: z.boolean().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  deadline: z.string().optional(),
});

type TaskFormData = z.infer<typeof taskSchema>;

interface TaskFormProps {
  initialData?: TaskDTO;
  phases: PhaseDTO[];
  onSubmit: (data: CreateTaskDTO | UpdateTaskDTO) => void;
  isSubmitting: boolean;
}

const TaskForm: React.FC<TaskFormProps> = ({ initialData, phases, onSubmit, isSubmitting }) => {
  const [showRecurrenceOptions, setShowRecurrenceOptions] = useState(initialData?.isRecurring || false);

  const { control, handleSubmit, formState: { errors }, watch } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: initialData ? {
      ...initialData,
      deadline: initialData.deadline ? new Date(initialData.deadline).toISOString().substring(0, 16) : undefined,
    } : {
      name: '',
      description: '',
      phaseId: '',
      estimatedTimeInMinutes: 25,
      isRecurring: false,
      allowSplit: true,
      priority: 'medium',
    }
  });

  const isRecurring = watch('isRecurring');

  useEffect(() => {
    setShowRecurrenceOptions(!!isRecurring);
  }, [isRecurring]);

  const submitHandler = (data: TaskFormData) => {
    onSubmit(data);
  };

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
        <label htmlFor="phaseId">Phase</label>
        <Controller
          name="phaseId"
          control={control}
          render={({ field }) => (
            <select {...field} id="phaseId">
              <option value="">-- Select Phase --</option>
              {phases.map(phase => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      <div className="form-group">
        <label htmlFor="estimatedTimeInMinutes">Estimated Time (minutes)*</label>
        <Controller
          name="estimatedTimeInMinutes"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="estimatedTimeInMinutes"
              type="number"
              min="1"
              max="1440"
              className={errors.estimatedTimeInMinutes ? 'error' : ''}
              onChange={e => field.onChange(parseInt(e.target.value))}
            />
          )}
        />
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
              {priorityOptions.map(option => (
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
          render={({ field }) => (
            <input
              {...field}
              id="deadline"
              type="datetime-local"
            />
          )}
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
                checked={field.value || false}
                onChange={e => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
                disabled={field.disabled}
              />
              <label htmlFor="allowSplit">Allow splitting this task into smaller blocks</label>
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
                onChange={e => field.onChange(e.target.checked)}
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