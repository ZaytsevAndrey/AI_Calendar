import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CreateHabitDTO, HabitDTO, UpdateHabitDTO } from 'api/habits.api';

const habitSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80, 'Keep it under 80 characters'),
    color: z.string().regex(/^#([A-Fa-f0-9]{6})$/, 'Use a hex color like #22c55e'),
    description: z.string().max(500, 'Keep it under 500 characters').optional(),
    reserveBlock: z.boolean(),
    blockStartTime: z.string(),
    blockMinutes: z.coerce.number(),
  })
  .superRefine((value, ctx) => {
    if (!value.reserveBlock) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.blockStartTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockStartTime'],
        message: 'Use a time like 07:30',
      });
    }
    if (
      !Number.isInteger(value.blockMinutes) ||
      value.blockMinutes < 5 ||
      value.blockMinutes > 240
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockMinutes'],
        message: 'Use 5–240 minutes',
      });
    }
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
      reserveBlock: Boolean(initialData?.blockStartTime && initialData?.blockMinutes),
      blockStartTime: initialData?.blockStartTime ?? '07:00',
      blockMinutes: initialData?.blockMinutes ?? 30,
    },
  });

  const colorValue = watch('color');
  const reserveBlock = watch('reserveBlock');

  return (
        <form
          onSubmit={handleSubmit((values) =>
            onSubmit({
              name: values.name,
              color: values.color,
              description: values.description,
              blockStartTime: values.reserveBlock ? values.blockStartTime : null,
              blockMinutes: values.reserveBlock ? values.blockMinutes : null,
            }),
          )}
          className="space-y-1"
        >
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

      <div className="ui-field">
        <label className="flex items-center gap-2 text-sm text-ide-text">
          <input type="checkbox" {...register('reserveBlock')} className="h-4 w-4" />
          Reserve a daily time block
        </label>
        {reserveBlock ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="habit-block-start" className="ui-label">
                  Starts
                </label>
                <input
                  id="habit-block-start"
                  type="time"
                  {...register('blockStartTime')}
                  className={`ui-input ${errors.blockStartTime ? 'ui-input-error' : ''}`}
                />
                {errors.blockStartTime ? (
                  <span className="ui-error">{errors.blockStartTime.message}</span>
                ) : null}
              </div>
              <div>
                <label htmlFor="habit-block-minutes" className="ui-label">
                  Minutes
                </label>
                <input
                  id="habit-block-minutes"
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  {...register('blockMinutes')}
                  className={`ui-input ${errors.blockMinutes ? 'ui-input-error' : ''}`}
                />
                {errors.blockMinutes ? (
                  <span className="ui-error">{errors.blockMinutes.message}</span>
                ) : null}
              </div>
            </div>
            <p className="ui-hint">
              Generate will not place tasks on top of this time. When Google Calendar is connected,
              the same block is added there every day.
            </p>
          </>
        ) : null}
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
