import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarCheck,
  CalendarPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  SkipForward,
  Trash2,
} from 'lucide-react';
import { ScheduleApi } from 'api/schedule.api';
import {
  useDeleteEventMutation,
  usePlaceProblematicMutation,
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { Button } from 'ui/Button';
import { IconButton } from 'ui/IconButton';
import { ActionMenu, type ActionMenuItem } from 'ui/ActionMenu';
import { Spinner } from '../../../ui/Spinner';
import { formatMinutes } from '../../../utils/formatDate';
import { isoToHm } from '../../../utils/ianaDateTime';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { occurrenceStartIsoForYmd } from '../occurrenceStart';
import { markProblematicHandled } from '../problematicSeatWatch';
import type { ProblematicItem } from '../problematicItems';
import { preferredMsOnDay, suggestedStarts } from '../slotPickMath';
import { phaseIdForMovedSlot, phaseWindowsForDay } from '../slotPickPhases';
import { phaseColor } from 'theme/phasePalette';

type Props = {
  item: ProblematicItem;
  timeZone: string;
  todayYmd: string;
  onMove: (item: ProblematicItem, ymd: string) => void;
  onEdit: (item: ProblematicItem) => void;
};

type Suggestion = { start: string; end: string } | null;


function reasonKey(reason: string | null | undefined): string {
  switch (reason) {
    case 'phase_full':
    case 'no_slot':
    case 'preferred_unavailable':
    case 'deadline_no_fit':
      return `schedule.problematicReason.${reason}`;
    case 'preferred_on_fixed':
    case 'conflict':
      return 'schedule.problematicReason.conflict';
    default:
      return 'schedule.problematicReason.unknown';
  }
}

/** One parked day: the best free slot that day as a one-tap fix, then the rest. */
export function ProblematicItemCard({ item, timeZone, todayYmd, onMove, onEdit }: Props) {
  const { t } = useTranslation();
  const { task, ymd, kind } = item;
  const { data: phases = [] } = useGetAllPhasesQuery();
  const [placeProblematic] = usePlaceProblematicMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [deleteEvent] = useDeleteEventMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [suggesting, setSuggesting] = useState(kind !== 'seriesNoDay');

  const placeDay = ymd && ymd > todayYmd ? ymd : todayYmd;
  const duration = Math.max(1, task.estimatedTimeInMinutes || 30);
  const phase = task.phase ?? task.phases?.[0];
  const original = task.problematicOriginalStart ?? null;
  const hm = (iso: string) => isoToHm(iso, timeZone);

  useEffect(() => {
    if (kind === 'seriesNoDay') return;
    let cancelled = false;
    setSuggesting(true);
    void ScheduleApi.getFreeSlots(task.id, placeDay, null)
      .then((data) => {
        if (cancelled) return;
        const [best] = suggestedStarts(
          data.candidates.map((iso) => Date.parse(iso)),
          preferredMsOnDay(original, data.ymd, data.timeZone),
          data.durationMinutes,
          1,
        );
        setSuggestion(
          best == null
            ? null
            : {
                start: new Date(best).toISOString(),
                end: new Date(best + data.durationMinutes * 60_000).toISOString(),
              },
        );
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      })
      .finally(() => {
        if (!cancelled) setSuggesting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.key, kind, task.id, placeDay, original]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    markProblematicHandled(task.id);
    try {
      // Progress / result toasts come from the mutations themselves.
      await action();
    } catch (e) {
      setError(extractApiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const placeSuggestion = () => {
    if (!suggestion) return;
    const startMs = Date.parse(suggestion.start);
    const own = task.phaseId ?? phase?.id ?? null;
    const phaseId = phaseIdForMovedSlot(
      phaseWindowsForDay(phases, placeDay, timeZone),
      own,
      startMs,
      Date.parse(suggestion.end),
    );
    void run('place', () =>
      placeProblematic({
        id: task.id,
        body: {
          start: suggestion.start,
          end: suggestion.end,
          phaseIds: phaseId ? [phaseId] : [],
          ...(kind === 'seriesDay' && ymd ? { occurrenceYmd: ymd } : {}),
        },
      }).unwrap(),
    );
  };

  const skipDay = () => {
    if (!ymd) return;
    // A copy is removed and its series day skipped; a series skips that day.
    void run('skip', () =>
      skipOccurrence({
        id: task.id,
        body: { occurrenceStart: occurrenceStartIsoForYmd(ymd, timeZone) },
      }).unwrap(),
    );
  };

  const placeOnTop = () =>
    void run('top', () =>
      updateEvent({ id: task.id, body: { scheduleState: 'resolved' } }).unwrap(),
    );

  const remove = () => void run('delete', () => deleteEvent(task.id).unwrap());

  const canSkip = (kind === 'seriesDay' || kind === 'seriesCopy') && !!ymd;
  const canPlaceOnTop = kind === 'seriesCopy' || kind === 'oneOff';
  const canMove = kind !== 'seriesNoDay';
  const disabled = busy != null;
  const originalLine =
    original && task.problematicOriginalEnd
      ? t('schedule.problematicWas', {
          start: hm(original),
          end: hm(task.problematicOriginalEnd),
        })
      : null;
  // The parked day is gone (or unknown): the suggestion is for today.
  const placeAtKey =
    placeDay === ymd ? 'schedule.problematicPlaceAt' : 'schedule.problematicPlaceAtToday';

  const series = kind === 'seriesDay' || kind === 'seriesCopy' || kind === 'seriesNoDay';
  const meta = [
    formatMinutes(duration),
    series ? t('tasks.item.repeats') : null,
  ].filter(Boolean);
  const menu: ActionMenuItem[] = [
    ...(canPlaceOnTop
      ? [{ id: 'top', label: t('schedule.problematicResolve'), icon: Layers, disabled, onSelect: placeOnTop }]
      : []),
    ...(canSkip
      ? [{ id: 'skip', label: t('schedule.problematicSkipDay'), icon: SkipForward, disabled, onSelect: skipDay }]
      : []),
    { id: 'edit', label: t('schedule.problematicEdit'), icon: Pencil, disabled, onSelect: () => onEdit(item) },
    ...(kind === 'oneOff'
      ? [{ id: 'delete', label: t('schedule.problematicDelete'), icon: Trash2, danger: true, disabled, onSelect: remove }]
      : []),
  ];

  return (
    <li
      className="task-item relative flex flex-col gap-2 overflow-hidden rounded-control border border-ide-border bg-ide-panel p-3 pl-4"
      aria-busy={disabled}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: phaseColor(phase?.color) }}
      />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-heading font-semibold text-ide-text">{task.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-body-sm tabular-nums text-ide-muted">
            <span>{meta.join(' · ')}</span>
            {phase ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden>·</span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: phaseColor(phase.color) }} aria-hidden />
                {phase.name}
              </span>
            ) : null}
          </p>
        </div>
        <IconButton
          ref={moreRef}
          label={t('schedule.problematicMore')}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>

      <p className="text-body-sm text-ide-warn">
        {t(reasonKey(task.problematicReason))}
        {originalLine ? <span className="text-ide-muted"> · {originalLine}</span> : null}
      </p>
      {kind === 'seriesNoDay' ? (
        <p className="text-body-sm text-ide-muted">{t('schedule.problematicNoDay')}</p>
      ) : null}

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        {canMove ? (
          suggesting ? (
            <Button type="button" size={{ base: 'md', md: 'sm' }} disabled>
              <Spinner className="h-4 w-4" />
              {t('schedule.problematicFinding')}
            </Button>
          ) : suggestion ? (
            <Button
              type="button"
              size={{ base: 'md', md: 'sm' }}
              icon={busy === 'place' ? undefined : CalendarCheck}
              disabled={disabled}
              onClick={placeSuggestion}

            >
              {busy === 'place' ? <Spinner className="h-4 w-4" /> : null}
              {t(placeAtKey, { start: hm(suggestion.start) })}
            </Button>
          ) : (
            <span className="text-body-sm text-ide-muted">{t('schedule.problematicNoRoomDay')}</span>
          )
        ) : null}
        {canMove ? (
          <Button
            type="button"
            variant="secondary"
            size={{ base: 'md', md: 'sm' }}
            icon={CalendarPlus}
            disabled={disabled}
            onClick={() => onMove(item, placeDay)}

          >
            {t('schedule.problematicOtherTime')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size={{ base: 'md', md: 'sm' }}
            icon={Pencil}
            disabled={disabled}
            onClick={() => onEdit(item)}
          >
            {t('schedule.problematicEdit')}
          </Button>
        )}
      </div>

      <ActionMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} title={task.name} items={menu} />

      {error ? (
        <p className="text-body-sm text-ide-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
