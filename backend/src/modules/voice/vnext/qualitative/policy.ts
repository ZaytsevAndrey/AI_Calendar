import type { TimeOfDayLabelV1 } from '../contracts/types';

/**
 * Numeric mappings that already exist in documentation/spec-voice-agent.md.
 * Evening, night, after lunch, and after work are not given a clock there.
 * The specialist prompt's ~14:00 / ~18:00 values are not copied.
 */

export type QualitativeBound = 'at' | 'until' | 'not_before';

export type QualitativeDecision =
  | { status: 'window'; earliestHm: string; deadlineHm: string; source: 'spec-morning' }
  | { status: 'deadline'; hm: string; source: 'spec-midday' | 'spec-until-sleep' }
  | { status: 'earliest'; hm: string; source: 'spec-wake' }
  | { status: 'unmapped' };

function addMinutes(hm: string, minutes: number): string {
  const [hour, minute] = hm.split(':').map(Number);
  const total = (((hour * 60 + minute + minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

export function mapQualitative(input: {
  label: TimeOfDayLabelV1;
  bound: QualitativeBound;
  wakeHm: string;
  sleepHm: string;
}): QualitativeDecision {
  if (input.label === 'morning' && input.bound === 'at') {
    return {
      status: 'window',
      earliestHm: input.wakeHm,
      deadlineHm: addMinutes(input.wakeHm, 180),
      source: 'spec-morning',
    };
  }
  if (input.label === 'midday' && (input.bound === 'at' || input.bound === 'until')) {
    return { status: 'deadline', hm: '12:00', source: 'spec-midday' };
  }
  if (input.label === 'evening' && input.bound === 'until') {
    return { status: 'deadline', hm: input.sleepHm, source: 'spec-until-sleep' };
  }
  return { status: 'unmapped' };
}
