import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsDateString,
  Min,
  Max,
  IsArray,
  IsUUID,
} from 'class-validator';
import { TaskPriority } from '../entities/task.entity';
import { TaskEventType } from '../../scheduling/event-type.enum';

export class CreateTaskDto {
  @ApiProperty({ example: 'Complete project report', description: 'Task name' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Write a detailed report about project progress',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Primary phase ID (legacy); optional if phaseIds set',
    required: false,
  })
  @IsString()
  @IsOptional()
  phaseId?: string;

  @ApiProperty({
    description: 'Phase IDs whose windows are eligible for scheduling (union)',
    required: false,
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  phaseIds?: string[];

  @ApiProperty({
    enum: TaskEventType,
    default: TaskEventType.ADMIN,
    required: false,
  })
  @IsEnum(TaskEventType)
  @IsOptional()
  eventType?: TaskEventType;

  @ApiProperty({
    example: 60,
    description: 'Estimated duration in minutes (defaults by event type if omitted)',
    required: false,
  })
  @IsInt()
  @Min(1)
  @Max(1440)
  @IsOptional()
  estimatedTimeInMinutes?: number;

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recurrencePattern?: string;

  @ApiProperty({ default: true, required: false })
  @IsBoolean()
  @IsOptional()
  allowSplit?: boolean;

  @ApiProperty({
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
    required: false,
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  deadline?: string;

  @ApiProperty({
    description: 'Required for FIXED type: block start (ISO 8601)',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduledStartTime?: string;

  @ApiProperty({
    description: 'Required for FIXED type: block end (ISO 8601)',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduledEndTime?: string;
}
