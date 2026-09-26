import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGetHabitsQuery } from 'api/habitsApi';
import { useToggleHabit } from 'modules/habits/useToggleHabit';

export function HabitNowStrip() {
  const { t } = useTranslation();
  const { data } = useGetHabitsQuery();
  const { toggle, busy } = useToggleHabit();
  const habits = data?.habits ?? [];
  if (!habits.length || !data) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ide-muted">{t('now.habits')}</h3>
        <Link to="/habits" className="text-xs text-ide-link hover:underline">
          {t('now.allHabits')}
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {habits.map((habit) => (
          <button
            key={habit.id}
            type="button"
            disabled={busy}
            aria-pressed={habit.checkedToday}
            onClick={() => void toggle(habit.id, data.today, habit.checkedToday)}
            className="flex min-w-[8rem] flex-1 items-center gap-2 rounded-md border border-ide-border bg-ide-surface px-2.5 py-2 text-left text-sm"
            style={
              habit.checkedToday
                ? { backgroundColor: habit.color, borderColor: habit.color, color: '#fff' }
                : undefined
            }
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: habit.checkedToday ? '#fff' : habit.color }}
            />
            <span className={`min-w-0 flex-1 truncate ${habit.checkedToday ? '' : 'text-ide-text'}`}>
              {habit.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
