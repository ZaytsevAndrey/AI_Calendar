import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from './entities/phase.entity';
import { PhasesService } from './phases.service';
import { PhasesController } from './phases.controller';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Phase, UserSettings])],
  providers: [PhasesService],
  controllers: [PhasesController],
  exports: [PhasesService],
})
export class PhasesModule {} 