import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { formatDurationShort } from './durationLabel';

type Props = {
    value: number | null;
    onChange: (minutes: number) => void;
    options?: number[];
    /** Show «інша» with a number field for any other length. */
    allowCustom?: boolean;
    label?: string;
    disabled?: boolean;
};

const DEFAULT_OPTIONS = [15, 30, 45, 60, 90, 120];

/** Common durations as chips, plus «інша» for a custom length in minutes. */
export function DurationChips({ value, onChange, options = DEFAULT_OPTIONS, allowCustom = true, label, disabled }: Props) {
    const { t } = useTranslation();
    const custom = value != null && !options.includes(value);
    const [editing, setEditing] = useState(custom);

    return (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map((minutes) => {
                const on = value === minutes && !editing;
                return (
                    <button
                        key={minutes}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => {
                            setEditing(false);
                            onChange(minutes);
                        }}
                        className={chipClass(on)}
                    >
                        {formatDurationShort(minutes, t)}
                    </button>
                );
            })}
            {allowCustom ? (
                editing ? (
                    <label className={cx(chipClass(true), 'gap-1 pr-2')}>
                        <input
                            type="number"
                            inputMode="numeric"
                            min={5}
                            max={24 * 60}
                            step={5}
                            autoFocus
                            disabled={disabled}
                            value={value ?? ''}
                            onChange={(event) => {
                                const n = Number(event.target.value);
                                if (Number.isFinite(n) && n > 0) onChange(Math.round(n));
                            }}
                            className="w-14 bg-transparent text-right tabular-nums outline-none"
                            aria-label={t('common.durationMinutes')}
                        />
                        <span>{t('common.minutesUnit')}</span>
                    </label>
                ) : (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditing(true)}
                        className={chipClass(custom)}
                    >
                        {custom && value != null ? formatDurationShort(value, t) : t('common.otherDuration')}
                    </button>
                )
            ) : null}
        </div>
    );
}

export function chipClass(on: boolean): string {
    return cx(
        'inline-flex h-11 items-center justify-center rounded-full border px-3.5 text-base tabular-nums transition md:h-8 md:px-3 md:text-body-sm',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link disabled:opacity-50',
        on
            ? 'border-ide-link bg-ide-selection font-medium text-ide-link'
            : 'border-ide-border bg-ide-panel text-ide-text hover:bg-ide-surface',
    );
}
