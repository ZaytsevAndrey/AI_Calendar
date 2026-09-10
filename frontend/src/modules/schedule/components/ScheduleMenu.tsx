import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type Props = {
    busy: boolean;
    isGenerating: boolean;
    isClearing: boolean;
    isUndoing: boolean;
    canUndo: boolean;
    onGenerate: () => void;
    onUndo: () => void;
    onClear: () => void;
};

export function ScheduleMenu({
    busy,
    isGenerating,
    isClearing,
    isUndoing,
    canUndo,
    onGenerate,
    onUndo,
    onClear,
}: Props) {
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
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                className="ui-btn-secondary w-full sm:w-auto"
                disabled={busy}
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={() => setOpen((v) => !v)}
            >
                Schedule
                <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 min-w-[13rem] rounded-lg border border-ide-border bg-ide-panel py-1"
                >
                    <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ide-text hover:bg-ide-surface disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                            setOpen(false);
                            onGenerate();
                        }}
                    >
                        {isGenerating ? 'Generating…' : 'Generate schedule'}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ide-text hover:bg-ide-surface disabled:opacity-50"
                        disabled={busy || !canUndo}
                        onClick={() => {
                            setOpen(false);
                            onUndo();
                        }}
                    >
                        {isUndoing ? 'Undoing…' : 'Undo last generate'}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ide-error hover:bg-ide-error/10 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                            setOpen(false);
                            onClear();
                        }}
                    >
                        {isClearing ? 'Clearing…' : 'Clear schedule'}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
