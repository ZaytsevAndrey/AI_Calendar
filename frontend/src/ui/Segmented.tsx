import React from 'react';
import { cx } from './cx';

type Option<T extends string> = { value: T; label: string; icon?: React.ComponentType<{ className?: string }> };

type Props<T extends string> = {
    value: T;
    onChange: (value: T) => void;
    options: readonly Option<T>[];
    /** Accessible name of the group. */
    label: string;
    className?: string;
    size?: 'sm' | 'md';
};

/**
 * Segmented control: one choice out of 2–5. Buttons with `aria-pressed`, so a screen reader hears each
 * option as a toggle. Phone 44 px (36 px from md), the selected segment is raised on the surface.
 */
export function Segmented<T extends string>({ value, onChange, options, label, className, size = 'md' }: Props<T>) {
    return (
        <div
            role="group"
            aria-label={label}
            className={cx('inline-flex min-w-0 rounded-control border border-ide-border bg-ide-surface p-0.5', className)}
        >
            {options.map((option) => {
                const on = option.value === value;
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(option.value)}
                        className={cx(
                            'inline-flex min-w-0 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 font-medium max-[359px]:px-1.5 md:px-3 transition',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ide-link',
                            size === 'sm' ? 'h-9 text-body-sm md:h-7' : 'h-10 text-body max-[359px]:text-body-sm md:h-8 md:text-body-sm',
                            on ? 'bg-ide-panel text-ide-text shadow-ide' : 'text-ide-muted hover:text-ide-text',
                        )}
                    >
                        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                        <span className="truncate">{option.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
