import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RemindersService } from './reminders.service';

const TICK_MS = 60_000;

@Injectable()
export class ReminderTickProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderTickProcessor.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly reminders: RemindersService) {}

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.reminders.dispatchDue().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Reminder tick error: ${message}`);
      });
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }
}
