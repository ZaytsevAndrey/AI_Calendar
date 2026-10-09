import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhaseDTO } from 'api/phases.api';
import type { FreeSlotsResponse } from 'api/schedule.api';
import {
  formatHmFromIso,
  initialCandidateIndex,
  minToPx,
  msToMinOfDay,
  nearestCandidateIndex,
  pxToMin,
  resolvePlaceableStartIso,
  snapMsToStep,
  SLOT_GHOST_MIN_PX,
  SLOT_STEP_MIN,
  SLOT_WHEEL_FACTOR,
} from '../slotPickMath';
import {
  phaseIdAtFocus,
  phaseWindowById,
  phaseWindowsForDay,
} from '../slotPickPhases';

type Props = {
  data: FreeSlotsResponse;
  taskName: string;
  phases: PhaseDTO[];
  phaseId: string;
  preferredStartIso?: string | null;
  settling?: boolean;
  selectedStartIso: string | null;
  /** External seek (manual time / phase select) — ISO instant. */
  seekIso?: string | null;
  /** Bump to re-seek the same ISO (e.g. typing the same time again). */
  seekNonce?: number;
  onSelect: (startIso: string | null) => void;
  /** Snapped focus ISO (always), for the manual time field. */
  onFocusIso: (focusIso: string) => void;
  onPhaseChange: (phaseId: string) => void;
};

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

function planKey(data: FreeSlotsResponse): string {
  return `${data.ymd}|${data.candidates.join('|')}`;
}

export function SlotPickTimeline({
  data,
  taskName,
  phases,
  phaseId,
  preferredStartIso,
  settling = false,
  selectedStartIso,
  seekIso,
  seekNonce = 0,
  onSelect,
  onFocusIso,
  onPhaseChange,
}: Props) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  const userScrolledRef = useRef(false);
  const initedPlanRef = useRef<string | null>(null);
  const padPxRef = useRef(120);
  const onSelectRef = useRef(onSelect);
  const onFocusIsoRef = useRef(onFocusIso);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const phaseIdRef = useRef(phaseId);
  const lastSeekNonceRef = useRef(0);
  const scrollEndTimer = useRef<number | null>(null);
  const [padPx, setPadPx] = useState(120);
  const [focusStartMs, setFocusStartMs] = useState<number | null>(null);
  onSelectRef.current = onSelect;
  onFocusIsoRef.current = onFocusIso;
  onPhaseChangeRef.current = onPhaseChange;
  phaseIdRef.current = phaseId;

  const dayStartMs = Date.parse(data.dayStart);
  const dayEndMs = Date.parse(data.dayEnd);
  const candidatesMs = data.candidates.map((iso) => Date.parse(iso));
  const freeMs = data.free.map((g) => ({
    start: Date.parse(g.start),
    end: Date.parse(g.end),
  }));
  const windows = useMemo(
    () => phaseWindowsForDay(phases, data.ymd, data.timeZone),
    [phases, data.ymd, data.timeZone],
  );
  const daySpanMin = Math.max(60, (dayEndMs - dayStartMs) / 60_000);
  const trackH = minToPx(daySpanMin);
  const durationMin = data.durationMinutes;
  const activePhase = windows.find((w) => w.id === phaseId);
  const phaseColor = activePhase?.color || data.phase?.color || '#4a90e2';
  const placeable = selectedStartIso != null;

  const displayStartMs =
    placeable && selectedStartIso
      ? Date.parse(selectedStartIso)
      : (focusStartMs ??
        (selectedStartIso ? Date.parse(selectedStartIso) : dayStartMs));
  const displayEndMs = displayStartMs + durationMin * 60_000;
  const rangeStartLabel = formatHmFromIso(
    new Date(displayStartMs).toISOString(),
    data.timeZone,
  );
  const rangeEndLabel = formatHmFromIso(
    new Date(displayEndMs).toISOString(),
    data.timeZone,
  );

  const scrollTopForMs = (ms: number, el: HTMLDivElement) => {
    const pad = padPxRef.current;
    const top =
      pad + minToPx(msToMinOfDay(ms, dayStartMs)) - el.clientHeight / 2;
    return Math.max(0, top);
  };

  const resolvePlaceableIso = (snappedMs: number): string | null =>
    resolvePlaceableStartIso(
      snappedMs,
      durationMin,
      data.candidates,
      candidatesMs,
      freeMs,
    );

  const syncPhaseForFocus = (snappedMs: number) => {
    const next = phaseIdAtFocus(windows, snappedMs) ?? '';
    if (next !== phaseIdRef.current) {
      onPhaseChangeRef.current(next);
    }
  };

  const applyFocusMs = (
    rawFocusMs: number,
    opts?: { syncPhase?: boolean },
  ) => {
    const snapped = snapMsToStep(rawFocusMs, dayStartMs);
    setFocusStartMs(snapped);
    const focusIso = new Date(snapped).toISOString();
    onFocusIsoRef.current(focusIso);
    onSelectRef.current(resolvePlaceableIso(snapped));
    // Phase auto-sync only while the user is scrolling — not after a phase
    // dropdown seek (that would immediately overwrite their choice).
    if (opts?.syncPhase) syncPhaseForFocus(snapped);
  };

  const centerOnMs = (
    ms: number,
    smooth: boolean,
    opts?: { syncPhase?: boolean },
  ) => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = scrollTopForMs(ms, el);
    if (Math.abs(el.scrollTop - target) < 2) {
      applyFocusMs(ms, opts);
      return;
    }
    suppressScrollRef.current = true;
    el.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
    applyFocusMs(ms, opts);
    window.setTimeout(
      () => {
        suppressScrollRef.current = false;
      },
      smooth ? 350 : 0,
    );
  };

  const centerIndex = (
    idx: number,
    smooth: boolean,
    opts?: { syncPhase?: boolean },
  ) => {
    if (idx < 0) return;
    centerOnMs(candidatesMs[idx], smooth, opts);
    onSelectRef.current(data.candidates[idx]);
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

  useEffect(() => {
    const key = planKey(data);
    if (initedPlanRef.current === key) return;
    initedPlanRef.current = key;
    userScrolledRef.current = false;

    if (candidatesMs.length) {
      const preferredMs = preferredStartIso
        ? Date.parse(preferredStartIso)
        : null;
      const idx = initialCandidateIndex(
        candidatesMs,
        dayStartMs,
        dayEndMs,
        Number.isFinite(preferredMs as number) ? (preferredMs as number) : null,
      );
      if (idx >= 0) {
        centerIndex(idx, false, { syncPhase: true });
        return;
      }
    }
    // No candidates — still park focus mid-day so phase/time UI work.
    centerOnMs(dayStartMs + (dayEndMs - dayStartMs) / 2, false, {
      syncPhase: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ymd, data.candidates.join('|')]);

  useLayoutEffect(() => {
    if (userScrolledRef.current) return;
    if (initedPlanRef.current !== planKey(data)) return;
    if (!selectedStartIso) return;
    const el = scrollerRef.current;
    if (!el) return;
    const ms = Date.parse(selectedStartIso);
    if (!Number.isFinite(ms)) return;
    const target = scrollTopForMs(ms, el);
    if (Math.abs(el.scrollTop - target) <= 2) return;
    suppressScrollRef.current = true;
    el.scrollTo({ top: target, behavior: 'auto' });
    suppressScrollRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padPx]);

  // Manual time / phase-select seek from parent.
  useEffect(() => {
    if (!seekIso || seekNonce <= 0) return;
    if (seekNonce === lastSeekNonceRef.current) return;
    lastSeekNonceRef.current = seekNonce;
    const ms = Date.parse(seekIso);
    if (!Number.isFinite(ms)) return;
    userScrolledRef.current = true;
    const snapped = snapMsToStep(ms, dayStartMs);
    const placeableIso = resolvePlaceableIso(snapped);
    if (placeableIso) {
      const idx = data.candidates.indexOf(placeableIso);
      if (idx >= 0) {
        // Seek from parent (phase dropdown / time field) — do not clobber phase.
        centerIndex(idx, true, { syncPhase: false });
        return;
      }
    }
    centerOnMs(snapped, true, { syncPhase: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekIso, seekNonce]);

  const onScrollerScroll = () => {
    if (suppressScrollRef.current) return;
    userScrolledRef.current = true;
    const el = scrollerRef.current;
    if (!el) return;
    const pad = padPxRef.current;
    const focusPx = el.scrollTop + el.clientHeight / 2 - pad;
    const focusMs = dayStartMs + pxToMin(focusPx) * 60_000;
    applyFocusMs(focusMs, { syncPhase: true });

    if (scrollEndTimer.current != null) {
      window.clearTimeout(scrollEndTimer.current);
    }
    scrollEndTimer.current = window.setTimeout(() => {
      if (suppressScrollRef.current) return;
      const live = scrollerRef.current;
      if (!live || !candidatesMs.length) return;
      const liveFocusPx =
        live.scrollTop + live.clientHeight / 2 - padPxRef.current;
      const liveFocusMs = dayStartMs + pxToMin(liveFocusPx) * 60_000;
      const snapped = snapMsToStep(liveFocusMs, dayStartMs);
      // Never soft-snap back onto a free slot while the focus is over busy.
      if (!resolvePlaceableIso(snapped)) return;
      const near = nearestCandidateIndex(candidatesMs, liveFocusMs);
      if (near < 0) return;
      const dist = Math.abs(candidatesMs[near] - liveFocusMs);
      if (dist > (SLOT_STEP_MIN / 2) * 60_000) return;
      centerIndex(near, true, { syncPhase: true });
    }, 140);
  };

  const onTrackPointer = (clientY: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    userScrolledRef.current = true;
    const rect = el.getBoundingClientRect();
    const yInTrack = el.scrollTop + (clientY - rect.top) - padPxRef.current;
    const focusMs = dayStartMs + pxToMin(yInTrack) * 60_000;
    const snapped = snapMsToStep(focusMs, dayStartMs);
    const iso = resolvePlaceableIso(snapped);
    if (iso) {
      const idx = data.candidates.indexOf(iso);
      if (idx >= 0) {
        centerIndex(idx, true);
        return;
      }
    }
    centerOnMs(snapped, true);
  };

  const ticks = hourTicks(dayStartMs, dayEndMs, data.timeZone);
  const ghostH = Math.max(SLOT_GHOST_MIN_PX, minToPx(durationMin));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-ide-muted">
          {t('schedule.problematicSlotHint', {
            step: SLOT_STEP_MIN,
          })}
        </p>
        <p
          className={`text-sm font-semibold tabular-nums ${
            placeable ? 'text-ide-link' : 'text-ide-warn'
          }`}
          aria-live="polite"
        >
          {t('schedule.problematicSlotRange', {
            start: rangeStartLabel,
            end: rangeEndLabel,
          })}
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#2b2d30]">
        {/* Focus hairline + ghost: line is exactly at viewport mid (= slot start). */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-30"
          aria-hidden
        >
          <div className="absolute bottom-full left-0 right-0 mb-1 px-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ide-link/90">
              {t('schedule.problematicSlotFocus')}
              {activePhase ? ` · ${activePhase.name}` : ''}
            </p>
            <p
              className={`text-sm font-semibold tabular-nums ${
                placeable ? 'text-white' : 'text-ide-warn'
              }`}
            >
              {t('schedule.problematicSlotRange', {
                start: rangeStartLabel,
                end: rangeEndLabel,
              })}
            </p>
            {!placeable ? (
              <p className="text-[11px] text-ide-warn">
                {t('schedule.problematicSlotNotFree')}
              </p>
            ) : null}
          </div>
          <div className="absolute inset-x-0 top-0 h-0.5 -translate-y-1/2 bg-ide-link/80 shadow-[0_0_12px_rgba(74,144,226,0.55)]" />
          <div
            className={`absolute inset-x-5 top-0 rounded-lg border shadow-lg transition-[transform,opacity,filter] duration-200 ease-out ${
              settling ? 'scale-[1.03] opacity-100' : 'scale-100'
            } ${
              placeable
                ? 'border-white/25 opacity-95'
                : 'border-ide-warn/50 opacity-70 grayscale'
            }`}
            style={{
              minHeight: SLOT_GHOST_MIN_PX,
              height: ghostH,
              background: placeable
                ? `linear-gradient(135deg, ${phaseColor}cc, ${phaseColor}88)`
                : 'linear-gradient(135deg, #6b7280cc, #4b556388)',
              boxShadow: placeable
                ? `0 8px 24px ${phaseColor}55`
                : '0 8px 24px rgba(0,0,0,0.35)',
            }}
          >
            <div className="flex h-full min-h-[inherit] flex-col justify-center gap-0.5 px-3 py-2">
              <p className="truncate text-sm font-semibold leading-tight text-white drop-shadow">
                {taskName}
              </p>
              <p className="text-[11px] leading-tight tabular-nums text-white/90">
                {t('schedule.problematicSlotRange', {
                  start: rangeStartLabel,
                  end: rangeEndLabel,
                })}
                {' · '}
                {durationMin} min
              </p>
            </div>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="slot-pick-scroller max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
          onScroll={onScrollerScroll}
          role="listbox"
          aria-label={t('schedule.problematicSlotListAria')}
        >
          <div style={{ height: padPx }} aria-hidden />
          <div
            className="relative mx-3"
            style={{ height: trackH }}
            onClick={(e) => onTrackPointer(e.clientY)}
          >
            {ticks.map((tick) => (
              <div
                key={tick.min}
                className="pointer-events-none absolute inset-x-0 border-t border-white/10"
                style={{ top: minToPx(tick.min) }}
              >
                <span className="-mt-2.5 ml-1 inline-block bg-[#2b2d30] pr-1 text-[10px] tabular-nums text-ide-muted">
                  {tick.label}
                </span>
              </div>
            ))}

            {/* Phase bands */}
            {windows.map((w) => {
              const startMin = msToMinOfDay(
                Math.max(w.startMs, dayStartMs),
                dayStartMs,
              );
              const endMin = msToMinOfDay(
                Math.min(w.endMs, dayEndMs),
                dayStartMs,
              );
              if (endMin <= startMin) return null;
              const active = w.id === phaseId;
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
                  className="pointer-events-none absolute inset-x-10 overflow-hidden rounded-md border border-white/10"
                  style={{
                    top: minToPx(startMin),
                    height: h,
                    background: `linear-gradient(90deg, ${tint}55, ${tint}22)`,
                  }}
                  title={
                    label
                      ? `${label} · ${formatHmFromIso(b.start, data.timeZone)}–${formatHmFromIso(b.end, data.timeZone)}`
                      : undefined
                  }
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

            {data.candidates.map((iso) => {
              const min = msToMinOfDay(Date.parse(iso), dayStartMs);
              const active = iso === selectedStartIso;
              return (
                <div
                  key={iso}
                  role="option"
                  aria-selected={active}
                  className="absolute left-0 right-0 z-10 h-4 -translate-y-2"
                  style={{ top: minToPx(min) }}
                  onClick={(e) => {
                    e.stopPropagation();
                    userScrolledRef.current = true;
                    const idx = data.candidates.indexOf(iso);
                    centerIndex(idx, true);
                  }}
                >
                  <span className="sr-only">
                    {formatHmFromIso(iso, data.timeZone)}
                  </span>
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

/** Seek helper for parent: scroll to the start of a phase window. */
export function seekIsoForPhase(
  phases: PhaseDTO[],
  phaseId: string,
  ymd: string,
  timeZone: string,
): string | null {
  const win = phaseWindowById(phaseWindowsForDay(phases, ymd, timeZone), phaseId);
  if (!win) return null;
  return new Date(win.startMs).toISOString();
}
