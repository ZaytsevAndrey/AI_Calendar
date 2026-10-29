import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ApiErrorLog } from './entities/api-error-log.entity';
import type { ApiErrorEntry } from '../../common/api-error-sink';

export const API_ERROR_RETENTION_DAYS = 14;
const PRUNE_EVERY = 200;

/** Writes API errors for the admin console. Runs in the client API. */
@Injectable()
export class ApiErrorLogService {
  private readonly logger = new Logger(ApiErrorLogService.name);
  private writes = 0;

  constructor(
    @InjectRepository(ApiErrorLog)
    private readonly repo: Repository<ApiErrorLog>,
  ) {}

  async record(entry: ApiErrorEntry): Promise<void> {
    try {
      await this.repo.insert(entry);
      this.writes += 1;
      if (this.writes % PRUNE_EVERY === 1) {
        const cutoff = new Date(Date.now() - API_ERROR_RETENTION_DAYS * 86_400_000);
        await this.repo.delete({ createdAt: LessThan(cutoff) });
      }
    } catch (err: unknown) {
      // Never log through the exception path again: that could loop.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`api error log write failed: ${msg}`);
    }
  }
}
