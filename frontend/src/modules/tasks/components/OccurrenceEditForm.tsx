import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type { PhaseDTO } from 'api/phases.api';
import type { EditOccurrenceDTO, TaskDTO } from 'api/tasks.api';
import { Button } from 'ui/Button';
import { DurationChips } from 'ui/DurationChips';
import { HelpTip } from 'ui/HelpTip';
import { Input } from 'ui/Input';
import { Textarea } from 'ui/Textarea';
import { TimeField } from 'ui/TimeField';
import { phaseColor } from 'theme/phasePalette';
import { formatCivilYmd } from 'utils/formatDate';
import { isoToHm, localDateTimeIso, localYmd } from 'utils/ianaDateTime';
import { taskTraits } from '../schedulingTraits';

export type OccurrenceEditScope = 'occurrence' | 'following';

type Props = {
  series: TaskDTO;
  /** Start / end instants of the occurrence being changed. */
  occurrenceStart: string;
  occurrenceEnd?: string;
  scope: OccurrenceEditScope;
  phases: PhaseDTO[];
  timeZone: string;
  isSubmitting: boolean;
  onSubmit: (body: EditOccurrenceDTO) => void;
  onCancel: () => void;
};

const labelText = 'block text-xs font-medium text-ide-text';

/**
 * «Лише цей день» / «Цей і наступні»: the fields one occurrence may own —
 * name, notes, phase (flexible only), start and duration. The day itself
 * cannot change here (the domain keeps an occurrence on its civil day).
 * Only what the user changed is sent.
 */
export function OccurrenceEditForm({
  series,
  occurrenceStart,
  occurrenceEnd,
  scope,
  phases,
  timeZone,
  isSubmitting,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const traits = taskTraits(series);
  const ymd = localYmd(occurrenceStart, timeZone);
  const initialHm = isoToHm(occurrenceStart, timeZone) ?? '';
  const initialMinutes = occurrenceEnd
    ? Math.max(1, Math.round((new Date(occurrenceEnd).getTime() - new Date(occurrenceStart).getTime()) / 60_000))
    : series.estimatedTimeInMinutes;
  const initialPhaseId = series.phaseId ?? series.phases?.[0]?.id ?? '';

  const [name, setName] = useState(series.name);
  const [description, setDescription] = useState(series.description ?? '');
  const [phaseId, setPhaseId] = useState(initialPhaseId);
  const [hm, setHm] = useState(initialHm);
  const [minutes, setMinutes] = useState<number>(initialMinutes);
  const [nameError, setNameError] = useState(false);

  const schedulingPhases = useMemo(
    () => phases.filter((p) => p.type === 'time_phase' || p.type == null),
    [phases],
  );
  const dayLabel = formatCivilYmd(ymd);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    const body: EditOccurrenceDTO = { occurrenceStart, scope };
    if (name.trim() !== series.name) body.name = name.trim();
    if ((description ?? '') !== (series.description ?? '')) body.description = description || null;
    if (!traits.behavior.startsWith('fixed') && phaseId !== initialPhaseId) {
      body.phaseIds = phaseId ? [phaseId] : [];
    }
    if (hm && hm !== initialHm) body.start = localDateTimeIso(ymd, hm, timeZone);
    if (minutes !== initialMinutes) body.durationMinutes = minutes;
    onSubmit(body);
  };

  return (
    <form id="occurrence-form" onSubmit={submit} className="task-form">
      <div className="space-y-4">
        <p className="text-sm text-ide-muted">
          {scope === 'occurrence'
            ? t('tasks.occurrence.thisDayNotice', { when: dayLabel })
            : t('tasks.occurrence.followingNotice', { when: dayLabel })}
        </p>

        <div>
          <label htmlFor="occurrence-name" className={labelText}>
            {t('tasks.form.name')} <span className="text-ide-error">*</span>
          </label>
          <Input
            id="occurrence-name"
            value={name}
            autoComplete="off"
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
          />
          {nameError ? (
            <p className="mt-1 text-body-sm text-ide-error" role="alert">
              {t('tasks.validation.nameRequired')}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="occurrence-description" className={labelText}>
            {t('tasks.form.description')}
          </label>
          <Textarea
            id="occurrence-description"
            rows={2}
            value={description}
            placeholder={t('tasks.form.descriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-0.5 flex items-center gap-1">
              <label htmlFor="occurrence-start" className={labelText}>
                {t('tasks.occurrence.startTime')}
              </label>
              <HelpTip label={t('tasks.form.helpAbout', { field: t('tasks.occurrence.startTime') })}>
                {t('tasks.occurrence.sameDay', { when: dayLabel })}
              </HelpTip>
            </div>
            <TimeField id="occurrence-start" value={hm} onChange={setHm} />
          </div>
          <div>
            <span className={labelText}>{t('tasks.occurrence.duration')}</span>
            <DurationChips
              value={minutes}
              onChange={setMinutes}
              label={t('tasks.occurrence.duration')}
            />
          </div>
        </div>

        {traits.behavior === 'flexible' ? (
          <div>
            <span id="occurrence-phase-label" className={labelText}>
              {t('tasks.form.phase')}
            </span>
            <div
              id="occurrence-phase"
              role="listbox"
              aria-labelledby="occurrence-phase-label"
              className="flex flex-wrap gap-1.5"
            >
              <button
                type="button"
                role="option"
                aria-selected={phaseId === ''}
                className={`filter-chip h-8 px-2.5 text-xs ${phaseId === '' ? 'filter-chip-on' : ''}`}
                onClick={() => setPhaseId('')}
              >
                {t('tasks.form.anyTime')}
              </button>
              {schedulingPhases.map((phase) => {
                const on = phaseId === phase.id;
                const color = phase.color || null;
                return (
                  <button
                    type="button"
                    key={phase.id}
                    role="option"
                    aria-selected={on}
                    className={`filter-chip h-10 max-w-full px-3 text-body-sm md:h-8 md:px-2.5 ${on ? 'filter-chip-on' : ''}`}
                    style={
                      on
                        ? { borderColor: phaseColor(color), backgroundColor: phaseColor(color, 0.2) }
                        : { borderColor: phaseColor(color, 0.55), boxShadow: `inset 3px 0 0 ${phaseColor(color)}` }
                    }
                    onClick={() => setPhaseId(phase.id)}
                  >
                    <span className="truncate">{phase.name}</span>
                    <span className="shrink-0 text-ide-muted">
                      {phase.startTime}–{phase.endTime}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-ide-border pt-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="w-full max-md:!hidden sm:w-auto"
          disabled={isSubmitting}
          icon={X}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting} icon={Check}>
          {isSubmitting ? t('common.saving') : t('tasks.occurrence.save')}
        </Button>
      </div>
    </form>
  );
}

export default OccurrenceEditForm;
