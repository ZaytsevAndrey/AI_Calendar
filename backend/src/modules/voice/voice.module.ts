import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Habit } from '../habits/entities/habit.entity';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { VoiceDailyUsage } from './entities/voice-daily-usage.entity';
import { GroqClient } from './groq.client';
import { PiperSpeechService } from './piper-speech.service';
import { VoiceAgentOrchestrator } from './voice-agent.orchestrator';
import { VoiceAgentTools } from './voice-agent.tools';
import { VoiceController } from './voice.controller';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceService } from './voice.service';
import { VoiceSessionStore } from './voice-session.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Phase,
      Task,
      ScheduledTask,
      Habit,
      HabitCheckIn,
      VoiceDailyUsage,
    ]),
    UserSettingsModule,
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    GroqClient,
    PiperSpeechService,
    VoiceSessionStore,
    VoiceQuotaService,
    VoiceAgentTools,
    VoiceAgentOrchestrator,
  ],
  exports: [GroqClient],
})
export class VoiceModule {}
