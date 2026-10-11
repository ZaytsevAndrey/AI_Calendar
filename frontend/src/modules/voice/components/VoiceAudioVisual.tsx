import React, { useEffect, useState } from 'react';

const BAR_COUNT = 12;

type Mode = 'listening' | 'speaking' | 'idle';

/**
 * Polished listening / speaking visual (replaces the old 5-bar equalizer).
 * Listening uses real mic level; speaking uses a soft pulse when TTS is on.
 */
export function VoiceAudioVisual({
  mode,
  level,
  label,
}: {
  mode: Mode;
  level: number;
  label: string;
}) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (mode !== 'speaking') {
      setPulse(0);
      return;
    }
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      setPulse(0.35 + 0.45 * (0.5 + 0.5 * Math.sin(frame / 8)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const drive = mode === 'listening' ? Math.max(0, Math.min(1, level)) : mode === 'speaking' ? pulse : 0.12;

  return (
    <div
      className="relative mx-auto flex h-16 w-full max-w-xs items-end justify-center gap-[3px]"
      role="img"
      aria-label={label}
    >
      <span
        className={`pointer-events-none absolute inset-0 rounded-full blur-2xl transition-opacity ${
          mode === 'listening'
            ? 'bg-ide-error/20 opacity-100'
            : mode === 'speaking'
              ? 'bg-ide-accentBlue/25 opacity-100'
              : 'opacity-0'
        }`}
      />
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const wave = Math.sin((i / BAR_COUNT) * Math.PI);
        const height = 6 + drive * (10 + wave * 28) * (0.55 + 0.45 * wave);
        const active = mode !== 'idle' && drive > 0.08;
        return (
          <span
            key={i}
            className={`relative z-[1] w-[3px] rounded-full transition-[height,background-color,opacity] duration-100 ${
              active
                ? mode === 'speaking'
                  ? 'bg-ide-accentBlue'
                  : 'bg-ide-error'
                : 'bg-ide-border opacity-70'
            }`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}
