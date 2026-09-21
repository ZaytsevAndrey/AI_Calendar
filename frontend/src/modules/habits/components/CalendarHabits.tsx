import React from 'react';
import type { HabitDTO } from 'api/habits.api';
import { useGetHabitsQuery } from 'api/habitsApi';
import { Modal } from '../../../ui/Modal';
import { ymdFromLocalDate } from '../../../utils/ianaDateTime';
import {
  formatHabitDateLabel,
  habitDoneOn,
  isYmdInRange,
  showHabitDots,
} from '../habitDays';
import type { HabitBlockChip } from '../habitBlocks';
import { useToggleHabit } from '../useToggleHabit';

const MAX_DOTS = 6;

function lockMessage(date: string, today: string): string {
  if (date > today) return 'Future days cannot be checked in.';
  return 'You can change check-ins for the last 14 days.';
}

export function HabitDayChecklist({ date }: { date: string }) {
  const { data } = useGetHabitsQuery();
  const { toggle, busy } = useToggleHabit();
  const habits = data?.habits ?? [];
  if (!data || habits.length === 0) return null;

  const editable = isYmdInRange(date, data.editableFrom, data.editableTo);

  return (
    <ul className="max-h-40 space-y-1.5 overflow-y-auto">
      {habits.map((habit) => {
        const done = habitDoneOn(habit.checkInDates, date);
        return (
          <li key={habit.id}>
            <button
              type="button"
              disabled={!editable || busy}
              aria-pressed={done}
              aria-label={`${habit.name} on ${formatHabitDateLabel(date)}`}
              onClick={() => void toggle(habit.id, date, done)}
              className="flex w-full items-center gap-2 rounded-md border border-ide-border px-3 py-2 text-left text-sm disabled:opacity-60"
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
              <span className="shrink-0 text-xs text-ide-muted">{done ? 'Done' : 'Mark'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function HabitDaySection({ date }: { date: string }) {
  const { data } = useGetHabitsQuery();
  if (!data?.habits.length) return null;
  const editable = isYmdInRange(date, data.editableFrom, data.editableTo);

  return (
    <div className="mb-4 shrink-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ide-muted">Habits</h3>
        {editable ? null : (
          <p className="text-xs text-ide-muted">{lockMessage(date, data.today)}</p>
        )}
      </div>
      <HabitDayChecklist date={date} />
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
      aria-label={`Habits on ${formatHabitDateLabel(ymd)}, ${doneCount} of ${marks.length} done`}
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
  const { data } = useGetHabitsQuery();
  const editable =
    date && data ? isYmdInRange(date, data.editableFrom, data.editableTo) : false;

  return (
    <Modal
      open={Boolean(date)}
      onClose={onClose}
      title={date ? `Habits · ${formatHabitDateLabel(date)}` : 'Habits'}
      maxWidthClass="max-w-md"
    >
      {date && data && !editable ? (
        <p className="mb-3 text-sm text-ide-muted">{lockMessage(date, data.today)}</p>
      ) : null}
      {date ? <HabitDayChecklist date={date} /> : null}
    </Modal>
  );
}

export function HabitBlockButton({
  block,
  showTime,
  onOpen,
}: {
  block: HabitBlockChip;
  showTime: boolean;
  onOpen: (ymd: string) => void;
}) {
  const clock = block.start.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <button
      type="button"
      title={showTime ? `${clock} ${block.name}` : block.name}
      className="relative mb-1 w-full overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-1 text-left text-xs text-white"
      style={{ backgroundColor: block.color, opacity: block.done ? 0.55 : 1 }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(block.ymd);
      }}
    >
      {showTime ? `${clock} ` : ''}
      {block.name}
      {block.done ? ' ✓' : ''}
    </button>
  );
}
