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
import { Check, Plus, Trash2, X } from 'lucide-react';
import { Button } from 'ui/Button';
import { Input } from 'ui/Input';
import { Textarea } from 'ui/Textarea';
import { PHASE_PALETTE } from 'theme/phasePalette';

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
  /** New phase: start values (a free gap the user tapped). */
  defaults?: Partial<Pick<PhaseFormData, 'startTime' | 'endTime' | 'weekDays'>>;
  onSubmit: (data: CreatePhaseDTO | UpdatePhaseDTO) => void;
  isSubmitting: boolean;
  onCancel?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}

const PhaseForm = ({
  initialData,
  defaults,
  onSubmit,
  isSubmitting,
  onCancel,
  onDelete,
  isDeleting = false
}: PhaseFormProps) => {
  const { t } = useTranslation();
  const { data: userSettings } = useGetUserSettingsQuery();
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initialData?.weekDays || defaults?.weekDays || [1, 2, 3, 4, 5],
  );

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
      color: PHASE_PALETTE[Math.floor(Math.random() * PHASE_PALETTE.length)].hex,
      description: '',
      startTime: defaults?.startTime ?? '09:00',
      endTime: defaults?.endTime ?? '12:00',
      weekDays: defaults?.weekDays ?? [1, 2, 3, 4, 5],
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
    <form onSubmit={handleSubmit(submitHandler)} className="flex flex-col gap-5">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
          {t('phases.name')}
        </label>
        <Input {...register('name')} id="name" error={!!errors.name} autoComplete="off" />
        {errors.name && <span className="error-message">{errors.name.message}</span>}
      </div>

      <ColorField
        errors={errors}
        colorValue={watchedValues.color}
        setColor={(value) => setValue('color', value, { shouldDirty: true, shouldValidate: true })}
      />

      <WeekDaysSelector selectedDays={selectedDays} setSelectedDays={setSelectedDays} errors={errors} />

      <TimeRangeField<PhaseFormData> control={control} errors={errors} />
      {sleepError ? (
        <p className="-mt-3 text-body-sm text-ide-error" role="alert">
          {sleepError}
        </p>
      ) : null}

      <div>
        <label htmlFor="description" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
          {t('phases.description')}
        </label>
        <Textarea {...register('description')} id="description" rows={2} />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-ide-border pt-4 sm:flex-row sm:items-center">
        {initialData && onDelete ? (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={isDeleting || isSubmitting}
            className="sm:mr-auto"
            icon={Trash2}
          >
            {isDeleting ? t('common.deleting') : t('common.delete')}
          </Button>
        ) : (
          <span className="sm:mr-auto" />
        )}
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} className="max-md:hidden" icon={X}>
            {t('common.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting || !!sleepError} icon={initialData ? Check : Plus}>
          {isSubmitting ? t('common.saving') : initialData ? t('phases.update') : t('phases.create')}
        </Button>
      </div>
    </form>
  );
};

export default PhaseForm;
