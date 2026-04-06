import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { UserSettingsModule } from './modules/user-settings/user-settings.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';
import { EventPhasesModule } from './modules/event-phases/event-phases.module';
import { PhasesModule } from './modules/phases/phases.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'db.sqlite',
      entities: [__dirname + '/modules/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
    AuthModule,
    UsersModule,
    UserSettingsModule,
    ScheduleModule,
    TasksModule,
    GoogleCalendarModule,
    EventPhasesModule,
    PhasesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
