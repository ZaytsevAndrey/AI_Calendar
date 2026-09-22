import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { JwtExceptionFilter } from '../../src/modules/auth/jwt-exception.filter';
import { GoogleCalendarService } from '../../src/modules/google-calendar/google-calendar.service';
import { GroqClient } from '../../src/modules/voice/groq.client';
import { ScheduleJobProcessor } from '../../src/modules/schedule/schedule-job.processor';
import { ReminderTickProcessor } from '../../src/modules/reminders/reminder-tick.processor';
import { ScheduleJobService } from '../../src/modules/schedule/schedule-job.service';
import { ScheduleJob } from '../../src/modules/schedule/entities/schedule-job.entity';
import { createGoogleCalendarStub, GoogleCalendarStub } from './google.stub';
import { createGroqStub, GroqStub } from './groq.stub';

export type E2eApp = {
  app: NestFastifyApplication;
  google: GoogleCalendarStub;
  groq: GroqStub;
  sqlitePath: string;
  drainJobs: () => Promise<void>;
};

export async function createTestApp(): Promise<E2eApp> {
  const sqlitePath = join(tmpdir(), `ai-cal-e2e-${randomUUID()}.sqlite`);
  process.env.SQLITE_PATH = sqlitePath;
  process.env.DATABASE_URL = '';
  process.env.TYPEORM_SYNC = 'true';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-jwt-secret';

  const google = createGoogleCalendarStub();
  const groq = createGroqStub();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(GoogleCalendarService)
    .useValue(google)
    .overrideProvider(GroqClient)
    .useValue(groq)
    .overrideProvider(ScheduleJobProcessor)
    .useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
    })
    .overrideProvider(ReminderTickProcessor)
    .useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
    })
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 15 * 1024 * 1024 }),
    { logger: false },
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new JwtExceptionFilter());

  const fastify = app.getHttpAdapter().getInstance();
  fastify.get('/health', async () => ({ status: 'ok' }));

  await app.init();
  await fastify.ready();

  const jobs = app.get(ScheduleJobService);
  const jobRepo = app.get<Repository<ScheduleJob>>(
    getRepositoryToken(ScheduleJob),
  );
  const drainJobs = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        await jobs.processNextPending();
      } catch {
        break;
      }
      const active = await jobRepo.count({
        where: { status: In(['pending', 'running']) },
      });
      if (active === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  return { app, google, groq, sqlitePath, drainJobs };
}

export async function closeTestApp(ctx: E2eApp | undefined): Promise<void> {
  if (!ctx?.app) return;
  try {
    await ctx.drainJobs();
  } catch {
    // App may already be tearing down.
  }
  await ctx.app.close();
  try {
    unlinkSync(ctx.sqlitePath);
  } catch {
    // Windows may keep the sqlite handle briefly; the OS temp dir will reclaim it.
  }
}
