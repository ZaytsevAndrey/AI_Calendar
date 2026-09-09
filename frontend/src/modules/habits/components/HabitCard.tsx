import React from 'react';
import { Flame, Pencil } from 'lucide-react';
import type { HabitDTO } from 'api/habits.api';
import { useCheckInHabitMutation, useUncheckHabitMutation } from 'api/habitsApi';
import { showErrorToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

type HabitCardProps = {
  habit: HabitDTO;
  today: string;
  yesterday: string;
  onEdit: (habit: HabitDTO) => void;
};

const weekdayLabel = (ymd: string) => {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
};

const HabitCard: React.FC<HabitCardProps> = ({ habit, today, yesterday, onEdit }) => {
  const [checkIn, { isLoading: checking }] = useCheckInHabitMutation();
  const [uncheck, { isLoading: unchecking }] = useUncheckHabitMutation();
  const busy = checking || unchecking;

  const toggle = async (date: string, currentlyDone: boolean) => {
    try {
      if (currentlyDone) {
        await uncheck({ id: habit.id, date }).unwrap();
      } else {
        await checkIn({ id: habit.id, date }).unwrap();
      }
    } catch (err) {
      showErrorToast({
        title: currentlyDone ? 'Could not clear check-in' : 'Could not check in',
        detail: extractApiErrorMessage(err),
      });
    }
  };

  return (
    <article className="overflow-hidden rounded-xl border border-ide-border bg-ide-panel">
      <div className="h-1.5" style={{ backgroundColor: habit.color }} />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ide-text">{habit.name}</h2>
            {habit.description ? (
              <p className="mt-1 text-sm text-ide-muted">{habit.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="ui-btn-ghost shrink-0 px-3"
            onClick={() => onEdit(habit)}
            aria-label={`Edit ${habit.name}`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ide-muted">
          <span className="inline-flex items-center gap-1.5 text-ide-text">
            <Flame className="h-4 w-4 text-ide-keyword" aria-hidden />
            {habit.currentStreak} day streak
          </span>
          <span>{habit.points} pts</span>
          <span>{habit.totalCheckIns} check-ins</span>
        </div>

        <div className="flex justify-between gap-1" aria-label="Last 7 days">
          {habit.last7Days.map((day) => (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  day.done ? 'bg-ide-accent' : 'bg-ide-border'
                }`}
                title={`${day.date}${day.done ? ' done' : ''}`}
              />
              <span className="text-[10px] uppercase tracking-wide text-ide-muted">
                {weekdayLabel(day.date)}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle(yesterday, habit.checkedYesterday)}
            className={habit.checkedYesterday ? 'ui-btn-primary' : 'ui-btn-secondary'}
            aria-pressed={habit.checkedYesterday}
          >
            Yesterday{habit.checkedYesterday ? ' ✓' : ''}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle(today, habit.checkedToday)}
            className={habit.checkedToday ? 'ui-btn-primary' : 'ui-btn-secondary'}
            aria-pressed={habit.checkedToday}
          >
            Today{habit.checkedToday ? ' ✓' : ''}
          </button>
        </div>
      </div>
    </article>
  );
};

export default HabitCard;
