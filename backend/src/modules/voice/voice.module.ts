import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from '../phases/entities/phase.entity';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { GroqClient } from './groq.client';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [TypeOrmModule.forFeature([Phase]), UserSettingsModule],
  controllers: [VoiceController],
  providers: [VoiceService, GroqClient],
})
export class VoiceModule {}
