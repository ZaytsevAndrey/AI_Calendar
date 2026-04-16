import React, { useMemo } from 'react';
import { Controller, Control } from 'react-hook-form';
import type { PhaseDTO } from '../../../api/phases.api';
import type { TaskWizardFormValues } from './schema';

const lbl = 'mb-1 block text-sm font-medium text-ide-text';

type Props = {
  control: Control<TaskWizardFormValues>;
  phases: PhaseDTO[];
};

export const TaskPhaseStep: React.FC<Props> = ({ control, phases }) => {
  const schedulingPhases = useMemo(() => {
    const toMinutes = (time?: string) => {
      if (!time) return Number.MAX_SAFE_INTEGER;
      const [h, m] = time.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
      return h * 60 + m;
    };

    return phases
      .filter((p) => p.type === 'time_phase' || p.type == null || p.type === undefined)
      .sort((a, b) => {
        const diff = toMinutes(a.startTime) - toMinutes(b.startTime);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
  }, [phases]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ide-muted">
          Optionally pick phases where this task should be considered. Leave empty to allow the full
          day window.
        </p>
      </div>
      <div>
        <span className={lbl}>Eligible phases</span>
        {schedulingPhases.length === 0 ? (
          <p className="text-sm text-ide-muted">No time phases yet. You can skip this step.</p>
        ) : (
          <Controller
            name="phaseIds"
            control={control}
            render={({ field }) => (
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-ide-border p-3">
                {schedulingPhases.map((phase) => (
                  <li key={phase.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-ide-text">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={(field.value ?? []).includes(phase.id)}
                        onChange={(e) => {
                          const cur = field.value ?? [];
                          if (e.target.checked) field.onChange([...cur, phase.id]);
                          else field.onChange(cur.filter((id) => id !== phase.id));
                        }}
                      />
                      <span>
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ backgroundColor: phase.color || '#888' }}
                          aria-hidden
                        />
                        {phase.name}{' '}
                        <span className="text-ide-muted">
                          ({phase.startTime} - {phase.endTime})
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          />
        )}
      </div>
    </div>
  );
};
