import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventPhase } from './event-phase.entity';
import { EventPhasesService } from './event-phases.service';
import { EventPhasesController } from './event-phases.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EventPhase])],
  providers: [EventPhasesService],
  controllers: [EventPhasesController],
  exports: [EventPhasesService],
})
export class EventPhasesModule {} 