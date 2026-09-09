import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CreateHabitDTO, HabitDTO, UpdateHabitDTO } from 'api/habits.api';

const habitSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Keep it under 80 characters'),
  color: z.string().regex(/^#([A-Fa-f0-9]{6})$/, 'Use a hex color like #22c55e'),
  description: z.string().max(500, 'Keep it under 500 characters').optional(),
});

type HabitFormData = z.infer<typeof habitSchema>;

type HabitFormProps = {
  initialData?: HabitDTO | null;
  onSubmit: (data: CreateHabitDTO | UpdateHabitDTO) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
};

function randomColor(): string {
  return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
}

const HabitForm: React.FC<HabitFormProps> = ({
  initialData,
  onSubmit,
  isSubmitting,
  onCancel,
  onDelete,
  isDeleting = false,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<HabitFormData>({
    resolver: zodResolver(habitSchema),
    defaultValues: {
      name: initialData?.name ?? '',
      color: initialData?.color ?? randomColor(),
      description: initialData?.description ?? '',
    },
  });

  const colorValue = watch('color');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-1">
      <div className="ui-field">
        <label htmlFor="habit-name" className="ui-label">
          Name
        </label>
        <input
          id="habit-name"
          {...register('name')}
          className={`ui-input ${errors.name ? 'ui-input-error' : ''}`}
          placeholder="Exercise, No smoking…"
          autoFocus
        />
        {errors.name ? <span className="ui-error">{errors.name.message}</span> : null}
      </div>

      <div className="ui-field">
        <label htmlFor="habit-color" className="ui-label">
          Color
        </label>
        <div className="flex items-center gap-3">
          <input
            id="habit-color"
            type="color"
            value={colorValue}
            onChange={(event) =>
              setValue('color', event.target.value, { shouldDirty: true, shouldValidate: true })
            }
            className="h-11 w-14 cursor-pointer rounded-lg border border-ide-border bg-ide-surface p-1"
          />
          <input
            aria-label="Hex color"
            {...register('color')}
            className={`ui-input ${errors.color ? 'ui-input-error' : ''}`}
          />
        </div>
        {errors.color ? <span className="ui-error">{errors.color.message}</span> : null}
      </div>

      <div className="ui-field">
        <label htmlFor="habit-description" className="ui-label">
          Description (optional)
        </label>
        <textarea
          id="habit-description"
          {...register('description')}
          rows={3}
          className={`ui-textarea ${errors.description ? 'ui-input-error' : ''}`}
        />
        {errors.description ? (
          <span className="ui-error">{errors.description.message}</span>
        ) : (
          <p className="ui-hint">Tap = a successful day. The name carries the meaning.</p>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {initialData && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting || isSubmitting}
            className="ui-btn-danger sm:mr-auto"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="ui-btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} className="ui-btn-primary">
          {isSubmitting ? 'Saving…' : initialData ? 'Save' : 'Create habit'}
        </button>
      </div>
    </form>
  );
};

export default HabitForm;
