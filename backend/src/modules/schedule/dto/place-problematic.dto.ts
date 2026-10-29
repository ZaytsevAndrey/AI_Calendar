import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class PlaceProblematicDto {
  @ApiProperty({ description: 'Chosen start of the free slot' })
  @IsDateString()
  start: string;

  @ApiProperty({ description: 'Chosen end of the free slot' })
  @IsDateString()
  end: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Phase of the chosen slot. Empty clears the phase; omitted keeps it',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  phaseIds?: string[];

  @ApiProperty({
    required: false,
    description: 'Parked series day (YYYY-MM-DD). Required for a recurring task',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurrenceYmd?: string;
}

export type PlaceProblematicResult = {
  /** Task that now owns the slot: the task itself, its day copy, or the series it merged into. */
  taskId: string;
  start: string;
  end: string;
};
