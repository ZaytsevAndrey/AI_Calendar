import React from 'react';
import { useTranslation } from 'react-i18next';
import { GenerateProgress } from '../hooks/useScheduleActions';

const STEP_IDS = ['preparing', 'computing', 'syncing_google', 'done'] as const;

const STEP_LABEL_KEYS: Record<(typeof STEP_IDS)[number], string> = {
  preparing: 'schedule.stepPreparing',
  computing: 'schedule.stepComputing',
  syncing_google: 'schedule.stepSyncing',
  done: 'schedule.stepDone',
};

function stepIndex(stage: string): number {
  const idx = STEP_IDS.findIndex((id) => id === stage);
  if (idx >= 0) return idx;
  if (stage === 'failed') return STEP_IDS.length - 1;
  return 0;
}

type Props = {
  progress: GenerateProgress;
};

export function GenerateProgressPanel({ progress }: Props) {
  const { t } = useTranslation();
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
      aria-label={t('schedule.progressAria')}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ide-text">{t('schedule.generatingTitle')}</h2>
        <span className="text-xs text-ide-muted">{elapsedSec}s</span>
      </div>
      <ol className="space-y-2">
        {STEP_IDS.map((id, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
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
                {t(STEP_LABEL_KEYS[id])}
                {active ? syncLabel : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-ide-muted">{t('schedule.progressHint')}</p>
    </section>
  );
}
