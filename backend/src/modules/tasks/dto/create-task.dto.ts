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
  ArrayMaxSize,
  ValidateIf,
  MaxLength,
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
  @ArrayMaxSize(1)
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

  @ApiProperty({
    description: 'Weekdays for recurrence (0 = Sunday … 6 = Saturday). Empty or omitted = every day.',
    required: false,
    type: [Number],
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  recurrenceWeekDays?: number[] | null;

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
    description:
      'Movable tasks: do not place before this instant (start of a day or a clock time). Null clears it. Survives replan.',
    required: false,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  @IsOptional()
  earliestStartTime?: string | null;

  @ApiProperty({
    description:
      'Movable non-recurring: only these weekdays inside the From–Until window (0 = Sunday … 6 = Saturday). Empty or omitted = any day in the window.',
    required: false,
    type: [Number],
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  eligibleWeekDays?: number[] | null;

  @ApiProperty({
    example: 'Asia/Nicosia',
    description:
      'IANA time zone for From/Until calendar days. Optional; defaults to the user Settings zone.',
    required: false,
  })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  timeZone?: string;

  @ApiProperty({
    description:
      'Exact start for fixed tasks, or preferred start window for movable tasks. Null clears it.',
    required: false,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  @IsOptional()
  scheduledStartTime?: string | null;

  @ApiProperty({
    description:
      'Exact end for fixed tasks, or preferred end window for movable tasks. Null clears it.',
    required: false,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  @IsOptional()
  scheduledEndTime?: string | null;
}
