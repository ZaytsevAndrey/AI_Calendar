import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { PhaseDTO, CreatePhaseDTO, UpdatePhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { usePhaseValidation } from '../hooks/usePhaseValidation';
import { TimeRangeField } from './TimeRangeField';
import { WeekDaysSelector } from './WeekDaysSelector';
import { ColorField } from './ColorField';

export type PhaseFormData = {
  name: string;
  color: string;
  description?: string;
  startTime: string;
  endTime: string;
  weekDays: number[];
};

interface PhaseFormProps {
  initialData?: PhaseDTO;
  onSubmit: (data: CreatePhaseDTO | UpdatePhaseDTO) => void;
  isSubmitting: boolean;
  onCancel?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}

const PhaseForm = ({
  initialData,
  onSubmit,
  isSubmitting,
  onCancel,
  onDelete,
  isDeleting = false
}: PhaseFormProps) => {
  const { t } = useTranslation();
  const { data: userSettings } = useGetUserSettingsQuery();
  const [selectedDays, setSelectedDays] = useState<number[]>(initialData?.weekDays || [1,2,3,4,5]);

  const phaseSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('phases.nameRequired')),
        color: z
          .string()
          .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, t('phases.colorInvalid')),
        description: z.string().optional(),
        startTime: z.string().min(1, t('phases.startRequired')),
        endTime: z.string().min(1, t('phases.endRequired')),
        weekDays: z.array(z.number()).min(1, t('phases.weekDaysRequired')),
      }),
    [t],
  );
  
  const { register, handleSubmit, formState: { errors }, watch, setValue, control } = useForm<PhaseFormData>({
    resolver: zodResolver(phaseSchema),
    defaultValues: initialData ? {
      ...initialData,
      weekDays: initialData.weekDays || [1, 2, 3, 4, 5],
    } : {
      name: '',
      color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
      description: '',
      startTime: '09:00',
      endTime: '22:00',
      weekDays: [1, 2, 3, 4, 5],
    }
  });

  const watchedValues = watch();
  
  // Custom validation hook
  const { sleepError } = usePhaseValidation({
    startTime: watchedValues.startTime,
    endTime: watchedValues.endTime,
    selectedDays,
    userSettings,
  });

  // Sync selected days with the form
  React.useEffect(() => {
    setValue('weekDays', selectedDays);
  }, [selectedDays, setValue]);

  const submitHandler = (data: PhaseFormData) => {
    if (sleepError) {
      alert(sleepError);
      return;
    }
    onSubmit({ ...data, weekDays: selectedDays });
  };

  return (
    <form onSubmit={handleSubmit(submitHandler)} className="phase-form space-y-1">
      <div className="form-group">
        <label htmlFor="name">{t('phases.name')}</label>
        <input {...register('name')} id="name" className={errors.name ? 'error' : ''} />
        {errors.name && <span className="error-message">{errors.name.message}</span>}
      </div>

      <ColorField 
        errors={errors} 
        colorValue={watchedValues.color}
        setColor={(value) => setValue('color', value, { shouldDirty: true, shouldValidate: true })}
      />

      <div className="form-group">
        <label htmlFor="description">{t('phases.description')}</label>
        <textarea {...register('description')} id="description" rows={3} />
      </div>

      <TimeRangeField<PhaseFormData> control={control} errors={errors} />

      {/* Field errors */}
      {sleepError && (
        <div className="form-group">
          <span className="error-message validation-error">
            ⚠️ {sleepError}
          </span>
        </div>
      )}
      <WeekDaysSelector 
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        errors={errors}
      />

      <div className="form-actions">
        {initialData && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting || isSubmitting}
            className="ui-btn-danger"
          >
            {isDeleting ? t('common.deleting') : t('common.delete')}
          </button>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn-secondary"
          >
            {t('common.cancel')}
          </button>
        ) : null}
        <button 
          type="submit" 
          disabled={isSubmitting || !!sleepError} 
          className="primary-button"
        >
          {isSubmitting
            ? t('common.saving')
            : initialData
              ? t('phases.update')
              : t('phases.create')}
        </button>
      </div>
    </form>
  );
};

export default PhaseForm;
