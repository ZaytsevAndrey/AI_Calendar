import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { PhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import {
  minutesToTime,
  snapMinutes,
  timeToMinutes,
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

const PhasesCalendar: React.FC<PhasesCalendarProps> = ({
  phases,
  onEditPhase,
  onPhaseTimeChange,
}) => {
  const { data: userSettings } = useGetUserSettingsQuery();
  const wake = userSettings?.wakeTime || '07:00';
  const sleep = userSettings?.sleepTime || '22:00';
  const dayStartMin = timeToMinutes(wake);
  const dayEndMin = timeToMinutes(sleep);
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
    () => phases.filter((p) => p.type !== 'sleep_time'),
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
    [dayStartMin, dayEndMin, daySpanMin, gridHeightPx],
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
    const startMin = timeToMinutes(phase.startTime);
    const endMin = timeToMinutes(phase.endTime);
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
    const startMin = timeToMinutes(phase.startTime);
    const endMin = timeToMinutes(phase.endTime);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDragSession(phase.id, dayOfWeek, startMin, endMin, 'resize-start', 0);
  };

  const startResizeEnd = (e: React.PointerEvent, phase: PhaseDTO, dayOfWeek: number) => {
    if (!onPhaseTimeChange) return;
    e.preventDefault();
    e.stopPropagation();
    const startMin = timeToMinutes(phase.startTime);
    const endMin = timeToMinutes(phase.endTime);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDragSession(phase.id, dayOfWeek, startMin, endMin, 'resize-end', 0);
  };

  const blockMetrics = (
    phase: PhaseDTO,
    dayOfWeek: number,
  ): { top: string; height: string } | null => {
    let startMin = timeToMinutes(phase.startTime);
    let endMin = timeToMinutes(phase.endTime);
    if (live && live.phaseId === phase.id && live.dayOfWeek === dayOfWeek) {
      startMin = live.startMin;
      endMin = live.endMin;
    }
    if (endMin <= startMin) return null;
    const top = ((startMin - dayStartMin) / daySpanMin) * gridHeightPx;
    const height = ((endMin - startMin) / daySpanMin) * gridHeightPx;
    return {
      top: `${Math.max(0, top)}px`,
      height: `${Math.max(HANDLE_PX * 2, height)}px`,
    };
  };

  return (
    <Paper sx={{ p: 2, mt: 2, overflow: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Weekly phase template
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Drag a block or its top/bottom edge. Step: {SNAP_MIN} min. Click the center to edit.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `56px repeat(${COLUMNS.length}, minmax(72px, 1fr))`,
          gap: 0,
          minWidth: 520,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Box
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            p: 0.5,
          }}
        />
        {COLUMNS.map(({ dow, label }) => (
          <Box
            key={dow}
            sx={{
              borderBottom: '1px solid',
              borderLeft: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
              p: 0.5,
              textAlign: 'center',
            }}
          >
            <Typography variant="caption" fontWeight={600}>
              {label}
            </Typography>
          </Box>
        ))}

        <Box
          sx={{
            position: 'relative',
            borderRight: '1px solid',
            borderColor: 'divider',
            height: gridHeightPx,
            bgcolor: 'grey.50',
          }}
        >
          {hourLabels.map(({ minutes, label }) => {
            const top = ((minutes - dayStartMin) / daySpanMin) * gridHeightPx;
            return (
              <Typography
                key={label}
                variant="caption"
                sx={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: 4,
                  right: 2,
                  fontSize: '0.65rem',
                  color: 'text.secondary',
                  lineHeight: 1,
                }}
              >
                {label}
              </Typography>
            );
          })}
        </Box>

        {COLUMNS.map(({ dow: dayOfWeek }, dayIndex) => {
          const colPhases = displayPhases.filter((p) =>
            phaseAppliesOnDay(p, dayOfWeek),
          );
          return (
            <Box
              key={dayOfWeek}
              id={`phase-col-${dayOfWeek}`}
              sx={{
                position: 'relative',
                height: gridHeightPx,
                borderLeft: '1px solid',
                borderRight:
                  dayIndex < COLUMNS.length - 1 ? '1px solid' : undefined,
                borderColor: 'divider',
                bgcolor: 'grey.50',
              }}
            >
              {colPhases.map((phase) => {
                const pos = blockMetrics(phase, dayOfWeek);
                if (!pos) return null;
                return (
                  <Box
                    key={`${dayOfWeek}-${phase.id}`}
                    sx={{
                      position: 'absolute',
                      left: 2,
                      right: 2,
                      top: pos.top,
                      height: pos.height,
                      borderRadius: 1,
                      border: '1px solid rgba(0,0,0,0.12)',
                      overflow: 'hidden',
                      zIndex: 1,
                      touchAction: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {onPhaseTimeChange ? (
                      <Box
                        onPointerDown={(e) => startResizeStart(e, phase, dayOfWeek)}
                        sx={{
                          height: HANDLE_PX,
                          cursor: 'ns-resize',
                          bgcolor: 'rgba(0,0,0,0.15)',
                          flexShrink: 0,
                        }}
                      />
                    ) : null}
                    <Box
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
                      sx={{
                        flex: 1,
                        minHeight: 0,
                        backgroundColor: phase.color,
                        opacity: 0.85,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: onPhaseTimeChange ? 'grab' : 'pointer',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.65rem',
                          color: 'common.white',
                          fontWeight: 700,
                          textAlign: 'center',
                          px: 0.25,
                          textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                          lineHeight: 1.15,
                          pointerEvents: 'none',
                        }}
                      >
                        {phase.name}
                      </Typography>
                    </Box>
                    {onPhaseTimeChange ? (
                      <Box
                        onPointerDown={(e) => startResizeEnd(e, phase, dayOfWeek)}
                        sx={{
                          height: HANDLE_PX,
                          cursor: 'ns-resize',
                          bgcolor: 'rgba(0,0,0,0.15)',
                        }}
                      />
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {displayPhases.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ width: '100%' }}>
            Legend
          </Typography>
          {[...displayPhases]
            .sort(
              (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
            )
            .map((phase) => (
              <Box
                key={phase.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: phase.color,
                  color: 'common.white',
                }}
              >
                <Typography variant="caption" fontWeight={600}>
                  {phase.name} ({phase.startTime}–{phase.endTime})
                </Typography>
              </Box>
            ))}
        </Box>
      )}
    </Paper>
  );
};

export default PhasesCalendar;
