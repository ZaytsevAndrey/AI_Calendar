import React, { useEffect, useState } from 'react';
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
import { Spinner } from '../../../ui/Spinner';
import { formatMinutes } from '../../../utils/formatDate';
import { isoToHm } from '../../../utils/ianaDateTime';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { occurrenceStartIsoForYmd } from '../occurrenceStart';
import { markProblematicHandled } from '../problematicSeatWatch';
import type { ProblematicItem } from '../problematicItems';
import { preferredMsOnDay, suggestedStarts } from '../slotPickMath';
import { phaseIdForMovedSlot, phaseWindowsForDay } from '../slotPickPhases';

type Props = {
  item: ProblematicItem;
  timeZone: string;
  todayYmd: string;
  onMove: (item: ProblematicItem, ymd: string) => void;
  onEdit: (item: ProblematicItem) => void;
};

type Suggestion = { start: string; end: string } | null;

const pill =
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none';

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

  return (
    <li
      className="task-item flex flex-col gap-2.5 border-l-4"
      style={{
        borderLeftColor: phase?.color || '#808080',
        backgroundColor: '#3C3F41',
        backgroundImage: `linear-gradient(135deg, ${phase?.color || '#808080'}38, ${phase?.color || '#808080'}14 46%, transparent)`,
      }}
      aria-busy={disabled}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-ide-text">
          {task.name}
        </h3>
        <IconButton
          label={t('schedule.problematicMore')}
          size="sm"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>

      <div className="flex flex-wrap gap-2">
        {kind === 'seriesDay' || kind === 'seriesCopy' || kind === 'seriesNoDay' ? (
          <span className={`${pill} border-ide-link/40 bg-ide-link/15 text-ide-link`}>
            {t('tasks.item.repeats')}
          </span>
        ) : null}
        {phase ? (
          <span
            className={pill}
            style={{
              borderColor: `${phase.color || '#808080'}88`,
              backgroundColor: `${phase.color || '#808080'}24`,
              color: phase.color || undefined,
            }}
          >
            {phase.name}
          </span>
        ) : null}
        <span className={`${pill} border-ide-text/10 bg-ide-text/5 text-ide-text`}>
          {formatMinutes(duration)}
        </span>
        <span className={`${pill} border-ide-warn/50 bg-ide-warn/15 text-ide-warn`}>
          {t(reasonKey(task.problematicReason))}
        </span>
      </div>

      {originalLine ? <p className="text-sm text-ide-muted">{originalLine}</p> : null}
      {kind === 'seriesNoDay' ? (
        <p className="text-sm text-ide-muted">{t('schedule.problematicNoDay')}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canMove ? (
          suggesting ? (
            <Button type="button" size="sm" disabled>
              <Spinner className="h-4 w-4" />
              {t('schedule.problematicFinding')}
            </Button>
          ) : suggestion ? (
            <Button
              type="button"
              size="sm"
              icon={busy === 'place' ? undefined : CalendarCheck}
              disabled={disabled}
              onClick={placeSuggestion}
            >
              {busy === 'place' ? <Spinner className="h-4 w-4" /> : null}
              {t(placeAtKey, { start: hm(suggestion.start) })}
            </Button>
          ) : (
            <span className="text-sm text-ide-warn">{t('schedule.problematicNoRoomDay')}</span>
          )
        ) : null}
        {canMove ? (
          <Button
            type="button"
            variant={suggestion ? 'ghost' : 'secondary'}
            size="sm"
            icon={CalendarPlus}
            disabled={disabled}
            onClick={() => onMove(item, placeDay)}
          >
            {t('schedule.problematicOtherTime')}
          </Button>
        ) : null}
        {canSkip ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={busy === 'skip' ? undefined : SkipForward}
            disabled={disabled}
            onClick={skipDay}
          >
            {busy === 'skip' ? <Spinner className="h-4 w-4" /> : null}
            {t('schedule.problematicSkipDay')}
          </Button>
        ) : null}
        {kind === 'seriesNoDay' ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Pencil}
            disabled={disabled}
            onClick={() => onEdit(item)}
          >
            {t('schedule.problematicEdit')}
          </Button>
        ) : null}
      </div>

      {moreOpen ? (
        <div className="flex flex-col gap-2 border-t border-ide-text/10 pt-2.5">
          {canPlaceOnTop ? (
            <div className="flex flex-col items-start gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={busy === 'top' ? undefined : Layers}
                disabled={disabled}
                onClick={placeOnTop}
              >
                {busy === 'top' ? <Spinner className="h-4 w-4" /> : null}
                {t('schedule.problematicResolve')}
              </Button>
              <p className="pl-2 text-xs text-ide-muted">{t('schedule.problematicResolveHint')}</p>
            </div>
          ) : null}
          {kind !== 'seriesNoDay' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Pencil}
              disabled={disabled}
              onClick={() => onEdit(item)}
            >
              {t('schedule.problematicEdit')}
            </Button>
          ) : null}
          {kind === 'oneOff' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={busy === 'delete' ? undefined : Trash2}
              className="text-ide-error"
              disabled={disabled}
              onClick={remove}
            >
              {busy === 'delete' ? <Spinner className="h-4 w-4" /> : null}
              {t('schedule.problematicDelete')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-ide-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
