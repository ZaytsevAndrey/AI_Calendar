import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ScheduleJobService } from './schedule-job.service';

@Injectable()
export class ScheduleJobProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleJobProcessor.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly scheduleJobService: ScheduleJobService) {}

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.scheduleJobService.processNextPending().catch((err) => {
        this.logger.error(`Schedule job processor error: ${err}`);
      });
    }, 2000);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }
}
