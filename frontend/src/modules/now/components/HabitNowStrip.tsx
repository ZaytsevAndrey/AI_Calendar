import React from 'react';
import { Link } from 'react-router-dom';
import type { HabitDTO } from 'api/habits.api';
import {
  useCheckInHabitMutation,
  useGetHabitsQuery,
  useUncheckHabitMutation,
} from 'api/habitsApi';
import { showErrorToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

function HabitChip({
  habit,
  today,
  yesterday,
}: {
  habit: HabitDTO;
  today: string;
  yesterday: string;
}) {
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
    <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-ide-border bg-ide-surface px-2.5 py-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: habit.color }} />
      <span className="min-w-0 flex-1 truncate text-sm text-ide-text">{habit.name}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle(yesterday, habit.checkedYesterday)}
        className={`shrink-0 rounded px-2 py-1 text-xs ${
          habit.checkedYesterday ? 'bg-ide-link/20 text-ide-text' : 'text-ide-muted hover:text-ide-text'
        }`}
        aria-pressed={habit.checkedYesterday}
      >
        Yday
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle(today, habit.checkedToday)}
        className={`shrink-0 rounded px-2 py-1 text-xs ${
          habit.checkedToday ? 'bg-ide-link text-white' : 'text-ide-muted hover:text-ide-text'
        }`}
        aria-pressed={habit.checkedToday}
      >
        Today
      </button>
    </div>
  );
}

export function HabitNowStrip() {
  const { data } = useGetHabitsQuery();
  const habits = data?.habits ?? [];
  if (!habits.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ide-muted">Habits</h3>
        <Link to="/habits" className="text-xs text-ide-link hover:underline">
          All habits
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {habits.map((habit) => (
          <HabitChip key={habit.id} habit={habit} today={data!.today} yesterday={data!.yesterday} />
        ))}
      </div>
    </div>
  );
}
