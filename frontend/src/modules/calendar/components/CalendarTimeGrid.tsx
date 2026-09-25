import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { HabitBlockChip } from '../../habits/habitBlocks';
import { ymdFromLocalDate } from '../../../utils/ianaDateTime';
import { getEventColor } from '../hooks/useCalendar';
import {
  chipLabel,
  eventEndDate,
  eventStartDate,
  sameLocalDay,
  tooltipText,
} from '../calendarView';
import {
  applyEventDrag,
  dateOnDayAtMinutes,
  dayIndexAtX,
  EventDragMode,
  layoutEventLanes,
  pointerMinutes,
} from '../eventDrag';

const PX_PER_HOUR = 48;
const HANDLE_PX = 8;

type Placement = {
  dayIndex: number;
  startMin: number;
  endMin: number;
};

type TimedHabit = HabitBlockChip & {
  durationMinutes: number;
  /** Column this block is drawn on when it continues past midnight. */
  gridYmd?: string;
  /** Top of the block on the packed visible axis. */
  displayStartMin?: number;
};

interface CalendarTimeGridProps {
  days: Date[];
  events: GoogleCalendarEvent[];
  allDayEvents: GoogleCalendarEvent[];
  habits: TimedHabit[];
  dayStartMin: number;
  dayEndMin: number;
  hourBands: { minutes: number; label: string; color?: string; durationMin?: number }[];
  eventRange?: (
    event: GoogleCalendarEvent,
    day: Date,
  ) => { startMin: number; endMin: number } | null;
  minutesToDate?: (day: Date, minutes: number) => Date;
  onEditEvent?: (eventId: string) => void;
  onCreateForDate?: (day: Date) => void;
  onEventTimeChange?: (
    event: GoogleCalendarEvent,
    start: Date,
    end: Date,
  ) => Promise<void>;
  onOpenHabit?: (ymd: string) => void;
  renderDayExtra?: (day: Date) => React.ReactNode;
}

function eventMinutes(
  event: GoogleCalendarEvent,
  dayEndMin: number,
): { startMin: number; endMin: number } | null {
  const start = eventStartDate(event);
  const end = eventEndDate(event);
  if (!start || !end) return null;
  const startMin = start.getHours() * 60 + start.getMinutes();
  let endMin = end.getHours() * 60 + end.getMinutes();
  if (!sameLocalDay(start, end) || endMin <= startMin) {
    endMin = Math.max(startMin + 15, dayEndMin);
  }
  return { startMin, endMin };
}

const CalendarTimeGrid: React.FC<CalendarTimeGridProps> = ({
  days,
  events,
  allDayEvents,
  habits,
  dayStartMin,
  dayEndMin,
  hourBands,
  eventRange,
  minutesToDate,
  onEditEvent,
  onCreateForDate,
  onEventTimeChange,
  onOpenHabit,
  renderDayExtra,
}) => {
  const daySpanMin = Math.max(dayEndMin - dayStartMin, 60);
  const gridHeightPx = (daySpanMin / 60) * PX_PER_HOUR;
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const onChangeRef = useRef(onEventTimeChange);
  onChangeRef.current = onEventTimeChange;
  const skipClickRef = useRef(false);
  const [live, setLive] = useState<(Placement & { eventId: string }) | null>(null);
  const [pending, setPending] = useState<Record<string, Placement>>({});

  const rangeOnDay = (
    event: GoogleCalendarEvent,
    day: Date,
    dayIndex: number,
  ): { startMin: number; endMin: number } | null => {
    if (eventRange) return eventRange(event, day);
    if (dayIndex < 0) return null;
    return eventMinutes(event, dayEndMin);
  };

  const placementFor = (event: GoogleCalendarEvent, naturalDay: number): Placement | null => {
    if (live?.eventId === event.id) {
      return { dayIndex: live.dayIndex, startMin: live.startMin, endMin: live.endMin };
    }
    if (pending[event.id]) return pending[event.id];
    const day = days[naturalDay];
    if (!day || naturalDay < 0) return null;
    const range = rangeOnDay(event, day, naturalDay);
    if (!range) return null;
    return { dayIndex: naturalDay, ...range };
  };

  const bindDrag = (
    event: GoogleCalendarEvent,
    mode: EventDragMode,
    origin: Placement,
    grabOffsetMin: number,
    originX: number,
    originY: number,
  ) => {
    const originCol = colRefs.current[origin.dayIndex];
    if (!originCol || !onChangeRef.current) return;
    let current = origin;
    let moved = false;

    const readColumns = () =>
      colRefs.current.map((col) => {
        const rect = col?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right } : { left: 0, right: 0 };
      });

    const handleMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - originX, e.clientY - originY) < 4) return;
      moved = true;
      const rect = (colRefs.current[current.dayIndex] ?? originCol).getBoundingClientRect();
      const pointerMin = pointerMinutes(
        e.clientY,
        rect.top,
        rect.height,
        dayStartMin,
        daySpanMin,
      );
      current = applyEventDrag({
        mode,
        startMin: origin.startMin,
        endMin: origin.endMin,
        pointerMin,
        grabOffsetMin,
        dayStartMin,
        dayEndMin,
        dayIndex: origin.dayIndex,
        pointerDayIndex: dayIndexAtX(e.clientX, readColumns()),
      });
      setLive({ eventId: event.id, ...current });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      setLive(null);
      const unchanged =
        current.dayIndex === origin.dayIndex &&
        current.startMin === origin.startMin &&
        current.endMin === origin.endMin;
      if (!moved || unchanged || !onChangeRef.current) return;
      if (current.endMin - current.startMin < 15) return;
      const day = days[current.dayIndex];
      if (!day) return;
      const toDate = minutesToDate ?? dateOnDayAtMinutes;
      const start = toDate(day, current.startMin);
      const end = toDate(day, current.endMin);
      if (!(end > start)) return;
      skipClickRef.current = true;
      const placed = current;
      setPending((prev) => ({ ...prev, [event.id]: placed }));
      void onChangeRef.current(event, start, end)
        .catch(() => undefined)
        .finally(() => {
          setPending((prev) => {
            const next = { ...prev };
            delete next[event.id];
            return next;
          });
          window.setTimeout(() => {
            skipClickRef.current = false;
          }, 0);
        });
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const startDrag = (
    e: React.PointerEvent,
    event: GoogleCalendarEvent,
    mode: EventDragMode,
    place: Placement,
  ) => {
    if (!onEventTimeChange) return;
    e.preventDefault();
    e.stopPropagation();
    const col = colRefs.current[place.dayIndex];
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const pointerMin = pointerMinutes(e.clientY, rect.top, rect.height, dayStartMin, daySpanMin);
    const blockTop = ((place.startMin - dayStartMin) / daySpanMin) * rect.height;
    const grabOffsetMin = pointerMin - (dayStartMin + (blockTop / rect.height) * daySpanMin);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDrag(
      event,
      mode,
      place,
      mode === 'move' ? grabOffsetMin : 0,
      e.clientX,
      e.clientY,
    );
  };

  const positioned = days.map((day, dayIndex) => {
    const items = events
      .map((event) => {
        const start = eventStartDate(event);
        const naturalDay = eventRange
          ? days.findIndex((item) => !!eventRange(event, item))
          : start
            ? days.findIndex((item) => sameLocalDay(item, start))
            : -1;
        const place = placementFor(event, naturalDay);
        if (!place || place.dayIndex !== dayIndex) return null;
        return { event, place };
      })
      .filter((item): item is { event: GoogleCalendarEvent; place: Placement } => !!item);
    const lanes = layoutEventLanes(
      items.map((item) => ({
        id: item.event.id,
        startMin: item.place.startMin,
        endMin: item.place.endMin,
      })),
    );
    return { day, dayIndex, items, lanes };
  });

  const columns = `56px repeat(${days.length}, minmax(${days.length > 1 ? '88px' : '0px'}, 1fr))`;
  const gridMinWidth = days.length > 1 ? 56 + days.length * 88 : undefined;

  return (
    <div
      className="flex w-full max-w-full min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] lg:min-h-0 lg:flex-1"
      data-testid="calendar-time-grid"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col" style={{ minWidth: gridMinWidth }}>
      {allDayEvents.length > 0 && (
        <div
          className="mb-2 grid gap-1"
          style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((day) => (
            <div key={day.toDateString()} className="flex flex-col gap-1">
              {allDayEvents
                .filter((event) => {
                  const start = eventStartDate(event);
                  return start ? sameLocalDay(start, day) : false;
                })
                .map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    title={tooltipText(event)}
                    className="truncate rounded px-1.5 py-1 text-left text-xs text-white"
                    style={{ backgroundColor: getEventColor(event) }}
                    onClick={() => onEditEvent?.(event.id)}
                  >
                    {chipLabel(event)}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="grid shrink-0" style={{ gridTemplateColumns: columns, minWidth: gridMinWidth }}>
        <div />
        {days.map((day) => {
          const today = day.toDateString() === new Date().toDateString();
          return (
            <div
              key={`head-${day.toDateString()}`}
              className={`border-b border-l border-ide-border bg-ide-panel px-1 py-1 text-center text-xs ${
                today
                  ? 'font-bold text-ide-link ring-1 ring-inset ring-ide-link'
                  : 'text-ide-text'
              }`}
            >
              {days.length === 1 ? format(day, 'EEEE d') : format(day, 'EEE d')}
              {renderDayExtra?.(day)}
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-testid="calendar-hour-scroll">
      <div className="grid" style={{ gridTemplateColumns: columns, minWidth: gridMinWidth }}>
        <div className="relative border-r border-ide-border" style={{ height: gridHeightPx }}>
          {hourBands.map((band) => {
            const top = ((band.minutes - dayStartMin) / daySpanMin) * gridHeightPx;
            if (days.length === 1) {
              return (
                <button
                  key={band.label}
                  type="button"
                  className="absolute left-0 right-0 px-1 text-left text-[0.65rem] leading-none text-ide-muted"
                  style={{ top }}
                  onClick={() => onCreateForDate?.(days[0])}
                >
                  {band.label}
                </button>
              );
            }
            return (
              <span
                key={band.label}
                className="absolute left-1 text-[0.65rem] leading-none text-ide-muted"
                style={{ top }}
              >
                {band.label}
              </span>
            );
          })}
        </div>

        {positioned.map(({ day, dayIndex, items, lanes }) => (
          <div
            key={day.toDateString()}
            ref={(el) => {
              colRefs.current[dayIndex] = el;
            }}
            className="relative border-l border-ide-border bg-ide-panel"
            style={{ height: gridHeightPx }}
          >
            {hourBands.map((band) => {
              const top = ((band.minutes - dayStartMin) / daySpanMin) * gridHeightPx;
              const height = ((band.durationMin ?? 60) / daySpanMin) * gridHeightPx;
              return (
                <div
                  key={band.label}
                  className="absolute left-0 right-0 border-t border-ide-border/70"
                  style={{
                    top,
                    height,
                    backgroundColor: band.color ? `${band.color}14` : undefined,
                  }}
                  onClick={() => onCreateForDate?.(day)}
                />
              );
            })}
            {habits
              .filter((habit) => (habit.gridYmd ?? habit.ymd) === ymdFromLocalDate(day))
              .map((habit) => {
                const origin = habit.displayStartMin ?? habit.startMinutes;
                const startMin = Math.max(origin, dayStartMin);
                const endMin = Math.min(origin + habit.durationMinutes, dayEndMin);
                if (endMin <= startMin) return null;
                const top = ((startMin - dayStartMin) / daySpanMin) * gridHeightPx;
                const height = ((endMin - startMin) / daySpanMin) * gridHeightPx;
                return (
                  <button
                    key={habit.id}
                    type="button"
                    className="absolute left-0.5 right-0.5 z-[1] overflow-hidden rounded px-1 text-left text-[0.65rem] text-white"
                    style={{
                      top,
                      height: Math.max(height, 18),
                      backgroundColor: habit.color,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenHabit?.(habit.ymd);
                    }}
                  >
                    {habit.name}
                  </button>
                );
              })}
            {items.map(({ event, place }) => {
              const lane = lanes.get(event.id) ?? { lane: 0, laneCount: 1 };
              const top = ((place.startMin - dayStartMin) / daySpanMin) * gridHeightPx;
              const height = ((place.endMin - place.startMin) / daySpanMin) * gridHeightPx;
              const width = 100 / lane.laneCount;
              return (
                <div
                  key={event.id}
                  data-testid={`calendar-event-${event.id}`}
                  className="absolute z-[2] flex flex-col overflow-hidden rounded border border-white/30"
                  style={{
                    top,
                    height: Math.max(height, HANDLE_PX * 2 + 16),
                    left: `calc(${lane.lane * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    backgroundColor: getEventColor(event),
                    touchAction: 'none',
                  }}
                  title={tooltipText(event)}
                >
                  {onEventTimeChange ? (
                    <div
                      onPointerDown={(e) => startDrag(e, event, 'resize-start', place)}
                      className="shrink-0 cursor-ns-resize bg-black/20"
                      style={{ height: HANDLE_PX }}
                    />
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`min-h-0 flex-1 px-1 text-[0.65rem] leading-tight text-white ${
                      onEventTimeChange ? 'cursor-grab' : 'cursor-pointer'
                    }`}
                    onPointerDown={(e) => startDrag(e, event, 'move', place)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (skipClickRef.current) return;
                      onEditEvent?.(event.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onEditEvent?.(event.id);
                      }
                    }}
                  >
                    {chipLabel(event)}
                  </div>
                  {onEventTimeChange ? (
                    <div
                      onPointerDown={(e) => startDrag(e, event, 'resize-end', place)}
                      className="shrink-0 cursor-ns-resize bg-black/20"
                      style={{ height: HANDLE_PX }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>
      </div>
    </div>
  );
};

export default CalendarTimeGrid;
