import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/entities/task.entity';
import { PlacementStepService } from './placement-step.service';
import { shouldEnqueueRecurringExtend } from './recurring-extend.util';

/** How often we append missing series days and purge past problematic copies. */
const TICK_MS = 60 * 60 * 1000;
const RECURRING_EXTEND_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

@Injectable()
export class RecurringExtendProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringExtendProcessor.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly lastAppendAt = new Map<string, Date>();

  constructor(
    private readonly placementStep: PlacementStepService,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.tick();
    }, 30_000);
    this.interval = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async tick(): Promise<void> {
    try {
      const purged = await this.placementStep.purgePastProblematicCopies();
      if (purged > 0) {
        this.logger.log(`Purged ${purged} past problematic cop(ies)`);
      }
      const appended = await this.appendDueUsers();
      if (appended > 0) {
        this.logger.log(`Appended missing series days for ${appended} user(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Recurring extend tick error: ${message}`);
    }
  }

  private async appendDueUsers(limit = 10): Promise<number> {
    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('DISTINCT task.userId', 'userId')
      .where('task.isRecurring = :recurring', { recurring: true })
      .andWhere('task.isUnscheduled = :unscheduled', { unscheduled: false })
      .andWhere('task.status = :status', { status: 'todo' })
      .getRawMany<{ userId: string }>();
    const now = new Date();
    let count = 0;
    for (const row of rows) {
      if (count >= limit) break;
      const userId = row.userId;
      if (
        !shouldEnqueueRecurringExtend({
          hasActiveRecurring: true,
          hasPendingOrRunningJob: false,
          lastExtendAt: this.lastAppendAt.get(userId) ?? null,
          now,
          minIntervalMs: RECURRING_EXTEND_MIN_INTERVAL_MS,
        })
      ) {
        continue;
      }
      await this.placementStep.appendMissingSeriesDays(userId);
      this.lastAppendAt.set(userId, now);
      count += 1;
    }
    return count;
  }
}
