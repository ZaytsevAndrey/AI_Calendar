import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDTO } from 'api/tasks.api';
import { ScheduleApi, type FreeSlotsResponse } from 'api/schedule.api';
import {
  useCreateEventMutation,
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { CalendarCheck, X } from 'lucide-react';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { DatePicker } from 'ui/DatePicker';
import { Select } from 'ui/Select';
import { TimeField } from 'ui/TimeField';
import { formatCivilYmd } from '../../../utils/formatDate';
import {
  addDaysToYmd,
  isoToHm,
  localDateTimeIso,
  localYmd,
  normalizeClockHm,
} from '../../../utils/ianaDateTime';
import { showErrorToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import {
  buildOneOffFromSeries,
  occurrenceStartIsoForYmd,
} from '../buildOneOffFromSeries';
import { SlotPickTimeline, seekIsoForPhase } from './SlotPickTimeline';
import { formatHmFromIso } from '../slotPickMath';
import {
  phaseIdAtFocus,
  phaseIdForMovedSlot,
  phaseWindowsForDay,
} from '../slotPickPhases';

type Target = { task: TaskDTO; occurrenceYmd: string } | null;

type Props = {
  target: Target;
  timeZone: string;
  onClose: () => void;
  onDone: () => void;
};

function defaultPhaseId(task: TaskDTO): string {
  return task.phaseId ?? task.phases?.[0]?.id ?? task.phase?.id ?? '';
}

export function MoveOccurrenceSheet({
  target,
  timeZone,
  onClose,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const { data: allPhases = [] } = useGetAllPhasesQuery();
  const [createEvent] = useCreateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [placeYmd, setPlaceYmd] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [slots, setSlots] = useState<FreeSlotsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStartIso, setSelectedStartIso] = useState<string | null>(null);
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const [seekIso, setSeekIso] = useState<string | null>(null);
  const [seekNonce, setSeekNonce] = useState(0);
  const [timeDraft, setTimeDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const autoAdvancedDay = useRef(false);

  const schedulablePhases = useMemo(
    () => allPhases.filter((p) => p.type !== 'sleep_time' && !!p.id),
    [allPhases],
  );

  const zone = slots?.timeZone || timeZone;

  useEffect(() => {
    if (!target) {
      setPlaceYmd('');
      setPhaseId('');
      setSlots(null);
      setLoadError(null);
      setSelectedStartIso(null);
      setFocusIso(null);
      setSeekIso(null);
      setSeekNonce(0);
      setTimeDraft('');
      setLoading(false);
      autoAdvancedDay.current = false;
      return;
    }
    setPlaceYmd(target.occurrenceYmd);
    autoAdvancedDay.current = false;
    const def = defaultPhaseId(target.task);
    setPhaseId(def);
  }, [target]);

  // Full-day slots (all eligible phases) — phase filter is UI-only + auto from scroll.
  useEffect(() => {
    if (!target || !placeYmd) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSlots(null);
    setSelectedStartIso(null);
    setFocusIso(null);
    setSeekIso(null);
    setSeekNonce(0);
    void ScheduleApi.getFreeSlots(target.task.id, placeYmd, null)
      .then((data) => {
        if (cancelled) return;
        const today = localYmd(new Date().toISOString(), timeZone);
        if (
          data.candidates.length === 0 &&
          data.free.length === 0 &&
          placeYmd === today &&
          !autoAdvancedDay.current
        ) {
          autoAdvancedDay.current = true;
          setPlaceYmd(addDaysToYmd(placeYmd, 1));
          return;
        }
        setSlots(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(extractApiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, placeYmd, timeZone]);

  // Keep the time field in sync with timeline focus / selection.
  useEffect(() => {
    const iso = selectedStartIso || focusIso;
    if (!iso) return;
    const hm = isoToHm(iso, zone) || formatHmFromIso(iso, zone).slice(0, 5);
    if (hm) setTimeDraft(hm);
  }, [selectedStartIso, focusIso, zone]);

  if (!target) return null;

  const { task, occurrenceYmd } = target;
  const placeLabel = formatCivilYmd(placeYmd) ?? placeYmd;
  const duration = Math.max(1, task.estimatedTimeInMinutes || 30);
  const recurring = !!task.isRecurring;
  const canPlace = !!selectedStartIso && !busy && !loading;
  // The Phase select only navigates the timeline. The saved phase follows the
  // chosen slot: the task's own phase while the slot fits it, else the phase there.
  const taskPhaseId = defaultPhaseId(task) || null;
  const dayWindows = placeYmd
    ? phaseWindowsForDay(schedulablePhases, placeYmd, zone)
    : [];
  const selectedStartMs = selectedStartIso ? Date.parse(selectedStartIso) : NaN;
  const savedPhaseId = Number.isFinite(selectedStartMs)
    ? phaseIdForMovedSlot(
        dayWindows,
        taskPhaseId,
        selectedStartMs,
        selectedStartMs + duration * 60_000,
      )
    : taskPhaseId;
  const savedPhaseName =
    schedulablePhases.find((p) => p.id === savedPhaseId)?.name ?? null;
  const phaseWillChange = !!selectedStartIso && savedPhaseId !== taskPhaseId;

  const requestSeek = (iso: string) => {
    setSeekIso(iso);
    setSeekNonce((n) => n + 1);
  };

  const clearParkedDay = async () => {
    const remaining = (task.problematicOccurrenceYmds ?? []).filter(
      (ymd) => ymd !== occurrenceYmd,
    );
    if (remaining.length === 0) {
      await updateEvent({
        id: task.id,
        body: { scheduleState: 'none' },
      }).unwrap();
      return;
    }
    await updateEvent({
      id: task.id,
      body: {
        scheduleState: 'problematic',
        problematicOccurrenceYmds: remaining,
        problematicReason: task.problematicReason ?? null,
      },
    }).unwrap();
  };

  const confirm = async () => {
    if (!selectedStartIso || !placeYmd) {
      showErrorToast({ title: t('schedule.problematicMoveNoSlot') });
      return;
    }
    setBusy(true);
    setSettling(true);
    await new Promise((r) => setTimeout(r, 280));
    try {
      const hm =
        isoToHm(selectedStartIso, zone) ||
        formatHmFromIso(selectedStartIso, zone).slice(0, 5) ||
        '09:00';
      const chosenPhase = savedPhaseId;

      if (recurring) {
        const payload = buildOneOffFromSeries(
          task,
          placeYmd,
          zone,
          hm,
          chosenPhase,
        );
        const created = await createEvent(payload).unwrap();
        if (created.conflicts?.length) {
          // Conflict sheet opens via mutation side-effect; keep Move open.
          return;
        }
        await skipOccurrence({
          id: task.id,
          body: {
            occurrenceStart: occurrenceStartIsoForYmd(occurrenceYmd, zone),
          },
        }).unwrap();
        await clearParkedDay();
      } else {
        const start = selectedStartIso;
        const end = new Date(
          Date.parse(start) + duration * 60_000,
        ).toISOString();
        const updated = await updateEvent({
          id: task.id,
          body: {
            eventType: 'fixed',
            scheduledStartTime: start,
            scheduledEndTime: end,
            phaseIds: chosenPhase ? [chosenPhase] : [],
            scheduleState: 'none',
            isUnscheduled: false,
            problematicOccurrenceYmds: null,
            problematicReason: null,
          },
        }).unwrap();
        if (updated.conflicts?.length) {
          return;
        }
      }
      onDone();
    } catch (e) {
      showErrorToast({
        title: t('schedule.problematicActionFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setSettling(false);
      setBusy(false);
    }
  };

  const onPhaseSelect = (next: string) => {
    setPhaseId(next);
    if (!next || !placeYmd) return;
    const iso = seekIsoForPhase(schedulablePhases, next, placeYmd, zone);
    if (iso) requestSeek(iso);
  };

  const onTimeCommit = (raw: string) => {
    const hm = normalizeClockHm(raw);
    setTimeDraft(hm);
    if (!placeYmd) return;
    const iso = localDateTimeIso(placeYmd, hm, zone);
    const windows = phaseWindowsForDay(schedulablePhases, placeYmd, zone);
    const at = phaseIdAtFocus(windows, Date.parse(iso));
    setPhaseId(at ?? '');
    requestSeek(iso);
  };

  const todayYmd = localYmd(new Date().toISOString(), timeZone);
  const showTimeline =
    !loading && !loadError && slots && (slots.candidates.length > 0 || slots.free.length > 0);
  const showEmpty =
    !loading &&
    !loadError &&
    slots &&
    slots.candidates.length === 0 &&
    slots.free.length === 0;

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={t('schedule.problematicMoveDayTitle')}
      maxWidthClass="max-w-md"
      zIndexClass="z-[1400]"
      bodyOverflowHidden
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size={dialogButtonSize}
            className="w-full sm:w-auto"
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
            disabled={!canPlace}
            onClick={() => void confirm()}
            icon={CalendarCheck}
          >
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {t('schedule.problematicMoveDayConfirm')}
          </Button>
        </>
      }
    >
      <p className="mb-1 text-sm font-medium text-ide-text">{task.name}</p>
      <p className="mb-3 text-sm text-ide-muted">
        {recurring
          ? t('schedule.problematicMoveDayIntro', {
              date: placeLabel,
              minutes: duration,
            })
          : t('schedule.problematicMoveOneOffIntro', {
              date: placeLabel,
              minutes: duration,
            })}
      </p>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="block text-sm text-ide-text">
          <span id="move-slot-day" className="mb-1 block text-ide-muted">
            {t('schedule.problematicSlotDay')}
          </span>
          <DatePicker
            labelledBy="move-slot-day"
            value={placeYmd}
            minYmd={todayYmd}
            emptyLabel={t('schedule.problematicSlotDay')}
            onChange={(ymd) => {
              if (ymd && !busy) setPlaceYmd(ymd);
            }}
          />
        </div>
        <label className="block text-sm text-ide-text">
          <span className="mb-1 block text-ide-muted">
            {t('schedule.problematicSlotPhase')}
          </span>
          <Select
            value={phaseId}
            disabled={busy}
            onChange={(e) => onPhaseSelect(e.target.value)}
          >
            <option value="">{t('schedule.problematicSlotPhaseAny')}</option>
            {schedulablePhases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm text-ide-text">
          <span className="mb-1 block text-ide-muted">
            {t('schedule.problematicSlotTime')}
          </span>
          <TimeField
            value={timeDraft}
            minuteStep={15}
            disabled={busy || loading}
            aria-label={t('schedule.problematicSlotTime')}
            onChange={onTimeCommit}
          />
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ide-muted">
          <Spinner className="h-5 w-5" />
          {t('schedule.problematicSlotLoading')}
        </div>
      ) : null}

      {!loading && loadError ? (
        <p className="rounded-lg border border-ide-error/40 bg-ide-error/10 px-3 py-4 text-sm text-ide-error">
          {t('schedule.problematicSlotLoadFailed')}
          <span className="mt-1 block text-ide-muted">{loadError}</span>
        </p>
      ) : null}

      {showEmpty ? (
        <p className="rounded-lg border border-ide-warn/40 bg-ide-warn/10 px-3 py-4 text-sm text-ide-warn">
          {t('schedule.problematicSlotEmpty')}
        </p>
      ) : null}

      {showTimeline && slots ? (
        <SlotPickTimeline
          data={slots}
          taskName={task.name}
          phases={schedulablePhases}
          phaseId={phaseId}
          preferredStartIso={
            task.scheduledStartTime ?? task.problematicOriginalStart
          }
          settling={settling}
          selectedStartIso={selectedStartIso}
          seekIso={seekIso}
          seekNonce={seekNonce}
          onSelect={setSelectedStartIso}
          onFocusIso={setFocusIso}
          onPhaseChange={setPhaseId}
        />
      ) : null}

      {showTimeline && phaseWillChange ? (
        <p className="mt-2 text-sm text-ide-muted" data-testid="move-phase-change">
          {savedPhaseName
            ? t('schedule.problematicMovePhaseChange', { phase: savedPhaseName })
            : t('schedule.problematicMovePhaseClear')}
        </p>
      ) : null}
    </Modal>
  );
}
