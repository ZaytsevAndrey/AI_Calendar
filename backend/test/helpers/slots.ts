import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduledTask } from '../../src/modules/schedule/schedule.entity';

/**
 * Write one slot row directly, as a test fixture. Slots have no public write
 * API (placement writes them; PE-30 removed `POST /schedule`).
 */
export async function seedSlot(
  app: NestFastifyApplication,
  taskId: unknown,
  startIso: string,
  endIso: string,
): Promise<ScheduledTask> {
  const repo = app.get<Repository<ScheduledTask>>(getRepositoryToken(ScheduledTask));
  return repo.save(
    repo.create({
      taskId: String(taskId),
      scheduledStartTime: new Date(startIso),
      scheduledEndTime: new Date(endIso),
    }),
  );
}
