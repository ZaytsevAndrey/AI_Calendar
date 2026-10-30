import React from 'react';

/** Placeholder rows while a list loads: the shape of the content instead of a spinner. */
export function ListSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
    return (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={label} role="status">
            {Array.from({ length: rows }, (_, i) => (
                <div
                    key={i}
                    className="flex min-h-[56px] items-center gap-3 rounded-control border border-ide-border bg-ide-panel px-3"
                    style={{ opacity: 1 - i * 0.12 }}
                >
                    <span className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-ide-surface" />
                    <span className="flex flex-1 flex-col gap-1.5">
                        <span className="h-3.5 w-1/2 animate-pulse rounded bg-ide-surface" />
                        <span className="h-3 w-1/3 animate-pulse rounded bg-ide-surface" />
                    </span>
                </div>
            ))}
        </div>
    );
}
