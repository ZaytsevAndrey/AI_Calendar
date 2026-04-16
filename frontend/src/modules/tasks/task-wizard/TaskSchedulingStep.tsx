import React from 'react';
import { Control, FieldErrors, useWatch } from 'react-hook-form';
import type { TaskWizardFormValues } from './schema';
import { DEFAULT_DURATION_BY_TYPE, SPLITTABLE_TYPES } from './constants';
import type { TaskEventType } from '../../../api/tasks.api';
import {
  EVENT_TYPE_SCHEDULING_HINTS,
  getSchedulingConfigForEventType,
  SCHEDULING_FIELD_VISIBILITY,
  SCHEDULING_MODE_DESCRIPTION,
  type SchedulingFieldKey,
} from './schedulingFields.config';
import {
  AllowSplitField,
  DeadlineField,
  EstimatedTimeField,
  FixedEndField,
  FixedStartField,
  IsRecurringField,
  PreferredEndField,
  PreferredStartField,
  RecurrencePatternField,
} from './fields/SchedulingFields';

type Props = {
  control: Control<TaskWizardFormValues>;
  errors: FieldErrors<TaskWizardFormValues>;
  eventType?: TaskEventType;
};

export const TaskSchedulingStep: React.FC<Props> = ({
  control,
  errors,
  eventType,
}) => {
  const resolvedEventType: TaskEventType = eventType ?? 'admin';
  const typeAllowsSplit = SPLITTABLE_TYPES.has(resolvedEventType);
  const defaultForType = DEFAULT_DURATION_BY_TYPE[resolvedEventType] ?? 30;
  const isRecurring = useWatch({ control, name: 'isRecurring' });
  const config = getSchedulingConfigForEventType(resolvedEventType);
  const eventHint = EVENT_TYPE_SCHEDULING_HINTS[resolvedEventType];

  const fieldRenderers: Record<SchedulingFieldKey, React.ReactNode> = {
    scheduledStartTime: <FixedStartField control={control} errors={errors} />,
    scheduledEndTime: <FixedEndField control={control} errors={errors} />,
    deadline: <DeadlineField control={control} errors={errors} />,
    estimatedTimeInMinutes: (
      <EstimatedTimeField
        control={control}
        errors={errors}
        defaultForType={defaultForType}
      />
    ),
    allowSplit: (
      <AllowSplitField
        control={control}
        errors={errors}
        typeAllowsSplit={typeAllowsSplit}
      />
    ),
    isRecurring: <IsRecurringField control={control} errors={errors} />,
    recurrencePattern: <RecurrencePatternField control={control} errors={errors} />,
    preferredStartTime: <PreferredStartField control={control} errors={errors} />,
    preferredEndTime: <PreferredEndField control={control} errors={errors} />,
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ide-muted">
          {SCHEDULING_MODE_DESCRIPTION[config.mode]}
        </p>
      </div>
      {eventHint ? (
        <div className="rounded-md border border-ide-border bg-ide-surface p-3 text-sm text-ide-muted">
          {eventHint}
        </div>
      ) : null}
      {config.fields.map((fieldKey) => {
        const visibility = SCHEDULING_FIELD_VISIBILITY[fieldKey];
        if (visibility?.requiresRecurring && !isRecurring) return null;
        return <React.Fragment key={fieldKey}>{fieldRenderers[fieldKey]}</React.Fragment>;
      })}
    </div>
  );
};
