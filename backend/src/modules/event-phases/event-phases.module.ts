import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventPhase } from './event-phase.entity';
import { EventPhasesService } from './event-phases.service';
import { EventPhasesController } from './event-phases.controller';
import { PhasesModule } from '../phases/phases.module';

@Module({
  imports: [TypeOrmModule.forFeature([EventPhase]), PhasesModule],
  providers: [EventPhasesService],
  controllers: [EventPhasesController],
  exports: [EventPhasesService],
})
export class EventPhasesModule {} 