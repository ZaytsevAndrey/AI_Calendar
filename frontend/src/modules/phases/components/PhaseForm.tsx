import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PhaseDTO, CreatePhaseDTO, UpdatePhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import 'modules/phases/components/PhaseForm.scss';
import { usePhaseValidation } from '../hooks/usePhaseValidation';
import { TimeRangeField } from './TimeRangeField';
import { WeekDaysSelector } from './WeekDaysSelector';
import { ColorField } from './ColorField';

const phaseSchema = z.object({
  name: z.string().min(1, 'Phase name is required'),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid color format'),
  description: z.string().optional(),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  weekDays: z.array(z.number()).min(1, 'Select at least one day of the week'),
});

type PhaseFormData = z.infer<typeof phaseSchema>;

interface PhaseFormProps {
  initialData?: PhaseDTO;
  onSubmit: (data: CreatePhaseDTO | UpdatePhaseDTO) => void;
  isSubmitting: boolean;
}

const PhaseForm = ({ initialData, onSubmit, isSubmitting }: PhaseFormProps) => {
  const { data: userSettings } = useGetUserSettingsQuery();
  const [selectedDays, setSelectedDays] = useState<number[]>(initialData?.weekDays || [1,2,3,4,5]);
  
  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<PhaseFormData>({
    resolver: zodResolver(phaseSchema),
    defaultValues: initialData ? {
      ...initialData,
      weekDays: initialData.weekDays || [1, 2, 3, 4, 5],
    } : {
      name: '',
      color: '#' + Math.floor(Math.random()*16777215).toString(16),
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
    <form onSubmit={handleSubmit(submitHandler)} className="phase-form form-container">
      <div className="form-group">
        <label htmlFor="name">Phase Name*</label>
        <input {...register('name')} id="name" className={errors.name ? 'error' : ''} />
        {errors.name && <span className="error-message">{errors.name.message}</span>}
      </div>

      <ColorField 
        register={register} 
        errors={errors} 
      />

      <div className="form-group">
        <label htmlFor="description">Description</label>
        <textarea {...register('description')} id="description" rows={3} />
      </div>

      <TimeRangeField 
        register={register}
        errors={errors}
        watchedValues={watchedValues}
        setValue={setValue}
      />

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
        <button 
          type="submit" 
          disabled={isSubmitting || !!sleepError} 
          className="primary-button"
        >
          {isSubmitting ? 'Saving...' : initialData ? 'Update Phase' : 'Create Phase'}
        </button>
      </div>
    </form>
  );
};

export default PhaseForm; 