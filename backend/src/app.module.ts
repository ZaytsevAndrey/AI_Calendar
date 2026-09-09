import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { UserSettingsModule } from './modules/user-settings/user-settings.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';
import { EventPhasesModule } from './modules/event-phases/event-phases.module';
import { PhasesModule } from './modules/phases/phases.module';
import { VoiceModule } from './modules/voice/voice.module';
import { HabitsModule } from './modules/habits/habits.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { createTypeOrmOptions } from './database/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createTypeOrmOptions({
          ...process.env,
          DATABASE_URL: config.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL,
          SQLITE_PATH: config.get<string>('SQLITE_PATH') ?? process.env.SQLITE_PATH,
          TYPEORM_SYNC: config.get<string>('TYPEORM_SYNC') ?? process.env.TYPEORM_SYNC,
          DATABASE_SSL: config.get<string>('DATABASE_SSL') ?? process.env.DATABASE_SSL,
        }),
    }),
    AuthModule,
    UsersModule,
    UserSettingsModule,
    ScheduleModule,
    TasksModule,
    GoogleCalendarModule,
    EventPhasesModule,
    PhasesModule,
    VoiceModule,
    HabitsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
