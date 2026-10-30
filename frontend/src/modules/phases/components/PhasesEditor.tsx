import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, LayoutTemplate, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  useApplyPhasePresetMutation,
  useCreatePhaseMutation,
  useDeletePhaseMutation,
  useGetAllPhasesQuery,
  useUpdatePhaseMutation,
} from 'api/phasesApi';
import type { PhasePresetId } from 'api/phasesApi';
import type { CreatePhaseDTO, PhaseDTO, UpdatePhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { Modal } from 'ui/Modal';
import { Button } from 'ui/Button';
import { cx } from 'ui/cx';
import { useIsPhone } from 'ui/useViewport';
import { dialogButtonSize } from 'ui/controlSize';
import { phaseColor } from 'theme/phasePalette';
import { formatWeekdays } from 'utils/formatWeekdays';
import { showErrorToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import PhasesWeek from './PhasesWeek';
import { PhasePresetPicker, messageFromApiError } from './PhasePresetPicker';
import { WeekDaysSelector } from './WeekDaysSelector';
import type { PhaseFormData } from './PhaseForm';
import { minutesToTime, resolveActiveWindow, resolvePhaseRangeInActiveWindow } from '../utils/phasesTimeUtils';

const PhaseForm = lazy(() => import(/* webpackChunkName: "phase-form" */ './PhaseForm'));

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_KEYS: Record<number, string> = {
  1: 'phases.mon',
  2: 'phases.tue',
  3: 'phases.wed',
  4: 'phases.thu',
  5: 'phases.fri',
  6: 'phases.sat',
  0: 'phases.sun',
};

type Editing =
  | { kind: 'edit'; phase: PhaseDTO }
  | { kind: 'new'; defaults?: Partial<Pick<PhaseFormData, 'startTime' | 'endTime' | 'weekDays'>> }
  | null;

function isUserPhase(phase: PhaseDTO): boolean {
  return (
    phase.type !== 'main_phase' &&
    phase.type !== 'sleep_time' &&
    phase.name !== 'Focus hours' &&
    phase.name !== 'Години фокусу'
  );
}

function appliesOn(phase: PhaseDTO, dow: number): boolean {
  return !phase.weekDays?.length || phase.weekDays.includes(dow);
}

function weekDaysForPreset(phases: PhaseDTO[]): number[] {
  if (phases.length === 0) return [1, 2, 3, 4, 5];
  if (phases.some((phase) => !phase.weekDays?.length)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  phases.forEach((phase) => phase.weekDays?.forEach((day) => days.add(day)));
  return [...days].sort((a, b) => a - b);
}

/** Settings → «Мій день» → Фази. Desktop: weekly template + list + side drawer. Phone: mini-week, the day's list, sheets. */
export function PhasesEditor() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const { data: allPhases = [], isLoading, error } = useGetAllPhasesQuery();
  const { data: settings } = useGetUserSettingsQuery();
  const phases = useMemo(() => allPhases.filter(isUserPhase), [allPhases]);
  const [createPhase, { isLoading: creating }] = useCreatePhaseMutation();
  const [updatePhase, { isLoading: updating }] = useUpdatePhaseMutation();
  const [deletePhase, { isLoading: deleting }] = useDeletePhaseMutation();
  const [applyPreset, { isLoading: applying }] = useApplyPhasePresetMutation();
  const [editing, setEditing] = useState<Editing>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PhaseDTO | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetId, setPresetId] = useState<PhasePresetId>('working');
  const [presetDays, setPresetDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [day, setDay] = useState<number>(() => new Date().getDay());

  const window = useMemo(
    () => resolveActiveWindow(settings?.wakeTime || '07:00', settings?.sleepTime || '22:00'),
    [settings?.wakeTime, settings?.sleepTime],
  );
  const rangeOf = (phase: PhaseDTO) => resolvePhaseRangeInActiveWindow(phase.startTime, phase.endTime, window);
  const sorted = useMemo(
    () => [...phases].sort((a, b) => rangeOf(a).start - rangeOf(b).start),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phases, window],
  );

  const onTimeChange = useCallback(
    async (phaseId: string, startTime: string, endTime: string) => {
      try {
        await updatePhase({ id: phaseId, phase: { startTime, endTime } }).unwrap();
      } catch {
        showErrorToast({ title: t('phases.updateFailed'), detail: t('phases.updateFailedDetail') });
        throw new Error('phase-update-failed');
      }
    },
    [t, updatePhase],
  );

  const submit = async (data: CreatePhaseDTO | UpdatePhaseDTO) => {
    try {
      if (editing?.kind === 'edit') await updatePhase({ id: editing.phase.id, phase: data }).unwrap();
      else await createPhase(data as CreatePhaseDTO).unwrap();
      setEditing(null);
    } catch (err) {
      showErrorToast({ title: t('phases.saveFailed'), detail: extractApiErrorMessage(err) });
    }
  };

  const remove = async () => {
    const target = confirmDelete;
    if (!target) return;
    try {
      await deletePhase(target.id).unwrap();
      setConfirmDelete(null);
      setEditing(null);
      setSelectedId(null);
    } catch (err) {
      showErrorToast({ title: t('phases.deleteFailed'), detail: extractApiErrorMessage(err) });
    }
  };

  const openPreset = () => {
    setPresetId('working');
    setPresetDays(weekDaysForPreset(phases));
    setPresetOpen(true);
  };

  const runPreset = async () => {
    if (presetDays.length === 0) return;
    try {
      await applyPreset({ presetId, weekDays: presetDays }).unwrap();
      setPresetOpen(false);
    } catch (err: unknown) {
      showErrorToast({
        title: t('phases.applyFailed'),
        detail: messageFromApiError(err) ?? t('phases.applyFailedDetail'),
      });
    }
  };

  // Phone: the selected day's phases with the free gaps between them.
  const dayRows = useMemo(() => {
    const list = sorted.filter((phase) => appliesOn(phase, day));
    const rows: Array<{ kind: 'phase'; phase: PhaseDTO } | { kind: 'gap'; start: number; end: number }> = [];
    let cursor = window.start;
    for (const phase of list) {
      const r = rangeOf(phase);
      if (r.start - cursor >= 30) rows.push({ kind: 'gap', start: cursor, end: r.start });
      rows.push({ kind: 'phase', phase });
      cursor = Math.max(cursor, r.end);
    }
    if (window.end - cursor >= 30) rows.push({ kind: 'gap', start: cursor, end: window.end });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, day, window]);

  if (isLoading) return <p className="px-1 py-6 text-body-sm text-ide-muted">{t('phases.loading')}</p>;
  if (error) {
    return (
      <p className="rounded-control border border-ide-error/40 bg-ide-errorTint px-4 py-3 text-body-sm text-ide-error">
        {t('phases.loadError')}
      </p>
    );
  }

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ide-border px-4 py-3 md:px-5">
      <div className="min-w-0">
        <h2 className="text-heading font-semibold text-ide-text">{t('settings.phasesTitle')}</h2>
        <p className="mt-0.5 text-body-sm text-ide-muted">{t('settings.phasesHint')}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size={{ base: 'md', md: 'sm' }} icon={LayoutTemplate} onClick={openPreset}>
          {t('phases.templates')}
        </Button>
        <Button size={{ base: 'md', md: 'sm' }} icon={Plus} onClick={() => setEditing({ kind: 'new' })}>
          {t('phases.add')}
        </Button>
      </div>
    </header>
  );

  const phaseRow = (phase: PhaseDTO, showDays: boolean) => {
    const r = rangeOf(phase);
    return (
      <button
        type="button"
        onClick={() => setEditing({ kind: 'edit', phase })}
        className={cx(
          'flex min-h-[52px] w-full items-center gap-3 rounded-control px-3 text-left transition hover:bg-ide-surface',
          selectedId === phase.id && 'bg-ide-surface',
        )}
        data-testid="phase-row"
      >
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: phaseColor(phase.color) }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ide-text">{phase.name}</span>
          <span className="block truncate text-body-sm tabular-nums text-ide-muted">
            {minutesToTime(r.start)}–{minutesToTime(r.end)}
            {showDays ? ` · ${formatWeekdays(phase.weekDays, t)}` : ''}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ide-muted" aria-hidden />
      </button>
    );
  };

  return (
    <section className="rounded-control border border-ide-border bg-ide-panel">
      {header}

      {phone ? (
        <div className="p-3">
          <div role="group" aria-label={t('phases.daysOfWeek')} className="mb-3 grid grid-cols-7 gap-1">
            {DAY_ORDER.map((dow) => {
              const on = dow === day;
              const span = window.end - window.start;
              return (
                <button
                  key={dow}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDay(dow)}
                  className={cx(
                    'flex flex-col items-center gap-1 rounded-control p-1 transition',
                    on ? 'bg-ide-surface ring-1 ring-ide-link' : 'active:bg-ide-surface',
                  )}
                >
                  <span className={cx('text-caption', on ? 'font-semibold text-ide-link' : 'text-ide-muted')}>
                    {t(DAY_KEYS[dow])}
                  </span>
                  <span className="relative h-16 w-3 overflow-hidden rounded-full bg-ide-surface" aria-hidden>
                    {sorted
                      .filter((phase) => appliesOn(phase, dow))
                      .map((phase) => {
                        const r = rangeOf(phase);
                        return (
                          <span
                            key={phase.id}
                            className="absolute inset-x-0"
                            style={{
                              top: `${((r.start - window.start) / span) * 100}%`,
                              height: `${((r.end - r.start) / span) * 100}%`,
                              backgroundColor: phaseColor(phase.color),
                            }}
                          />
                        );
                      })}
                  </span>
                </button>
              );
            })}
          </div>
          <ul className="flex flex-col gap-1">
            {dayRows.map((row) =>
              row.kind === 'phase' ? (
                <li key={row.phase.id}>{phaseRow(row.phase, true)}</li>
              ) : (
                <li key={`gap-${row.start}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        kind: 'new',
                        defaults: { startTime: minutesToTime(row.start), endTime: minutesToTime(row.end), weekDays: [day] },
                      })
                    }
                    className="flex min-h-11 w-full items-center gap-3 rounded-control border border-dashed border-ide-border px-3 text-left text-body-sm text-ide-muted"
                  >
                    <Plus className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1">{t('phases.noPhaseGap')}</span>
                    <span className="tabular-nums">
                      {minutesToTime(row.start)}–{minutesToTime(row.end)}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : (
        <div className="grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <p className="mb-2 text-body-sm text-ide-muted">{t('phases.dragHint', { minutes: 15 })}</p>
            <PhasesWeek
              phases={phases}
              selectedId={selectedId}
              onSelectPhase={(phase) => setSelectedId(phase?.id ?? null)}
              onEditPhase={(phase) => setEditing({ kind: 'edit', phase })}
              onPhaseTimeChange={onTimeChange}
            />
          </div>
          <div className="min-w-0">
            {sorted.length === 0 ? (
              <p className="rounded-control border border-dashed border-ide-border px-4 py-6 text-center text-body-sm text-ide-muted">
                {t('phases.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {sorted.map((phase) => (
                  <li key={phase.id}>{phaseRow(phase, true)}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing?.kind === 'edit' ? t('phases.editTitle') : t('phases.createTitle')}
        maxWidthClass="md:w-[420px] md:max-w-none"
        placement="right"
        swipeToClose={false}
        phoneHeight="full"
      >
        <Suspense fallback={<p className="px-1 py-6 text-body-sm text-ide-muted">{t('common.loading')}</p>}>
          {editing ? (
            <PhaseForm
              key={editing.kind === 'edit' ? editing.phase.id : 'new'}
              initialData={editing.kind === 'edit' ? editing.phase : undefined}
              defaults={editing.kind === 'new' ? editing.defaults : undefined}
              onSubmit={(data) => void submit(data)}
              isSubmitting={creating || updating}
              onCancel={() => setEditing(null)}
              onDelete={editing.kind === 'edit' ? () => setConfirmDelete(editing.phase) : undefined}
              isDeleting={deleting}
            />
          ) : null}
        </Suspense>
      </Modal>

      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title={t('phases.deleteTitle')}
        zIndexClass="z-[1400]"
        footer={
          <>
            <Button variant="secondary" size={dialogButtonSize} icon={X} onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="dangerSolid" size={dialogButtonSize} icon={Trash2} disabled={deleting} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-body text-ide-text">{t('phases.deleteConfirmNamed', { name: confirmDelete?.name ?? '' })}</p>
        <p className="mt-2 text-body-sm text-ide-muted">{t('phases.deleteHint')}</p>
      </Modal>

      <Modal
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        title={t('phases.presetTitle')}
        maxWidthClass="max-w-lg"
        footer={
          <>
            <Button variant="secondary" size={dialogButtonSize} icon={X} disabled={applying} onClick={() => setPresetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size={dialogButtonSize} icon={RefreshCw} disabled={applying || presetDays.length === 0} onClick={() => void runPreset()}>
              {t('phases.replacePhases')}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-body-sm text-ide-muted">{t('phases.presetLead')}</p>
        <PhasePresetPicker
          value={presetId}
          onChange={(choice) => {
            if (choice !== 'defaults') setPresetId(choice);
          }}
          disabled={applying}
        />
        <div className="mt-4">
          <WeekDaysSelector
            selectedDays={presetDays}
            setSelectedDays={setPresetDays}
            errors={presetDays.length === 0 ? { weekDays: { message: t('phases.selectOneDay') } } : {}}
          />
        </div>
      </Modal>
    </section>
  );
}
