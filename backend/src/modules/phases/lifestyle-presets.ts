/** Ready-made day phases, sized from the user's wake and sleep clocks. */

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
  name: string;
  color: string;
  description: string;
} & (
  | { place: 'afterWake'; offsetMin: number; durationMin: number }
  | { place: 'beforeSleep'; durationMin: number }
  | { place: 'fill' }
);

const PRESETS: Record<PhasePresetId, BlockSpec[]> = {
  working: [
    {
      place: 'afterWake',
      name: 'Deep work',
      color: '#1d4ed8',
      description: 'Focused work at the start of the day',
      offsetMin: 0,
      durationMin: 180,
    },
    {
      place: 'afterWake',
      name: 'Meetings',
      color: '#7c3aed',
      description: 'Calls and collaboration',
      offsetMin: 180,
      durationMin: 180,
    },
    {
      place: 'beforeSleep',
      name: 'Life admin',
      color: '#0f766e',
      description: 'Errands and admin before sleep',
      durationMin: 120,
    },
  ],
  student: [
    {
      place: 'afterWake',
      name: 'Classes',
      color: '#1d4ed8',
      description: 'Classes and lectures',
      offsetMin: 0,
      durationMin: 240,
    },
    {
      place: 'afterWake',
      name: 'Study',
      color: '#15803d',
      description: 'Focused study',
      offsetMin: 240,
      durationMin: 180,
    },
    {
      place: 'beforeSleep',
      name: 'Free time',
      color: '#c2410c',
      description: 'Unstructured time before sleep',
      durationMin: 120,
    },
  ],
  open: [
    {
      place: 'afterWake',
      name: 'Morning focus',
      color: '#1d4ed8',
      description: 'Deep work at the start of the day',
      offsetMin: 0,
      durationMin: 180,
    },
    {
      place: 'afterWake',
      name: 'Errands',
      color: '#c2410c',
      description: 'Errands after morning focus',
      offsetMin: 180,
      durationMin: 120,
    },
    {
      place: 'beforeSleep',
      name: 'Wind down',
      color: '#0f766e',
      description: 'Quiet time before sleep',
      durationMin: 120,
    },
    {
      place: 'fill',
      name: 'Personal projects',
      color: '#7c3aed',
      description: 'Project time between errands and wind down',
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
): LifestylePhaseBlock[] {
  const { wakeMin, duration } = awakeDurationMinutes(wakeTime, sleepTime);
  const specs = PRESETS[presetId];
  const placed: { start: number; end: number; place: BlockSpec['place'] }[] = [];
  const blocks: LifestylePhaseBlock[] = [];

  const push = (spec: BlockSpec, start: number, end: number) => {
    if (end - start < MIN_BLOCK_MINUTES) return;
    placed.push({ start, end, place: spec.place });
    blocks.push({
      name: spec.name,
      color: spec.color,
      description: spec.description,
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
