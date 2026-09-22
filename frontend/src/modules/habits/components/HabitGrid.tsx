import React from 'react';
import { Pencil } from 'lucide-react';
import type { HabitDTO } from 'api/habits.api';
import {
  datesInclusive,
  formatHabitDayNumber,
  formatHabitWeekday,
  habitDoneOn,
} from '../habitDays';
import { useToggleHabit } from '../useToggleHabit';

type HabitGridProps = {
  habits: HabitDTO[];
  today: string;
  editableFrom: string;
  editableTo: string;
  onEdit: (habit: HabitDTO) => void;
};

const HabitGrid: React.FC<HabitGridProps> = ({
  habits,
  today,
  editableFrom,
  editableTo,
  onEdit,
}) => {
  const { toggle, busy } = useToggleHabit();
  const dates = datesInclusive(editableFrom, editableTo);

  return (
    <div className="max-w-full overflow-auto overscroll-x-contain rounded-xl border border-ide-border bg-ide-panel [-webkit-overflow-scrolling:touch]">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">Habit check-ins for the last 14 days</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[11rem] bg-ide-surface px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ide-muted"
            >
              Habit
            </th>
            {dates.map((date) => (
              <th
                key={date}
                scope="col"
                aria-current={date === today ? 'date' : undefined}
                className={`w-11 px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide ${
                  date === today ? 'text-ide-link' : 'text-ide-muted'
                }`}
              >
                <span className="block">{formatHabitWeekday(date)}</span>
                <span className="block text-xs normal-case">{formatHabitDayNumber(date)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {habits.map((habit) => (
            <tr key={habit.id} className="border-t border-ide-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-ide-panel px-3 py-2 text-left font-normal"
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: habit.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-ide-text">{habit.name}</h2>
                    <p className="text-xs text-ide-muted">
                      {habit.currentStreak} day streak · {habit.points} pts
                      {habit.blockStartTime && habit.blockMinutes
                        ? ` · ${habit.blockStartTime} · ${habit.blockMinutes} min`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ui-btn-ghost shrink-0 px-2"
                    onClick={() => onEdit(habit)}
                    aria-label={`Edit ${habit.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </th>
              {dates.map((date) => {
                const done = habitDoneOn(habit.checkInDates, date);
                return (
                  <td
                    key={date}
                    className={`px-1 py-2 text-center ${date === today ? 'bg-ide-selection/20' : ''}`}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={done}
                      aria-label={
                        date === today ? `${habit.name} today` : `${habit.name} on ${date}`
                      }
                      onClick={() => void toggle(habit.id, date, done)}
                      className={`mx-auto flex h-9 w-9 items-center justify-center rounded-md border text-sm text-white ${
                        done ? '' : 'border-ide-border'
                      }`}
                      style={
                        done
                          ? { backgroundColor: habit.color, borderColor: habit.color }
                          : undefined
                      }
                    >
                      {done ? '✓' : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default HabitGrid;
