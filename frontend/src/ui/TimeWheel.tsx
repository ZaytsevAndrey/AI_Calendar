import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { formatTimeValue, parseTimeValue } from './timeValue';

const ROW = 40;
const VISIBLE = 5;

type Props = {
    value: string;
    onChange: (value: string) => void;
    /** Minute step for the minute wheel (1, 5, 15…). */
    minuteStep?: number;
    id?: string;
    label?: string;
};

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** Two scroll-snap wheels (hours, minutes). Arrow keys move one step; the centre row is the value. */
export function TimeWheel({ value, onChange, minuteStep = 15, id, label }: Props) {
    const { t } = useTranslation();
    const parsed = parseTimeValue(value);
    const hour = parsed?.hours ?? 9;
    const minute = parsed?.minutes ?? 0;
    const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
    const minuteIndex = Math.max(0, minutes.findIndex((m) => m >= minute) === -1 ? 0 : minutes.findIndex((m) => m >= minute));

    return (
        <div
            id={id}
            role="group"
            aria-label={label ?? t('common.time')}
            className="relative grid h-[200px] grid-cols-[1fr_auto_1fr] items-center overflow-hidden rounded-sheet bg-ide-surface"
        >
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-2 top-1/2 h-10 -translate-y-1/2 rounded-control bg-ide-panel shadow-ide"
            />
            <Wheel
                values={Array.from({ length: 24 }, (_, i) => i)}
                index={hour}
                empty={!parsed}
                label={t('common.hours')}
                onIndex={(i) => onChange(formatTimeValue(i, minutes[minuteIndex] ?? 0))}
            />
            <span aria-hidden className="relative text-title font-semibold">
                :
            </span>
            <Wheel
                values={minutes}
                index={minuteIndex}
                empty={!parsed}
                label={t('common.minutes')}
                onIndex={(i) => onChange(formatTimeValue(hour, minutes[i]))}
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ide-surface to-transparent"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ide-surface to-transparent"
            />
        </div>
    );
}

function Wheel({
    values,
    index,
    empty,
    label,
    onIndex,
}: {
    values: number[];
    index: number;
    /** No value yet: the centre row is a muted hint; tapping it or scrolling sets the value. */
    empty?: boolean;
    label: string;
    onIndex: (index: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const settle = useRef<number | null>(null);
    const programmatic = useRef(false);
    /** Only a user gesture commits a scroll; layout scrolls on open must not invent a value. */
    const touched = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const target = index * ROW;
        if (Math.abs(el.scrollTop - target) > 1) {
            programmatic.current = true;
            el.scrollTo({ top: target });
            requestAnimationFrame(() => {
                programmatic.current = false;
            });
        }
    }, [index]);

    const onScroll = () => {
        if (programmatic.current || !touched.current) return;
        if (settle.current) window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
            const el = ref.current;
            if (!el) return;
            const next = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
            if (next !== index || empty) onIndex(next);
        }, 90);
    };

    return (
        <div
            ref={ref}
            role="spinbutton"
            tabIndex={0}
            aria-label={label}
            aria-valuenow={values[index]}
            aria-valuetext={pad(values[index] ?? 0)}
            aria-valuemin={values[0]}
            aria-valuemax={values[values.length - 1]}
            onScroll={onScroll}
            onPointerDown={() => {
                touched.current = true;
            }}
            onWheel={() => {
                touched.current = true;
            }}
            onTouchStart={() => {
                touched.current = true;
            }}
            onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    onIndex((index - 1 + values.length) % values.length);
                } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    onIndex((index + 1) % values.length);
                }
            }}
            className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-control outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ide-link [&::-webkit-scrollbar]:hidden"
            style={{ paddingBlock: ROW * Math.floor(VISIBLE / 2) }}
        >
            {values.map((v, i) => (
                <button
                    key={v}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onIndex(i)}
                    className={cx(
                        'flex h-10 w-full snap-center items-center justify-center tabular-nums transition-colors',
                        i === index
                            ? cx('text-title font-semibold', empty ? 'text-ide-muted' : 'text-ide-text')
                            : 'text-base text-ide-subtle',
                    )}
                >
                    {pad(v)}
                </button>
            ))}
        </div>
    );
}
