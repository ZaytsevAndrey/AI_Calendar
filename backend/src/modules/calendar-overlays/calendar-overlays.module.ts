import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarOverlaysController } from './calendar-overlays.controller';
import { CalendarOverlaysService } from './calendar-overlays.service';
import { CalendarEventOverlay } from './entities/calendar-event-overlay.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarEventOverlay]),
    forwardRef(() => TasksModule),
    GoogleCalendarModule,
    CalendarProvidersModule,
  ],
  controllers: [CalendarOverlaysController],
  providers: [CalendarOverlaysService],
  exports: [CalendarOverlaysService],
})
export class CalendarOverlaysModule {}
