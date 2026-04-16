import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import {
  minutesToTime,
  resolveActiveWindow,
  resolvePhaseRangeInActiveWindow,
  snapMinutes,
} from '../utils/phasesTimeUtils';

const PX_PER_HOUR = 44;
const SNAP_MIN = 15;
const MIN_DURATION_MIN = 15;
const HANDLE_PX = 8;

const COLUMNS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

interface PhasesCalendarProps {
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

const PhasesCalendar: React.FC<PhasesCalendarProps> = ({
  phases,
  onEditPhase,
  onPhaseTimeChange,
}) => {
  const { data: userSettings } = useGetUserSettingsQuery();
  const wake = userSettings?.wakeTime || '07:00';
  const sleep = userSettings?.sleepTime || '22:00';
  const activeWindow = useMemo(() => resolveActiveWindow(wake, sleep), [wake, sleep]);
  const dayStartMin = activeWindow.start;
  const dayEndMin = activeWindow.end;
  const daySpanMin = Math.max(dayEndMin - dayStartMin, 60);
  const gridHeightPx = (daySpanMin / 60) * PX_PER_HOUR;

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
        try {
          await onPhaseTimeChangeRef.current(
            phaseId,
            minutesToTime(startMin),
            minutesToTime(endMin),
          );
        } catch {
          skipClickAfterDragRef.current = false;
          return;
        }
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

  const blockMetrics = (
    phase: PhaseDTO,
    dayOfWeek: number,
  ): { top: string; height: string } | null => {
    const range = resolvePhaseRangeInActiveWindow(
      phase.startTime,
      phase.endTime,
      activeWindow,
    );
    let startMin = range.start;
    let endMin = range.end;
    if (live && live.phaseId === phase.id && live.dayOfWeek === dayOfWeek) {
      startMin = live.startMin;
      endMin = live.endMin;
    }
    const clippedStart = Math.max(startMin, dayStartMin);
    const clippedEnd = Math.min(endMin, dayEndMin);
    if (clippedEnd <= clippedStart) return null;
    const top = ((clippedStart - dayStartMin) / daySpanMin) * gridHeightPx;
    const height = ((clippedEnd - clippedStart) / daySpanMin) * gridHeightPx;
    return {
      top: `${Math.max(0, top)}px`,
      height: `${Math.max(HANDLE_PX * 2, height)}px`,
    };
  };

  return (
    <div className="mt-2 overflow-auto rounded-lg border border-ide-border bg-ide-panel p-4 shadow-ide">
      <h2 className="mb-1 text-lg font-semibold text-ide-text">Weekly phase template</h2>
      <p className="mb-4 block text-xs text-ide-muted">
        Drag a block or its top/bottom edge. Step: {SNAP_MIN} min. Click the center to edit.
      </p>

      <div
        className="grid min-w-[520px] gap-0 rounded border border-ide-border"
        style={{
          gridTemplateColumns: `56px repeat(${COLUMNS.length}, minmax(72px, 1fr))`,
        }}
      >
        <div className="border-b border-ide-border bg-ide-surface/80 p-1" />
        {COLUMNS.map(({ dow, label }) => (
          <div
            key={dow}
            className="border-b border-l border-ide-border bg-ide-surface/80 p-1 text-center"
          >
            <span className="text-xs font-semibold text-ide-text">{label}</span>
          </div>
        ))}

        <div
          className="relative border-r border-ide-border bg-ide-surface"
          style={{ height: gridHeightPx }}
        >
          {hourLabels.map(({ minutes, label }) => {
            const top = ((minutes - dayStartMin) / daySpanMin) * gridHeightPx;
            return (
              <span
                key={label}
                className="absolute left-1 right-0.5 text-[0.65rem] leading-none text-ide-muted"
                style={{ top: `${top}px` }}
              >
                {label}
              </span>
            );
          })}
        </div>

        {COLUMNS.map(({ dow: dayOfWeek }, dayIndex) => {
          const colPhases = displayPhases.filter((p) => phaseAppliesOnDay(p, dayOfWeek));
          return (
            <div
              key={dayOfWeek}
              id={`phase-col-${dayOfWeek}`}
              className={`relative border-ide-border bg-ide-surface ${
                dayIndex < COLUMNS.length - 1 ? 'border-l border-r' : 'border-l'
              }`}
              style={{ height: gridHeightPx }}
            >
              {colPhases.map((phase) => {
                const pos = blockMetrics(phase, dayOfWeek);
                if (!pos) return null;
                return (
                  <div
                    key={`${dayOfWeek}-${phase.id}`}
                    className="absolute left-0.5 right-0.5 z-[1] flex flex-col overflow-hidden rounded border border-black/20"
                    style={{ top: pos.top, height: pos.height, touchAction: 'none' }}
                  >
                    {onPhaseTimeChange ? (
                      <div
                        onPointerDown={(e) => startResizeStart(e, phase, dayOfWeek)}
                        className="shrink-0 cursor-ns-resize bg-black/15"
                        style={{ height: HANDLE_PX }}
                      />
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
                        onEditPhase?.(phase);
                      }}
                      className="flex min-h-0 flex-1 items-center justify-center opacity-85"
                      style={{
                        backgroundColor: phase.color,
                        cursor: onPhaseTimeChange ? 'grab' : 'pointer',
                      }}
                    >
                      <span
                        className="pointer-events-none px-0.5 text-center text-[0.65rem] font-bold leading-snug text-white"
                        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.45)' }}
                      >
                        {phase.name}
                      </span>
                    </div>
                    {onPhaseTimeChange ? (
                      <div
                        onPointerDown={(e) => startResizeEnd(e, phase, dayOfWeek)}
                        className="cursor-ns-resize bg-black/15"
                        style={{ height: HANDLE_PX }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {displayPhases.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="w-full text-sm font-semibold text-ide-text">Legend</span>
          {[...displayPhases]
            .sort((a, b) => {
              const aRange = resolvePhaseRangeInActiveWindow(a.startTime, a.endTime, activeWindow);
              const bRange = resolvePhaseRangeInActiveWindow(b.startTime, b.endTime, activeWindow);
              return aRange.start - bRange.start;
            })
            .map((phase) => (
              <div
                key={phase.id}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-white"
                style={{ backgroundColor: phase.color }}
              >
                {phase.name} ({phase.startTime}–{phase.endTime})
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default PhasesCalendar;
