export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const m = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function snapMinutes(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

export interface ActiveWindow {
  start: number;
  end: number;
  spansNextDay: boolean;
}

export function resolveActiveWindow(
  wakeTime: string,
  sleepTime: string,
): ActiveWindow {
  const start = timeToMinutes(wakeTime);
  const rawEnd = timeToMinutes(sleepTime);
  const spansNextDay = rawEnd <= start;
  const end = spansNextDay ? rawEnd + 24 * 60 : rawEnd;
  return { start, end, spansNextDay };
}

export function toActiveWindowMinutes(
  minutes: number,
  window: ActiveWindow,
): number {
  if (!window.spansNextDay) return minutes;
  return minutes < window.start ? minutes + 24 * 60 : minutes;
}

export function resolvePhaseRangeInActiveWindow(
  startTime: string,
  endTime: string,
  window: ActiveWindow,
): { start: number; end: number } {
  const start = toActiveWindowMinutes(timeToMinutes(startTime), window);
  let end = toActiveWindowMinutes(timeToMinutes(endTime), window);
  if (end <= start) {
    end += 24 * 60;
  }
  return { start, end };
}

export function isRangeWithinActiveWindow(
  startTime: string,
  endTime: string,
  wakeTime: string,
  sleepTime: string,
): boolean {
  const window = resolveActiveWindow(wakeTime, sleepTime);
  const range = resolvePhaseRangeInActiveWindow(startTime, endTime, window);
  return range.start >= window.start && range.end <= window.end;
}