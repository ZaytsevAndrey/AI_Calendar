import React, { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';
import { PhaseDTO } from '../../../api/phases.api';
import {
  taskWizardSchema,
  type TaskWizardFormValues,
  STEP_0_FIELDS,
  STEP_1_FIELDS,
} from '../task-wizard/schema';
import { buildTaskPayload, initialWizardValues } from '../task-wizard/buildPayload';
import { TaskWizardProgress } from '../task-wizard/TaskWizardProgress';
import { TaskTypeStep } from '../task-wizard/TaskTypeStep';
import { TaskDetailsStep } from '../task-wizard/TaskDetailsStep';
import { TaskSchedulingStep } from '../task-wizard/TaskSchedulingStep';
import { TaskPhaseStep } from '../task-wizard/TaskPhaseStep';
import { TaskReviewStep } from '../task-wizard/TaskReviewStep';
import { SPLITTABLE_TYPES } from '../task-wizard/constants';
import type { TaskEventType } from '../../../api/tasks.api';
import { getSchedulingConfigForEventType } from '../task-wizard/schedulingFields.config';

const TOTAL_STEPS = 4;

interface TaskFormProps {
  initialData?: TaskDTO;
  phases: PhaseDTO[];
  onSubmit: (data: CreateTaskDTO | UpdateTaskDTO) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  mode: 'create' | 'edit';
}

const TaskForm: React.FC<TaskFormProps> = ({
  initialData,
  phases,
  onSubmit,
  isSubmitting,
  onCancel,
  mode,
}) => {
  const [step, setStep] = useState(0);

  const defaultValues = useMemo(() => initialWizardValues(initialData), [initialData]);

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    trigger,
    getValues,
    setError,
    clearErrors,
    reset,
  } = useForm<TaskWizardFormValues>({
    resolver: zodResolver(taskWizardSchema),
    defaultValues,
    mode: 'onTouched',
  });

  useEffect(() => {
    reset(initialWizardValues(initialData));
    setStep(0);
  }, [initialData, reset]);

  const eventType = useWatch({ control, name: 'eventType' }) as TaskEventType | undefined;
  const isRecurring = useWatch({ control, name: 'isRecurring' });
  const typeAllowsSplit = eventType ? SPLITTABLE_TYPES.has(eventType) : false;

  useEffect(() => {
    if (!typeAllowsSplit) {
      setValue('allowSplit', false);
    }
  }, [typeAllowsSplit, setValue]);

  const submitHandler = (data: TaskWizardFormValues) => {
    const payload = buildTaskPayload(data);
    onSubmit(payload);
  };

  const goNext = async () => {
    clearErrors('scheduledEndTime');
    if (step === 0) {
      const ok = await trigger([...STEP_0_FIELDS]);
      if (!ok) return;
      setStep(1);
      return;
    }
    if (step === 1) {
      const ok = await trigger([...STEP_1_FIELDS]);
      if (!ok) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      const schedulingConfig = getSchedulingConfigForEventType(eventType);
      const validationFields = isRecurring
        ? schedulingConfig.validationFieldsWhenRecurring
        : schedulingConfig.validationFieldsWhenNotRecurring;
      const ok = await trigger(validationFields);
      if (!ok) return;

      if (schedulingConfig.mode === 'fixed') {
        const s = getValues('scheduledStartTime');
        const e = getValues('scheduledEndTime');
        if (s && e && new Date(e).getTime() <= new Date(s).getTime()) {
          setError('scheduledEndTime', {
            type: 'manual',
            message: 'End must be after start',
          });
          return;
        }
      }
      setStep(3);
      return;
    }
  };

  const goBack = () => {
    clearErrors();
    setStep((s) => Math.max(0, s - 1));
  };

  const title = mode === 'create' ? 'Create event' : 'Edit event';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step === TOTAL_STEPS - 1) {
          void handleSubmit(submitHandler)();
        }
      }}
      className="task-form flex flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        <h2 className="sr-only">{title}</h2>
        <TaskWizardProgress currentStep={step} totalSteps={TOTAL_STEPS} />

        {step === 0 ? (
          <div className="space-y-6">
            <TaskTypeStep control={control} errors={errors} />
            <TaskPhaseStep control={control} phases={phases} />
          </div>
        ) : null}
        {step === 1 ? <TaskDetailsStep control={control} errors={errors} /> : null}
        {step === 2 ? (
          <TaskSchedulingStep
            control={control}
            errors={errors}
            eventType={eventType}
            phases={phases}
          />
        ) : null}
        {step === 3 ? <TaskReviewStep getValues={getValues} phases={phases} /> : null}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-ide-border pt-4 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : goBack())}
          className="ui-btn-secondary w-full sm:w-auto"
          disabled={isSubmitting}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <div className="flex flex-col gap-2 sm:flex-row">
          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={() => void goNext()}
              className="ui-btn-primary w-full sm:w-auto"
              disabled={isSubmitting}
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              className="ui-btn-primary w-full sm:w-auto"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create event' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
};

export default TaskForm;
