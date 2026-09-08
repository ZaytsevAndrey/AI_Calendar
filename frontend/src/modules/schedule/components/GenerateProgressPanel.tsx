import React from 'react';
import { GenerateProgress } from '../hooks/useScheduleActions';

const STEPS: { id: string; label: string }[] = [
  { id: 'preparing', label: 'Snapshot current schedule' },
  { id: 'computing', label: 'Computing time slots' },
  { id: 'syncing_google', label: 'Updating Google Calendar' },
  { id: 'done', label: 'Finishing up' },
];

function stepIndex(stage: string): number {
  const idx = STEPS.findIndex((step) => step.id === stage);
  if (idx >= 0) return idx;
  if (stage === 'failed') return STEPS.length - 1;
  return 0;
}

type Props = {
  progress: GenerateProgress;
};

export function GenerateProgressPanel({ progress }: Props) {
  const currentIdx = stepIndex(progress.stage);
  const elapsedSec = Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000));
  const syncLabel =
    progress.stage === 'syncing_google' && progress.total && progress.total > 0
      ? ` (${progress.current ?? 0}/${progress.total})`
      : '';

  return (
    <section
      className="rounded-xl border border-ide-border bg-ide-panel p-4"
      aria-live="polite"
      aria-label="Schedule generation progress"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ide-text">Generating schedule</h2>
        <span className="text-xs text-ide-muted">{elapsedSec}s</span>
      </div>
      <ol className="space-y-2">
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  done
                    ? 'bg-ide-link text-white'
                    : active
                      ? 'border border-ide-link text-ide-link'
                      : 'border border-ide-border text-ide-muted'
                }`}
              >
                {done ? '✓' : idx + 1}
              </span>
              <span className={active ? 'text-ide-text' : 'text-ide-muted'}>
                {step.label}
                {active ? syncLabel : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-ide-muted">
        You can keep using the calendar. This often takes a little while because Google Calendar is updated in the background.
      </p>
    </section>
  );
}
