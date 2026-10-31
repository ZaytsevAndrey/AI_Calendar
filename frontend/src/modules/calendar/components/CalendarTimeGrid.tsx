import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../../../utils/formatDate';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { dateFnsOptions } from '../../../i18n/dateLocale';
import { useTaskMutationStagesTick } from '../../schedule/useTaskMutationStage';
import {
  beginMove,
  cardMotionStage,
  cardMotionState,
  isMotionLocked,
} from '../motion/cardMotion';
import { joinKeys, stageProgress } from '../motion/motionMath';
import { useMotionPresence } from '../motion/useMotionPresence';
import { getEventColor, eventEndMs } from '../hooks/useCalendar';
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
import { layoutAllDay } from '../allDayLayout';
import { applyTimeSelection } from '../timeSelection';
import { phaseColor } from 'theme/phasePalette';
import { cx } from 'ui/cx';

const PX_PER_HOUR = 48;
const HANDLE_PX = 6;
const LONG_PRESS_MS = 420;
const LONG_PRESS_SLOP_PX = 8;
/** Long-press on empty time creates a task this long. */
const TOUCH_CREATE_MIN = 60;

/** Fire `onFire` when a touch holds still; a move or lift before that cancels (tap and scroll stay native). */
function holdToStart(e: React.PointerEvent, onFire: () => void) {
  const x = e.clientX;
  const y = e.clientY;
  const id = e.pointerId;
  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', cleanup);
    window.removeEventListener('pointercancel', cleanup);
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === id && Math.hypot(ev.clientX - x, ev.clientY - y) > LONG_PRESS_SLOP_PX) cleanup();
  };
  const timer = window.setTimeout(() => {
    cleanup();
    navigator.vibrate?.(12);
    onFire();
  }, LONG_PRESS_MS);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup);
  window.addEventListener('pointercancel', cleanup);
}

/** While a touch drag runs, stop the page from scrolling under the finger. */
function blockTouchScroll(): () => void {
  const prevent = (ev: TouchEvent) => ev.preventDefault();
  document.addEventListener('touchmove', prevent, { passive: false });
  return () => document.removeEventListener('touchmove', prevent);
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
  /** Ids an action on this card is known by (event id, its task id); default: the event id. */
  motionKeys?: (event: GoogleCalendarEvent) => string[];
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
  motionKeys,
}) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const keysFor = (event: GoogleCalendarEvent) => motionKeys?.(event) ?? [event.id];
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
    touch = false,
  ) => {
    const originCol = colRefs.current[origin.dayIndex];
    if (!originCol || !onChangeRef.current) return;
    let current = origin;
    let moved = false;
    const releaseScroll = touch ? blockTouchScroll() : null;
    if (touch) setLive({ eventId: event.id, ...origin });

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
      releaseScroll?.();
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
      const motion = startMoveMotion(event, origin);
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
          motion?.settle('done');
          window.setTimeout(clearPending, 400);
        })
        .catch(() => {
          motion?.settle('error');
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

  /** Leave the card's old self at `origin` while the server works; the new place fills up. */
  const startMoveMotion = (event: GoogleCalendarEvent, origin: Placement) => {
    const root = rootRef.current;
    const originCol = colRefs.current[origin.dayIndex];
    const card = root?.querySelector<HTMLElement>(`[data-motion-id="${CSS.escape(event.id)}"]`);
    const cardCol = card?.parentElement;
    if (!card || !cardCol || !originCol) return null;
    const cardRect = card.getBoundingClientRect();
    const fromCol = originCol.getBoundingClientRect();
    const box = timedCardBox(origin.endMin - origin.startMin);
    const day = days[origin.dayIndex];
    return beginMove(
      keysFor(event),
      card,
      {
        left: cardRect.left - cardCol.getBoundingClientRect().left + fromCol.left,
        top: fromCol.top + yFor(origin.startMin),
        width: cardRect.width,
        height: box.heightPx,
      },
      day ? `${clockAt(day, origin.startMin)}–${clockAt(day, origin.endMin)}` : undefined,
    );
  };

  const startDrag = (
    e: React.PointerEvent,
    event: GoogleCalendarEvent,
    mode: EventDragMode,
    place: Placement,
  ) => {
    if (!onEventTimeChange) return;
    if (isMotionLocked(keysFor(event))) {
      e.stopPropagation();
      return;
    }
    // A card still sliding from a replan is picked up where it is laid out.
    (e.currentTarget as HTMLElement)
      .closest<HTMLElement>('[data-motion-id]')
      ?.getAnimations()
      .forEach((animation) => animation.cancel());
    e.stopPropagation();
    const col = colRefs.current[place.dayIndex];
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const pointerMin = pointerMinutes(e.clientY, rect.top, rect.height, dayStartMin, daySpanMin);
    const anchorMin = mode === 'resize-end' ? place.endMin : place.startMin;
    if (e.pointerType === 'touch') {
      // Tap opens the preview, a swipe scrolls; holding still picks the event up.
      if (mode !== 'move') return;
      const { clientX, clientY } = e;
      holdToStart(e, () => bindDrag(event, mode, place, pointerMin - anchorMin, clientX, clientY, true));
      return;
    }
    e.preventDefault();
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
    if (!onCreateRangeRef.current || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.calendar-chip, button, a, input, textarea')) return;
    const col = colRefs.current[dayIndex];
    if (!col) return;
    if (e.pointerType === 'touch') {
      const rect = col.getBoundingClientRect();
      const at = pointerMinutes(e.clientY, rect.top, rect.height, dayStartMin, daySpanMin);
      holdToStart(e, () => {
        const startMin = Math.max(dayStartMin, Math.floor(at / 15) * 15);
        const endMin = Math.min(dayEndMin, startMin + TOUCH_CREATE_MIN);
        const day = days[dayIndex];
        if (!day || !onCreateRangeRef.current || endMin <= startMin) return;
        skipClickRef.current = true;
        window.setTimeout(() => {
          skipClickRef.current = false;
        }, 400);
        setDraft({ dayIndex, startMin, endMin });
        window.setTimeout(() => setDraft(null), 300);
        const toDate = minutesToDate ?? dateOnDayAtMinutes;
        onCreateRangeRef.current(day, toDate(day, startMin), toDate(day, endMin));
      });
      return;
    }

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

  const allDayBars = layoutAllDay(allDayEvents, days);
  const allDayRows = allDayBars.reduce((max, bar) => Math.max(max, bar.row + 1), 0);

  const nowMinutes = days.map((day) => nowDisplayMin?.(day) ?? null);
  const gutterNow = nowMinutes.find((value): value is number => value != null) ?? null;

  // Open on the current time (or the start of the day), a third from the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const daysKey = days.map((day) => day.toDateString()).join('|');
  useMotionPresence(rootRef, {
    resetKey: daysKey,
    skipIds: live ? new Set([live.eventId]) : undefined,
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = gutterNow != null ? yFor(gutterNow) - el.clientHeight / 3 : 0;
    el.scrollTop = Math.max(0, target);
    // Only when the visible days change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey]);

  const columns = `56px repeat(${days.length}, minmax(${days.length > 1 ? '88px' : '0px'}, 1fr))`;
  const gridMinWidth = days.length > 1 ? 56 + days.length * 88 : undefined;

  return (
    <div
      ref={rootRef}
      className="flex w-full max-w-full min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] lg:min-h-0 lg:flex-1"
      data-testid="calendar-time-grid"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col" style={{ minWidth: gridMinWidth }}>
      {/* A phone day already has the week strip above; its own header would repeat the date. */}
      <div
        className={cx('grid shrink-0', days.length === 1 && 'max-md:hidden')}
        style={{ gridTemplateColumns: columns, minWidth: gridMinWidth }}
      >
        <div />
        {days.map((day) => {
          const today = day.toDateString() === new Date().toDateString();
          return (
            <div
              key={`head-${day.toDateString()}`}
              aria-current={today ? 'date' : undefined}
              className="flex items-center justify-center gap-1.5 border-b border-l border-ide-border bg-ide-panel px-1 py-1.5 text-body-sm"
            >
              <span className={cx('capitalize', today ? 'font-medium text-ide-link' : 'text-ide-muted')}>
                {format(day, days.length === 1 ? 'EEEE' : 'EEE', dateFnsOptions())}
              </span>
              <span
                className={cx(
                  'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 font-semibold tabular-nums',
                  today ? 'bg-ide-accentBlue text-white' : 'text-ide-text',
                )}
              >
                {format(day, 'd', dateFnsOptions())}
              </span>
              {renderDayExtra?.(day)}
            </div>
          );
        })}
      </div>
      {allDayBars.length > 0 && (
        <div
          className="grid shrink-0 gap-y-1 border-b border-ide-border py-1"
          style={{ gridTemplateColumns: columns, minWidth: gridMinWidth }}
        >
          <div
            className="px-1.5 text-caption leading-tight text-ide-muted"
            style={{ gridColumn: 1, gridRow: `1 / span ${allDayRows}` }}
          >
            {t('common.allDay')}
          </div>
          {allDayBars.map(({ event, from, to, row }) => {
            const completed = isEventCompleted?.(event) ?? false;
            return (
              <button
                key={event.id}
                type="button"
                data-motion-id={event.id}
                data-motion-keys={joinKeys(keysFor(event))}
                data-motion={cardMotionState(keysFor(event)) ?? undefined}
                data-motion-start={eventStartDate(event)?.getTime()}
                data-motion-title={event.summary || undefined}
                title={tooltipText(event)}
                className={cx(
                  'calendar-chip calendar-chip--line mx-0.5 min-w-0 text-left font-medium',
                  completed && 'calendar-chip--done',
                  !event.isAppGenerated && 'calendar-chip--external',
                )}
                style={
                  {
                    '--chip-color': getEventColor(event),
                    gridColumn: `${from + 2} / ${to + 3}`,
                    gridRow: row + 1,
                  } as React.CSSProperties
                }
                onClick={() => onEditEvent?.(event.id)}
              >
                {completed ? (
                  <span className="calendar-chip__check" aria-hidden>
                    ✓
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{chipLabel(event)}</span>
                {renderEventMeta?.(event, completed)}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-testid="calendar-hour-scroll"
        data-motion-scroll
      >
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
                }}
              >
                {days.length === 1 ? (
                  <button
                    type="button"
                    className="absolute left-0 right-0 top-0.5 px-1.5 text-left text-caption leading-none tabular-nums text-ide-muted"
                    onClick={() => onCreateForDate?.(days[0])}
                  >
                    {band.label}
                  </button>
                ) : (
                  <span className="absolute left-1.5 top-0.5 text-caption leading-none tabular-nums text-ide-muted">
                    {band.label}
                  </span>
                )}
              </div>
            );
          })}
          {gutterNow != null && now ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-[3] h-5 -translate-y-1/2"
              style={{ top: yFor(gutterNow) }}
              aria-hidden
            >
              <span className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[4px] bg-ide-error px-1 py-0.5 text-caption font-semibold leading-none tabular-nums text-white">
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
              return (
                <div
                  key={band.label}
                  className="absolute left-0 right-0 overflow-hidden border-t border-ide-border/70"
                  style={{
                    top,
                    height,
                    backgroundColor: band.color ? phaseColor(band.color, 0.06) : undefined,
                  }}
                  onClick={() => {
                    if (skipClickRef.current) return;
                    onCreateForDate?.(day);
                  }}
                >
                </div>
              );
            })}
            {draft && draft.dayIndex === dayIndex ? (
              <div
                data-testid="calendar-time-selection"
                className="pointer-events-none absolute left-0.5 right-0.5 z-[1] overflow-hidden rounded-chip border border-ide-link bg-ide-link/20"
                style={{
                  top: yFor(draft.startMin),
                  height: Math.max(2, yFor(draft.endMin) - yFor(draft.startMin)),
                }}
              >
                <span className="block truncate px-1.5 pt-0.5 text-caption font-medium tabular-nums text-ide-text">
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
              const keys = keysFor(event);
              const motionState = cardMotionState(keys);
              const motionStage = motionState ? cardMotionStage(keys) : null;
              const locked = isMotionLocked(keys);
              const completed = isEventCompleted?.(event) ?? false;
              const endMs = eventEndMs(event);
              const past = !!now && endMs != null && endMs <= now.getTime() && !live;
              const timeText = `${clockAt(day, place.startMin)}–${clockAt(day, place.endMin)}`;
              const chipColor = getEventColor(event);
              return (
                <div
                  key={event.id}
                  data-testid={`calendar-event-${event.id}`}
                  data-card-mode={box.mode}
                  data-motion-id={event.id}
                  data-motion-keys={joinKeys(keys)}
                  data-motion={motionState ?? undefined}
                  data-motion-stage={motionStage ?? undefined}
                  data-motion-start={eventStartDate(event)?.getTime()}
                  data-motion-title={event.summary || undefined}
                  aria-busy={motionState ? true : undefined}
                  className={cx(
                    'calendar-chip group absolute z-[2] flex flex-col',
                    box.mode === 'stacked' ? 'calendar-chip--stacked' : timedCardClass(box.mode),
                    completed && 'calendar-chip--done',
                    past && !motionState && 'calendar-chip--past',
                    !event.isAppGenerated && 'calendar-chip--external',
                  )}
                  style={
                    {
                      top,
                      height: micro ? undefined : box.heightPx,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      '--chip-color': chipColor,
                      '--chip-slot': `${box.heightPx}px`,
                      '--chip-open': `${box.openPx}px`,
                      '--chip-lines': Math.max(1, Math.floor((box.heightPx - 26) / 16)),
                      '--motion-p': stageProgress(motionStage),
                      touchAction: live?.eventId === event.id ? 'none' : 'pan-y',
                    } as React.CSSProperties
                  }
                  // While an action runs, the tooltip says which server step it is on.
                  title={motionStage ? t(`tasks.toast.progress.${motionStage}`) : tooltipText(event)}
                >
                  {onEventTimeChange && !locked ? (
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
                      !onEventTimeChange ? 'cursor-pointer' : locked ? 'cursor-not-allowed' : 'cursor-grab'
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
                    <span className="calendar-chip__title pr-4">
                      {completed ? (
                        <span className="calendar-chip__check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                      {chipLabel(event)}
                    </span>
                    <span className="calendar-chip__sub">
                      {renderEventMeta ? renderEventMeta(event, completed) : null}
                      <span className="calendar-chip__time">{timeText}</span>
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
                  {onEventTimeChange && !locked ? (
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
                <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ide-error" />
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
