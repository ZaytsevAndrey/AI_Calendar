import React from 'react';
import { cx } from './cx';

export type FieldProps = {
    label?: React.ReactNode;
    htmlFor?: string;
    error?: React.ReactNode;
    hint?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
};

export function Field({ label, htmlFor, error, hint, className, children }: FieldProps) {
    return (
        <div className={cx('mb-4 last:mb-0', className)}>
            {label ? (
                <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ide-text">
                    {label}
                </label>
            ) : null}
            {children}
            {error ? <span className="mt-1 block text-sm text-ide-error">{error}</span> : null}
            {hint && !error ? <p className="mt-1 text-xs leading-relaxed text-ide-muted">{hint}</p> : null}
        </div>
    );
}
