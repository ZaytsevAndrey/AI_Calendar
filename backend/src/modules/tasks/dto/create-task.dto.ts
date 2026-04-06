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
} from 'class-validator';
import { TaskPriority } from '../entities/task.entity';

export class CreateTaskDto {
  @ApiProperty({ example: 'Complete project report', description: 'Task name' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Write a detailed report about project progress',
    description: 'Task description',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Phase ID',
    required: false,
  })
  @IsString()
  @IsOptional()
  phaseId?: string;

  @ApiProperty({
    example: 60,
    description: 'Estimated time in minutes to complete the task',
  })
  @IsInt()
  @Min(1)
  @Max(1440) // Max 24 hours
  estimatedTimeInMinutes: number;

  @ApiProperty({
    example: false,
    description: 'Whether the task is recurring',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @ApiProperty({
    example: 'DAILY',
    description: 'Recurrence pattern for recurring tasks',
    required: false,
  })
  @IsString()
  @IsOptional()
  recurrencePattern?: string;

  @ApiProperty({
    example: true,
    description: 'Whether the task can be split into smaller blocks',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  allowSplit?: boolean;

  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.MEDIUM,
    description: 'Task priority',
    default: TaskPriority.MEDIUM,
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiProperty({
    example: '2023-12-31T23:59:59Z',
    description: 'Task deadline',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  deadline?: string;
}
