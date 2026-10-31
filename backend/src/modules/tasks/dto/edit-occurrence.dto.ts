import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type OccurrenceEditScope = 'occurrence' | 'following';
export type OccurrenceStatus = 'todo' | 'completed';

/**
 * Change one day of a series (`scope: occurrence`, default) or this day and
 * the following ones (`scope: following`) without touching the rest of the
 * series. Only the fields present are changed.
 */
export class EditOccurrenceDto {
  @ApiProperty({
    description: 'Start instant of the occurrence being changed (ISO 8601).',
    example: '2026-09-21T06:00:00.000Z',
  })
  @IsDateString()
  occurrenceStart: string;

  @ApiProperty({ required: false, enum: ['occurrence', 'following'], default: 'occurrence' })
  @IsIn(['occurrence', 'following'])
  @IsOptional()
  scope?: OccurrenceEditScope;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  name?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  description?: string | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Phase for the changed occurrence(s); empty = any time.',
  })
  @IsArray()
  @ArrayMaxSize(1)
  @IsUUID('4', { each: true })
  @IsOptional()
  phaseIds?: string[];

  @ApiProperty({
    required: false,
    description: 'New start instant (ISO 8601). Must stay on the occurrence day.',
  })
  @IsDateString()
  @IsOptional()
  start?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  @IsOptional()
  durationMinutes?: number;

  @ApiProperty({
    required: false,
    enum: ['todo', 'completed'],
    description: 'Completion of this one occurrence (scope: occurrence only).',
  })
  @IsIn(['todo', 'completed'])
  @IsOptional()
  status?: OccurrenceStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  googleEventId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  googleEventCalendarId?: string;
}
