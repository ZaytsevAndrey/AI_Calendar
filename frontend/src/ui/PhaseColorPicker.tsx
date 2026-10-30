import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cx } from './cx';
import { PHASE_PALETTE, phasePaletteId } from 'theme/phasePalette';

type Props = {
    id?: string;
    /** Stored phase color (any hex; shown as the nearest palette color). */
    value?: string | null;
    onChange: (hex: string) => void;
    labelledBy?: string;
};

/** Ten phase colors as a radio group. Arrow keys move between swatches. */
export function PhaseColorPicker({ id, value, onChange, labelledBy }: Props) {
    const { t } = useTranslation();
    const selected = phasePaletteId(value);

    const move = (from: number, delta: number) => {
        const next = PHASE_PALETTE[(from + delta + PHASE_PALETTE.length) % PHASE_PALETTE.length];
        onChange(next.hex);
        requestAnimationFrame(() => document.getElementById(`${id ?? 'phase-color'}-${next.id}`)?.focus());
    };

    return (
        <div
            id={id}
            role="radiogroup"
            aria-labelledby={labelledBy}
            className="grid grid-cols-5 gap-2.5 sm:flex sm:flex-wrap"
        >
            {PHASE_PALETTE.map((entry, index) => {
                const on = entry.id === selected;
                return (
                    <button
                        key={entry.id}
                        id={`${id ?? 'phase-color'}-${entry.id}`}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={t(`phases.palette.${entry.id}`)}
                        title={t(`phases.palette.${entry.id}`)}
                        tabIndex={on ? 0 : -1}
                        onClick={() => onChange(entry.hex)}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                                event.preventDefault();
                                move(index, 1);
                            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                                event.preventDefault();
                                move(index, -1);
                            }
                        }}
                        className={cx(
                            'flex h-11 w-11 items-center justify-center rounded-full transition md:h-8 md:w-8',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link',
                            on && 'ring-2 ring-offset-2 ring-offset-ide-panel',
                        )}
                        style={{
                            backgroundColor: `rgb(var(--ph-${entry.id}))`,
                            ...(on ? { ['--tw-ring-color' as string]: `rgb(var(--ph-${entry.id}))` } : {}),
                        }}
                    >
                        {on ? <Check className="h-4 w-4 text-white mix-blend-normal drop-shadow" aria-hidden /> : null}
                    </button>
                );
            })}
        </div>
    );
}
