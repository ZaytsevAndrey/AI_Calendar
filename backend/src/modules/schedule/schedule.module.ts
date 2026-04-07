import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ScheduledTask } from './schedule.entity';
import { ScheduleJob } from './entities/schedule-job.entity';
import { ScheduleUndoSnapshot } from './entities/schedule-undo-snapshot.entity';
import { IntelligentSchedulingEngine } from './intelligent-scheduling.engine';
import { ScheduleJobService } from './schedule-job.service';
import { ScheduleJobProcessor } from './schedule-job.processor';
import { ScheduleJobController } from './schedule-job.controller';
import { TasksModule } from '../tasks/tasks.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { Task } from '../tasks/entities/task.entity';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScheduledTask,
      ScheduleJob,
      ScheduleUndoSnapshot,
      Task,
    ]),
    forwardRef(() => TasksModule),
    UserSettingsModule,
    GoogleCalendarModule,
  ],
  controllers: [ScheduleController, ScheduleJobController],
  providers: [
    ScheduleService,
    IntelligentSchedulingEngine,
    ScheduleJobService,
    ScheduleJobProcessor,
  ],
  exports: [ScheduleService, ScheduleJobService],
})
export class ScheduleModule {}
