import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

type Props = {
    open: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement>;
    children: React.ReactNode;
    /** Panel width in px (clamped to the viewport). */
    width?: number;
    align?: 'start' | 'end';
    label?: string;
    role?: 'dialog' | 'menu' | 'listbox';
    className?: string;
};

const GAP = 6;
const EDGE = 8;

/** Panel anchored under (or above) a trigger. Closes on outside press and Escape. Desktop only. */
export function Popover({ open, onClose, anchorRef, children, width = 320, align = 'start', label, role = 'dialog', className }: Props) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useLayoutEffect(() => {
        if (!open) {
            setPos(null);
            return;
        }
        const place = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            if (!anchor) return;
            const w = Math.min(width, window.innerWidth - EDGE * 2);
            const panelHeight = panelRef.current?.offsetHeight ?? 320;
            let left = align === 'end' ? anchor.right - w : anchor.left;
            left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
            const below = window.innerHeight - anchor.bottom - GAP - EDGE;
            const above = anchor.top - GAP - EDGE;
            const placeBelow = panelHeight <= below || below >= above;
            const maxHeight = Math.max(160, placeBelow ? below : above);
            const top = placeBelow ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - Math.min(panelHeight, maxHeight));
            setPos({ top, left, maxHeight });
        };
        place();
        const raf = requestAnimationFrame(place);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open, anchorRef, width, align]);

    useEffect(() => {
        if (!open) return;
        const onDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
            closeRef.current();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                closeRef.current();
                anchorRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, anchorRef]);

    if (!open || typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={panelRef}
            role={role}
            aria-label={label}
            data-popover="open"
            className={cx(
                'fixed z-[1400] overflow-y-auto overscroll-contain rounded-control border border-ide-border bg-ide-overlay p-2 text-ide-text shadow-ide-md',
                'motion-safe:animate-[pop-in_120ms_ease-out]',
                className,
            )}
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width: Math.min(width, typeof window !== 'undefined' ? window.innerWidth - EDGE * 2 : width),
                maxHeight: pos?.maxHeight,
                visibility: pos ? 'visible' : 'hidden',
            }}
        >
            {children}
        </div>,
        document.body,
    );
}
