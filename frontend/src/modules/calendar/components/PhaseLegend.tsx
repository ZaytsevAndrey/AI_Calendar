import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronDown, Pencil } from 'lucide-react';
import { useTimePhasesForDate } from 'modules/phases/hooks/usePhases';
import { Popover } from 'ui/Popover';
import { cx } from 'ui/cx';
import { phaseColor } from 'theme/phasePalette';

/** Phases are edited in Settings → «Мій день». */
export const PHASES_SETTINGS_PATH = '/settings/day';

type Phase = {
  id: string;
  name: string;
  color?: string | null;
  startTime: string;
  endTime: string;
  type?: string;
};

type Props = {
  date: Date;
  /** Phone: icon-only trigger. */
  compact?: boolean;
};

/** Phase colors in the toolbar: stacked dots that open the list with times and «Редагувати фази». */
export function PhaseLegend({ date, compact = false }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data = [] } = useTimePhasesForDate(date);
  const phases = (data as Phase[])
    .filter((phase) => phase.type !== 'sleep_time')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (!phases.length) return null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('calendar.phasesLegend')}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex shrink-0 items-center gap-2 rounded-control border border-ide-border bg-ide-panel text-body-sm text-ide-text transition hover:bg-ide-surface',
          compact ? 'h-11 px-3' : 'h-9 px-3',
        )}
      >
        <span className="flex -space-x-1" aria-hidden>
          {phases.slice(0, 4).map((phase) => (
            <span
              key={phase.id}
              className="h-3 w-3 rounded-full ring-2 ring-ide-panel"
              style={{ backgroundColor: phaseColor(phase.color) }}
            />
          ))}
        </span>
        {compact ? null : <span>{t('calendar.phases')}</span>}
        <ChevronDown className="h-4 w-4 text-ide-muted" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={280} align="end" label={t('calendar.phasesLegend')} className="p-2">
        <ul className="flex flex-col">
          {phases.map((phase) => (
            <li key={phase.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: phaseColor(phase.color) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body-sm text-ide-text">{phase.name}</span>
              <span className="shrink-0 text-caption tabular-nums text-ide-muted">
                {phase.startTime}–{phase.endTime}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-ide-border pt-1">
          <Link
            to={PHASES_SETTINGS_PATH}
            onClick={() => setOpen(false)}
            className="flex h-9 items-center gap-2 rounded-lg px-2 text-body-sm text-ide-link hover:bg-ide-surface"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            {t('calendar.editPhases')}
          </Link>
        </div>
      </Popover>
    </>
  );
}
