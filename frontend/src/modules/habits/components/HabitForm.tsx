import React, { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { CreateHabitDTO, HabitDTO, UpdateHabitDTO } from 'api/habits.api';

type HabitFormData = {
  name: string;
  color: string;
  description?: string;
  reserveBlock: boolean;
  blockStartTime: string;
  blockMinutes: number;
};

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
  const { t } = useTranslation();

  const habitSchema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, t('habits.nameRequired'))
            .max(80, t('habits.nameMax')),
          color: z.string().regex(/^#([A-Fa-f0-9]{6})$/, t('habits.colorInvalid')),
          description: z.string().max(500, t('habits.descriptionMax')).optional(),
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
              message: t('habits.timeFormat'),
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
              message: t('habits.minutesRange'),
            });
          }
        }),
    [t],
  );

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
          {t('habits.name')}
        </label>
        <input
          id="habit-name"
          {...register('name')}
          className={`ui-input ${errors.name ? 'ui-input-error' : ''}`}
          placeholder={t('habits.namePlaceholder')}
          autoFocus
        />
        {errors.name ? <span className="ui-error">{errors.name.message}</span> : null}
      </div>

      <div className="ui-field">
        <label htmlFor="habit-color" className="ui-label">
          {t('habits.color')}
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
            aria-label={t('habits.hexColor')}
            {...register('color')}
            className={`ui-input ${errors.color ? 'ui-input-error' : ''}`}
          />
        </div>
        {errors.color ? <span className="ui-error">{errors.color.message}</span> : null}
      </div>

      <div className="ui-field">
        <label htmlFor="habit-description" className="ui-label">
          {t('habits.description')}
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
          <p className="ui-hint">{t('habits.descriptionHint')}</p>
        )}
      </div>

      <div className="ui-field">
        <label className="flex items-center gap-2 text-sm text-ide-text">
          <input type="checkbox" {...register('reserveBlock')} className="h-4 w-4" />
          {t('habits.reserveBlock')}
        </label>
        {reserveBlock ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="habit-block-start" className="ui-label">
                  {t('habits.starts')}
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
                  {t('habits.minutes')}
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
            <p className="ui-hint">{t('habits.reserveHint')}</p>
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
            {isDeleting ? t('common.deleting') : t('common.delete')}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="ui-btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting} className="ui-btn-primary">
          {isSubmitting
            ? t('common.saving')
            : initialData
              ? t('common.save')
              : t('habits.createHabit')}
        </button>
      </div>
    </form>
  );
};

export default HabitForm;
