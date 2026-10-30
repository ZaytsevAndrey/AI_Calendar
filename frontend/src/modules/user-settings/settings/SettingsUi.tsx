import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check } from 'lucide-react';
import { Spinner } from 'ui/Spinner';
import { cx } from 'ui/cx';
import type { SaveStatus } from './useAutosave';

/** A card of related settings with an optional heading and one-line lead. */
export function SettingsGroup({
    title,
    hint,
    children,
    className,
}: {
    title?: string;
    hint?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cx('rounded-control border border-ide-border bg-ide-panel', className)}>
            {title ? (
                <header className="border-b border-ide-border px-4 py-3 md:px-5">
                    <h2 className="text-heading font-semibold text-ide-text">{title}</h2>
                    {hint ? <p className="mt-0.5 text-body-sm text-ide-muted">{hint}</p> : null}
                </header>
            ) : null}
            <div className="divide-y divide-ide-border">{children}</div>
        </section>
    );
}

/** Label and hint on the left, the control on the right (stacked on a phone), save mark beside the label. */
export function SettingRow({
    label,
    htmlFor,
    hint,
    status,
    children,
    stack = false,
}: {
    label: string;
    htmlFor?: string;
    hint?: React.ReactNode;
    status?: SaveStatus;
    children: React.ReactNode;
    /** Control on its own line under the label (wide controls: segments, lists, text). */
    stack?: boolean;
}) {
    return (
        <div
            className={cx(
                'flex gap-2 px-4 py-3 md:px-5',
                stack ? 'flex-col' : 'flex-row items-center justify-between gap-4 md:gap-6',
            )}
        >
            <div className="min-w-0 flex-1 md:max-w-md">
                <div className="flex items-center gap-2">
                    {htmlFor ? (
                        <label htmlFor={htmlFor} className="text-body font-medium text-ide-text">
                            {label}
                        </label>
                    ) : (
                        <span className="text-body font-medium text-ide-text">{label}</span>
                    )}
                    {status ? <SaveMark status={status} /> : null}
                </div>
                {hint ? <p className="mt-0.5 text-body-sm text-ide-muted">{hint}</p> : null}
            </div>
            <div className={cx('min-w-0', !stack && 'shrink-0')}>{children}</div>
        </div>
    );
}

export function SaveMark({ status }: { status: SaveStatus }) {
    const { t } = useTranslation();
    if (status === 'idle') return null;
    return (
        <span
            role="status"
            className={cx(
                'inline-flex items-center gap-1 text-caption',
                status === 'error' ? 'text-ide-error' : status === 'saved' ? 'text-ide-accent' : 'text-ide-muted',
            )}
        >
            {status === 'saving' ? <Spinner className="h-3 w-3" /> : null}
            {status === 'saved' ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
            {status === 'error' ? <AlertCircle className="h-3.5 w-3.5" aria-hidden /> : null}
            {status === 'saving' ? t('settings.saving') : status === 'saved' ? t('settings.savedShort') : t('settings.saveFailed')}
        </span>
    );
}
