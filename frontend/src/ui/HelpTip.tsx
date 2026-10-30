import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import { useCalendarPopover } from './CalendarMonth';
import { cx } from './cx';

type Props = {
    /** Accessible name of the `?` trigger, e.g. "About Phase". */
    label: string;
    children: React.ReactNode;
    className?: string;
};

/**
 * `?` beside a field label. Hover or keyboard focus shows the text; a tap pins it
 * until the next tap, a tap elsewhere, or Escape.
 */
export function HelpTip({ label, children, className }: Props) {
    const tipId = useId();
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(false);
    const open = hover || pinned;
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const pos = useCalendarPopover(open, buttonRef, panelRef);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (buttonRef.current?.contains(e.target as Node)) return;
            setPinned(false);
            setHover(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setPinned(false);
            setHover(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label={label}
                aria-describedby={open ? tipId : undefined}
                aria-expanded={open}
                className={cx(
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ide-muted',
                    'hover:text-ide-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ide-link',
                    className,
                )}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                onFocus={() => setHover(true)}
                onBlur={() => {
                    setHover(false);
                    setPinned(false);
                }}
                onClick={() => {
                    if (pinned) {
                        setPinned(false);
                        setHover(false);
                    } else {
                        setPinned(true);
                    }
                }}
            >
                <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            </button>
            {open && typeof document !== 'undefined'
                ? createPortal(
                      <div
                          ref={panelRef}
                          id={tipId}
                          role="tooltip"
                          className="pointer-events-none fixed z-[1500] w-max max-w-[min(280px,calc(100vw-1rem))] rounded-lg border border-ide-border bg-ide-panel px-2.5 py-1.5 text-xs leading-relaxed text-ide-text shadow-ide-md"
                          style={{ top: pos.top, left: pos.left }}
                      >
                          {children}
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}
