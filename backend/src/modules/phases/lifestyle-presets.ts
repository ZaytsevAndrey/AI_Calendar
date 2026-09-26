/** Ready-made day phases, sized from the user's wake and sleep clocks. */

import { isAppLanguage, t, type AppLanguage, type MessageKey } from '../../i18n';

export const PHASE_PRESET_IDS = ['working', 'student', 'open'] as const;

export type PhasePresetId = (typeof PHASE_PRESET_IDS)[number];

export interface LifestylePhaseBlock {
  name: string;
  color: string;
  description: string;
  startTime: string;
  endTime: string;
}

const MIN_BLOCK_MINUTES = 30;

type BlockSpec = {
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  color: string;
} & (
  | { place: 'afterWake'; offsetMin: number; durationMin: number }
  | { place: 'beforeSleep'; durationMin: number }
  | { place: 'fill' }
);

const PRESETS: Record<PhasePresetId, BlockSpec[]> = {
  working: [
    {
      place: 'afterWake',
      nameKey: 'preset.working.deepWork.name',
      descriptionKey: 'preset.working.deepWork.description',
      color: '#1d4ed8',
      offsetMin: 0,
      durationMin: 180,
    },
    {
      place: 'afterWake',
      nameKey: 'preset.working.meetings.name',
      descriptionKey: 'preset.working.meetings.description',
      color: '#7c3aed',
      offsetMin: 180,
      durationMin: 180,
    },
    {
      place: 'beforeSleep',
      nameKey: 'preset.working.lifeAdmin.name',
      descriptionKey: 'preset.working.lifeAdmin.description',
      color: '#0f766e',
      durationMin: 120,
    },
  ],
  student: [
    {
      place: 'afterWake',
      nameKey: 'preset.student.classes.name',
      descriptionKey: 'preset.student.classes.description',
      color: '#1d4ed8',
      offsetMin: 0,
      durationMin: 240,
    },
    {
      place: 'afterWake',
      nameKey: 'preset.student.study.name',
      descriptionKey: 'preset.student.study.description',
      color: '#15803d',
      offsetMin: 240,
      durationMin: 180,
    },
    {
      place: 'beforeSleep',
      nameKey: 'preset.student.freeTime.name',
      descriptionKey: 'preset.student.freeTime.description',
      color: '#c2410c',
      durationMin: 120,
    },
  ],
  open: [
    {
      place: 'afterWake',
      nameKey: 'preset.open.morningFocus.name',
      descriptionKey: 'preset.open.morningFocus.description',
      color: '#1d4ed8',
      offsetMin: 0,
      durationMin: 180,
    },
    {
      place: 'afterWake',
      nameKey: 'preset.open.errands.name',
      descriptionKey: 'preset.open.errands.description',
      color: '#c2410c',
      offsetMin: 180,
      durationMin: 120,
    },
    {
      place: 'beforeSleep',
      nameKey: 'preset.open.windDown.name',
      descriptionKey: 'preset.open.windDown.description',
      color: '#0f766e',
      durationMin: 120,
    },
    {
      place: 'fill',
      nameKey: 'preset.open.personalProjects.name',
      descriptionKey: 'preset.open.personalProjects.description',
      color: '#7c3aed',
    },
  ],
};

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes: number): string {
  const minutesInDay = 24 * 60;
  const wrapped = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Minutes from wake until sleep. Equal clocks mean a full 24h window. */
export function awakeDurationMinutes(wakeTime: string, sleepTime: string): {
  wakeMin: number;
  duration: number;
} {
  const wakeMin = timeToMinutes(wakeTime);
  const sleepMin = timeToMinutes(sleepTime);
  const duration =
    sleepMin > wakeMin ? sleepMin - wakeMin : sleepMin + 24 * 60 - wakeMin;
  return { wakeMin, duration };
}

/**
 * Place catalog blocks inside the awake window.
 * Blocks that start after wake keep their offset and shrink at the sleep edge.
 * Blocks before sleep shrink or drop when earlier blocks already occupy that time.
 * A fill block takes the gap after wake-anchored blocks, stopping at the
 * before-sleep block when one was placed, otherwise running until sleep.
 * Anything shorter than 30 minutes is omitted.
 */
export function buildLifestylePresetBlocks(
  presetId: PhasePresetId,
  wakeTime: string,
  sleepTime: string,
  language: string = 'en',
): LifestylePhaseBlock[] {
  const lang: AppLanguage = isAppLanguage(language) ? language : 'en';
  const { wakeMin, duration } = awakeDurationMinutes(wakeTime, sleepTime);
  const specs = PRESETS[presetId];
  const placed: { start: number; end: number; place: BlockSpec['place'] }[] = [];
  const blocks: LifestylePhaseBlock[] = [];

  const push = (spec: BlockSpec, start: number, end: number) => {
    if (end - start < MIN_BLOCK_MINUTES) return;
    placed.push({ start, end, place: spec.place });
    blocks.push({
      name: t(lang, spec.nameKey),
      color: spec.color,
      description: t(lang, spec.descriptionKey),
      startTime: formatClock(wakeMin + start),
      endTime: formatClock(wakeMin + end),
    });
  };

  let occupied = 0;
  for (const spec of specs) {
    if (spec.place !== 'afterWake') continue;
    const start = Math.max(spec.offsetMin, occupied);
    if (start >= duration) continue;
    const end = Math.min(start + spec.durationMin, duration);
    const before = placed.length;
    push(spec, start, end);
    if (placed.length > before) occupied = placed[placed.length - 1].end;
  }

  for (const spec of specs) {
    if (spec.place !== 'beforeSleep') continue;
    let start = Math.max(0, duration - spec.durationMin);
    const end = duration;
    const overlapEnd = placed.reduce((max, block) => {
      const overlaps = block.start < end && block.end > start;
      return overlaps ? Math.max(max, block.end) : max;
    }, start);
    push(spec, overlapEnd, end);
  }

  for (const spec of specs) {
    if (spec.place !== 'fill') continue;
    const afterEnds = placed
      .filter((block) => block.place === 'afterWake')
      .map((block) => block.end);
    if (afterEnds.length === 0) continue;
    const beforeStarts = placed
      .filter((block) => block.place === 'beforeSleep')
      .map((block) => block.start);
    const start = Math.max(...afterEnds);
    const end = beforeStarts.length > 0 ? Math.min(...beforeStarts) : duration;
    push(spec, start, end);
  }

  return blocks;
}
