import React, { useRef, useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../../utils/formatDate';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { dateFnsOptions } from '../../../i18n/dateLocale';
import {
  getTaskMutationStage,
  MUTATION_STAGE_COLORS,
} from '../../schedule/taskMutationProgress';
import { useTaskMutationStagesTick } from '../../schedule/useTaskMutationStage';
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
import { timedCardBox, timedCardClass } from '../timedCardLayout';
import { applyTimeSelection } from '../timeSelection';

const PX_PER_HOUR = 48;
const HANDLE_PX = 4;

/** Hour digits for a band, sized so they stay inside a short strip and stay quiet in a tall one. */
function hourMark(label: string, heightPx: number): { text: string; fontSize: number; opacity: number } | null {
  if (heightPx < 14 || !label) return null;
  const onTheHour = /^\d{2}:00$/.test(label);
  const text = onTheHour ? label.slice(0, 2) : label;
  const fontSize = Math.round(
    Math.min(onTheHour ? 52 : 18, Math.max(10, (heightPx - 4) * (onTheHour ? 0.62 : 0.4))),
  );
  const t = Math.min(1, Math.max(0, (fontSize - 10) / 42));
  return { text, fontSize, opacity: 0.4 - t * 0.26 };
}

type Placement = {
  dayIndex: number;
  startMin: number;
  endMin: number;
};

interface CalendarTimeGridProps {
  days: Date[];
  events: GoogleCalendarEvent[];
  allDayEvents: GoogleCalendarEvent[];
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
  /** Drag on empty space: fixed task for the selected start and end. */
  onCreateForRange?: (day: Date, start: Date, end: Date) => void;
  /** Current instant, used to label the now line. */
  now?: Date;
  /** Display-axis minute of `now` on a column, or null when that column is not today. */
  nowDisplayMin?: (day: Date) => number | null;
  onEventTimeChange?: (
    event: GoogleCalendarEvent,
    start: Date,
    end: Date,
  ) => Promise<void>;
  onDeleteEvent?: (event: GoogleCalendarEvent) => void;
  isEventCompleted?: (event: GoogleCalendarEvent) => boolean;
  renderDayExtra?: (day: Date) => React.ReactNode;
  renderEventMeta?: (event: GoogleCalendarEvent, completed: boolean) => React.ReactNode;
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
  dayStartMin,
  dayEndMin,
  hourBands,
  eventRange,
  minutesToDate,
  onEditEvent,
  onCreateForDate,
  onCreateForRange,
  now,
  nowDisplayMin,
  onEventTimeChange,
  onDeleteEvent,
  isEventCompleted,
  renderDayExtra,
  renderEventMeta,
}) => {
  const { t } = useTranslation();
  const daySpanMin = Math.max(dayEndMin - dayStartMin, 60);
  const gridHeightPx = (daySpanMin / 60) * PX_PER_HOUR;
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const onChangeRef = useRef(onEventTimeChange);
  onChangeRef.current = onEventTimeChange;
  const onCreateRangeRef = useRef(onCreateForRange);
  onCreateRangeRef.current = onCreateForRange;
  const skipClickRef = useRef(false);
  const [live, setLive] = useState<(Placement & { eventId: string }) | null>(null);
  const [draft, setDraft] = useState<Placement | null>(null);
  const [pending, setPending] = useState<Record<string, Placement>>({});
  useTaskMutationStagesTick();

  const rangeOnDay = (
    event: GoogleCalendarEvent,
    day: Date,
    dayIndex: number,
  ): { startMin: number; endMin: number } | null => {
    if (eventRange) return eventRange(event, day);
    if (dayIndex < 0) return null;
    return eventMinutes(event, dayEndMin);
  };

  const yFor = (minutes: number) => ((minutes - dayStartMin) / daySpanMin) * gridHeightPx;

  const clockAt = (day: Date, minutes: number) =>
    formatClock((minutesToDate ?? dateOnDayAtMinutes)(day, minutes));

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
        lockDay: !!event.recurringEventId,
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
      // Keep pending until events refetch matches (or error / timeout) to avoid snap-back.
      const clearPending = () => {
        setPending((prev) => {
          if (!(event.id in prev)) return prev;
          const next = { ...prev };
          delete next[event.id];
          return next;
        });
        window.setTimeout(() => {
          skipClickRef.current = false;
        }, 0);
      };
      const safety = window.setTimeout(clearPending, 12_000);
      void onChangeRef.current(event, start, end)
        .then(() => {
          window.setTimeout(clearPending, 400);
        })
        .catch(() => {
          clearPending();
        })
        .finally(() => {
          window.clearTimeout(safety);
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
    const anchorMin = mode === 'resize-end' ? place.endMin : place.startMin;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    bindDrag(
      event,
      mode,
      place,
      pointerMin - anchorMin,
      e.clientX,
      e.clientY,
    );
  };

  const startSelection = (e: React.PointerEvent, dayIndex: number) => {
    if (!onCreateRangeRef.current || e.button !== 0 || e.pointerType === 'touch') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.calendar-chip, button, a, input, textarea')) return;
    const col = colRefs.current[dayIndex];
    if (!col) return;

    const originRect = col.getBoundingClientRect();
    const anchorMin = pointerMinutes(
      e.clientY,
      originRect.top,
      originRect.height,
      dayStartMin,
      daySpanMin,
    );
    const originX = e.clientX;
    const originY = e.clientY;
    let moved = false;
    let allowCreate = true;
    let done = false;
    let current = applyTimeSelection({
      anchorMin,
      pointerMin: anchorMin,
      dayStartMin,
      dayEndMin,
    });

    const handleMove = (ev: PointerEvent) => {
      if (!allowCreate) return;
      if (!moved && Math.hypot(ev.clientX - originX, ev.clientY - originY) < 4) return;
      moved = true;
      const liveRect = col.getBoundingClientRect();
      current = applyTimeSelection({
        anchorMin,
        pointerMin: pointerMinutes(
          ev.clientY,
          liveRect.top,
          liveRect.height,
          dayStartMin,
          daySpanMin,
        ),
        dayStartMin,
        dayEndMin,
      });
      setDraft({ dayIndex, ...current });
    };

    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('keydown', handleKey);
      setDraft(null);
      if (!moved && allowCreate) return;
      skipClickRef.current = true;
      window.setTimeout(() => {
        skipClickRef.current = false;
      }, 0);
      if (!moved || !allowCreate || !onCreateRangeRef.current) return;
      const day = days[dayIndex];
      if (!day) return;
      const toDate = minutesToDate ?? dateOnDayAtMinutes;
      const start = toDate(day, current.startMin);
      const end = toDate(day, current.endMin);
      if (!(end > start)) return;
      onCreateRangeRef.current(day, start, end);
    };

    const handleUp = () => finish();
    const handleCancel = () => {
      allowCreate = false;
      finish();
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      allowCreate = false;
      setDraft(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('keydown', handleKey);
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

  const nowMinutes = days.map((day) => nowDisplayMin?.(day) ?? null);
  const gutterNow = nowMinutes.find((value): value is number => value != null) ?? null;

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
                .map((event) => {
                  const completed = isEventCompleted?.(event) ?? false;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      title={tooltipText(event)}
                      className={`calendar-chip flex w-full items-center gap-0.5 px-1.5 py-1 text-left text-xs font-medium ${
                        completed ? 'calendar-chip--done' : ''
                      }`}
                      style={
                        { ['--chip-color']: getEventColor(event) } as React.CSSProperties
                      }
                      onClick={() => onEditEvent?.(event.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{chipLabel(event)}</span>
                      {renderEventMeta?.(event, completed)}
                    </button>
                  );
                })}
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
              {days.length === 1
                ? format(day, 'EEEE d', dateFnsOptions())
                : format(day, 'EEE d', dateFnsOptions())}
              {renderDayExtra?.(day)}
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-testid="calendar-hour-scroll">
      <div className="grid" style={{ gridTemplateColumns: columns, minWidth: gridMinWidth }}>
        <div className="relative border-r border-ide-border" style={{ height: gridHeightPx }}>
          {hourBands.map((band, index) => {
            const top = yFor(band.minutes);
            const height = ((band.durationMin ?? 60) / daySpanMin) * gridHeightPx;
            return (
              <div
                key={band.label}
                className="absolute left-0 right-0"
                style={{
                  top,
                  height,
                  backgroundColor: index % 2 === 1 ? 'rgba(0,0,0,0.16)' : undefined,
                }}
              >
                {days.length === 1 ? (
                  <button
                    type="button"
                    className="absolute left-0 right-0 top-0 px-1 text-left text-[0.65rem] leading-none text-ide-muted"
                    onClick={() => onCreateForDate?.(days[0])}
                  >
                    {band.label}
                  </button>
                ) : (
                  <span className="absolute left-1 top-0 text-[0.65rem] leading-none text-ide-muted">
                    {band.label}
                  </span>
                )}
              </div>
            );
          })}
          {days.length === 1 && gutterNow != null && now ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-[3] h-4 -translate-y-1/2"
              style={{ top: yFor(gutterNow) }}
              aria-hidden
            >
              <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[0.65rem] font-medium leading-none text-ide-error">
                {formatClock(now)}
              </span>
            </div>
          ) : null}
        </div>

        {positioned.map(({ day, dayIndex, items, lanes }) => (
          <div
            key={day.toDateString()}
            ref={(el) => {
              colRefs.current[dayIndex] = el;
            }}
            className={`relative border-l border-ide-border bg-ide-panel${
              onCreateForRange ? ' cursor-crosshair select-none' : ''
            }`}
            style={{ height: gridHeightPx }}
            onPointerDown={(e) => startSelection(e, dayIndex)}
            data-testid={`calendar-day-column-${dayIndex}`}
          >
            {hourBands.map((band, index) => {
              const top = yFor(band.minutes);
              const height = ((band.durationMin ?? 60) / daySpanMin) * gridHeightPx;
              const mark = hourMark(band.label, height);
              return (
                <div
                  key={band.label}
                  className="absolute left-0 right-0 overflow-hidden border-t border-ide-border/80"
                  style={{
                    top,
                    height,
                    backgroundColor: index % 2 === 1 ? 'rgba(0,0,0,0.16)' : undefined,
                    backgroundImage: band.color
                      ? `linear-gradient(${band.color}1c, ${band.color}1c)`
                      : undefined,
                  }}
                  onClick={() => {
                    if (skipClickRef.current) return;
                    onCreateForDate?.(day);
                  }}
                >
                  {mark ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex select-none items-center justify-center font-medium tabular-nums tracking-tight text-ide-text blur-[1px]"
                      style={{ fontSize: mark.fontSize, opacity: mark.opacity }}
                    >
                      {mark.text}
                    </span>
                  ) : null}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-ide-bg/40"
                  />
                </div>
              );
            })}
            {draft && draft.dayIndex === dayIndex ? (
              <div
                data-testid="calendar-time-selection"
                className="pointer-events-none absolute left-0.5 right-0.5 z-[1] overflow-hidden rounded border border-ide-link bg-ide-link/25"
                style={{
                  top: yFor(draft.startMin),
                  height: Math.max(2, yFor(draft.endMin) - yFor(draft.startMin)),
                }}
              >
                <span className="block truncate px-1 pt-0.5 text-[10px] font-medium leading-tight text-ide-text">
                  {`${clockAt(day, draft.startMin)}–${clockAt(day, draft.endMin)}`}
                </span>
              </div>
            ) : null}
            {items.map(({ event, place }) => {
              const lane = lanes.get(event.id) ?? { lane: 0, laneCount: 1 };
              const top = yFor(place.startMin);
              const box = timedCardBox(place.endMin - place.startMin);
              const micro = box.mode === 'micro';
              const width = 100 / lane.laneCount;
              const mutationStage =
                getTaskMutationStage(event.id) ??
                getTaskMutationStage(event.recurringEventId);
              const completed = isEventCompleted?.(event) ?? false;
              const chipColor = mutationStage
                ? MUTATION_STAGE_COLORS[mutationStage]
                : getEventColor(event);
              return (
                <div
                  key={event.id}
                  data-testid={`calendar-event-${event.id}`}
                  data-card-mode={box.mode}
                  className={`calendar-chip calendar-chip--stacked group absolute z-[2] flex flex-col ${timedCardClass(box.mode)}${
                    mutationStage ? ` calendar-event-stage-${mutationStage}` : ''
                  }${completed ? ' calendar-chip--done' : ''}`}
                  style={
                    {
                      top,
                      height: micro ? undefined : box.heightPx,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      '--chip-color': chipColor,
                      '--chip-slot': `${box.heightPx}px`,
                      '--chip-open': `${box.openPx}px`,
                      touchAction: 'none',
                    } as React.CSSProperties
                  }
                  title={tooltipText(event)}
                >
                  {onEventTimeChange ? (
                    <div
                      onPointerDown={(e) => startDrag(e, event, 'resize-start', place)}
                      className="calendar-chip__handle calendar-chip__handle--start cursor-ns-resize"
                      style={{ height: HANDLE_PX }}
                    />
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`calendar-chip__body relative flex min-h-0 flex-1 flex-col items-stretch ${
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
                    {renderEventMeta ? (
                      <span className="calendar-chip__lead order-1 min-w-0 max-w-full pr-3">
                        {renderEventMeta(event, completed)}
                      </span>
                    ) : completed ? (
                      <span className="calendar-chip__badge order-1">
                        {t('calendar.completedBadge')}
                      </span>
                    ) : null}
                    <span className="calendar-chip__title order-2 min-w-0">
                      {completed ? (
                        <span className="calendar-chip__check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                      {chipLabel(event)}
                    </span>
                    {onDeleteEvent ? (
                      <button
                        type="button"
                        className="calendar-chip__delete"
                        aria-label={t('common.delete')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteEvent(event);
                        }}
                      >
                        <X strokeWidth={2.5} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {onEventTimeChange ? (
                    <div
                      onPointerDown={(e) => startDrag(e, event, 'resize-end', place)}
                      className="calendar-chip__handle calendar-chip__handle--end cursor-ns-resize"
                      style={{ height: HANDLE_PX }}
                    />
                  ) : null}
                </div>
              );
            })}
            {nowMinutes[dayIndex] != null ? (
              <div
                data-testid="calendar-now-line"
                role="img"
                aria-label={t('calendar.nowLine')}
                className="pointer-events-none absolute inset-x-0 z-[3] h-0.5 -translate-y-1/2 bg-ide-error"
                style={{ top: yFor(nowMinutes[dayIndex] as number) }}
              >
                {days.length > 1 && now ? (
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 rounded-sm bg-ide-error px-1 py-0.5 text-[0.65rem] font-medium leading-none text-white">
                    {formatClock(now)}
                  </span>
                ) : (
                  <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ide-error" />
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      </div>
      </div>
    </div>
  );
};

export default CalendarTimeGrid;
