import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HabitDTO } from 'api/habits.api';
import { useGetHabitsQuery } from 'api/habitsApi';
import { Modal } from '../../../ui/Modal';
import { ymdFromLocalDate } from '../../../utils/ianaDateTime';
import { formatClock } from '../../../utils/formatDate';
import {
  formatHabitDateLabel,
  habitDoneOn,
  isHabitDateEditable,
  showHabitDots,
} from '../habitDays';
import type { HabitBlockChip } from '../habitBlocks';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { useToggleHabit } from '../useToggleHabit';
import i18n from 'i18n';

const MAX_DOTS = 6;

function lockMessage(): string {
  return i18n.t('habits.futureLocked');
}

export function HabitDayChecklist({
  date,
  omitTimed = false,
  layout = 'stack',
}: {
  date: string;
  omitTimed?: boolean;
  layout?: 'stack' | 'row';
}) {
  const { t } = useTranslation();
  const { data } = useGetHabitsQuery();
  const { toggle, busy } = useToggleHabit();
  const habits = (data?.habits ?? []).filter(
    (habit) => !omitTimed || !habit.blockStartTime || !habit.blockMinutes,
  );
  if (!data || habits.length === 0) return null;

  const editable = isHabitDateEditable(date, data.today);

  const row = layout === 'row';

  return (
    <ul className={row ? 'flex gap-1 overflow-x-auto' : 'max-h-40 space-y-1.5 overflow-y-auto'}>
      {habits.map((habit) => {
        const done = habitDoneOn(habit.checkInDates, date);
        return (
          <li key={habit.id} className={row ? 'shrink-0' : undefined}>
            <button
              type="button"
              disabled={!editable || busy}
              aria-pressed={done}
              aria-label={t('habits.dateAria', {
                name: habit.name,
                date: formatHabitDateLabel(date),
              })}
              onClick={() => void toggle(habit.id, date, done)}
              className={
                row
                  ? 'inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-md border border-ide-border px-2 text-left text-xs disabled:opacity-60'
                  : 'flex w-full items-center gap-2 rounded-md border border-ide-border px-3 py-2 text-left text-sm disabled:opacity-60'
              }
              style={
                done
                  ? { borderColor: habit.color, backgroundColor: `${habit.color}22` }
                  : undefined
              }
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: habit.color }}
              />
              <span className="min-w-0 flex-1 truncate text-ide-text">{habit.name}</span>
              {row ? null : (
                <span className="shrink-0 text-xs text-ide-muted">
                  {done ? t('habits.done') : t('habits.mark')}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function HabitDaySection({ date }: { date: string }) {
  const { t } = useTranslation();
  const { data } = useGetHabitsQuery();
  const phone = usePhoneLayout();
  const checkInOnly = (data?.habits ?? []).filter(
    (habit) => !habit.blockStartTime || !habit.blockMinutes,
  );
  if (!data || checkInOnly.length === 0) return null;
  const editable = isHabitDateEditable(date, data.today);

  return (
    <div className="mb-4 shrink-0 max-md:mb-1">
      <div className="mb-2 flex items-baseline justify-between gap-2 max-md:mb-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ide-muted">
          {t('habits.title')}
        </h3>
        {editable ? null : (
          <p className="text-xs text-ide-muted">{lockMessage()}</p>
        )}
      </div>
      <HabitDayChecklist date={date} omitTimed layout={phone ? 'row' : 'stack'} />
    </div>
  );
}

export function HabitDayDots({
  day,
  onOpen,
}: {
  day: Date;
  onOpen: (ymd: string) => void;
}) {
  const { t } = useTranslation();
  const { data } = useGetHabitsQuery();
  if (!data?.habits.length) return null;

  const ymd = ymdFromLocalDate(day);
  const marks = data.habits.map((habit: HabitDTO) => ({
    id: habit.id,
    color: habit.color,
    done: habitDoneOn(habit.checkInDates, ymd),
  }));
  if (
    !showHabitDots({
      ymd,
      today: data.today,
      editableFrom: data.editableFrom,
      habitCount: marks.length,
      anyDone: marks.some((mark) => mark.done),
    })
  ) {
    return null;
  }

  const shown = marks.slice(0, MAX_DOTS);
  const extra = marks.length - shown.length;
  const doneCount = marks.filter((mark) => mark.done).length;

  return (
    <button
      type="button"
      className="mt-1 flex min-h-6 shrink-0 items-center gap-0.5 py-0.5"
      aria-label={t('habits.dotsAria', {
        date: formatHabitDateLabel(ymd),
        done: doneCount,
        total: marks.length,
      })}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(ymd);
      }}
    >
      {shown.map((mark) => (
        <span
          key={mark.id}
          className={`h-2 w-2 rounded-full ${mark.done ? '' : 'border border-ide-muted'}`}
          style={{ backgroundColor: mark.done ? mark.color : 'transparent' }}
        />
      ))}
      {extra > 0 ? <span className="text-[10px] text-ide-muted">+{extra}</span> : null}
    </button>
  );
}

export function HabitDayDialog({
  date,
  onClose,
}: {
  date: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useGetHabitsQuery();
  const editable =
    date && data ? isHabitDateEditable(date, data.today) : false;

  return (
    <Modal
      open={Boolean(date)}
      onClose={onClose}
      title={
        date
          ? t('habits.dayTitle', { date: formatHabitDateLabel(date) })
          : t('habits.title')
      }
      maxWidthClass="max-w-md"
    >
      {date && data && !editable ? (
        <p className="mb-3 text-sm text-ide-muted">{lockMessage()}</p>
      ) : null}
      {date ? <HabitDayChecklist date={date} /> : null}
    </Modal>
  );
}

export function HabitBlockButton({
  block,
  showTime,
}: {
  block: HabitBlockChip;
  showTime: boolean;
}) {
  const { data } = useGetHabitsQuery();
  const { toggle, busy } = useToggleHabit();
  const clock = formatClock(block.start);
  const editable = data ? isHabitDateEditable(block.ymd, data.today) : false;
  return (
    <button
      type="button"
      title={showTime ? `${clock} ${block.name}` : block.name}
      disabled={!editable || busy}
      className={`calendar-chip relative mb-1 w-full whitespace-nowrap px-1.5 py-1 pl-2 text-left text-xs font-medium disabled:opacity-60 ${
        block.done ? 'calendar-chip--done' : ''
      }`}
      style={{ ['--chip-color']: block.color } as React.CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        if (!editable) return;
        void toggle(block.habitId, block.ymd, block.done);
      }}
    >
      <span className="block truncate">
        {block.done ? '✓ ' : ''}
        {showTime ? `${clock} ` : ''}
        {block.name}
      </span>
    </button>
  );
}
