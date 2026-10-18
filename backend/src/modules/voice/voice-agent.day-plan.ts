import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlacementStepService } from '../schedule/placement-step.service';
import type { PlacementPlan } from '../schedule/placement-step.util';
import { TaskEventType } from '../scheduling/event-type.enum';
import {
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import type {
  DayPlanProposal,
  DayPlanProposalItem,
  DayPlanUnplaced,
  DayPlanUnplacedReason,
  PlanDraft,
  PlanItem,
} from './voice-agent.types';
import { endOfLocalDayIso, localDateTimeIso } from './voice-local-date.util';

/**
 * Turns a day-plan draft into a preview through the placement engine (dry-run).
 * Items are seated in draft order; each seated item blocks the next ones.
 * Nothing is written; Apply goes through the client like any other intent.
 */
@Injectable()
export class VoiceDayPlanner {
  private readonly logger = new Logger(VoiceDayPlanner.name);

  constructor(
    @Inject(forwardRef(() => PlacementStepService))
    private readonly placement: PlacementStepService,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
  ) {}

  async propose(
    userId: string,
    draft: PlanDraft,
    timeZone: string,
  ): Promise<DayPlanProposal> {
    const existingIds = draft.items
      .map((item) => item.taskId)
      .filter((id): id is string => Boolean(id));
    const existing = existingIds.length
      ? await this.tasksRepository.find({
          where: { userId, id: In(existingIds) },
          relations: ['phase', 'phases'],
        })
      : [];
    const byId = new Map(existing.map((task) => [task.id, task]));

    const entries = draft.items
      .map((item) => {
        const base = item.taskId ? byId.get(item.taskId) : null;
        if (item.taskId && !base) return null;
        return {
          item,
          task: draftTaskFor(item, base ?? null, userId, draft.day, timeZone),
          preferredStart: item.preferredHm
            ? new Date(localDateTimeIso(draft.day, item.preferredHm, timeZone))
            : null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    let plans: PlacementPlan[];
    try {
      plans = await this.placement.previewSequence(userId, {
        windowYmd: draft.day,
        entries: entries.map(({ task, preferredStart }) => ({ task, preferredStart })),
        ignoreTaskIds: existingIds,
      });
    } catch (err) {
      this.logger.warn(
        `Day-plan preview failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      plans = entries.map(() => ({ outcome: 'problematic', reason: 'preview_failed' }));
    }

    const items: DayPlanProposalItem[] = [];
    const unplaced: DayPlanUnplaced[] = [];
    entries.forEach(({ item }, index) => {
      const plan = plans[index];
      if (plan?.outcome === 'seated') {
        items.push({
          itemId: item.id,
          taskId: item.taskId,
          source: item.source,
          name: item.name,
          start: new Date(plan.start).toISOString(),
          end: new Date(plan.end).toISOString(),
          durationMinutes: item.durationMinutes,
        });
        return;
      }
      unplaced.push({ itemId: item.id, name: item.name, reason: unplacedReason(plan) });
    });
    items.sort((a, b) => a.start.localeCompare(b.start));

    return {
      day: draft.day,
      stage: draft.stage,
      revision: draft.revision + 1,
      items,
      unplaced,
      changedItemIds: changedSince(draft.lastProposal, items, unplaced),
    };
  }
}

function unplacedReason(plan: PlacementPlan | undefined): DayPlanUnplacedReason {
  if (plan?.outcome === 'unscheduled') return 'deadline_passed';
  if (plan?.outcome === 'conflict') return 'conflict';
  return 'no_room';
}

/** Unsaved copy the engine seats: plan constraints override the stored row. */
function draftTaskFor(
  item: PlanItem,
  base: Task | null,
  userId: string,
  day: string,
  timeZone: string,
): Task {
  const earliest = item.earliestHm
    ? new Date(localDateTimeIso(day, item.earliestHm, timeZone))
    : (base?.earliestStartTime ?? null);
  const deadline = item.deadlineHm
    ? new Date(localDateTimeIso(day, item.deadlineHm, timeZone))
    : (base?.deadline ?? new Date(endOfLocalDayIso(day, timeZone)));
  const fresh = {
    id: item.id,
    userId,
    name: item.name,
    eventType: TaskEventType.ADMIN,
    status: TaskStatus.TODO,
    isRecurring: false,
    isFixedExternal: false,
    allowSplit: false,
    phase: null,
    phases: [],
    phaseId: null,
  };
  return {
    ...(base ?? fresh),
    scheduleState: ScheduleState.NONE,
    isUnscheduled: false,
    scheduledStartTime: null,
    scheduledEndTime: null,
    estimatedTimeInMinutes: item.durationMinutes,
    earliestStartTime: earliest,
    deadline,
  } as unknown as Task;
}

function changedSince(
  previous: DayPlanProposal | null,
  items: DayPlanProposalItem[],
  unplaced: DayPlanUnplaced[],
): string[] {
  if (!previous) return [];
  const before = new Map(previous.items.map((item) => [item.itemId, item]));
  const wasUnplaced = new Set(previous.unplaced.map((row) => row.itemId));
  const changed: string[] = [];
  for (const item of items) {
    const prior = before.get(item.itemId);
    if (!prior || prior.start !== item.start || prior.end !== item.end) {
      changed.push(item.itemId);
    }
  }
  for (const row of unplaced) {
    if (!wasUnplaced.has(row.itemId)) changed.push(row.itemId);
  }
  return changed;
}
