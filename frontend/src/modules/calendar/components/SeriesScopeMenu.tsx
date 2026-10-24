import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Button } from 'ui/Button';
import type { SeriesDragScope } from 'modules/schedule/seriesDragChoice';

type Props = {
  label: string;
  variant: 'secondary' | 'danger';
  disabled?: boolean;
  menuAlign?: 'left' | 'right';
  onChoose: (scope: SeriesDragScope) => void;
};

const SCOPES: SeriesDragScope[] = ['occurrence', 'series', 'all'];

const scopeLabelKey: Record<SeriesDragScope, string> = {
  occurrence: 'calendar.seriesDeleteThisDay',
  series: 'calendar.seriesDeleteFollowing',
  all: 'calendar.seriesDeleteAll',
};

/** Split button that picks this day / following / entire series. */
export function SeriesScopeMenu({
  label,
  variant,
  disabled,
  menuAlign = 'right',
  onChoose,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative min-w-0 flex-1 sm:flex-none" ref={rootRef}>
      <Button
        type="button"
        variant={variant === 'danger' ? 'danger' : 'secondary'}
        className="w-full min-w-[9rem] sm:w-auto"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        icon={variant === 'danger' ? Trash2 : Pencil}
      >
        {label}
        <ChevronDown aria-hidden />
      </Button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-20 mt-1 min-w-[13rem] rounded-lg border border-ide-border bg-ide-panel py-1 ${
            menuAlign === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          {SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              role="menuitem"
              className={`flex min-h-[44px] w-full items-center px-3 text-left text-sm hover:bg-ide-surface disabled:opacity-50 ${
                variant === 'danger' && scope === 'all'
                  ? 'text-red-400'
                  : 'text-ide-text'
              }`}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onChoose(scope);
              }}
            >
              {t(scopeLabelKey[scope])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
