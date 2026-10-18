import type {
  DayPlanProposal,
  DayPlanProposalItem,
  VoiceIntentExecutionStatus,
  VoiceWriteIntent,
} from 'api/voice.api';

export type ChangePreviewKind =
  | 'create'
  | 'move'
  | 'edit'
  | 'delete'
  | 'complete'
  | 'skip'
  | 'cancel'
  | 'window'
  | 'shift'
  | 'end_series'
  | 'other';

export type ChangePreviewCard = {
  id: string;
  name: string;
  kind: ChangePreviewKind;
  startIso: string | null;
  endIso: string | null;
  durationMinutes: number | null;
  color: string;
  /** Day plan: new or moved since the previous revision. */
  changed?: boolean;
  /** After apply: what happened to this intent. */
  status?: VoiceIntentExecutionStatus;
};

const PLAN_SOURCE_KIND: Record<DayPlanProposalItem['source'], ChangePreviewKind> = {
  new: 'create',
  flexible: 'shift',
  unscheduled: 'window',
};

const DEFAULT_COLOR = '#039be5';
const DELETE_COLOR = '#e67c73';
const COMPLETE_COLOR = '#33b679';
const SKIP_COLOR = '#f6c026';

const KIND_LABEL_KEY: Record<ChangePreviewKind, string> = {
  create: 'voice.previewCreate',
  move: 'voice.previewMove',
  edit: 'voice.previewEdit',
  delete: 'voice.previewDelete',
  complete: 'voice.previewComplete',
  skip: 'voice.previewSkip',
  cancel: 'voice.previewCancel',
  window: 'voice.previewWindow',
  shift: 'voice.previewShift',
  end_series: 'voice.previewEndSeries',
  other: 'voice.previewEdit',
};

export function changePreviewKindLabelKey(kind: ChangePreviewKind): string {
  return KIND_LABEL_KEY[kind];
}

function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / 60000));
}

function colorForKind(kind: ChangePreviewKind): string {
  if (kind === 'delete' || kind === 'cancel' || kind === 'end_series') return DELETE_COLOR;
  if (kind === 'complete') return COMPLETE_COLOR;
  if (kind === 'skip') return SKIP_COLOR;
  return DEFAULT_COLOR;
}

function kindFromCommand(kind: string): ChangePreviewKind {
  switch (kind) {
    case 'move':
    case 'shift':
    case 'window':
    case 'complete':
    case 'skip':
    case 'delete':
    case 'cancel':
    case 'end_series':
      return kind;
    case 'update':
      return 'edit';
    default:
      return 'other';
  }
}

function cardFromIntent(intent: VoiceWriteIntent, index: number): ChangePreviewCard {
  if (intent.type === 'create') {
    const task = intent.task;
    const startIso = task.scheduledStartTime || task.earliestStartTime || null;
    const endIso = task.scheduledEndTime || null;
    const duration =
      typeof task.estimatedTimeInMinutes === 'number' && task.estimatedTimeInMinutes > 0
        ? task.estimatedTimeInMinutes
        : minutesBetween(startIso, endIso);
    return {
      id: `create-${index}-${task.name}`,
      name: task.name || intent.summary,
      kind: 'create',
      startIso,
      endIso,
      durationMinutes: duration,
      color: colorForKind('create'),
    };
  }

  const command = intent.command;
  const kind = kindFromCommand(String(command.kind || ''));
  let startIso: string | null = null;
  let endIso: string | null = null;

  if ('start' in command && typeof command.start === 'string') startIso = command.start;
  if ('end' in command && typeof command.end === 'string') endIso = command.end;
  if (!startIso && 'scheduledStartTime' in command && typeof command.scheduledStartTime === 'string') {
    startIso = command.scheduledStartTime;
  }
  if (!endIso && 'scheduledEndTime' in command && typeof command.scheduledEndTime === 'string') {
    endIso = command.scheduledEndTime;
  }
  if (!startIso && 'occurrenceStart' in command && typeof command.occurrenceStart === 'string') {
    startIso = command.occurrenceStart;
  }

  const name =
    ('taskName' in command && typeof command.taskName === 'string' && command.taskName) ||
    intent.summary ||
    kind;

  return {
    id: `command-${index}-${String(command.taskId || name)}-${kind}`,
    name,
    kind,
    startIso,
    endIso,
    durationMinutes: minutesBetween(startIso, endIso),
    color: colorForKind(kind),
  };
}

export function buildChangePreviewCards(input: {
  intents?: VoiceWriteIntent[] | null;
  plan?: DayPlanProposal | null;
  statuses?: VoiceIntentExecutionStatus[] | null;
}): ChangePreviewCard[] {
  if (input.plan?.items?.length) {
    const changed = new Set(input.plan.changedItemIds ?? []);
    return input.plan.items.map((item) => {
      const kind = PLAN_SOURCE_KIND[item.source] ?? 'window';
      return {
        id: `plan-${item.itemId}`,
        name: item.name,
        kind,
        startIso: item.start,
        endIso: item.end,
        durationMinutes: item.durationMinutes || minutesBetween(item.start, item.end),
        color: colorForKind(kind),
        changed: changed.has(item.itemId),
      };
    });
  }

  const intents = input.intents?.filter(Boolean) ?? [];
  return intents.map((intent, index) => ({
    ...cardFromIntent(intent, index),
    status: input.statuses?.[index],
  }));
}
