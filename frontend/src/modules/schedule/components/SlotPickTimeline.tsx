import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhaseDTO } from 'api/phases.api';
import type { FreeSlotsResponse } from 'api/schedule.api';
import {
  adjacentCandidateMs,
  clampFocusMs,
  formatHmFromIso,
  minToPx,
  msToMinOfDay,
  pxToMin,
  resolvePlaceableStartIso,
  snapMsToStep,
  SLOT_GHOST_MIN_PX,
  SLOT_STEP_MIN,
  SLOT_WHEEL_FACTOR,
} from '../slotPickMath';
import { phaseIdAtFocus, phaseWindowsForDay } from '../slotPickPhases';

type Props = {
  data: FreeSlotsResponse;
  taskName: string;
  phases: PhaseDTO[];
  /** Chosen start (ISO). The parent owns it; the timeline only reports changes. */
  focusIso: string | null;
  onFocusChange: (iso: string) => void;
  /** Enter on the timeline while the focus is free. */
  onConfirm?: () => void;
};

/** Quiet time after the last scroll event before the focus is reported. */
const SCROLL_SETTLE_MS = 120;

function hourTicks(
  dayStartMs: number,
  dayEndMs: number,
  timeZone: string,
): { min: number; label: string }[] {
  const span = Math.max(60, (dayEndMs - dayStartMs) / 60_000);
  const out: { min: number; label: string }[] = [];
  for (let m = 0; m <= span + 0.5; m += 60) {
    const iso = new Date(dayStartMs + m * 60_000).toISOString();
    out.push({ min: m, label: formatHmFromIso(iso, timeZone) });
  }
  return out;
}

/**
 * Scroll-picker for one civil day: the hairline in the middle is the start.
 * Scroll, tap, or keys (↑↓ 15 min, PgUp/PgDn free starts, Home/End) move it.
 */
export function SlotPickTimeline({
  data,
  taskName,
  phases,
  focusIso,
  onFocusChange,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmaticRef = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const programmaticTimer = useRef<number | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const [padPx, setPadPx] = useState(120);
  const padPxRef = useRef(120);

  const dayStartMs = Date.parse(data.dayStart);
  const dayEndMs = Date.parse(data.dayEnd);
  const durationMin = data.durationMinutes;
  const candidatesMs = useMemo(
    () => data.candidates.map((iso) => Date.parse(iso)),
    [data.candidates],
  );
  const freeMs = useMemo(
    () => data.free.map((g) => ({ start: Date.parse(g.start), end: Date.parse(g.end) })),
    [data.free],
  );
  const windows = useMemo(
    () => phaseWindowsForDay(phases, data.ymd, data.timeZone),
    [phases, data.ymd, data.timeZone],
  );

  const parsedFocus = focusIso ? Date.parse(focusIso) : NaN;
  const propFocusMs = Number.isFinite(parsedFocus) ? parsedFocus : dayStartMs;
  /** What the hairline shows right now (moves live while scrolling). */
  const [liveMs, setLiveMs] = useState(propFocusMs);

  const snapAndClamp = (ms: number) =>
    clampFocusMs(snapMsToStep(ms, dayStartMs), dayStartMs, dayEndMs, durationMin);

  const placeable =
    resolvePlaceableStartIso(liveMs, durationMin, data.candidates, candidatesMs, freeMs) !=
    null;
  const startLabel = formatHmFromIso(new Date(liveMs).toISOString(), data.timeZone);
  const endLabel = formatHmFromIso(
    new Date(liveMs + durationMin * 60_000).toISOString(),
    data.timeZone,
  );
  const phaseAtFocus = windows.find((w) => w.id === phaseIdAtFocus(windows, liveMs));
  const phaseColor = phaseAtFocus?.color || data.phase?.color || '#4a90e2';

  const scrollTopFor = (ms: number, el: HTMLDivElement) =>
    Math.max(
      0,
      padPxRef.current + minToPx(msToMinOfDay(ms, dayStartMs)) - el.clientHeight / 2,
    );

  const focusFromScroll = (el: HTMLDivElement) =>
    snapAndClamp(
      dayStartMs +
        pxToMin(el.scrollTop + el.clientHeight / 2 - padPxRef.current) * 60_000,
    );

  const scrollToMs = (ms: number, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = scrollTopFor(ms, el);
    if (Math.abs(el.scrollTop - top) < 2) return;
    programmaticRef.current = true;
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    if (programmaticTimer.current != null) window.clearTimeout(programmaticTimer.current);
    programmaticTimer.current = window.setTimeout(
      () => {
        programmaticRef.current = false;
      },
      smooth ? 450 : 50,
    );
  };

  const report = (ms: number) => {
    const snapped = snapAndClamp(ms);
    setLiveMs(snapped);
    onFocusChangeRef.current(new Date(snapped).toISOString());
  };

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.max(80, Math.round(el.clientHeight / 2 - 24));
      if (Math.abs(next - padPxRef.current) < 1) return;
      padPxRef.current = next;
      setPadPx(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new day opens on the parent's focus without animation.
  useLayoutEffect(() => {
    setLiveMs(propFocusMs);
    scrollToMs(propFocusMs, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ymd, padPx]);

  // Parent moved the focus (chip, time field, key, tap): follow it.
  useEffect(() => {
    if (Math.abs(propFocusMs - liveMs) < 1000) return;
    setLiveMs(propFocusMs);
    scrollToMs(propFocusMs, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propFocusMs]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY * SLOT_WHEEL_FACTOR;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
      if (programmaticTimer.current != null) window.clearTimeout(programmaticTimer.current);
    },
    [],
  );

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || programmaticRef.current) return;
    setLiveMs(focusFromScroll(el));
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const live = scrollerRef.current;
      if (!live || programmaticRef.current) return;
      report(focusFromScroll(live));
    }, SCROLL_SETTLE_MS);
  };

  const onTrackClick = (clientY: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = el.scrollTop + (clientY - rect.top) - padPxRef.current;
    const ms = snapAndClamp(dayStartMs + pxToMin(y) * 60_000);
    onFocusChangeRef.current(new Date(ms).toISOString());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
        next = liveMs - SLOT_STEP_MIN * 60_000;
        break;
      case 'ArrowDown':
        next = liveMs + SLOT_STEP_MIN * 60_000;
        break;
      case 'PageUp':
        next = adjacentCandidateMs(candidatesMs, liveMs, -1);
        break;
      case 'PageDown':
        next = adjacentCandidateMs(candidatesMs, liveMs, 1);
        break;
      case 'Home':
        next = candidatesMs.length ? Math.min(...candidatesMs) : dayStartMs;
        break;
      case 'End':
        next = candidatesMs.length ? Math.max(...candidatesMs) : dayEndMs;
        break;
      case 'Enter':
        if (placeable && onConfirm) {
          e.preventDefault();
          onConfirm();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next == null) return;
    const ms = snapAndClamp(next);
    onFocusChangeRef.current(new Date(ms).toISOString());
  };

  const ticks = hourTicks(dayStartMs, dayEndMs, data.timeZone);
  const trackH = minToPx(Math.max(60, (dayEndMs - dayStartMs) / 60_000));
  const ghostH = Math.max(SLOT_GHOST_MIN_PX, minToPx(durationMin));
  const statusText = placeable
    ? t('schedule.problematicSlotFree')
    : t('schedule.problematicSlotNotFree');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ide-muted">{t('schedule.problematicSlotHint')}</p>

      <div className="relative overflow-hidden rounded-xl border border-ide-border bg-ide-bg">
        {/* Hairline at the viewport middle = slot start; ghost card hangs below it. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30" aria-hidden>
          <div className="absolute inset-x-0 top-0 h-0.5 -translate-y-1/2 bg-ide-link/80 shadow-[0_0_12px_rgba(74,144,226,0.55)]" />
          <div
            className={`absolute inset-x-5 top-0 rounded-lg border shadow-lg transition-[opacity,filter] duration-150 ${
              placeable ? 'border-white/25 opacity-95' : 'border-ide-warn/60 opacity-75 grayscale'
            }`}
            style={{
              height: ghostH,
              background: placeable
                ? `linear-gradient(135deg, ${phaseColor}cc, ${phaseColor}88)`
                : 'linear-gradient(135deg, #6b7280cc, #4b556388)',
            }}
          >
            <div className="flex h-full flex-col justify-center gap-0.5 px-3 py-2">
              <p className="truncate text-sm font-semibold leading-tight text-white drop-shadow">
                {taskName}
              </p>
              <p className="text-[11px] tabular-nums leading-tight text-white/90">
                {t('schedule.problematicSlotRange', { start: startLabel, end: endLabel })}
                {phaseAtFocus ? ` · ${phaseAtFocus.name}` : ''}
              </p>
              <p
                className={`text-[11px] font-medium leading-tight ${
                  placeable ? 'text-white/80' : 'text-ide-warn'
                }`}
              >
                {statusText}
              </p>
            </div>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="slot-pick-scroller max-h-[min(48vh,400px)] overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ide-link"
          style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="slider"
          aria-label={t('schedule.problematicSlotListAria')}
          aria-valuemin={0}
          aria-valuemax={Math.round((dayEndMs - dayStartMs) / 60_000)}
          aria-valuenow={Math.round(msToMinOfDay(liveMs, dayStartMs))}
          aria-valuetext={`${startLabel}–${endLabel}, ${statusText}`}
        >
          <div style={{ height: padPx }} aria-hidden />
          <div
            className="relative mx-3"
            style={{ height: trackH }}
            onClick={(e) => onTrackClick(e.clientY)}
            aria-hidden
          >
            {ticks.map((tick) => (
              <div
                key={tick.min}
                className="pointer-events-none absolute inset-x-0 border-t border-ide-border"
                style={{ top: minToPx(tick.min) }}
              >
                <span className="-mt-2.5 ml-1 inline-block bg-ide-bg pr-1 text-[10px] tabular-nums text-ide-muted">
                  {tick.label}
                </span>
              </div>
            ))}

            {windows.map((w) => {
              const startMin = msToMinOfDay(Math.max(w.startMs, dayStartMs), dayStartMs);
              const endMin = msToMinOfDay(Math.min(w.endMs, dayEndMs), dayStartMs);
              if (endMin <= startMin) return null;
              const active = w.id === phaseAtFocus?.id;
              return (
                <div
                  key={`phase-${w.id}`}
                  className="pointer-events-none absolute left-0 w-1.5 rounded-full"
                  style={{
                    top: minToPx(startMin),
                    height: Math.max(4, minToPx(endMin - startMin)),
                    background: w.color,
                    opacity: active ? 0.95 : 0.45,
                  }}
                  title={w.name}
                />
              );
            })}

            {data.free.map((gap) => {
              const startMin = msToMinOfDay(Date.parse(gap.start), dayStartMs);
              const endMin = msToMinOfDay(Date.parse(gap.end), dayStartMs);
              return (
                <div
                  key={`free-${gap.start}`}
                  className="pointer-events-none absolute inset-x-10 rounded-md bg-ide-link/10 ring-1 ring-inset ring-ide-link/20"
                  style={{
                    top: minToPx(startMin),
                    height: Math.max(4, minToPx(endMin - startMin)),
                  }}
                />
              );
            })}

            {data.busy.map((b, idx) => {
              const startMin = msToMinOfDay(Date.parse(b.start), dayStartMs);
              const endMin = msToMinOfDay(Date.parse(b.end), dayStartMs);
              const h = Math.max(4, minToPx(endMin - startMin));
              const tint = b.color || '#6b7280';
              const label = b.label?.trim();
              return (
                <div
                  key={`busy-${b.start}-${b.end}-${idx}`}
                  className="pointer-events-none absolute inset-x-10 overflow-hidden rounded-md border border-ide-border"
                  style={{
                    top: minToPx(startMin),
                    height: h,
                    background: `linear-gradient(90deg, ${tint}55, ${tint}22)`,
                  }}
                >
                  {label ? (
                    <div className="flex h-full min-h-0 flex-col justify-center gap-0.5 px-2 py-1">
                      <p className="truncate text-[11px] font-semibold leading-tight text-white/95 drop-shadow">
                        {label}
                      </p>
                      {h >= 36 ? (
                        <p className="truncate text-[10px] tabular-nums leading-tight text-white/75">
                          {formatHmFromIso(b.start, data.timeZone)}–
                          {formatHmFromIso(b.end, data.timeZone)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="h-full w-full bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,rgba(0,0,0,0.18)_4px,rgba(0,0,0,0.18)_8px)]" />
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ height: padPx }} aria-hidden />
        </div>
      </div>
    </div>
  );
}
