import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  clampCompanionPanelRect,
  loadCompanionPanelRect,
  saveCompanionPanelRect,
  type CompanionPanelRect,
} from '../companionPanelGeometry';

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type CompanionPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  zIndexClass?: string;
};

type DragState =
  | { mode: 'move'; startX: number; startY: number; origin: CompanionPanelRect }
  | {
      mode: 'resize';
      edge: ResizeEdge;
      startX: number;
      startY: number;
      origin: CompanionPanelRect;
    };

export function CompanionPanel({
  open,
  onClose,
  title,
  children,
  footer,
  zIndexClass = 'z-[1400]',
}: CompanionPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [rect, setRect] = useState<CompanionPanelRect>(() => loadCompanionPanelRect());
  const dragRef = useRef<DragState | null>(null);
  const rectRef = useRef(rect);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    if (!open) return;
    setRect(loadCompanionPanelRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      setRect((prev) => clampCompanionPanelRect(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const persist = useCallback((next: CompanionPanelRect) => {
    const clamped = clampCompanionPanelRect(next);
    setRect(clamped);
    saveCompanionPanelRect(clamped);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const origin = drag.origin;

      if (drag.mode === 'move') {
        setRect(
          clampCompanionPanelRect({
            ...origin,
            left: origin.left + dx,
            top: origin.top + dy,
          }),
        );
        return;
      }

      let { left, top, width, height } = origin;
      const edge = drag.edge;
      if (edge.includes('e')) width = origin.width + dx;
      if (edge.includes('s')) height = origin.height + dy;
      if (edge.includes('w')) {
        width = origin.width - dx;
        left = origin.left + dx;
      }
      if (edge.includes('n')) {
        height = origin.height - dy;
        top = origin.top + dy;
      }
      setRect(clampCompanionPanelRect({ left, top, width, height }));
    };

    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      persist(rectRef.current);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [open, persist]);

  const beginMove = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      origin: rectRef.current,
    };
  };

  const beginResize = (edge: ResizeEdge) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode: 'resize',
      edge,
      startX: event.clientX,
      startY: event.clientY,
      origin: rectRef.current,
    };
  };

  if (!open || typeof document === 'undefined') return null;

  const handleClass =
    'absolute z-20 bg-transparent touch-none';

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={`fixed ${zIndexClass} flex flex-col overflow-hidden rounded-2xl border border-ide-border bg-ide-panel shadow-ide-md`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 border-b border-ide-border px-3 py-2 active:cursor-grabbing"
        onPointerDown={beginMove}
      >
        <h2 id={titleId} className="select-none text-base font-semibold text-ide-text">
          {title}
        </h2>
        <button
          type="button"
          className="ui-btn-secondary shrink-0 px-2"
          aria-label={t('common.close')}
          title={t('common.close')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 text-ide-text sm:p-4">{children}</div>

      {footer ? (
        <div className="flex flex-shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-ide-border p-3">
          {footer}
        </div>
      ) : null}

      <div className={`${handleClass} inset-x-2 top-0 h-1.5 cursor-n-resize`} onPointerDown={beginResize('n')} />
      <div className={`${handleClass} inset-x-2 bottom-0 h-1.5 cursor-s-resize`} onPointerDown={beginResize('s')} />
      <div className={`${handleClass} inset-y-2 left-0 w-1.5 cursor-w-resize`} onPointerDown={beginResize('w')} />
      <div className={`${handleClass} inset-y-2 right-0 w-1.5 cursor-e-resize`} onPointerDown={beginResize('e')} />
      <div className={`${handleClass} left-0 top-0 h-3 w-3 cursor-nw-resize`} onPointerDown={beginResize('nw')} />
      <div className={`${handleClass} right-0 top-0 h-3 w-3 cursor-ne-resize`} onPointerDown={beginResize('ne')} />
      <div className={`${handleClass} bottom-0 left-0 h-3 w-3 cursor-sw-resize`} onPointerDown={beginResize('sw')} />
      <div className={`${handleClass} bottom-0 right-0 h-3 w-3 cursor-se-resize`} onPointerDown={beginResize('se')} />
    </div>,
    document.body,
  );
}
