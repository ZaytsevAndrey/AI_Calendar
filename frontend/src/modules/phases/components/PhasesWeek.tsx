import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import {
  minutesToTime,
  resolveActiveWindow,
  resolvePhaseRangeInActiveWindow,
  snapMinutes,
} from '../utils/phasesTimeUtils';
import { phaseColor } from 'theme/phasePalette';
import { cx } from 'ui/cx';
import { layoutEventLanes } from 'modules/calendar/eventDrag';

const PX_PER_HOUR = 40;
const SNAP_MIN = 15;
const MIN_DURATION_MIN = 15;
const HANDLE_PX = 8;

const COLUMN_DOWS = [1, 2, 3, 4, 5, 6, 0] as const;

interface PhasesWeekProps {
  selectedId?: string | null;
  onSelectPhase?: (phase: PhaseDTO | null) => void;
  phases: PhaseDTO[];
  onEditPhase?: (phase: PhaseDTO) => void;
  onPhaseTimeChange?: (
    phaseId: string,
    startTime: string,
    endTime: string,
  ) => Promise<void>;
}

function phaseAppliesOnDay(phase: PhaseDTO, dayOfWeek: number): boolean {
  if (!phase.weekDays || phase.weekDays.length === 0) return true;
  return phase.weekDays.includes(dayOfWeek);
}

function isSystemMainPhase(phase: PhaseDTO): boolean {
  return phase.type === 'main_phase' || phase.name === 'Focus hours';
}

/**
 * Desktop weekly template: phases as chips with a 2 px gap; overlapping phases share the column side by side.
 * Click selects (handles show), a second click opens the editor. Drag moves, edges resize, 15-minute steps.
 */
const PhasesWeek: React.FC<PhasesWeekProps> = ({
  phases,
  onEditPhase,
  onPhaseTimeChange,
  selectedId = null,
  onSelectPhase,
}) => {
  const { t } = useTranslation();
  const { data: userSettings } = useGetUserSettingsQuery();
  const wake = userSettings?.wakeTime || '07:00';
  const sleep = userSettings?.sleepTime || '22:00';
  const activeWindow = useMemo(() => resolveActiveWindow(wake, sleep), [wake, sleep]);
  const dayStartMin = activeWindow.start;
  const dayEndMin = activeWindow.end;
  const daySpanMin = Math.max(dayEndMin - dayStartMin, 60);
  const gridHeightPx = (daySpanMin / 60) * PX_PER_HOUR;

  const columns = useMemo(
    () =>
      COLUMN_DOWS.map((dow) => ({
        dow,
        label: t(
          (
            {
              1: 'phases.mon',
              2: 'phases.tue',
              3: 'phases.wed',
              4: 'phases.thu',
              5: 'phases.fri',
              6: 'phases.sat',
              0: 'phases.sun',
            } as const
          )[dow],
        ),
      })),
    [t],
  );

  const onPhaseTimeChangeRef = useRef(onPhaseTimeChange);
  onPhaseTimeChangeRef.current = onPhaseTimeChange;

  const hourLabels = useMemo(() => {
    const labels: { minutes: number; label: string }[] = [];
    const startH = Math.floor(dayStartMin / 60);
    const endH = Math.ceil(dayEndMin / 60);
    for (let h = startH; h <= endH; h++) {
      const m = h * 60;
      if (m >= dayStartMin && m <= dayEndMin) {
        labels.push({ minutes: m, label: minutesToTime(m) });
      }
    }
    return labels;
  }, [dayStartMin, dayEndMin]);

  const displayPhases = useMemo(
    () => phases.filter((p) => p.type !== 'sleep_time' && !isSystemMainPhase(p)),
    [phases],
  );

  const [live, setLive] = useState<{
    phaseId: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  } | null>(null);
  const [pending, setPending] = useState<{
    phaseId: string;
    startMin: number;
    endMin: number;
  } | null>(null);

  const skipClickAfterDragRef = useRef(false);

  const minutesFromY = (
    clientY: number,
    columnEl: HTMLElement,
  ): number => {
    const rect = columnEl.getBoundingClientRect();
    const y = Math.max(0, Math.min(gridHeightPx, clientY - rect.top));
    const rawMin = dayStartMin + (y / gridHeightPx) * daySpanMin;
    return snapMinutes(
      Math.max(dayStartMin, Math.min(dayEndMin - 1, rawMin)),
      SNAP_MIN,
    );
  };

  const bindDragSession = useCallback(
    (
      phaseId: string,
      dayOfWeek: number,
      initStart: number,
      initEnd: number,
      mode: 'move' | 'resize-start' | 'resize-end',
      grabOffsetMin: number,
    ) => {
      const col = document.getElementById(`phase-col-${dayOfWeek}`);
      if (!col || !onPhaseTimeChangeRef.current) return;

      let startMin = initStart;
      let endMin = initEnd;
      let moved = false;

      const syncLive = () => {
        setLive({ phaseId, dayOfWeek, startMin, endMin });
      };
      syncLive();

      const handleMove = (e: PointerEvent) => {
        moved = true;
        if (mode === 'move') {
          let nextStart = minutesFromY(e.clientY, col) - grabOffsetMin;
          nextStart = snapMinutes(nextStart, SNAP_MIN);
          const dur = endMin - startMin;
          const maxStart = dayEndMin - dur;
          nextStart = Math.max(dayStartMin, Math.min(maxStart, nextStart));
          startMin = nextStart;
          endMin = nextStart + dur;
        } else if (mode === 'resize-start') {
          let nextStart = minutesFromY(e.clientY, col);
          nextStart = Math.max(
            dayStartMin,
            Math.min(endMin - MIN_DURATION_MIN, nextStart),
          );
          nextStart = snapMinutes(nextStart, SNAP_MIN);
          startMin = nextStart;
        } else {
          let nextEnd = minutesFromY(e.clientY, col);
          nextEnd = Math.max(
            startMin + MIN_DURATION_MIN,
            Math.min(dayEndMin, nextEnd),
          );
          nextEnd = snapMinutes(nextEnd, SNAP_MIN);
          endMin = nextEnd;
        }
        syncLive();
      };

      const handleUp = async () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        setLive(null);

        if (!moved || !onPhaseTimeChangeRef.current) return;
        if (endMin <= startMin || endMin - startMin < MIN_DURATION_MIN) return;

        skipClickAfterDragRef.current = true;
        setPending({ phaseId, startMin, endMin });
        try {
          await onPhaseTimeChangeRef.current(
            phaseId,
            minutesToTime(startMin),
            minutesToTime(endMin),
          );
        } catch {
          setPending(null);
          skipClickAfterDragRef.current = false;
          return;
        }
        window.setTimeout(() => setPending(null), 400);
        setTimeout(() => {
          skipClickAfterDragRef.current = false;
        }, 0);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
    },
    [activeWindow, dayStartMin, dayEndMin, daySpanMin, gridHeightPx],
  );

  const startMove = (
    e: React.PointerEvent,
    phase: PhaseDTO,
    dayOfWeek: number,
  ) => {
    if (!onPhaseTimeChange) return;
    e.preventDefault();
    e.stopPropagation();
    const col = document.getElementById(`phase-col-${dayOfWeek}`);
    if (!col) return;
    const range = resolvePhaseRangeInActiveWindow(
      phase.startTime,
      phase.endTime,
      activeWindow,
    );
    const startMin = range.start;
    const endMin = range.end;
    if (endMin <= startMin) return;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const blockTop = ((startMin - dayStartMin) / daySpanMin) * gridHeightPx;
    const grabOffsetMin = ((y - blockTop) / gridHeightPx) * daySpanMin;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDragSession(phase.id, dayOfWeek, startMin, endMin, 'move', grabOffsetMin);
  };

  const startResizeStart = (e: React.PointerEvent, phase: PhaseDTO, dayOfWeek: number) => {
    if (!onPhaseTimeChange) return;
    e.preventDefault();
    e.stopPropagation();
    const range = resolvePhaseRangeInActiveWindow(
      phase.startTime,
      phase.endTime,
      activeWindow,
    );
    const startMin = range.start;
    const endMin = range.end;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDragSession(phase.id, dayOfWeek, startMin, endMin, 'resize-start', 0);
  };

  const startResizeEnd = (e: React.PointerEvent, phase: PhaseDTO, dayOfWeek: number) => {
    if (!onPhaseTimeChange) return;
    e.preventDefault();
    e.stopPropagation();
    const range = resolvePhaseRangeInActiveWindow(
      phase.startTime,
      phase.endTime,
      activeWindow,
    );
    const startMin = range.start;
    const endMin = range.end;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDragSession(phase.id, dayOfWeek, startMin, endMin, 'resize-end', 0);
  };

  const rangeFor = (phase: PhaseDTO): { start: number; end: number } => {
    if (live && live.phaseId === phase.id) return { start: live.startMin, end: live.endMin };
    if (pending && pending.phaseId === phase.id) return { start: pending.startMin, end: pending.endMin };
    return resolvePhaseRangeInActiveWindow(phase.startTime, phase.endTime, activeWindow);
  };
  const yFor = (min: number) => ((min - dayStartMin) / daySpanMin) * gridHeightPx;

  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <div
        className="grid min-w-[560px]"
        style={{ gridTemplateColumns: `52px repeat(${columns.length}, minmax(72px, 1fr))` }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelectPhase?.(null);
        }}
      >
        <div className="border-b border-ide-border" />
        {columns.map(({ dow, label }) => (
          <div key={dow} className="border-b border-l border-ide-border py-1.5 text-center text-body-sm text-ide-muted">
            {label}
          </div>
        ))}

        <div className="relative" style={{ height: gridHeightPx }}>
          {hourLabels.map(({ minutes, label }) => (
            <span
              key={label}
              className="absolute left-1.5 -translate-y-1/2 text-caption tabular-nums text-ide-muted first:translate-y-0"
              style={{ top: yFor(minutes) }}
            >
              {label}
            </span>
          ))}
        </div>

        {columns.map(({ dow: dayOfWeek }) => {
          const colPhases = displayPhases.filter((p) => phaseAppliesOnDay(p, dayOfWeek));
          const lanes = layoutEventLanes(
            colPhases.map((p) => {
              const r = rangeFor(p);
              return { id: p.id, startMin: r.start, endMin: r.end };
            }),
          );
          return (
            <div
              key={dayOfWeek}
              id={`phase-col-${dayOfWeek}`}
              className="relative border-l border-ide-border"
              style={{ height: gridHeightPx }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) onSelectPhase?.(null);
              }}
            >
              {hourLabels.map(({ minutes }) => (
                <div
                  key={minutes}
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 border-t border-ide-border/60"
                  style={{ top: yFor(minutes) }}
                />
              ))}
              {colPhases.map((phase) => {
                const r = rangeFor(phase);
                const start = Math.max(r.start, dayStartMin);
                const end = Math.min(r.end, dayEndMin);
                if (end <= start) return null;
                const lane = lanes.get(phase.id) ?? { lane: 0, laneCount: 1 };
                const width = 100 / lane.laneCount;
                const top = yFor(start) + 1;
                const height = Math.max(HANDLE_PX * 2, yFor(end) - yFor(start) - 2);
                const selected = selectedId === phase.id || live?.phaseId === phase.id;
                return (
                  <div
                    key={`${dayOfWeek}-${phase.id}`}
                    data-phase-id={phase.id}
                    className={cx(
                      'group absolute z-[1] flex flex-col overflow-hidden rounded-chip border transition-shadow',
                      selected ? 'z-[2] border-ide-text/50 shadow-ide-md' : 'border-transparent hover:border-ide-text/20',
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      background: `color-mix(in srgb, ${phaseColor(phase.color)} var(--phase-tint, 18%), rgb(var(--ide-panel)))`,
                      boxShadow: `inset 3px 0 0 0 ${phaseColor(phase.color)}`,
                      touchAction: 'none',
                    }}
                  >
                    {onPhaseTimeChange ? (
                      <div
                        onPointerDown={(e) => startResizeStart(e, phase, dayOfWeek)}
                        aria-hidden
                        className={cx(
                          'absolute inset-x-0 top-0 z-[2] flex cursor-ns-resize items-start justify-center transition-opacity',
                          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                        style={{ height: HANDLE_PX }}
                      >
                        <span className="mt-0.5 h-0.5 w-5 rounded-full bg-ide-text/50" />
                      </div>
                    ) : null}
                    <div
                      onPointerDown={(e) => startMove(e, phase, dayOfWeek)}
                      onClick={(e) => {
                        if (skipClickAfterDragRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          skipClickAfterDragRef.current = false;
                          return;
                        }
                        if (selectedId === phase.id || !onSelectPhase) onEditPhase?.(phase);
                        else onSelectPhase(phase);
                      }}
                      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden py-1 pl-2.5 pr-1.5"
                      style={{ cursor: onPhaseTimeChange ? 'grab' : 'pointer' }}
                    >
                      <span className="pointer-events-none truncate text-caption font-semibold leading-tight text-ide-text">
                        {phase.name}
                      </span>
                      {height >= 34 ? (
                        <span className="pointer-events-none truncate text-caption tabular-nums leading-tight text-ide-muted">
                          {minutesToTime(r.start)}–{minutesToTime(r.end)}
                        </span>
                      ) : null}
                    </div>
                    {onPhaseTimeChange ? (
                      <div
                        onPointerDown={(e) => startResizeEnd(e, phase, dayOfWeek)}
                        aria-hidden
                        className={cx(
                          'absolute inset-x-0 bottom-0 z-[2] flex cursor-ns-resize items-end justify-center transition-opacity',
                          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                        style={{ height: HANDLE_PX }}
                      >
                        <span className="mb-0.5 h-0.5 w-5 rounded-full bg-ide-text/50" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PhasesWeek;
