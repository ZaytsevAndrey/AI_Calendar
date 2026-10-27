/**
 * Fixed planner world for the regression benchmark.
 * Tool JSON follows VoiceAgentTools. No database and no external calendar.
 */
import { buildPlannerUserPrompt } from '../../src/modules/voice/voice-agent.planner.prompt';
import type { PlanDraft, VoiceSessionTurn } from '../../src/modules/voice/voice-agent.types';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';

export const CLOCK = {
  nowIso: '2026-10-18T06:00:00.000Z',
  timeZone: 'Europe/Kyiv',
  today: '2026-10-18',
  tomorrow: '2026-10-19',
  friday: '2026-10-23',
  wake: '08:00',
  sleep: '23:00',
  nowLocal: '09:00',
} as const;

export type BenchWorldId = 'default' | 'empty-tomorrow';

type Slot = { taskId: string; name: string; start: string; end: string; eventType: string };

const ZVIT: Slot = {
  taskId: 'task-zvit',
  name: 'Звіт',
  start: '2026-10-18T06:00:00.000Z',
  end: '2026-10-18T07:00:00.000Z',
  eventType: 'task',
};

const NARADA: Slot = {
  taskId: 'task-narada',
  name: 'Нарада',
  start: '2026-10-19T08:00:00.000Z',
  end: '2026-10-19T09:00:00.000Z',
  eventType: 'event',
};

const REMINDERS = [
  {
    name: 'Ліки',
    dueYmd: CLOCK.tomorrow,
    overdueDays: 0,
    notificationTime: '08:00',
    recurrencePattern: null,
  },
];

const UNSCHEDULED = [
  { taskId: 'task-tax', name: 'Податки', deadline: null, estimatedTimeInMinutes: 30 },
];

export function slotsFor(world: BenchWorldId): Slot[] {
  return world === 'empty-tomorrow' ? [ZVIT] : [ZVIT, NARADA];
}

export function interviewPlan(): PlanDraft {
  return {
    day: CLOCK.today,
    stage: 'interview',
    interviewAsked: 1,
    items: [
      {
        id: 'task-zvit',
        taskId: 'task-zvit',
        source: 'flexible',
        name: 'Звіт',
        durationMinutes: 60,
        preferredHm: null,
        earliestHm: null,
        deadlineHm: null,
      },
    ],
    revision: 1,
    nextNewId: 1,
    lastProposal: null,
  };
}

export function executeTool(world: BenchWorldId, call: VoiceToolCall): unknown {
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const dayRaw = String(args.day ?? args.ymd ?? '');
  switch (call.name) {
    case 'get_now_next':
      return {
        nowLocal: CLOCK.nowLocal,
        today: CLOCK.today,
        now: { taskId: ZVIT.taskId, name: ZVIT.name, start: ZVIT.start, end: ZVIT.end },
        next: null,
      };
    case 'get_day_agenda': {
      const day = resolveDay(dayRaw);
      if (!day) return { error: 'invalid_day' };
      const items = slotsFor(world).filter((slot) => slot.start.slice(0, 10) === day || kyivDay(slot.start) === day);
      return {
        day,
        items: items.map((slot) => ({
          taskId: slot.taskId,
          name: slot.name,
          start: slot.start,
          end: slot.end,
          eventType: slot.eventType,
        })),
        count: items.length,
      };
    }
    case 'list_unscheduled':
      return { count: UNSCHEDULED.length, items: UNSCHEDULED };
    case 'list_problematic':
      return { count: 0, items: [] };
    case 'list_reminders':
      return { reminders: REMINDERS };
    case 'find_free_gaps': {
      const day = resolveDay(dayRaw);
      if (!day) return { error: 'invalid_day' };
      return {
        day,
        gaps: [{ start: `${day}T10:00:00`, end: `${day}T23:00:00`, minutes: 780 }],
      };
    }
    case 'match_task': {
      const query = String(args.query ?? args.name ?? '').trim().toLowerCase();
      const named = [
        { taskId: ZVIT.taskId, name: ZVIT.name, isUnscheduled: false },
        { taskId: NARADA.taskId, name: NARADA.name, isUnscheduled: false },
        { taskId: 'task-gym', name: 'Gym', isUnscheduled: false },
        { taskId: 'task-tax', name: 'Податки', isUnscheduled: true },
      ];
      const matches = query ? named.filter((row) => row.name.toLowerCase().includes(query)).slice(0, 8) : [];
      return { query, matches };
    }
    case 'get_task': {
      const id = String(args.taskId ?? args.id ?? '');
      const slot = slotsFor(world).find((row) => row.taskId === id);
      if (!slot) return { error: 'Task not found' };
      return {
        taskId: slot.taskId,
        name: slot.name,
        status: 'open',
        eventType: slot.eventType,
        isUnscheduled: false,
        scheduledStartTime: slot.start,
        scheduledEndTime: slot.end,
      };
    }
    default:
      return { error: `Unknown tool: ${call.name}` };
  }
}

export function userPrompt(input: {
  utterance: string;
  history?: VoiceSessionTurn[];
  toolResults?: Array<{ name: string; result: unknown }>;
  pendingClarification?: { segment: string; question: string } | null;
  pendingConfirmSummary?: string | null;
  planDraft?: PlanDraft | null;
}): string {
  return buildPlannerUserPrompt({
    transcript: input.utterance,
    timeZone: CLOCK.timeZone,
    nowIso: CLOCK.nowIso,
    todayYmd: CLOCK.today,
    wakeTime: CLOCK.wake,
    sleepTime: CLOCK.sleep,
    history: input.history ?? [],
    toolResults: input.toolResults ?? [],
    pendingConfirmSummary: input.pendingConfirmSummary ?? null,
    pendingClarification: input.pendingClarification ?? null,
    planDraft: input.planDraft ?? null,
  });
}

function resolveDay(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text || text === 'today') return CLOCK.today;
  if (text === 'tomorrow') return CLOCK.tomorrow;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

function kyivDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLOCK.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
