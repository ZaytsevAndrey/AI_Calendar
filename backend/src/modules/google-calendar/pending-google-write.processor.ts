import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PendingGoogleWriteService } from './pending-google-write.service';

/** Retry failed Google writes often enough to catch rate limits without hammering. */
const TICK_MS = 60 * 1000;

@Injectable()
export class PendingGoogleWriteProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingGoogleWriteProcessor.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly pending: PendingGoogleWriteService) {}

  onModuleInit() {
    setTimeout(() => {
      void this.tick();
    }, 45_000);
    this.interval = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async tick(): Promise<void> {
    try {
      const done = await this.pending.processQueue();
      if (done > 0) {
        this.logger.log(`Sent ${done} pending Google write(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pending Google write tick error: ${message}`);
    }
  }
}
