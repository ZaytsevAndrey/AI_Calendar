import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, ChevronLeft, ChevronRight, SkipForward, X } from 'lucide-react';
import type { TaskDTO } from 'api/tasks.api';
import { ScheduleApi, type FreeSlotsResponse } from 'api/schedule.api';
import { usePlaceProblematicMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { DateStrip } from 'ui/DateStrip';
import { useIsPhone } from 'ui/useViewport';
import { CalendarDays } from 'lucide-react';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { Button } from 'ui/Button';
import { IconButton } from 'ui/IconButton';
import { dialogButtonSize } from 'ui/controlSize';
import { DatePicker } from 'ui/DatePicker';
import { TimeField } from 'ui/TimeField';
import { formatCivilYmd, formatMinutes } from '../../../utils/formatDate';
import {
  addDaysToYmd,
  isoToHm,
  localDateTimeIso,
  localYmd,
} from '../../../utils/ianaDateTime';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { SlotPickTimeline } from './SlotPickTimeline';
import { markProblematicHandled } from '../problematicSeatWatch';
import {
  clampFocusMs,
  formatHmFromIso,
  initialFocusMs,
  preferredMsOnDay,
  resolvePlaceableStartIso,
  snapMsToStep,
  suggestedStarts,
} from '../slotPickMath';
import { phaseIdForMovedSlot, phaseWindowsForDay } from '../slotPickPhases';

type Target = { task: TaskDTO; occurrenceYmd: string } | null;

type Props = {
  target: Target;
  timeZone: string;
  onClose: () => void;
  /** The slot was written; the inbox stays open for the next item. */
  onDone: () => void;
  /**
   * `problematic` seats a parked task or series day (default).
   * `later` plans a task from «На потім» into the picked slot.
   */
  mode?: 'problematic' | 'later';
};

/** How far "Next day with room" looks ahead. */
const NEXT_DAY_SEARCH_DAYS = 14;

function taskPhaseId(task: TaskDTO): string | null {
  return task.phaseId ?? task.phases?.[0]?.id ?? task.phase?.id ?? null;
}

export function MoveOccurrenceSheet({ target, timeZone, onClose, onDone, mode = 'problematic' }: Props) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const [pickOther, setPickOther] = useState(false);
  const [updateTask, { isLoading: planning }] = useUpdateEventMutation();
  const { data: allPhases = [] } = useGetAllPhasesQuery();
  const [placeProblematic, { isLoading: placing }] = usePlaceProblematicMutation();
  const [ymd, setYmd] = useState('');
  const [slots, setSlots] = useState<FreeSlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** The one piece of chosen state: the start the hairline points at. */
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMiss, setSearchMiss] = useState(false);

  const busy = placing || planning;
  const todayYmd = localYmd(new Date().toISOString(), timeZone);
  const schedulablePhases = useMemo(
    () => allPhases.filter((p) => p.type !== 'sleep_time' && !!p.id),
    [allPhases],
  );
  const zone = slots?.timeZone || timeZone;
  const task = target?.task ?? null;
  const originalIso = task?.problematicOriginalStart ?? task?.scheduledStartTime ?? null;

  useEffect(() => {
    setSlots(null);
    setFocusIso(null);
    setSubmitError(null);
    setSearchMiss(false);
    if (!target) {
      setYmd('');
      return;
    }
    setYmd(target.occurrenceYmd > todayYmd ? target.occurrenceYmd : todayYmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (!target || !ymd) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSlots(null);
    setFocusIso(null);
    void ScheduleApi.getFreeSlots(target.task.id, ymd, null)
      .then((data) => {
        if (cancelled) return;
        setSlots(data);
        const focus = initialFocusMs(
          data.candidates.map((iso) => Date.parse(iso)),
          data.free.map((g) => ({ start: Date.parse(g.start), end: Date.parse(g.end) })),
          Date.parse(data.dayStart),
          Date.parse(data.dayEnd),
          preferredMsOnDay(originalIso, data.ymd, data.timeZone),
        );
        setFocusIso(new Date(focus).toISOString());
      })
      .catch((e) => {
        if (!cancelled) setLoadError(extractApiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ymd, reloadKey]);

  const view = useMemo(() => {
    if (!slots) return null;
    const candidatesMs = slots.candidates.map((iso) => Date.parse(iso));
    const free = slots.free.map((g) => ({ start: Date.parse(g.start), end: Date.parse(g.end) }));
    return {
      candidatesMs,
      free,
      dayStartMs: Date.parse(slots.dayStart),
      dayEndMs: Date.parse(slots.dayEnd),
      hasRoom: candidatesMs.length > 0 || free.length > 0,
      suggestions: suggestedStarts(
        candidatesMs,
        preferredMsOnDay(originalIso, slots.ymd, slots.timeZone),
        slots.durationMinutes,
      ),
    };
  }, [slots, originalIso]);

  if (!target || !task) return null;

  const { occurrenceYmd } = target;
  const recurring = !!task.isRecurring;
  const duration = slots?.durationMinutes ?? Math.max(1, task.estimatedTimeInMinutes || 30);
  const hm = (iso: string) => isoToHm(iso, zone) || formatHmFromIso(iso, zone);
  const dayLabel = (day: string) => formatCivilYmd(day) ?? day;

  const placeIso =
    view && focusIso
      ? resolvePlaceableStartIso(
          Date.parse(focusIso),
          duration,
          slots!.candidates,
          view.candidatesMs,
          view.free,
        )
      : null;
  const placeMs = placeIso ? Date.parse(placeIso) : NaN;

  // Saved phase follows the slot: own phase while it fits, else the phase there.
  const ownPhaseId = taskPhaseId(task);
  const savedPhaseId = Number.isFinite(placeMs)
    ? phaseIdForMovedSlot(
        phaseWindowsForDay(schedulablePhases, ymd, zone),
        ownPhaseId,
        placeMs,
        placeMs + duration * 60_000,
      )
    : ownPhaseId;
  const savedPhaseName = schedulablePhases.find((p) => p.id === savedPhaseId)?.name ?? null;
  const phaseWillChange = !!placeIso && savedPhaseId !== ownPhaseId;

  const setFocusMs = (ms: number) => {
    if (!view) return;
    const snapped = clampFocusMs(
      snapMsToStep(ms, view.dayStartMs),
      view.dayStartMs,
      view.dayEndMs,
      duration,
    );
    setSubmitError(null);
    setFocusIso(new Date(snapped).toISOString());
  };

  const changeDay = (next: string) => {
    if (!next || next < todayYmd || busy) return;
    setSearchMiss(false);
    setSubmitError(null);
    setYmd(next);
  };

  const findNextDayWithRoom = async () => {
    setSearching(true);
    setSearchMiss(false);
    try {
      for (let i = 1; i <= NEXT_DAY_SEARCH_DAYS; i++) {
        const day = addDaysToYmd(ymd, i);
        const data = await ScheduleApi.getFreeSlots(task.id, day, null);
        if (data.candidates.length > 0) {
          changeDay(day);
          return;
        }
      }
      setSearchMiss(true);
    } catch (e) {
      setLoadError(extractApiErrorMessage(e));
    } finally {
      setSearching(false);
    }
  };

  const confirm = async () => {
    if (!placeIso || busy) return;
    setSubmitError(null);
    try {
      if (mode === 'later') {
        // A window exactly the slot: placement seats it there and the task stays flexible.
        await updateTask({
          id: task.id,
          body: {
            isUnscheduled: false,
            earliestStartTime: placeIso,
            deadline: new Date(placeMs + duration * 60_000).toISOString(),
            scheduledStartTime: null,
            scheduledEndTime: null,
            phaseIds: savedPhaseId ? [savedPhaseId] : [],
          },
        }).unwrap();
        onDone();
        return;
      }
      markProblematicHandled(task.id);
      await placeProblematic({
        id: task.id,
        body: {
          start: placeIso,
          end: new Date(placeMs + duration * 60_000).toISOString(),
          phaseIds: savedPhaseId ? [savedPhaseId] : [],
          ...(recurring ? { occurrenceYmd } : {}),
        },
      }).unwrap();
      onDone();
    } catch (e) {
      // The slot may have been taken meanwhile: show why and refresh the day.
      setSubmitError(extractApiErrorMessage(e));
      setReloadKey((k) => k + 1);
    }
  };

  const originalLabel = task.problematicOriginalStart
    ? t('schedule.problematicMoveWas', {
        day: dayLabel(localYmd(task.problematicOriginalStart, zone)),
        start: hm(task.problematicOriginalStart),
        end: task.problematicOriginalEnd ? hm(task.problematicOriginalEnd) : '',
      })
    : null;

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={mode === 'later' ? t('schedule.planLaterTitle') : t('schedule.problematicMoveDayTitle')}
      maxWidthClass="max-w-md"
      zIndexClass="z-[1400]"
      bodyOverflowHidden
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size={dialogButtonSize}
            className="w-full max-md:!hidden sm:w-auto"
            disabled={busy}
            onClick={onClose}
            icon={X}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size={dialogButtonSize}
            className="w-full sm:w-auto"
            disabled={!placeIso || busy || loading}
            onClick={() => void confirm()}
            icon={busy ? undefined : CalendarCheck}
          >
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {placeIso
              ? t('schedule.problematicMoveConfirmAt', {
                  day: dayLabel(ymd),
                  start: hm(placeIso),
                })
              : t('schedule.problematicMoveDayConfirm')}
          </Button>
        </>
      }
    >
      <p className="text-body font-semibold text-ide-text">
        {task.name}
        <span className="font-normal tabular-nums text-ide-muted"> · {formatMinutes(duration)}</span>
      </p>
      {originalLabel ? <p className="mb-1 text-body-sm text-ide-muted">{originalLabel}</p> : null}
      {recurring && mode === 'problematic' ? (
        <p className="mb-3 text-caption text-ide-muted">{t('schedule.problematicMoveSeriesNote')}</p>
      ) : (
        <div className="mb-3" />
      )}

      {phone && !pickOther ? (
        <div className="mb-3">
          <DateStrip
            startYmd={todayYmd}
            value={ymd}
            todayYmd={todayYmd}
            label={t('schedule.problematicSlotDay')}
            onChange={changeDay}
            trailing={
              <button
                type="button"
                onClick={() => setPickOther(true)}
                className="flex min-h-[56px] w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control bg-ide-surface px-1 text-caption text-ide-link"
              >
                <CalendarDays aria-hidden className="h-4 w-4" />
                {t('common.otherDate')}
              </button>
            }
          />
        </div>
      ) : null}
      <div className={phone && !pickOther ? 'mb-3 flex items-end gap-2 max-md:[&>*:not(:last-child)]:hidden' : 'mb-3 flex items-end gap-2'}>
        <IconButton
          label={t('schedule.problematicMovePrevDay')}
          size="md"
          variant="secondary"
          disabled={busy || ymd <= todayYmd}
          onClick={() => changeDay(addDaysToYmd(ymd, -1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1 text-sm">
          <span id="move-slot-day" className="mb-1 block text-ide-muted">
            {t('schedule.problematicSlotDay')}
          </span>
          <DatePicker
            labelledBy="move-slot-day"
            value={ymd}
            minYmd={todayYmd}
            emptyLabel={t('schedule.problematicSlotDay')}
            onChange={changeDay}
          />
        </div>
        <IconButton
          label={t('schedule.problematicMoveNextDay')}
          size="md"
          variant="secondary"
          disabled={busy}
          onClick={() => changeDay(addDaysToYmd(ymd, 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </IconButton>
        <div className={phone && !pickOther ? 'w-full text-body-sm' : 'w-28 shrink-0 text-sm'}>
          <span className="mb-1 block text-ide-muted">{t('schedule.problematicSlotTime')}</span>
          <TimeField
            value={focusIso ? hm(focusIso) : ''}
            minuteStep={15}
            disabled={busy || !view}
            aria-label={t('schedule.problematicSlotTime')}
            onChange={(next) => {
              if (next) setFocusMs(Date.parse(localDateTimeIso(ymd, next, zone)));
            }}
          />
        </div>
      </div>

      {view && view.suggestions.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 text-caption font-medium text-ide-muted">
            {mode === 'later' ? t('schedule.planLaterSuggest') : t('schedule.problematicMoveSuggest')}
          </p>
          <div className="flex flex-wrap gap-2">
            {view.suggestions.map((ms) => {
              const iso = new Date(ms).toISOString();
              return (
                <Button
                  key={ms}
                  type="button"
                  variant="secondary"
                  size={{ base: 'md', md: 'sm' }}
                  pressed={placeIso != null && Math.abs(placeMs - ms) < 1000}
                  disabled={busy}
                  onClick={() => setFocusMs(ms)}
                >
                  {hm(iso)}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ide-muted">
          <Spinner className="h-5 w-5" />
          {t('schedule.problematicSlotLoading')}
        </div>
      ) : null}

      {!loading && loadError ? (
        <p className="rounded-control border border-ide-error/40 bg-ide-errorTint px-3 py-4 text-body-sm text-ide-error">
          {t('schedule.problematicSlotLoadFailed')}
          <span className="mt-1 block text-ide-muted">{loadError}</span>
        </p>
      ) : null}

      {!loading && !loadError && view && !view.hasRoom ? (
        <div className="flex flex-col items-start gap-3 rounded-control border border-ide-warn/40 bg-ide-warnTint px-3 py-4 text-body-sm text-ide-warn">
          <p>{t('schedule.problematicSlotEmpty')}</p>
          {searchMiss ? (
            <p className="text-ide-muted">
              {t('schedule.problematicMoveNoDayFound', { days: NEXT_DAY_SEARCH_DAYS })}
            </p>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={searching ? undefined : SkipForward}
              disabled={searching}
              onClick={() => void findNextDayWithRoom()}
            >
              {searching ? <Spinner className="h-4 w-4" /> : null}
              {t('schedule.problematicMoveFindDay')}
            </Button>
          )}
        </div>
      ) : null}

      {!loading && !loadError && slots && view?.hasRoom ? (
        <SlotPickTimeline
          data={slots}
          taskName={task.name}
          phases={schedulablePhases}
          focusIso={focusIso}
          onFocusChange={(iso) => {
            setSubmitError(null);
            setFocusIso(iso);
          }}
          onConfirm={() => void confirm()}
        />
      ) : null}

      {phaseWillChange ? (
        <p className="mt-2 text-sm text-ide-muted" data-testid="move-phase-change">
          {savedPhaseName
            ? t('schedule.problematicMovePhaseChange', { phase: savedPhaseName })
            : t('schedule.problematicMovePhaseClear')}
        </p>
      ) : null}

      {submitError ? (
        <p className="mt-2 rounded-control border border-ide-error/40 bg-ide-errorTint px-3 py-2 text-body-sm text-ide-error" role="alert">
          {submitError}
        </p>
      ) : null}
    </Modal>
  );
}
