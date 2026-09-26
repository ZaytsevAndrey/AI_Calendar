import type { ConflictOptionId, SchedulingConflict } from './intelligent-scheduling.engine';

export type ConflictOptionPhrase = {
  id: ConflictOptionId;
  title: string;
  detail: string;
};

const FALLBACK: Record<
  ConflictOptionId,
  { title: string; detail: string }
> = {
  move_other: {
    title: 'Keep this time; move the other task',
    detail: 'Leave your preferred slot and shift the other movable work.',
  },
  move_new: {
    title: 'Place this task elsewhere',
    detail: 'Keep the other block; find the next free slot for this task.',
  },
  skip_occurrence: {
    title: 'Skip this occurrence',
    detail: 'Skip today’s occurrence for this series and keep the preferred clock.',
  },
  leave_problematic: {
    title: 'Park as problematic',
    detail: 'Leave it out of the schedule until you resolve it later.',
  },
};

export function fallbackConflictOptionPhrases(
  conflict: SchedulingConflict,
): ConflictOptionPhrase[] {
  return conflict.options.map((id) => ({
    id,
    title: FALLBACK[id]?.title ?? id,
    detail: FALLBACK[id]?.detail ?? '',
  }));
}

export function conflictPhrasingSystemPrompt(): string {
  return [
    'You phrase scheduling conflict choices for a calendar app.',
    'Reply with JSON only: {"options":[{"id":"...","title":"...","detail":"..."}]}',
    'Use only the option ids given. Keep titles short; details one sentence.',
    'Do not invent new option ids. English only.',
  ].join(' ');
}

export function conflictPhrasingUserPayload(conflict: SchedulingConflict): string {
  return JSON.stringify({
    taskName: conflict.taskName,
    reason: conflict.reason,
    options: conflict.options,
    meta: conflict.meta ?? {},
  });
}

export function parseConflictOptionPhrases(
  raw: string,
  conflict: SchedulingConflict,
): ConflictOptionPhrase[] {
  const fallback = fallbackConflictOptionPhrases(conflict);
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      options?: { id?: string; title?: string; detail?: string }[];
    };
    if (!Array.isArray(parsed.options)) return fallback;
    const byId = new Map(
      parsed.options
        .filter((o) => o && typeof o.id === 'string')
        .map((o) => [o.id as string, o]),
    );
    return conflict.options.map((id) => {
      const hit = byId.get(id);
      const base = FALLBACK[id];
      return {
        id,
        title:
          typeof hit?.title === 'string' && hit.title.trim()
            ? hit.title.trim()
            : base.title,
        detail:
          typeof hit?.detail === 'string' && hit.detail.trim()
            ? hit.detail.trim()
            : base.detail,
      };
    });
  } catch {
    return fallback;
  }
}
