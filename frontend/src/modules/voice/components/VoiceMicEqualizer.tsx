import React from 'react';

const BAR_COUNT = 5;

/** Mic input level bars (0–1). Decorative; recording works without accurate levels. */
export function VoiceMicEqualizer({
  level,
  label,
}: {
  level: number;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <div
      className="flex h-10 items-end justify-center gap-1.5"
      role="img"
      aria-label={label}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const threshold = (i + 1) / (BAR_COUNT + 1);
        const active = clamped >= threshold * 0.55;
        const height = 8 + (active ? clamped : clamped * 0.35) * (10 + i * 4);
        return (
          <span
            key={i}
            className={`w-1.5 rounded-full transition-[height,background-color] duration-75 ${
              active ? 'bg-ide-error' : 'bg-ide-border'
            }`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}
