import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Phase } from './entities/phase.entity';
import { PhasesService } from './phases.service';
import { PhasesController } from './phases.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Phase])],
  providers: [PhasesService],
  controllers: [PhasesController],
  exports: [PhasesService],
})
export class PhasesModule {} 