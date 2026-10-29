import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduleModule } from '../schedule/schedule.module';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';
import { DayRemindersModule } from '../day-reminders/day-reminders.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { VoiceDailyUsage } from './entities/voice-daily-usage.entity';
import { AzureSttClient } from './azure-stt';
import { AzureTtsClient } from './azure-tts';
import { GroqClient } from './groq.client';
import { PiperSpeechService } from './piper-speech.service';
import { VoiceDayPlanner } from './voice-agent.day-plan';
import { VoiceAgentOrchestrator } from './voice-agent.orchestrator';
import { VoiceAgentTools } from './voice-agent.tools';
import { VoiceTraceInterceptor } from '../../common/voice-trace.interceptor';
import { VoiceController } from './voice.controller';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceService } from './voice.service';
import { VoiceSessionStore } from './voice-session.store';
import { StructuredVoiceService } from './vnext/production/structured-voice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Phase,
      Task,
      ScheduledTask,
      VoiceDailyUsage,
    ]),
    UserSettingsModule,
    DayRemindersModule,
    CalendarProvidersModule,
    forwardRef(() => ScheduleModule),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    GroqClient,
    AzureSttClient,
    AzureTtsClient,
    PiperSpeechService,
    VoiceSessionStore,
    VoiceQuotaService,
    VoiceAgentTools,
    VoiceDayPlanner,
    VoiceAgentOrchestrator,
    StructuredVoiceService,
    VoiceTraceInterceptor,
  ],
  exports: [GroqClient, VoiceQuotaService],
})
export class VoiceModule {}
