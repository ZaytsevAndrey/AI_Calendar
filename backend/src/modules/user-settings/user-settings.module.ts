import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSettingsService } from './user-settings.service';
import { UserSettingsController } from './user-settings.controller';
import { UserSettings } from './entities/user-settings.entity';
import { PhasesModule } from '../phases/phases.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserSettings]), PhasesModule],
  controllers: [UserSettingsController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class UserSettingsModule {}
