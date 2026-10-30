import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { useDialogFocus } from './useDialogFocus';
import { useIsPhone, useKeyboardInset } from './useViewport';

export type ModalProps = {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /** Desktop width (Tailwind max-w class). Phones always get a full-width sheet. */
    maxWidthClass?: string;
    /** Stacking class for the portal root (default z-[1300]). */
    zIndexClass?: string;
    /** When the body hosts its own scroller, keep the modal shell from jumping. */
    bodyOverflowHidden?: boolean;
    /** Phone height: `auto` (up to 92%) or `full` (forms). */
    phoneHeight?: 'auto' | 'full';
    /** Small action on the right of the title, e.g. «Готово» in a picker. */
    headerAction?: React.ReactNode;
    /** Phone: drag the sheet down to close. Off for forms with unsaved input. */
    swipeToClose?: boolean;
};

const SWIPE_CLOSE_PX = 96;

export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    children,
    footer,
    maxWidthClass = 'max-w-lg',
    zIndexClass = 'z-[1300]',
    bodyOverflowHidden = false,
    phoneHeight = 'auto',
    headerAction,
    swipeToClose = true,
}) => {
    const { t } = useTranslation();
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const phone = useIsPhone();
    const keyboard = useKeyboardInset(open && phone);
    const [drag, setDrag] = useState(0);
    const dragStart = useRef<number | null>(null);

    useDialogFocus(open, panelRef, onClose, { initialFocus: phone ? 'dialog' : 'first-field' });

    if (!open || typeof document === 'undefined') {
        return null;
    }

    const onPointerDown = (event: React.PointerEvent) => {
        if (!phone || !swipeToClose) return;
        dragStart.current = event.clientY;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent) => {
        if (dragStart.current === null) return;
        setDrag(Math.max(0, event.clientY - dragStart.current));
    };
    const onPointerUp = () => {
        if (dragStart.current === null) return;
        dragStart.current = null;
        if (drag > SWIPE_CLOSE_PX) onClose();
        setDrag(0);
    };

    return createPortal(
        <div
            className={cx(
                'fixed inset-0 flex items-end justify-center p-0 md:items-center md:p-4',
                zIndexClass,
            )}
        >
            <button
                type="button"
                tabIndex={-1}
                className="absolute inset-0 bg-black/55 motion-safe:animate-[fade-in_160ms_ease-out]"
                aria-label={t('common.closeModal')}
                onClick={onClose}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                aria-label={title ? undefined : t('common.dialog')}
                tabIndex={-1}
                className={cx(
                    'relative z-10 flex w-full flex-col border border-ide-border bg-ide-panel text-ide-text shadow-ide-md outline-none',
                    'rounded-t-sheet md:rounded-sheet',
                    phoneHeight === 'full' ? 'max-md:h-[96dvh]' : 'max-md:max-h-[92dvh]',
                    'md:max-h-[88vh]',
                    maxWidthClass,
                    'max-md:max-w-none motion-safe:max-md:animate-[sheet-in_220ms_cubic-bezier(.2,.8,.2,1)] motion-safe:md:animate-[pop-in_160ms_ease-out]',
                )}
                style={{
                    marginBottom: phone && keyboard ? keyboard : undefined,
                    maxHeight: phone && keyboard ? `calc(100dvh - ${keyboard + 12}px)` : undefined,
                    transform: drag ? `translateY(${drag}px)` : undefined,
                    transition: drag ? 'none' : undefined,
                }}
            >
                <div
                    className={cx('shrink-0 touch-none md:touch-auto', phone && swipeToClose && 'cursor-grab')}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    <div className="mx-auto mb-1 mt-2 h-1 w-9 rounded-full bg-ide-border md:hidden" aria-hidden />
                    {title || headerAction ? (
                        <div className="flex min-h-[3rem] items-center gap-3 border-b border-ide-border px-4 py-2.5 md:px-5 md:py-3.5">
                            {title ? (
                                <h2 id={titleId} className="min-w-0 flex-1 text-title font-semibold">
                                    {title}
                                </h2>
                            ) : (
                                <span className="flex-1" />
                            )}
                            {headerAction}
                        </div>
                    ) : null}
                </div>
                <div
                    className={cx(
                        'min-h-0 flex-1 overscroll-contain p-4 md:p-5',
                        bodyOverflowHidden ? 'overflow-hidden' : 'overflow-y-auto',
                    )}
                >
                    {children}
                </div>
                {footer ? (
                    <div
                        className={cx(
                            'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ide-border px-4 pt-3 md:px-5 md:pb-4',
                            'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                            'max-md:[&>button]:min-w-0 max-md:[&>button]:flex-1',
                        )}
                    >
                        {footer}
                    </div>
                ) : (
                    <div className="h-[env(safe-area-inset-bottom)] shrink-0 md:hidden" aria-hidden />
                )}
            </div>
        </div>,
        document.body,
    );
};
