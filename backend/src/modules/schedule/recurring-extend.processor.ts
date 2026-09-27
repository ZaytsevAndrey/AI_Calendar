import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ScheduleJobService } from './schedule-job.service';

/** How often we look for users whose recurring horizon needs sliding forward. */
const TICK_MS = 60 * 60 * 1000;

@Injectable()
export class RecurringExtendProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringExtendProcessor.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly scheduleJobService: ScheduleJobService) {}

  onModuleInit() {
    // First pass after a short delay so boot is not competing with other ticks.
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
      const enqueued = await this.scheduleJobService.enqueueRecurringExtends();
      if (enqueued > 0) {
        this.logger.log(`Enqueued recurring extend for ${enqueued} user(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Recurring extend tick error: ${message}`);
    }
  }
}
