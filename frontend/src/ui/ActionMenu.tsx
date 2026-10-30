import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Popover } from './Popover';
import { useDialogFocus } from './useDialogFocus';
import { useIsPhone } from './useViewport';

export type ActionMenuItem = {
    id: string;
    label: string;
    icon?: LucideIcon;
    /** Destructive: red, and placed last. */
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
};

type Props = {
    open: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement>;
    items: ActionMenuItem[];
    /** Shown above the list on a phone (usually the item name). */
    title?: string;
};

/** «⋯» menu: a popover menu on desktop, an action sheet on a phone. */
export function ActionMenu({ open, onClose, anchorRef, items, title }: Props) {
    const phone = useIsPhone();
    const ordered = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
    const pick = (item: ActionMenuItem) => {
        onClose();
        item.onSelect();
    };

    if (phone) {
        return <ActionSheet open={open} onClose={onClose} items={ordered} title={title} onPick={pick} />;
    }

    return (
        <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={240} align="end" role="menu" label={title}>
            <div className="flex flex-col">
                {ordered.map((item, index) => {
                    const Icon = item.icon;
                    const divider = item.danger && index > 0 && !ordered[index - 1].danger;
                    return (
                        <React.Fragment key={item.id}>
                            {divider ? <div className="my-1 border-t border-ide-border" role="separator" /> : null}
                            <button
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                onClick={() => pick(item)}
                                className={cx(
                                    'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body transition',
                                    'focus-visible:bg-ide-surface focus-visible:outline-none disabled:opacity-50',
                                    item.danger ? 'text-ide-error hover:bg-ide-errorTint' : 'hover:bg-ide-surface',
                                )}
                            >
                                {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden /> : null}
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>
        </Popover>
    );
}

function ActionSheet({
    open,
    onClose,
    items,
    title,
    onPick,
}: {
    open: boolean;
    onClose: () => void;
    items: ActionMenuItem[];
    title?: string;
    onPick: (item: ActionMenuItem) => void;
}) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    useDialogFocus(open, ref, onClose, { initialFocus: 'dialog' });
    if (!open || typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[1450] flex items-end justify-center">
            <button
                type="button"
                tabIndex={-1}
                className="absolute inset-0 bg-black/55 motion-safe:animate-[fade-in_160ms_ease-out]"
                aria-label={t('common.closeModal')}
                onClick={onClose}
            />
            <div
                ref={ref}
                role="menu"
                aria-label={title}
                tabIndex={-1}
                className="relative z-10 flex w-full flex-col gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none motion-safe:animate-[sheet-in_220ms_cubic-bezier(.2,.8,.2,1)]"
            >
                <div className="overflow-hidden rounded-sheet bg-ide-overlay">
                    {title ? (
                        <p className="truncate border-b border-ide-border px-4 py-3 text-center text-body-sm text-ide-muted">
                            {title}
                        </p>
                    ) : null}
                    {items.map((item, index) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                onClick={() => onPick(item)}
                                className={cx(
                                    'flex min-h-[52px] w-full items-center justify-center gap-2 px-4 text-base transition active:bg-ide-surface disabled:opacity-50',
                                    index > 0 && 'border-t border-ide-border',
                                    item.danger ? 'text-ide-error' : 'text-ide-text',
                                )}
                            >
                                {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                                {item.label}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[52px] w-full rounded-sheet bg-ide-overlay text-base font-semibold text-ide-text active:bg-ide-surface"
                >
                    {t('common.cancel')}
                </button>
            </div>
        </div>,
        document.body,
    );
}
