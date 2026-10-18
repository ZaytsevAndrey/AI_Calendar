import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ScheduledTask } from './schedule.entity';
import { ScheduleJob } from './entities/schedule-job.entity';
import { IntelligentSchedulingEngine } from './intelligent-scheduling.engine';
import { ScheduleJobService } from './schedule-job.service';
import { RecurringExtendProcessor } from './recurring-extend.processor';
import { ScheduleJobController } from './schedule-job.controller';
import { DisplayedEventMoveService } from './displayed-event-move.service';
import { ConflictOptionPhrasesService } from './conflict-option-phrases.service';
import { FreeSlotsService } from './free-slots.service';
import { PlacementStepService } from './placement-step.service';
import { TasksModule } from '../tasks/tasks.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { Task } from '../tasks/entities/task.entity';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';
import { PhasesModule } from '../phases/phases.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledTask, ScheduleJob, Task]),
    forwardRef(() => TasksModule),
    UserSettingsModule,
    GoogleCalendarModule,
    CalendarProvidersModule,
    PhasesModule,
    forwardRef(() => VoiceModule),
  ],
  controllers: [ScheduleController, ScheduleJobController],
  providers: [
    ScheduleService,
    IntelligentSchedulingEngine,
    ScheduleJobService,
    RecurringExtendProcessor,
    DisplayedEventMoveService,
    ConflictOptionPhrasesService,
    FreeSlotsService,
    PlacementStepService,
  ],
  exports: [ScheduleService, ScheduleJobService, PlacementStepService],
})
export class ScheduleModule {}
