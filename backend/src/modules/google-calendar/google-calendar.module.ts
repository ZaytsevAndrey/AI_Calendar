import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';
import { UsersModule } from '../users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { EventPhasesModule } from '../event-phases/event-phases.module';
import { PhasesModule } from '../phases/phases.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PendingGoogleWrite } from './entities/pending-google-write.entity';
import { PendingGoogleWriteService } from './pending-google-write.service';
import { PendingGoogleWriteProcessor } from './pending-google-write.processor';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      UserSettings,
      PendingGoogleWrite,
      Task,
      ScheduledTask,
    ]),
    EventPhasesModule,
    PhasesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN') },
      }),
    }),
  ],
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarService,
    PendingGoogleWriteService,
    PendingGoogleWriteProcessor,
  ],
  exports: [GoogleCalendarService, PendingGoogleWriteService],
})
export class GoogleCalendarModule {}
