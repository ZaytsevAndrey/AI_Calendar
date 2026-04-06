import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';
import { UsersModule } from '../users/users.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { EventPhasesModule } from '../event-phases/event-phases.module';

@Module({
  imports: [
    UsersModule,
    UserSettingsModule,
    TypeOrmModule.forFeature([UserSettings]),
    EventPhasesModule,
  ],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
