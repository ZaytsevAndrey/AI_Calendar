import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { cx } from './cx';

function seen(id: string): boolean {
    try {
        return localStorage.getItem(`luefy.hint.${id}`) === '1';
    } catch {
        return true;
    }
}

type Props = {
    /** Stored once dismissed; the hint never comes back for this browser. */
    id: string;
    children: React.ReactNode;
    className?: string;
};

/** One-time hint that floats over a surface until «Зрозуміло». */
export function Coachmark({ id, children, className }: Props) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(() => !seen(id));
    if (!open) return null;
    const dismiss = () => {
        try {
            localStorage.setItem(`luefy.hint.${id}`, '1');
        } catch {
            /* storage blocked: hide for this visit only */
        }
        setOpen(false);
    };
    return (
        <div
            role="status"
            className={cx(
                'flex items-center gap-3 rounded-control border border-ide-border bg-ide-elevated px-3 py-2 text-body-sm text-ide-text shadow-ide-md motion-safe:animate-[pop-in_200ms_ease-out]',
                className,
            )}
        >
            <Lightbulb className="h-4 w-4 shrink-0 text-ide-warn" aria-hidden />
            <span className="min-w-0 flex-1">{children}</span>
            <button
                type="button"
                onClick={dismiss}
                className="shrink-0 rounded-lg px-2 py-1 font-medium text-ide-link hover:bg-ide-surface"
            >
                {t('common.gotIt')}
            </button>
        </div>
    );
}
