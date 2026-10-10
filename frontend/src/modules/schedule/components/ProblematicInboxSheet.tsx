import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Pencil, SkipForward, CheckCircle2 } from 'lucide-react';
import type { TaskDTO } from 'api/tasks.api';
import {
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { formatCivilYmd, formatMinutes } from '../../../utils/formatDate';
import { showErrorToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { occurrenceStartIsoForYmd } from '../buildOneOffFromSeries';
import type { ParkDayHint } from '../parkDayHints';
import {
  remainingProblematicDays,
  todayYmdInZone,
} from '../problematicDays';
import { localYmd } from '../../../utils/ianaDateTime';
import { MoveOccurrenceSheet } from './MoveOccurrenceSheet';

type Props = {
  open: boolean;
  tasks: TaskDTO[];
  timeZone: string;
  dayHints?: Record<string, ParkDayHint>;
  onClose: () => void;
  onEdit: (task: TaskDTO) => void;
};

const pill =
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none';
const iconBtn =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-ide-text hover:bg-white/10 disabled:opacity-50';

function reasonKey(reason: string | null | undefined): string {
  switch (reason) {
    case 'phase_full':
      return 'schedule.problematicReason.phase_full';
    case 'no_slot':
      return 'schedule.problematicReason.no_slot';
    case 'preferred_unavailable':
      return 'schedule.problematicReason.preferred_unavailable';
    case 'deadline_no_fit':
      return 'schedule.problematicReason.deadline_no_fit';
    case 'preferred_on_fixed':
    case 'conflict':
      return 'schedule.problematicReason.conflict';
    default:
      return 'schedule.problematicReason.unknown';
  }
}

/** Prefer remaining today/future days; otherwise today so Skip/Move stay available. */
function actionDays(
  task: TaskDTO,
  hint: ParkDayHint | undefined,
  todayYmd: string,
): string[] {
  const known = remainingProblematicDays(task, hint, todayYmd);
  if (known.length) return known;
  return [todayYmd];
}

export function ProblematicInboxSheet({
  open,
  tasks,
  timeZone,
  dayHints = {},
  onClose,
  onEdit,
}: Props) {
  const { t } = useTranslation();
  const [updateEvent] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    task: TaskDTO;
    occurrenceYmd: string;
  } | null>(null);

  const todayYmd = todayYmdInZone(timeZone);

  const clearProblematic = async (task: TaskDTO) => {
    await updateEvent({
      id: task.id,
      body: { scheduleState: 'none' },
    }).unwrap();
  };

  const removeParkedDay = async (task: TaskDTO, occurrenceYmd: string) => {
    const remaining = remainingProblematicDays(
      task,
      dayHints[task.id],
      todayYmd,
    ).filter((ymd) => ymd !== occurrenceYmd);
    if (remaining.length === 0) {
      await clearProblematic(task);
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

  const resolve = async (task: TaskDTO) => {
    setBusyKey(`${task.id}:resolve`);
    try {
      // Progress toast from eventTasksApi.updateEvent.
      await updateEvent({
        id: task.id,
        body: { scheduleState: 'resolved' },
      }).unwrap();
    } catch (e) {
      showErrorToast({
        title: t('schedule.problematicActionFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const skipDay = async (task: TaskDTO, occurrenceYmd: string) => {
    setBusyKey(`${task.id}:skip:${occurrenceYmd}`);
    try {
      // Progress toast from eventTasksApi.skipOccurrence / updateEvent.
      await skipOccurrence({
        id: task.id,
        body: {
          occurrenceStart: occurrenceStartIsoForYmd(occurrenceYmd, timeZone),
        },
      }).unwrap();
      // Non-recurring problematic copies are deleted by skipOccurrence.
      if (task.isRecurring) {
        await removeParkedDay(task, occurrenceYmd);
      }
    } catch (e) {
      showErrorToast({
        title: t('schedule.problematicActionFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={t('schedule.problematicTitle')}
      maxWidthClass="max-w-md"
      footer={
        <button
          type="button"
          className="ui-btn-secondary w-full sm:w-auto"
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">{t('schedule.problematicIntro')}</p>
      {tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-ide-muted">
          {t('schedule.problematicEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {tasks.map((task) => {
            const rowBusy = busyKey?.startsWith(`${task.id}:`) ?? false;
            const phase = task.phase ?? task.phases?.[0];
            const hint = dayHints[task.id];
            const recurring = !!task.isRecurring;
            const knownDays = remainingProblematicDays(task, hint, todayYmd);
            const days = recurring
              ? actionDays(task, hint, todayYmd)
              : knownDays;
            const reason = task.problematicReason ?? hint?.reason ?? null;

            return (
              <li
                key={task.id}
                className="task-item flex flex-col gap-3 border-l-4"
                style={{
                  borderLeftColor: phase?.color || '#808080',
                  backgroundColor: '#3C3F41',
                  backgroundImage: `linear-gradient(135deg, ${phase?.color || '#808080'}38, ${phase?.color || '#808080'}14 46%, transparent)`,
                }}
                aria-busy={rowBusy}
              >
                <h3 className="line-clamp-2 text-base font-semibold leading-snug text-ide-text">
                  {task.name}
                </h3>

                <div className="flex flex-wrap gap-2">
                  {recurring ? (
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
                  {task.estimatedTimeInMinutes > 0 ? (
                    <span className={`${pill} border-white/10 bg-white/5 text-ide-text`}>
                      {formatMinutes(task.estimatedTimeInMinutes)}
                    </span>
                  ) : null}
                  <span className={`${pill} border-ide-warn/50 bg-ide-warn/15 text-ide-warn`}>
                    {t(reasonKey(reason))}
                  </span>
                </div>

                {days.length > 0 ? (
                  <p className="text-sm font-medium text-ide-warn">
                    {days.length === 1
                      ? t('schedule.problematicDidNotFit', {
                          date: formatCivilYmd(days[0]) ?? days[0],
                        })
                      : t('schedule.problematicDidNotFitMany', {
                          dates: days
                            .map((ymd) => formatCivilYmd(ymd) ?? ymd)
                            .join(', '),
                        })}
                  </p>
                ) : (
                  <p className="text-sm text-ide-muted">
                    {t('schedule.problematicNoDay')}
                  </p>
                )}

                {recurring && days.length > 1 ? (
                  <ul className="flex flex-col gap-2">
                    {days.map((ymd) => {
                      const label = formatCivilYmd(ymd) ?? ymd;
                      const skipBusy = busyKey === `${task.id}:skip:${ymd}`;
                      return (
                        <li
                          key={ymd}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span className="text-sm text-ide-text">{label}</span>
                          <span className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={iconBtn}
                              disabled={rowBusy}
                              onClick={() => void skipDay(task, ymd)}
                            >
                              {skipBusy ? (
                                <Spinner className="h-4 w-4" />
                              ) : (
                                <SkipForward className="h-4 w-4" aria-hidden />
                              )}
                              {t('schedule.problematicSkipDay')}
                            </button>
                            <button
                              type="button"
                              className={`${iconBtn} text-ide-link`}
                              disabled={rowBusy}
                              onClick={() =>
                                setMoveTarget({ task, occurrenceYmd: ymd })
                              }
                            >
                              <CalendarPlus className="h-4 w-4" aria-hidden />
                              {t('schedule.problematicMoveDay')}
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-3">
                  {recurring && days.length === 1 ? (
                    <>
                      <button
                        type="button"
                        className={iconBtn}
                        disabled={rowBusy}
                        onClick={() => void skipDay(task, days[0])}
                      >
                        {busyKey === `${task.id}:skip:${days[0]}` ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <SkipForward className="h-4 w-4" aria-hidden />
                        )}
                        {t('schedule.problematicSkipDay')}
                      </button>
                      <button
                        type="button"
                        className={`${iconBtn} text-ide-link`}
                        disabled={rowBusy}
                        onClick={() =>
                          setMoveTarget({ task, occurrenceYmd: days[0] })
                        }
                      >
                        <CalendarPlus className="h-4 w-4" aria-hidden />
                        {t('schedule.problematicMoveDay')}
                      </button>
                    </>
                  ) : null}
                  {!recurring ? (
                    <button
                      type="button"
                      className={`${iconBtn} text-ide-link`}
                      disabled={rowBusy}
                      onClick={() => {
                        const ymd =
                          days[0] ??
                          localYmd(new Date().toISOString(), timeZone);
                        setMoveTarget({ task, occurrenceYmd: ymd });
                      }}
                    >
                      <CalendarPlus className="h-4 w-4" aria-hidden />
                      {t('schedule.problematicMove')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={rowBusy}
                    onClick={() => {
                      onEdit(task);
                      onClose();
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    {t('schedule.problematicEdit')}
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} text-ide-link`}
                    disabled={rowBusy}
                    onClick={() => void resolve(task)}
                  >
                    {busyKey === `${task.id}:resolve` ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    )}
                    {t('schedule.problematicResolve')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
      <MoveOccurrenceSheet
        target={moveTarget}
        timeZone={timeZone}
        onClose={() => setMoveTarget(null)}
        onDone={() => {
          setMoveTarget(null);
          onClose();
        }}
      />
    </>
  );
}
