export const SCHEDULE_RECOMMENDATION_KINDS = [
  'overload',
  'gap',
  'phase_mismatch',
  'deadline_risk',
] as const;

export type ScheduleRecommendationKind =
  (typeof SCHEDULE_RECOMMENDATION_KINDS)[number];

export type ScheduleRecommendation = {
  kind: ScheduleRecommendationKind;
  title: string;
  detail: string;
  taskId: string | null;
};

export type ScheduleRecommendations = {
  summary: string;
  suggestions: ScheduleRecommendation[];
};

export const EMPTY_SCHEDULE_RECOMMENDATIONS: ScheduleRecommendations = {
  summary: 'Nothing to review yet. Add tasks or generate a schedule first.',
  suggestions: [],
};

export const MAX_SUGGESTIONS = 5;

export const SCHEDULE_RECOMMENDATIONS_SYSTEM_PROMPT = `You review a personal calendar and suggest concrete improvements. Reply with one JSON object only:
{"summary":"one sentence","suggestions":[{"kind":"overload"|"gap"|"phase_mismatch"|"deadline_risk","title":"short label","detail":"what to change and why, naming the task","taskId":"id from tasks or null"}]}
Rules:
- At most 5 suggestions.
- overload: too much work on one day. gap: open time that could hold waiting work. phase_mismatch: a task sits outside its phase window. deadline_risk: a deadline is soon or already missed, or unscheduled work has a deadline.
- taskId must be copied from the tasks list, or null. Never invent ids.
- Advice only. Do not tell the user you changed anything.
- If the snapshot is already reasonable, return an empty suggestions array and say so in summary.
- Do not treat sleep as work to schedule.
- Times are local wall clocks in the snapshot time zone.
- If externalCalendar is "unavailable", do not claim the day has no meetings.
- Write in English.`;

const KIND_SET = new Set<string>(SCHEDULE_RECOMMENDATION_KINDS);

export function formatInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
}

export function clockHm(value: string | null | undefined): string {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? '');
  return match ? `${match[1]}:${match[2]}` : (value ?? '').trim();
}

export function clipText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function parseScheduleRecommendations(
  raw: string,
  allowedTaskIds: ReadonlySet<string>,
): ScheduleRecommendations | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const summary =
    typeof record.summary === 'string' && record.summary.trim()
      ? clipText(record.summary, 280)
      : 'No concrete changes suggested.';
  const list = Array.isArray(record.suggestions) ? record.suggestions : [];
  const suggestions: ScheduleRecommendation[] = [];
  for (const item of list) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const suggestion = readSuggestion(item, allowedTaskIds);
    if (suggestion) suggestions.push(suggestion);
  }
  return { summary, suggestions };
}

function readSuggestion(
  item: unknown,
  allowedTaskIds: ReadonlySet<string>,
): ScheduleRecommendation | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !KIND_SET.has(record.kind)) return null;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  if (typeof record.detail !== 'string' || !record.detail.trim()) return null;
  let taskId: string | null = null;
  if (record.taskId != null && record.taskId !== '') {
    if (typeof record.taskId !== 'string' || !allowedTaskIds.has(record.taskId)) {
      return null;
    }
    taskId = record.taskId;
  }
  return {
    kind: record.kind as ScheduleRecommendationKind,
    title: clipText(record.title, 120),
    detail: clipText(record.detail, 400),
    taskId,
  };
}
