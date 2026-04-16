import React from 'react';
import { WIZARD_STEP_LABELS } from './constants';

type Props = {
  currentStep: number;
  totalSteps: number;
};

export const TaskWizardProgress: React.FC<Props> = ({ currentStep, totalSteps }) => {
  return (
    <nav aria-label="Task wizard progress" className="mb-6">
      <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
        {Array.from({ length: totalSteps }, (_, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <li key={WIZARD_STEP_LABELS[i]} className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? 'bg-ide-link text-white ring-2 ring-ide-link ring-offset-2 ring-offset-ide-panel'
                    : done
                      ? 'bg-ide-success/20 text-ide-success'
                      : 'border border-ide-border bg-ide-surface text-ide-muted'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={`hidden text-sm sm:inline ${
                  active ? 'font-semibold text-ide-text' : 'text-ide-muted'
                }`}
              >
                {WIZARD_STEP_LABELS[i]}
              </span>
              {i < totalSteps - 1 ? (
                <span className="hidden text-ide-border sm:inline" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-ide-muted sm:hidden">
        Step {currentStep + 1} of {totalSteps}: {WIZARD_STEP_LABELS[currentStep]}
      </p>
    </nav>
  );
};
