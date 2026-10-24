import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, CalendarClock, Eye, EyeOff, Mail, Search, type LucideIcon } from 'lucide-react';
import { cx } from './cx';
import {
    fieldIconSize,
    fieldLeadingPad,
    fieldTrailingPad,
    responsiveClasses,
    type ResponsiveSize,
} from './controlSize';
import { controlWidth, fieldClassName } from './fieldChrome';

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
    size?: ResponsiveSize;
    error?: boolean;
};

const leadingIcon: Partial<Record<string, LucideIcon>> = {
    email: Mail,
    search: Search,
};

const pickerIcon: Partial<Record<string, LucideIcon>> = {
    date: Calendar,
    'datetime-local': CalendarClock,
};

function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null) {
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
}

function openNativePicker(input: HTMLInputElement | null) {
    if (!input || input.disabled) return;
    input.focus();
    const withPicker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof withPicker.showPicker !== 'function') return;
    try {
        withPicker.showPicker();
    } catch {
        // The picker is already open, or this browser refuses showPicker outside a gesture.
    }
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
    { size, error, className, type = 'text', disabled, ...props },
    ref,
) {
    const { t } = useTranslation();
    const [passwordVisible, setPasswordVisible] = useState(false);
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const Leading = leadingIcon[type];
    const Picker = pickerIcon[type];
    const isPassword = type === 'password';
    const adorned = Boolean(Leading || Picker || isPassword);

    const setRefs = (node: HTMLInputElement | null) => {
        innerRef.current = node;
        assignRef(ref, node);
    };

    if (type === 'checkbox' || type === 'radio') {
        return (
            <input
                ref={ref}
                type={type}
                disabled={disabled}
                data-ui-control=""
                className={cx(
                    'h-4 w-4 shrink-0 cursor-pointer rounded border-ide-border accent-ide-accentBlue',
                    'transition duration-150 motion-reduce:transition-none motion-safe:active:scale-90',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link',
                    className,
                )}
                {...props}
            />
        );
    }

    if (type === 'color') {
        return (
            <input
                ref={ref}
                type="color"
                disabled={disabled}
                data-ui-control=""
                className={cx(
                    'h-11 w-14 cursor-pointer rounded-lg border border-ide-border bg-ide-surface p-1',
                    'transition-[border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-ide-link',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link',
                    error && 'border-ide-error',
                    className,
                )}
                {...props}
            />
        );
    }

    if (!adorned) {
        return (
            <input
                ref={ref}
                type={type}
                disabled={disabled}
                data-ui-control=""
                className={fieldClassName({ size, error, className: controlWidth(className) })}
                {...props}
            />
        );
    }

    const glyph = cx(
        'text-ide-muted transition-colors duration-200 motion-reduce:transition-none group-focus-within:text-ide-link',
        responsiveClasses(size, fieldIconSize),
    );

    return (
        <div className={cx('group relative', controlWidth(className))}>
            {Leading ? (
                <Leading
                    aria-hidden
                    className={cx('pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2', glyph)}
                />
            ) : null}
            <input
                ref={setRefs}
                type={isPassword && passwordVisible ? 'text' : type}
                disabled={disabled}
                data-ui-control=""
                className={fieldClassName({
                    size,
                    error,
                    extra: cx(
                        Leading && responsiveClasses(size, fieldLeadingPad),
                        (Picker || isPassword) && responsiveClasses(size, fieldTrailingPad),
                    ),
                    className: 'w-full',
                })}
                {...props}
            />
            {Picker ? (
                <button
                    type="button"
                    tabIndex={-1}
                    disabled={disabled}
                    aria-label={type === 'date' ? t('common.openDate') : t('common.openDateTime')}
                    className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ide-muted transition-colors duration-200 ease-out hover:bg-white/10 hover:text-ide-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link disabled:pointer-events-none motion-reduce:transition-none"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openNativePicker(innerRef.current)}
                >
                    <Picker aria-hidden className={responsiveClasses(size, fieldIconSize)} />
                </button>
            ) : null}
            {isPassword ? (
                <button
                    type="button"
                    disabled={disabled}
                    aria-label={passwordVisible ? t('common.hidePassword') : t('common.showPassword')}
                    aria-pressed={passwordVisible}
                    className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ide-muted transition-colors duration-200 ease-out hover:bg-white/10 hover:text-ide-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link disabled:pointer-events-none motion-reduce:transition-none"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setPasswordVisible((current) => !current)}
                >
                    {passwordVisible ? (
                        <EyeOff aria-hidden className={responsiveClasses(size, fieldIconSize)} />
                    ) : (
                        <Eye aria-hidden className={responsiveClasses(size, fieldIconSize)} />
                    )}
                </button>
            ) : null}
        </div>
    );
});
