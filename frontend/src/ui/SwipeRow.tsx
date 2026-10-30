import React, { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';

export type SwipeAction = {
    label: string;
    icon: LucideIcon;
    tone: 'success' | 'warning' | 'danger';
    onTrigger: () => void;
};

type Props = {
    /** Revealed by a swipe to the right (usually «Виконано»). */
    start?: SwipeAction;
    /** Revealed by a swipe to the left (usually «Пропустити» or «Видалити»). */
    end?: SwipeAction;
    disabled?: boolean;
    children: React.ReactNode;
    className?: string;
};

const TRIGGER_PX = 88;
const MAX_PX = 132;
const SLOP_PX = 10;

const TONE: Record<SwipeAction['tone'], string> = {
    success: 'bg-ide-accent text-ide-panel',
    warning: 'bg-ide-warn text-ide-panel',
    danger: 'bg-ide-errorFill text-white',
};

/**
 * Touch rows: swipe right or left past 88 px to run the action. Mouse and keyboard never swipe;
 * the row keeps its own buttons for those. Vertical scrolling stays native (`touch-action: pan-y`).
 */
export function SwipeRow({ start, end, disabled, children, className }: Props) {
    const [dx, setDx] = useState(0);
    const [settling, setSettling] = useState(false);
    const origin = useRef<{ x: number; y: number; id: number; swiping: boolean } | null>(null);

    const onPointerDown = (e: React.PointerEvent) => {
        if (disabled || e.pointerType !== 'touch') return;
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiping: false };
        setSettling(false);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const o = origin.current;
        if (!o || e.pointerId !== o.id) return;
        const mx = e.clientX - o.x;
        const my = e.clientY - o.y;
        if (!o.swiping) {
            if (Math.abs(my) > SLOP_PX && Math.abs(my) > Math.abs(mx)) {
                origin.current = null;
                return;
            }
            if (Math.abs(mx) < SLOP_PX) return;
            o.swiping = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        let next = mx;
        if (next > 0 && !start) next = 0;
        if (next < 0 && !end) next = 0;
        setDx(Math.max(-MAX_PX, Math.min(MAX_PX, next)));
    };

    const finish = () => {
        const o = origin.current;
        origin.current = null;
        if (!o?.swiping) return;
        const action = dx >= TRIGGER_PX ? start : dx <= -TRIGGER_PX ? end : undefined;
        setSettling(true);
        setDx(0);
        if (action) {
            navigator.vibrate?.(10);
            action.onTrigger();
        }
    };

    const shown = dx > 0 ? start : dx < 0 ? end : undefined;
    const armed = Math.abs(dx) >= TRIGGER_PX;
    const Icon = shown?.icon;

    return (
        <div className={cx('relative overflow-hidden rounded-control', className)}>
            {shown && Icon ? (
                <div
                    aria-hidden
                    className={cx(
                        'absolute inset-0 flex items-center gap-2 px-5 text-body-sm font-semibold transition-opacity',
                        TONE[shown.tone],
                        dx > 0 ? 'justify-start' : 'justify-end',
                        armed ? 'opacity-100' : 'opacity-70',
                    )}
                >
                    <Icon className={cx('h-5 w-5 transition-transform', armed && 'scale-110')} />
                    {shown.label}
                </div>
            ) : null}
            <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finish}
                onPointerCancel={finish}
                className={cx('relative', settling && 'transition-transform duration-200 ease-out')}
                style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
            >
                {children}
            </div>
        </div>
    );
}
