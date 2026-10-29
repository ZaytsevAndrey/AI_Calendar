import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { cx } from './cx';
import { fieldIconSize, fieldTrailingPad, responsiveClasses, type ResponsiveSize } from './controlSize';
import { controlWidth, fieldClassName } from './fieldChrome';
import { formatTimeValue, parseTimeValue } from './timeValue';
import { TimeColumns } from './TimeColumns';

export type TimeFieldProps = {
    id?: string;
    name?: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    size?: ResponsiveSize;
    error?: boolean;
    disabled?: boolean;
    /** Minute interval. Values off the interval stay visible so an existing time is not snapped. */
    minuteStep?: number;
    className?: string;
    'aria-label'?: string;
};

type PopupPlace = { top: number; left: number; width: number; above: boolean };

function placePopup(anchor: DOMRect): PopupPlace {
    const width = Math.max(anchor.width, 196);
    const height = 252;
    const margin = 8;
    let top = anchor.bottom + 4;
    let above = false;
    let left = anchor.left;
    if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, anchor.top - height - 4);
        above = true;
    }
    if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
    }
    return { top, left, width, above };
}

export const TimeField = React.forwardRef<HTMLButtonElement, TimeFieldProps>(function TimeField(
    {
        id,
        name,
        value,
        onChange,
        onBlur,
        size,
        error,
        disabled,
        minuteStep = 1,
        className,
        'aria-label': ariaLabel,
    },
    ref,
) {
    const autoId = useId();
    const listId = `${id ?? autoId}-time-list`;
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<PopupPlace | null>(null);
    const parsed = parseTimeValue(value);
    const hours = parsed?.hours ?? 0;
    const minutes = parsed?.minutes ?? 0;

    const setTrigger = (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
    };

    const updatePlace = () => {
        const node = triggerRef.current;
        if (!node) return;
        setPlace(placePopup(node.getBoundingClientRect()));
    };

    useLayoutEffect(() => {
        if (!open) return;
        updatePlace();
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
            setOpen(false);
            onBlur?.();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        const onReflow = () => updatePlace();
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onReflow);
            window.removeEventListener('scroll', onReflow, true);
        };
    }, [open, onBlur]);

    return (
        <>
            <button
                ref={setTrigger}
                id={id}
                type="button"
                name={name}
                disabled={disabled}
                data-ui-control=""
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => {
                    if (disabled) return;
                    setOpen((current) => !current);
                }}
                className={fieldClassName({
                    size,
                    error,
                    extra: cx('relative', responsiveClasses(size, fieldTrailingPad)),
                    className: cx('inline-flex items-center text-left', controlWidth(className)),
                })}
            >
                <span className={cx('min-w-0 flex-1 truncate', parsed ? undefined : 'text-ide-muted')}>
                    {parsed ? formatTimeValue(hours, minutes) : '--:--'}
                </span>
                <Clock
                    aria-hidden
                    className={cx(
                        'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ide-muted',
                        'transition-[color,transform] duration-200 ease-out motion-reduce:transition-none',
                        open && 'rotate-12 text-ide-link',
                        responsiveClasses(size, fieldIconSize),
                    )}
                />
            </button>
            {open && place && typeof document !== 'undefined'
                ? createPortal(
                      <div
                          ref={popupRef}
                          id={listId}
                          role="listbox"
                          aria-label={ariaLabel}
                          style={{ top: place.top, left: place.left, width: place.width }}
                          className={cx(
                              'fixed z-[2000] grid grid-cols-2 overflow-hidden rounded-lg border border-ide-border bg-ide-panel shadow-ide-md',
                              place.above ? 'ui-pop-up' : 'ui-pop-down',
                          )}
                      >
                          <TimeColumns value={value} minuteStep={minuteStep} onChange={onChange} />
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
});
