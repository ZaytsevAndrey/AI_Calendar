import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from '../phases/entities/phase.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { GroqClient } from './groq.client';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [TypeOrmModule.forFeature([Phase, Task, ScheduledTask]), UserSettingsModule],
  controllers: [VoiceController],
  providers: [VoiceService, GroqClient],
  exports: [GroqClient],
})
export class VoiceModule {}
