import React, { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { cx } from './cx';
import { fieldIconSize, fieldTrailingPad, responsiveClasses, type ResponsiveSize } from './controlSize';
import { controlWidth, fieldClassName } from './fieldChrome';
import { formatTimeValue, parseTimeValue } from './timeValue';
import { TimeColumns } from './TimeColumns';
import { TimeWheel } from './TimeWheel';
import { PickerShell } from './PickerShell';
import { useIsPhone } from './useViewport';

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

/** Clock time (`HH:mm`): hour/minute columns in a popover on desktop, a wheel in a sheet on a phone. */
export const TimeField = React.forwardRef<HTMLButtonElement, TimeFieldProps>(function TimeField(
    { id, name, value, onChange, onBlur, size, error, disabled, minuteStep = 1, className, 'aria-label': ariaLabel },
    ref,
) {
    const { t } = useTranslation();
    const autoId = useId();
    const listId = `${id ?? autoId}-time`;
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(false);
    const phone = useIsPhone();
    const parsed = parseTimeValue(value);

    const setTrigger = (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
    };

    const close = () => {
        setOpen(false);
        onBlur?.();
    };

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
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                onClick={() => {
                    if (!disabled) setOpen((current) => !current);
                }}
                className={fieldClassName({
                    size,
                    error,
                    extra: cx('relative', responsiveClasses(size, fieldTrailingPad)),
                    className: cx('inline-flex items-center text-left tabular-nums', controlWidth(className)),
                })}
            >
                <span className={cx('min-w-0 flex-1 truncate', parsed ? undefined : 'text-ide-muted')}>
                    {parsed ? formatTimeValue(parsed.hours, parsed.minutes) : '--:--'}
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
            <PickerShell
                open={open}
                onClose={close}
                anchorRef={triggerRef}
                title={ariaLabel ?? t('common.time')}
                width={Math.max(triggerRef.current?.offsetWidth ?? 0, 208)}
            >
                <div id={listId}>
                    {phone ? (
                        <TimeWheel
                            value={value}
                            onChange={onChange}
                            minuteStep={minuteStep > 1 ? minuteStep : 5}
                            label={ariaLabel}
                        />
                    ) : (
                        <div className="-m-1 overflow-hidden rounded-lg">
                            <TimeColumns
                                value={value}
                                minuteStep={minuteStep}
                                onChange={(next) => {
                                    onChange(next);
                                }}
                            />
                        </div>
                    )}
                </div>
            </PickerShell>
        </>
    );
});
