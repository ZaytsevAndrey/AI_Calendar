import { addDaysToYmd, nextWeekdayYmd, scheduleTodayYmd } from '../../voice-local-date.util';
import type { SemanticConstraintV1 } from '../contracts/types';
import { mapQualitative } from '../qualitative/policy';
import { resolveZonedClock } from './resolve-clock';

export type TurnClock = {
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
};

export type ResolvedWhen =
  | { status: 'none' }
  | { status: 'ymd'; ymd: string }
  | { status: 'instant'; iso: string; role: string }
  | { status: 'window'; earliestHm: string; deadlineHm: string; ymd?: string; source: string }
  | { status: 'deadline_hm'; hm: string; ymd?: string; source: string }
  | { status: 'duration'; minutes: number }
  | { status: 'preserved'; label: string }
  | { status: 'needs_day'; precision: 'week' | 'month' }
  | { status: 'gap' }
  | { status: 'fold' }
  | { status: 'invalid_date' }
  | { status: 'all_day' }
  | { status: 'past' }
  | { status: 'conflicting_day' };

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

/** Compute instants from structured constraints. Does not read the transcript. */
export function resolveConstraints(constraints: SemanticConstraintV1[], clock: TurnClock): ResolvedWhen[] {
  const today = scheduleTodayYmd(clock.nowIso, clock.timeZone, clock.wakeHm, clock.sleepHm);
  const results: ResolvedWhen[] = [];
  let ymd = today;
  let explicitDay = false;
  let weekdayToday = false;
  let dayUnresolved = false;
  if (conflictingDaySources(constraints)) return [{ status: 'conflicting_day' }];
  const ordered = [...constraints].sort((left, right) => dayPrecedence(left) - dayPrecedence(right));
  for (const constraint of ordered) {
    if (constraint.kind === 'date') {
      if (constraint.precision !== 'day') {
        dayUnresolved = true;
        results.push({ status: 'needs_day', precision: constraint.precision });
        continue;
      }
      if (!constraint.value) {
        results.push({ status: 'invalid_date' });
        continue;
      }
      explicitDay = true;
      ymd = constraint.value;
      results.push({ status: 'ymd', ymd });
      continue;
    }
    if (constraint.kind === 'weekday') {
      const current = nextWeekdayYmd(today, constraint.weekday);
      ymd = constraint.which === 'this' && current === today ? today : current;
      if (constraint.which === 'next' && ymd === today) ymd = addDaysToYmd(ymd, 7);
      weekdayToday = constraint.which === 'this' && ymd === today;
      explicitDay = true;
      results.push({ status: 'ymd', ymd });
      continue;
    }
    if (constraint.kind === 'relative_time' && constraint.anchor === 'now' && constraint.unit && constraint.amount != null) {
      if (constraint.unit === 'day') {
        const direction = constraint.direction === 'before' ? -1 : 1;
        ymd = addDaysToYmd(today, direction * constraint.amount);
        explicitDay = true;
        results.push({ status: 'ymd', ymd });
        continue;
      }
      const minutes = constraint.unit === 'hour' ? constraint.amount * 60 : constraint.amount;
      const signed = constraint.direction === 'before' ? -minutes : minutes;
      results.push({ status: 'instant', iso: addMinutes(clock.nowIso, signed), role: 'start' });
      continue;
    }
    if (constraint.kind === 'relative_time' && constraint.anchor === 'day_start' && constraint.unit === 'hour' && constraint.amount != null) {
      const start = `${ymd}T${clock.wakeHm}`;
      results.push({ status: 'preserved', label: `${constraint.direction} ${start}` });
      continue;
    }
    if (constraint.kind === 'clock') {
      if (dayUnresolved) continue;
      const resolved = resolveZonedClock(ymd, constraint.value, clock.timeZone);
      if (resolved.status === 'gap') results.push({ status: 'gap' });
      else if (resolved.status === 'fold') results.push({ status: 'fold' });
      else if (!explicitDay && Date.parse(resolved.iso) < Date.parse(clock.nowIso)) results.push({ status: 'past' });
      else if (weekdayToday && resolved.status === 'ok' && Date.parse(resolved.iso) < Date.parse(clock.nowIso)) {
        const rolled = resolveZonedClock(addDaysToYmd(ymd, 7), constraint.value, clock.timeZone);
        if (rolled.status === 'gap' || rolled.status === 'fold') results.push({ status: rolled.status });
        else results.push({ status: 'instant', iso: rolled.iso, role: constraint.role });
      }
      else results.push({ status: 'instant', iso: resolved.iso, role: constraint.role });
      continue;
    }
    if (constraint.kind === 'duration') {
      results.push({ status: 'duration', minutes: constraint.minutes });
      continue;
    }
    if (constraint.kind === 'time_of_day') {
      const mapped = mapQualitative({
        label: constraint.label,
        bound: constraint.bound ?? 'at',
        wakeHm: clock.wakeHm,
        sleepHm: clock.sleepHm,
      });
      if (mapped.status === 'window') {
        results.push({ status: 'window', earliestHm: mapped.earliestHm, deadlineHm: mapped.deadlineHm, ymd, source: mapped.source });
      } else if (mapped.status === 'deadline') {
        results.push({ status: 'deadline_hm', hm: mapped.hm, ymd, source: mapped.source });
      } else results.push({ status: 'preserved', label: constraint.label });
      continue;
    }
    if (constraint.kind === 'day_bound') {
      const hm = constraint.edge === 'wake' ? clock.wakeHm : clock.sleepHm;
      if (constraint.role === 'deadline') results.push({ status: 'deadline_hm', hm, ymd, source: 'settings' });
      else results.push({ status: 'window', earliestHm: hm, deadlineHm: clock.sleepHm, ymd, source: 'settings' });
      continue;
    }
    if (constraint.kind === 'all_day') {
      results.push({ status: 'all_day' });
      continue;
    }
    if (constraint.kind === 'recurrence' || constraint.kind === 'ordering') {
      results.push({ status: 'preserved', label: constraint.kind });
    }
  }
  return results;
}

/** A day constraint has to be known before a clock on that day is resolved. */
function dayPrecedence(constraint: SemanticConstraintV1): number {
  if (constraint.kind === 'date' || constraint.kind === 'weekday') return 0;
  if (constraint.kind === 'relative_time' && constraint.unit === 'day') return 1;
  return 2;
}

function isDaySource(constraint: SemanticConstraintV1): boolean {
  if (constraint.kind === 'date' || constraint.kind === 'weekday') return true;
  return constraint.kind === 'relative_time' && constraint.unit === 'day' && constraint.amount != null && constraint.anchor === 'now';
}

function conflictingDaySources(constraints: SemanticConstraintV1[]): boolean {
  return constraints.filter(isDaySource).length > 1;
}
