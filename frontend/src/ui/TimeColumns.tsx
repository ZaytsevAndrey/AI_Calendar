import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Timer } from 'lucide-react';
import { cx } from './cx';
import { formatTimeValue, minuteOptions, parseTimeValue } from './timeValue';

type TimeColumnsProps = {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
  listClassName?: string;
};

export function TimeColumns({ value, onChange, minuteStep = 1, listClassName }: TimeColumnsProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = parseTimeValue(value);
  const hours = parsed?.hours ?? 0;
  const minutes = parsed?.minutes ?? 0;
  const minutesList = minuteOptions(minuteStep, parsed ? minutes : null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-time-column]').forEach((column) => {
      const selected = column.querySelector<HTMLElement>('[data-selected="true"]');
      if (!selected) return;
      column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.clientHeight / 2;
    });
  }, [value, minuteStep]);

  const commit = (nextHours: number, nextMinutes: number) => {
    onChange(formatTimeValue(nextHours, nextMinutes));
  };

  return (
    <div ref={rootRef} className="grid grid-cols-2 overflow-hidden">
      <TimeColumn label={t('common.hours')} icon={Clock} bordered>
        {Array.from({ length: 24 }, (_, hour) => (
          <TimeOption
            key={hour}
            selected={parsed != null && hour === hours}
            onSelect={() => commit(hour, minutes)}
          >
            {String(hour).padStart(2, '0')}
          </TimeOption>
        ))}
      </TimeColumn>
      <TimeColumn label={t('common.minutes')} icon={Timer} listClassName={listClassName}>
        {minutesList.map((minute) => (
          <TimeOption
            key={minute}
            selected={parsed != null && minute === minutes}
            onSelect={() => commit(hours, minute)}
          >
            {String(minute).padStart(2, '0')}
          </TimeOption>
        ))}
      </TimeColumn>
    </div>
  );
}

function TimeColumn({
  label,
  icon: Icon,
  bordered,
  listClassName,
  children,
}: {
  label: string;
  icon: typeof Clock;
  bordered?: boolean;
  listClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cx('flex min-h-0 flex-col', bordered && 'border-r border-ide-border')}>
      <div className="flex h-8 items-center justify-center gap-1 whitespace-nowrap border-b border-ide-border px-1 text-[11px] font-medium text-ide-muted">
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        data-time-column
        className={cx(
          'overflow-y-auto scroll-smooth py-1 motion-reduce:scroll-auto',
          listClassName ?? 'max-h-52',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TimeOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      className={cx(
        'flex h-8 w-full items-center justify-center text-sm text-ide-text',
        'transition-colors duration-150 ease-out motion-reduce:transition-none',
        selected ? 'bg-ide-selection font-medium text-ide-text' : 'hover:bg-ide-elevated',
      )}
    >
      {children}
    </button>
  );
}
