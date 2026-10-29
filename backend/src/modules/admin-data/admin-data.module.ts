import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceTurnLog } from './entities/voice-turn-log.entity';
import { ApiErrorLog } from './entities/api-error-log.entity';
import { VoiceTurnLogService } from './voice-turn-log.service';
import { ApiErrorLogService } from './api-error-log.service';

/**
 * The client API's only admin-related part: it writes the voice request log and
 * the API error log that the separate admin API reads. No admin routes here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VoiceTurnLog, ApiErrorLog])],
  providers: [VoiceTurnLogService, ApiErrorLogService],
  exports: [VoiceTurnLogService, ApiErrorLogService],
})
export class AdminDataModule {}
